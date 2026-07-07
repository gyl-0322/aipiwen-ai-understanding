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
assertHit('小学 7-12 写作业拖拉，一催就炸，不爱阅读', 'RKI-V1-029');
assertHit('初中 13-15 青春期顶嘴叛逆，一说就吵，手机游戏', 'RKI-V1-030');
assertHit('高中 16-18 文理选科，升学专业，考试焦虑', 'RKI-V1-031', {
  allowedStatuses: ['auto_safe', 'rewrite_required'],
});
assertHit('成人职场拖延，职业方向摇摆，边界压力和自我理解', 'RKI-V1-032');
assertHit('四个问题不要全部三段式，不要八股，学习方法可以观察清单', 'RKI-V1-033');
assertHit('成年人报告严正申明不要写您孩子，要按年龄称谓', 'RKI-V1-035');

assertHit('精神功能右拇高 目标感 开创力 对外主导 高于个人均值', 'RKI-V1.2-SPIRIT-R_HIGH');
assertHit('精神功能左拇低 自我管理 自律需要外部结构 低于个人均值', 'RKI-V1.2-SPIRIT-L_LOW');
assertHit('精神功能右拇高左拇低 先点火再搭轨道 左右差异', 'RKI-V1.2-SPIRIT-R_GT_L');
assertHit('精神功能双低 目标感和管理力都需要小胜利支持', 'RKI-V1.2-SPIRIT-BOTH_LOW');

assertHit('思维功能右食高 逻辑推理 数学 规则理解 高于个人均值', 'RKI-V1.2-THINK-R_HIGH');
assertHit('思维功能左食高右食低 空间创意多于语言表达', 'RKI-V1.2-THINK-L_GT_R');
assertHit('思维功能双高 逻辑空间都强 复杂理解 方案设计', 'RKI-V1.2-THINK-BOTH_HIGH');

assertHit('体觉功能右中低 写字慢 精细操作启动慢 拖拉', 'RKI-V1.2-BODY-R_LOW');
assertHit('体觉功能左中高右中低 大运动强但精细书写慢', 'RKI-V1.2-BODY-L_GT_R');
assertHit('体觉功能双低 身体入口需要温和带动 任务拆小', 'RKI-V1.2-BODY-BOTH_LOW');

assertHit('听觉功能右无名低 单靠口头讲解容易漏 需要写下来复述确认', 'RKI-V1.2-AUDIO-R_LOW');
assertHit('听觉功能左无名高 语气敏感 音感 言外之意 情绪声调', 'RKI-V1.2-AUDIO-L_HIGH');
assertHit('听觉功能双高 语言信息和声音情绪都敏感 语气过载', 'RKI-V1.2-AUDIO-BOTH_HIGH');

assertHit('视觉功能右小低 脸盲 方向感 外部视觉入口慢', 'RKI-V1.2-VISUAL-R_LOW');
assertHit('视觉功能左小高 图像审美 色彩 画面联想 视觉化材料', 'RKI-V1.2-VISUAL-L_HIGH');
assertHit('视觉功能左小高右小低 会画图却不记路 内在画面强', 'RKI-V1.2-VISUAL-L_GT_R');
assertHit('视觉功能双低 不要说没眼力见 视觉入口不是最省力通道', 'RKI-V1.2-VISUAL-BOTH_LOW');

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

const fourQuestionRiskResults = searchReportKnowledge('ADHD 抑郁 适不适合继续在一起 是否录用 保证升学', {
  allowedStatuses: ['auto_safe', 'human_only', 'blocked'],
});
assert(
  fourQuestionRiskResults.some(result => result.id === 'RKI-V1-034'),
  'four-question high-risk entry should be retrievable for guardrails'
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
