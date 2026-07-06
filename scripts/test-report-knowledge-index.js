const assert = require('assert');
const {
  loadReportKnowledgeIndex,
  searchReportKnowledge,
  buildReportGroundingBlock,
} = require('../lib/report-knowledge-index');

function assertHit(query, expectedId, options = {}) {
  const results = searchReportKnowledge(query, options);
  const ids = results.map(result => result.id);
  assert(
    ids.includes(expectedId),
    `Expected "${query}" to hit ${expectedId}, got ${ids.join(', ') || 'no hits'}`
  );
  return results;
}

const index = loadReportKnowledgeIndex();
assert.strictEqual(index.version, 'report_knowledge_index_v1');
assert(index.entries.length >= 10, 'index should include at least 10 entries');

assertHit('孩子写作业拖拉，明明会做就是不开始', 'RKI-V1-001');
assertHit('孩子一点就炸，容易生气顶嘴', 'RKI-V1-002');
assertHit('报告有些不像孩子，在学校和家里不一样', 'RKI-V1-003');
assertHit('孩子不主动学习，没有自驱力', 'RKI-V1-004');
assertHit('我一催他就炸，不知道怎么说才不吵', 'RKI-V1-005');
assertHit('孩子怕难，不自信，怕输', 'RKI-V1-006');
assertHit('孩子不爱阅读，看书注意力飘', 'RKI-V1-007');
assertHit('皮纹报告到底准不准，可以作为线索吗', 'RKI-V1-008');

const autoResults = searchReportKnowledge('孩子是不是有 ADHD 或心理疾病', {
  allowedStatuses: ['auto_safe'],
});
assert(
  !autoResults.some(result => result.id === 'RKI-V1-009'),
  'human-only medical/psychological entry must not be returned for auto output'
);

const guardedResults = searchReportKnowledge('孩子是不是有 ADHD 或心理疾病', {
  allowedStatuses: ['auto_safe', 'human_only'],
});
assert(
  guardedResults.some(result => result.id === 'RKI-V1-009'),
  'human-only medical/psychological entry should be retrievable for risk grounding'
);

const blockedResults = searchReportKnowledge('这个候选人适不适合录用，学生是否可以分班', {
  allowedStatuses: ['auto_safe', 'human_only', 'blocked'],
});
assert(
  blockedResults.some(result => result.id === 'RKI-V1-011'),
  'blocked enterprise/school screening entry should be retrievable for guardrails'
);

const groundingBlock = buildReportGroundingBlock(assertHit('写作业拖拉，不开始，被催就炸', 'RKI-V1-001'));
assert(groundingBlock.includes('Report Knowledge Index 命中内容'), 'grounding block should include header');
assert(!groundingBlock.includes('teacher_report_reading_001'), 'grounding block must not expose source paths');
assert(!groundingBlock.includes('/Users/'), 'grounding block must not expose local absolute paths');

console.log(JSON.stringify({
  ok: true,
  totalEntries: index.entries.length,
  sampleGroundingItems: groundingBlock.split('\n\n').length - 2,
}, null, 2));
