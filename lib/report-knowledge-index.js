const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_PATH = path.join(
  __dirname,
  '..',
  'data',
  'report-knowledge-index',
  'report-knowledge-index-v1.json'
);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function loadReportKnowledgeIndex(indexPath = DEFAULT_INDEX_PATH) {
  const raw = fs.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(raw);
  if (!Array.isArray(index.entries)) {
    throw new Error('Report knowledge index entries must be an array');
  }
  return index;
}

function scoreEntry(entry, queryText, options = {}) {
  const query = normalizeText(queryText);
  if (!query) return 0;

  const statusBoost = {
    auto_safe: 3,
    rewrite_required: 2,
    human_only: 1,
    blocked: 1,
  }[entry.status] || 0;

  let score = statusBoost;
  const fields = [
    entry.title,
    entry.safeGrounding,
    entry.outputGuidance,
    ...(entry.retrievalKeywords || []),
    ...(entry.scenarios || []),
    ...(entry.modules || []),
  ].map(normalizeText);

  for (const keyword of entry.retrievalKeywords || []) {
    const kw = normalizeText(keyword);
    if (kw && query.includes(kw)) score += 8;
  }

  for (const scenario of entry.scenarios || []) {
    const sc = normalizeText(scenario);
    if (sc && query.includes(sc)) score += 5;
  }

  for (const moduleName of options.modules || []) {
    if ((entry.modules || []).includes(moduleName)) score += 4;
  }

  for (const token of query.match(/[一-龥]{2,4}|[a-z0-9]{3,}/g) || []) {
    if (fields.some(field => field.includes(token))) score += 1;
  }

  return score;
}

function searchReportKnowledge(queryText, options = {}) {
  const index = options.index || loadReportKnowledgeIndex(options.indexPath);
  const topK = Math.min(
    Math.max(Number(options.topK || index.retrievalPolicy?.defaultTopK || 6), 1),
    Number(index.retrievalPolicy?.maxTopK || 8)
  );
  const allowedStatuses = options.allowedStatuses || index.retrievalPolicy?.allowedStatusesForPromptGrounding || [
    'auto_safe',
    'rewrite_required',
  ];

  return index.entries
    .filter(entry => allowedStatuses.includes(entry.status))
    .map(entry => ({ entry, score: scoreEntry(entry, queryText, options) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, topK)
    .map(result => ({
      id: result.entry.id,
      title: result.entry.title,
      status: result.entry.status,
      modules: result.entry.modules,
      scenarios: result.entry.scenarios,
      safeGrounding: result.entry.safeGrounding,
      outputGuidance: result.entry.outputGuidance,
      doNotUse: result.entry.doNotUse || [],
      sourceRefs: result.entry.sourceRefs || [],
      score: result.score,
    }));
}

function toTextTokens(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toTextTokens);
  if (typeof value === 'object') {
    return Object.values(value).flatMap(toTextTokens);
  }
  const text = String(value).trim();
  return text ? [text] : [];
}

function buildRetrievalQuery(parts) {
  return toTextTokens(parts).join(' ');
}

function mapRetrievalHits(queryText, options = {}) {
  const results = searchReportKnowledge(queryText, options);
  return results.map(result => ({
    id: result.id,
    title: result.title,
    status: result.status,
    modules: result.modules || [],
    scenarios: result.scenarios || [],
    safeGrounding: result.safeGrounding,
    outputGuidance: result.outputGuidance,
    doNotUse: result.doNotUse || [],
    score: result.score,
    canUseForAutoOutput: ['auto_safe', 'rewrite_required'].includes(result.status),
    needsRewrite: result.status === 'rewrite_required',
    isGuardrailOnly: ['human_only', 'blocked'].includes(result.status),
  }));
}

function buildReportKnowledgeRetrievalDryRun(input = {}, options = {}) {
  const index = options.index || loadReportKnowledgeIndex(options.indexPath);
  const topK = Math.min(Math.max(Number(options.topK || 5), 1), 8);
  const selectedIssues = input.selectedIssues || input.userQuestions || [];
  const reportModules = input.reportModules || input.modules || [];
  const functionAreas = input.functionAreas || input.fiveFunctions || [];
  const metrics = input.metrics || input.functionMetrics || {};

  const stages = [
    {
      stage: 'age_stage',
      purpose: '按年龄阶段和身份召回对应问题库，避免成人报告写成孩子语气，或所有年龄共用同一批问题。',
      query: buildRetrievalQuery([
        input.ageBand,
        input.lifeStage,
        input.userIdentity,
        input.reportSubject,
        input.subjectAge,
        selectedIssues,
      ]),
      allowedStatuses: ['auto_safe', 'rewrite_required'],
    },
    {
      stage: 'user_questions',
      purpose: '按用户选择的四个问题和自定义提问召回差异化回答库，避免四问正文一模一样。',
      query: buildRetrievalQuery([
        input.ageBand,
        input.userIntent,
        selectedIssues,
        input.customUserQuestion,
        input.reportTextSummary,
      ]),
      queries: [
        ...selectedIssues.map(issue => ({
          label: 'selected_issue',
          query: buildRetrievalQuery([input.ageBand, input.userIntent, issue]),
        })),
        {
          label: 'custom_user_question',
          query: buildRetrievalQuery([input.ageBand, input.userIntent, input.customUserQuestion]),
        },
      ],
      allowedStatuses: ['auto_safe', 'rewrite_required', 'human_only', 'blocked'],
    },
    {
      stage: 'fixed_modules',
      purpose: '按固定报告模块召回 TRC、ATD、左右脑、性格类型、学习通道、行为模式等表达底座。',
      query: buildRetrievalQuery([
        input.ageBand,
        reportModules,
        input.personalityType,
        input.learningChannel,
        input.behaviorPattern,
        input.trc,
        input.atd,
      ]),
      allowedStatuses: ['auto_safe', 'rewrite_required'],
      modules: reportModules,
    },
    {
      stage: 'five_functions',
      purpose: '按五大功能区和单指数据召回对应知识卡，避免把两根手指数值相加后再和平均值比较。',
      query: buildRetrievalQuery([
        input.ageBand,
        functionAreas,
        metrics,
      ]),
      queries: functionAreas.map(functionArea => ({
        label: functionArea,
        query: buildRetrievalQuery([
          input.ageBand,
          functionArea,
          metrics[functionArea] || metrics,
        ]),
      })),
      allowedStatuses: ['auto_safe', 'rewrite_required'],
    },
    {
      stage: 'risk_guardrails',
      purpose: '召回禁用边界和人工复核线索，保证高风险问题不进入自动结论。',
      query: buildRetrievalQuery([
        selectedIssues,
        input.customUserQuestion,
        input.riskSignals,
        input.reportTextSummary,
      ]),
      allowedStatuses: ['auto_safe', 'rewrite_required', 'human_only', 'blocked'],
    },
  ];

  const stageResults = stages.map(stage => {
    const rawQueries = (stage.queries || [{ label: stage.stage, query: stage.query }])
      .filter(item => normalizeText(item.query));
    const mergedHits = [];
    const seenHitIds = new Set();

    for (const item of rawQueries) {
      const hits = mapRetrievalHits(item.query, {
        index,
        topK,
        allowedStatuses: stage.allowedStatuses,
        modules: stage.modules,
      });
      for (const hit of hits) {
        if (!seenHitIds.has(hit.id)) {
          seenHitIds.add(hit.id);
          mergedHits.push(hit);
        }
      }
    }

    return {
      stage: stage.stage,
      purpose: stage.purpose,
      hasQuery: rawQueries.length > 0,
      queryCount: rawQueries.length,
      queryLabels: rawQueries.map(item => item.label).filter(Boolean),
      hitCount: mergedHits.length,
      hitIds: mergedHits.map(hit => hit.id),
      hits: mergedHits,
    };
  });

  const uniqueHitIds = [];
  const seen = new Set();
  for (const stage of stageResults) {
    for (const id of stage.hitIds) {
      if (!seen.has(id)) {
        seen.add(id);
        uniqueHitIds.push(id);
      }
    }
  }

  return {
    ok: true,
    dryRunOnly: true,
    indexVersion: index.version,
    totalEntries: index.entries.length,
    inputSummary: {
      ageBand: input.ageBand || '',
      userIdentity: input.userIdentity || '',
      reportSubject: input.reportSubject || '',
      selectedIssueCount: selectedIssues.length,
      hasCustomUserQuestion: Boolean(normalizeText(input.customUserQuestion)),
      reportModuleCount: reportModules.length,
      functionAreaCount: functionAreas.length,
    },
    stageResults,
    uniqueHitIds,
    summary: {
      stageCount: stageResults.length,
      stagesWithHits: stageResults.filter(stage => stage.hitCount > 0).map(stage => stage.stage),
      autoUsableHitCount: stageResults.flatMap(stage => stage.hits).filter(hit => hit.canUseForAutoOutput).length,
      guardrailHitCount: stageResults.flatMap(stage => stage.hits).filter(hit => hit.isGuardrailOnly).length,
    },
  };
}

function buildReportGroundingBlock(results, options = {}) {
  const maxItems = Math.max(Number(options.maxItems || 6), 1);
  const safeResults = (results || []).slice(0, maxItems);
  if (!safeResults.length) return '';

  const lines = safeResults.map((item, index) => {
    const sourceTags = (item.sourceRefs || [])
      .map(source => source.sourceType)
      .filter(Boolean)
      .join(', ');
    return [
      `${index + 1}. ${item.title}`,
      `可用方式：${item.safeGrounding}`,
      `输出提示：${item.outputGuidance}`,
      item.doNotUse?.length ? `禁用：${item.doNotUse.join(' / ')}` : '',
      sourceTags ? `来源类型：${sourceTags}` : '',
    ].filter(Boolean).join('\n');
  });

  return [
    '【Report Knowledge Index 命中内容｜仅作报告生成事实底座】',
    '使用规则：自然融入报告，不向用户展示来源路径，不照搬原文，不输出禁用表达。',
    ...lines,
  ].join('\n\n');
}

function uniqueDryRunHits(dryRun, predicate, maxItems) {
  const hits = [];
  const seen = new Set();
  for (const stage of dryRun?.stageResults || []) {
    for (const hit of stage.hits || []) {
      if (seen.has(hit.id)) continue;
      if (predicate && !predicate(hit, stage)) continue;
      seen.add(hit.id);
      hits.push(hit);
      if (maxItems && hits.length >= maxItems) return hits;
    }
  }
  return hits;
}

function buildRiskGroundingBlock(results, options = {}) {
  const maxItems = Math.max(Number(options.maxItems || 4), 1);
  const safeResults = (results || []).slice(0, maxItems);
  if (!safeResults.length) return '';

  return [
    '【Report Knowledge Index 安全边界命中｜只用于降级、禁用和转人工判断】',
    '使用规则：这些内容不得作为普通报告结论输出；遇到相关问题时，只能安全改写、降级或建议人工/专业支持。',
    ...safeResults.map((item, index) => [
      `${index + 1}. ${item.title}`,
      `边界：${item.safeGrounding}`,
      item.doNotUse?.length ? `禁用：${item.doNotUse.join(' / ')}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n\n');
}

function buildReportKnowledgePromptContext(input = {}, options = {}) {
  const dryRun = buildReportKnowledgeRetrievalDryRun(input, {
    index: options.index,
    indexPath: options.indexPath,
    topK: options.topK || 5,
  });
  const autoHits = uniqueDryRunHits(
    dryRun,
    hit => hit.canUseForAutoOutput,
    options.maxReportItems || 6
  );
  const guardrailHits = uniqueDryRunHits(
    dryRun,
    hit => hit.isGuardrailOnly,
    options.maxRiskItems || 4
  );

  return {
    ok: true,
    mode: 'v1.5_dry_run_context',
    reportKnowledgeBlock: buildReportGroundingBlock(autoHits, { maxItems: options.maxReportItems || 6 }),
    riskKnowledgeBlock: buildRiskGroundingBlock(guardrailHits, { maxItems: options.maxRiskItems || 4 }),
    retrievalSummary: {
      indexVersion: dryRun.indexVersion,
      totalEntries: dryRun.totalEntries,
      stageCount: dryRun.summary.stageCount,
      stagesWithHits: dryRun.summary.stagesWithHits,
      uniqueHitIds: dryRun.uniqueHitIds,
      autoUsableHitCount: autoHits.length,
      guardrailHitCount: guardrailHits.length,
    },
  };
}

module.exports = {
  DEFAULT_INDEX_PATH,
  loadReportKnowledgeIndex,
  searchReportKnowledge,
  buildReportKnowledgeRetrievalDryRun,
  buildReportKnowledgePromptContext,
  buildReportGroundingBlock,
  buildRiskGroundingBlock,
};
