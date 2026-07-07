const {
  loadReportKnowledgeIndex,
  searchReportKnowledge,
  buildReportGroundingBlock,
  buildKnowledgeTrace,
} = require('../lib/report-knowledge-retriever');

function assertCase(condition, message) {
  if (!condition) throw new Error(message);
}

function assertHits(name, query, predicate) {
  const hits = searchReportKnowledge(query, { topK: 8 });
  assertCase(hits.length > 0, `${name}: 应命中知识片段`);
  assertCase(predicate(hits), `${name}: 命中片段不符合预期\n${JSON.stringify(buildKnowledgeTrace(hits), null, 2)}`);
  return hits;
}

const index = loadReportKnowledgeIndex();
assertCase(index.chunkCount >= 20, '索引 chunk 数过少，不能证明真实接入');
assertCase(index.sourceStats.some(s => s.rootLabel === 'repo_report_os' && s.files > 0), '必须包含 repo Report OS 来源');
assertCase(index.sourceStats.some(s => s.rootLabel.startsWith('obsidian') && s.files > 0), '必须包含 Obsidian 来源');

const atdHits = assertHits('ATD', 'ATD 反应节奏 速度 敏感 学习方式', hits =>
  hits.some(hit => hit.tags.includes('atd') || /ATD|反应节奏|速度/.test(hit.text))
);

const riskHits = assertHits('risk', '孩子是不是 ADHD 心理疾病 诊断 治疗 风险', hits =>
  hits.some(hit => hit.riskLevel !== 'normal' || hit.tags.includes('risk'))
);

const parentHits = assertHits('parent_child', '孩子作业拖拉 家长怎么沟通 老人带娃冲突', hits =>
  hits.some(hit => hit.tags.includes('parent_child') || /孩子|家长|亲子|老人/.test(hit.text))
);

const block = buildReportGroundingBlock([...atdHits.slice(0, 1), ...riskHits.slice(0, 1), ...parentHits.slice(0, 1)]);
assertCase(block.includes('Report Knowledge RAG｜本次真实检索命中'), 'grounding block 必须声明真实检索命中');
assertCase(!/repo_report_os|obsidian_|\.md|三家精华|艾尔发|359|228|叠环境|宋老师|肖老师/.test(block), 'grounding block 不得暴露内部来源、文件名或外部机构痕迹');
const traces = [
  ...buildKnowledgeTrace(atdHits).slice(0, 1),
  ...buildKnowledgeTrace(riskHits).slice(0, 1),
  ...buildKnowledgeTrace(parentHits).slice(0, 1),
];
assertCase(traces.every(t => t.sourceRoot && t.sourcePath), 'debug trace 必须保留真实来源证据');

console.log(JSON.stringify({
  ok: true,
  chunkCount: index.chunkCount,
  sourceStats: index.sourceStats,
  samples: {
    atd: buildKnowledgeTrace(atdHits).slice(0, 3),
    risk: buildKnowledgeTrace(riskHits).slice(0, 3),
    parentChild: buildKnowledgeTrace(parentHits).slice(0, 3),
  },
}, null, 2));
