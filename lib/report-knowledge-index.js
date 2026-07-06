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

module.exports = {
  DEFAULT_INDEX_PATH,
  loadReportKnowledgeIndex,
  searchReportKnowledge,
  buildReportGroundingBlock,
};
