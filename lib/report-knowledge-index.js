const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_PATH = path.join(
  __dirname,
  '..',
  'data',
  'report-knowledge-index',
  'report-knowledge-index-v1.json'
);

let defaultIndexCache = null;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compatibleAgeBands(value) {
  const text = normalizeText(value);
  if (!text) return [];
  if (text.includes('3-6') || text.includes('0-6') || text.includes('幼儿')) return ['0-6', '3-6'];
  if (text.includes('7-12') || text.includes('小学')) return ['7-12'];
  if (text.includes('13-15') || text.includes('初中')) return ['13-15', '13-18'];
  if (text.includes('16-18') || text.includes('高中')) return ['16-18', '13-18'];
  if (text.includes('19-25')) return ['19-25'];
  if (text.includes('26-40')) return ['26-40', 'adult'];
  if (text.includes('40+') || text.includes('40岁') || text.includes('成熟')) return ['40+', 'adult'];
  return [];
}

function matchesAgeBand(entry, requestedAgeBand) {
  const requested = compatibleAgeBands(requestedAgeBand);
  const entryBands = entry.ageBands || [];
  if (!requested.length || !entryBands.length || entryBands.includes('all')) return true;
  return entryBands.some(ageBand => requested.includes(ageBand));
}

function loadReportKnowledgeIndex(indexPath = DEFAULT_INDEX_PATH) {
  if (indexPath === DEFAULT_INDEX_PATH && defaultIndexCache) return defaultIndexCache;
  const raw = fs.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(raw);
  if (!Array.isArray(index.entries)) {
    throw new Error('Report knowledge index entries must be an array');
  }
  if (indexPath === DEFAULT_INDEX_PATH) defaultIndexCache = index;
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
  ];

  return index.entries
    .filter(entry => allowedStatuses.includes(entry.status))
    .filter(entry => matchesAgeBand(entry, options.ageBand))
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
    canUseForAutoOutput: result.status === 'auto_safe',
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
      allowedStatuses: ['auto_safe'],
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
          label: `selected_issue:${issue}`,
          query: buildRetrievalQuery([input.ageBand, input.userIntent, issue]),
        })),
        ...(normalizeText(input.customUserQuestion) ? [{
          label: 'custom_user_question',
          query: buildRetrievalQuery([input.ageBand, input.userIntent, input.customUserQuestion]),
        }] : []),
      ],
      allowedStatuses: ['auto_safe', 'human_only', 'blocked'],
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
      allowedStatuses: ['auto_safe'],
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
      allowedStatuses: ['auto_safe'],
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
      allowedStatuses: ['auto_safe', 'human_only', 'blocked'],
    },
  ];

  const stageResults = stages.map(stage => {
    const rawQueries = (stage.queries || [{ label: stage.stage, query: stage.query }])
      .filter(item => normalizeText(item.query));
    const mergedHits = [];
    const seenHitIds = new Set();
    const queryResults = [];

    for (const item of rawQueries) {
      const hits = mapRetrievalHits(item.query, {
        index,
        topK,
        allowedStatuses: stage.allowedStatuses,
        modules: stage.modules,
        ageBand: input.ageBand,
      });
      queryResults.push({
        label: item.label,
        hitCount: hits.length,
        hits,
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
      queryResults,
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

function prioritizedDryRunHits(dryRun, stageOrder, predicate, maxItems) {
  const stages = new Map((dryRun?.stageResults || []).map(stage => [stage.stage, stage]));
  const orderedStages = [...new Set(stageOrder)].map(stage => stages.get(stage)).filter(Boolean);
  const hits = [];
  const seen = new Set();
  const addHit = (hit) => {
    if (!hit || seen.has(hit.id) || (predicate && !predicate(hit))) return false;
    seen.add(hit.id);
    hits.push(hit);
    return true;
  };

  for (const stage of orderedStages) {
    const perQueryQuota = stage.stage === 'five_functions' ? 2 : 1;
    if (stage.queryResults?.length) {
      for (const queryResult of stage.queryResults) {
        let addedForQuery = 0;
        for (const hit of queryResult.hits || []) {
          if (addHit(hit)) addedForQuery += 1;
          if (addedForQuery >= perQueryQuota) break;
          if (maxItems && hits.length >= maxItems) return hits;
        }
        if (maxItems && hits.length >= maxItems) return hits;
      }
    } else {
      const firstHit = (stage.hits || []).find(hit => !seen.has(hit.id) && (!predicate || predicate(hit)));
      addHit(firstHit);
      if (maxItems && hits.length >= maxItems) return hits;
    }
  }

  for (const stage of orderedStages) {
    for (const hit of stage.hits || []) {
      addHit(hit);
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
  const autoStageOrder = [
    ...(input.selectedIssues?.length || input.customUserQuestion ? ['user_questions'] : []),
    ...(input.functionAreas?.length ? ['five_functions'] : []),
    'age_stage',
    ...(input.reportModules?.length ? ['fixed_modules'] : []),
    'user_questions',
    'five_functions',
    'fixed_modules',
  ];
  const autoHits = prioritizedDryRunHits(
    dryRun,
    autoStageOrder,
    hit => hit.canUseForAutoOutput,
    options.maxReportItems || 6
  );
  const guardrailHits = prioritizedDryRunHits(
    dryRun,
    ['risk_guardrails', 'user_questions', 'age_stage'],
    hit => hit.isGuardrailOnly,
    options.maxRiskItems || 4
  );

  return {
    ok: true,
    mode: 'v1.5_prompt_context',
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
