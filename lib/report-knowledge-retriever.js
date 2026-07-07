const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'data', 'report-knowledge-index', 'report-knowledge-index-v1.json');
let cachedIndex = null;

function loadReportKnowledgeIndex() {
  if (cachedIndex) return cachedIndex;
  const raw = fs.readFileSync(INDEX_PATH, 'utf8');
  cachedIndex = JSON.parse(raw);
  return cachedIndex;
}

function tokenize(text) {
  const input = String(text || '').toLowerCase();
  const chinese = input.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const latin = input.match(/[a-z0-9_+-]{2,}/g) || [];
  const grams = [];
  for (const word of chinese) {
    if (word.length <= 4) grams.push(word);
    for (let i = 0; i < word.length - 1; i += 1) grams.push(word.slice(i, i + 2));
    for (let i = 0; i < word.length - 2; i += 1) grams.push(word.slice(i, i + 3));
  }
  return [...new Set([...chinese, ...latin, ...grams])].filter(t => t.length >= 2);
}

function boostForChunk(chunk, query) {
  let boost = 0;
  const q = String(query || '');
  if (/ATD|反应|节奏|速度/.test(q) && chunk.tags.includes('atd')) boost += 6;
  if (/TRC|容量|纹线|认知/.test(q) && chunk.tags.includes('trc')) boost += 6;
  if (/左右脑|左脑|右脑/.test(q) && chunk.tags.includes('brain')) boost += 5;
  if (/孩子|家长|亲子|作业|老人/.test(q) && chunk.tags.includes('parent_child')) boost += 5;
  if (/诊断|疾病|ADHD|心理|治疗|风险/.test(q) && chunk.tags.includes('risk')) boost += 8;
  if (/话术|怎么说|沟通|表达/.test(q) && chunk.tags.includes('language')) boost += 4;
  if (/职业|专业|升学|兴趣/.test(q) && chunk.tags.includes('learning')) boost += 4;
  if (chunk.sourceRoot.startsWith('obsidian')) boost += 2;
  return boost;
}

function scoreChunk(chunk, query, queryTokens) {
  const haystack = `${chunk.title}\n${chunk.tags.join(' ')}\n${chunk.text}`.toLowerCase();
  let score = boostForChunk(chunk, query);
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += token.length >= 3 ? 3 : 1;
  }
  if (score > 0 && chunk.riskLevel === 'guardrail' && /诊断|疾病|ADHD|心理|治疗|风险/.test(query)) score += 5;
  return score;
}

function searchReportKnowledge(query, options = {}) {
  const index = loadReportKnowledgeIndex();
  const queryTokens = tokenize(query);
  const topK = options.topK || 6;
  const riskMode = options.riskMode || 'include';
  const scored = index.chunks
    .filter(chunk => {
      if (riskMode === 'exclude' && chunk.riskLevel !== 'normal') return false;
      if (options.tags?.length && !options.tags.some(tag => chunk.tags.includes(tag))) return false;
      return true;
    })
    .map(chunk => ({ chunk, score: scoreChunk(chunk, query, queryTokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.updatedAt.localeCompare(a.chunk.updatedAt))
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      id: chunk.id,
      score,
      sourceRoot: chunk.sourceRoot,
      sourcePath: chunk.sourcePath,
      title: chunk.title,
      tags: chunk.tags,
      audience: chunk.audience,
      riskLevel: chunk.riskLevel,
      text: chunk.text,
    }));
  return scored;
}

function compactChunkText(text, maxChars = 420) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars)}…` : oneLine;
}

function sanitizeForPrompt(text) {
  return compactChunkText(text)
    .replace(/三家精华|艾尔发|359|228|叠环境/g, '内部来源')
    .replace(/宋老师|肖老师|得到大脑|小鹅通|鹅通/g, '课程资料')
    .replace(/[A-Za-z0-9_.-]+\.md/g, '资料片段');
}

function buildReportGroundingBlock(hits) {
  if (!hits?.length) {
    return '【Report Knowledge RAG】本次未命中可用知识片段。只能基于 engineResult 与固定规则输出，不得假称参考了知识库。';
  }
  const lines = [
    '【Report Knowledge RAG｜本次真实检索命中】',
    '使用规则：以下片段只用于增强解释、话术、边界和例子；不得暴露内部文件名、老师/机构来源名、索引编号给用户。',
  ];
  hits.forEach((hit, index) => {
    lines.push(`${index + 1}. 知识片段｜tags=${hit.tags.join(',')}｜risk=${hit.riskLevel}`);
    lines.push(`摘录：${sanitizeForPrompt(hit.text)}`);
  });
  return lines.join('\n');
}

function buildKnowledgeTrace(hits) {
  return (hits || []).map(hit => ({
    id: hit.id,
    score: hit.score,
    sourceRoot: hit.sourceRoot,
    sourcePath: hit.sourcePath,
    title: hit.title,
    tags: hit.tags,
    riskLevel: hit.riskLevel,
  }));
}

module.exports = {
  loadReportKnowledgeIndex,
  searchReportKnowledge,
  buildReportGroundingBlock,
  buildKnowledgeTrace,
  tokenize,
};
