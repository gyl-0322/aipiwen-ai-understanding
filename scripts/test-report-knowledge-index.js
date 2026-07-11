const assert = require('assert');
const {
  loadReportKnowledgeIndex,
  searchReportKnowledge,
  buildReportKnowledgeRetrievalDryRun,
  buildReportKnowledgePromptContext,
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
assertHit('幼儿 3-6 分离哭闹 不守规则 总说不要 情绪安抚', 'RKI-V1.3-PRESCHOOL-ROUTINE');
assertHit('幼儿坐不住 穿衣吃饭慢 体觉精细 身体控制', 'RKI-V1.3-PRESCHOOL-BODY');
assertHit('小学 7-12 作业拖拉 一催就炸 启动困难 任务颗粒度', 'RKI-V1.3-SCHOOL-HOMEWORK');
assertHit('小学不爱阅读 看书坐不住 放学沉默 同学冲突 手机停不下来', 'RKI-V1.3-SCHOOL-READING-SOCIAL');
assertHit('初中 13-15 青春期顶嘴 叛逆 一说就吵 手机游戏 边界', 'RKI-V1.3-JUNIOR-BOUNDARY');
assertHit('初中偏科 学习方法 考试焦虑 兴趣特长 同伴关系', 'RKI-V1.3-JUNIOR-STUDY-EMOTION');
assertHit('高中 16-18 文理选科 升学 专业 未来方向 迷茫', 'RKI-V1.3-SENIOR-EDUCATION', {
  allowedStatuses: ['auto_safe', 'rewrite_required'],
});
assertHit('高中考试焦虑 输不起 父母三观差 亲子压力', 'RKI-V1.3-SENIOR-STRESS-PARENT', {
  allowedStatuses: ['auto_safe', 'rewrite_required'],
});
assertHit('19-25 大学刚毕业 专业不喜欢 考研就业 找工作 考公', 'RKI-V1.3-YOUNG-CAREER');
assertHit('19-25 明知道要做就是拖 总想让别人满意 关系适不适合', 'RKI-V1.3-YOUNG-SELF-RELATION');
assertHit('26-40 职业瓶颈 转型 创业打工 团队角色 工作很累', 'RKI-V1.3-ADULT-WORK');
assertHit('26-40 育儿 吼孩子 伴侣沟通 夫妻教育观念 原生家庭', 'RKI-V1.3-ADULT-FAMILY');
assertHit('40+ 转型 再出发 带教 退休 价值感 经验传承', 'RKI-V1.3-MATURE-TRANSITION');
assertHit('40+ 家庭责任 空巢 子女沟通 养老照护 健康焦虑', 'RKI-V1.3-MATURE-FAMILY-SUPPORT', {
  allowedStatuses: ['auto_safe', 'rewrite_required'],
});
assertHit('成年人报告不要出现您孩子，本人视角，孩子青少年称谓不能混用', 'RKI-V1.3-AGE-TITLE-VOICE');

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

const juniorDryRun = buildReportKnowledgeRetrievalDryRun({
  ageBand: '初中13-15岁',
  userIdentity: 'parent',
  reportSubject: 'child',
  selectedIssues: [
    '开始顶嘴/叛逆，怎么沟通不炸',
    '考试焦虑/输不起怎么疏导',
    '这型孩子最怕的老师/课堂是什么',
  ],
  customUserQuestion: '孩子一说学习就烦，手机也很难约定边界',
  reportModules: ['TRC', 'ATD', '左右脑', '性格类型', '学习通道', '行为模式'],
  functionAreas: ['精神功能', '听觉功能'],
  metrics: {
    精神功能: {
      右拇: '高于个人均值，目标感和主导性明显',
      左拇: '低于个人均值，自我管理需要外部结构',
    },
    听觉功能: {
      右无名: '低于个人均值，口头提醒容易漏',
    },
  },
});

assert.strictEqual(juniorDryRun.ok, true);
assert.strictEqual(juniorDryRun.dryRunOnly, true);
assert(juniorDryRun.uniqueHitIds.includes('RKI-V1.3-JUNIOR-BOUNDARY'), 'junior dry-run should hit junior boundary card');
assert(juniorDryRun.uniqueHitIds.includes('RKI-V1.3-JUNIOR-STUDY-EMOTION'), 'junior dry-run should hit junior study/emotion card');
assert(juniorDryRun.uniqueHitIds.includes('RKI-V1.2-SPIRIT-R_HIGH'), 'five-function dry-run should hit right-thumb spirit card');
assert(juniorDryRun.uniqueHitIds.includes('RKI-V1.2-SPIRIT-L_LOW'), 'five-function dry-run should hit left-thumb spirit card');
assert(juniorDryRun.uniqueHitIds.includes('RKI-V1.2-AUDIO-R_LOW'), 'five-function dry-run should hit right-ring audio card');
assert(
  juniorDryRun.stageResults.some(stage => stage.stage === 'risk_guardrails' && stage.hitCount > 0),
  'dry-run should include risk guardrail stage'
);

const adultDryRun = buildReportKnowledgeRetrievalDryRun({
  ageBand: '26-40岁',
  userIdentity: 'self',
  reportSubject: 'self',
  selectedIssues: [
    '职业瓶颈，创业还是继续打工',
    '伴侣沟通和家庭责任怎么平衡',
  ],
  customUserQuestion: '我总觉得工作很累，想转型但又担心不稳定',
  reportModules: ['性格类型', '行为模式'],
  functionAreas: ['思维功能', '视觉功能'],
  metrics: {
    思维功能: {
      右食: '高于个人均值，逻辑规则理解快',
    },
    视觉功能: {
      左小: '高于个人均值，图像和审美联想强',
    },
  },
});

assert(adultDryRun.uniqueHitIds.includes('RKI-V1.3-ADULT-WORK'), 'adult dry-run should hit adult work card');
assert(adultDryRun.uniqueHitIds.includes('RKI-V1.3-ADULT-FAMILY'), 'adult dry-run should hit adult family card');
assert(adultDryRun.uniqueHitIds.includes('RKI-V1.2-THINK-R_HIGH'), 'adult dry-run should hit right-index thinking card');
assert(adultDryRun.uniqueHitIds.includes('RKI-V1.2-VISUAL-L_HIGH'), 'adult dry-run should hit left-little visual card');
assert(!adultDryRun.uniqueHitIds.includes('RKI-V1.3-JUNIOR-BOUNDARY'), 'adult dry-run should not rely on junior boundary card');

const riskDryRun = buildReportKnowledgeRetrievalDryRun({
  ageBand: '高中16-18岁',
  userIdentity: 'parent',
  reportSubject: 'child',
  selectedIssues: ['升学决策：冲名校还是选适合专业'],
  customUserQuestion: '能不能保证升学成功，孩子是不是有心理疾病',
  riskSignals: ['保证升学', '心理疾病', '诊断'],
});

assert(riskDryRun.uniqueHitIds.includes('RKI-V1.3-SENIOR-EDUCATION'), 'risk dry-run should still hit senior education context');
assert(
  riskDryRun.stageResults.some(stage => stage.hits.some(hit => hit.isGuardrailOnly)),
  'risk dry-run should retrieve guardrail-only cards for unsafe questions'
);
assert(
  riskDryRun.summary.guardrailHitCount > 0,
  'risk dry-run should count guardrail hits'
);

const promptContext = buildReportKnowledgePromptContext({
  ageBand: '初中13-15岁',
  userIdentity: 'parent',
  reportSubject: 'child',
  selectedIssues: [
    '开始顶嘴/叛逆，怎么沟通不炸',
    '考试焦虑/输不起怎么疏导',
  ],
  customUserQuestion: '孩子一说学习就烦，手机也很难约定边界',
  reportModules: ['TRC（认知结构）', 'ATD（感受/反应节奏）', '性格类型（核心行为外显模块）'],
  functionAreas: ['精神功能', '听觉功能'],
  metrics: {
    精神功能: {
      右拇: '26 高于个人均值 差值+5.9',
      左拇: '14 低于个人均值 差值-6.1',
    },
    听觉功能: {
      右无名: '15 低于个人均值 差值-5.1',
      左无名: '24 高于个人均值 差值+3.9',
    },
  },
});

assert.strictEqual(promptContext.ok, true);
assert.strictEqual(promptContext.mode, 'v1.5_dry_run_context');
assert(promptContext.reportKnowledgeBlock.includes('Report Knowledge Index 命中内容'), 'V1.5 prompt context should include report grounding block');
assert(promptContext.retrievalSummary.uniqueHitIds.includes('RKI-V1.3-JUNIOR-BOUNDARY'), 'V1.5 context should include age-stage hit id');
assert(promptContext.retrievalSummary.uniqueHitIds.includes('RKI-V1.2-SPIRIT-R_HIGH'), 'V1.5 context should include five-function hit id');
assert(promptContext.issueKnowledgeContexts['开始顶嘴/叛逆，怎么沟通不炸']?.knowledgeBlock, 'first selected issue should have its own knowledge block');
assert(promptContext.issueKnowledgeContexts['考试焦虑/输不起怎么疏导']?.knowledgeBlock, 'second selected issue should have its own knowledge block');
assert(
  JSON.stringify(promptContext.retrievalSummary.issueHitIds['开始顶嘴/叛逆，怎么沟通不炸'])
    !== JSON.stringify(promptContext.retrievalSummary.issueHitIds['考试焦虑/输不起怎么疏导']),
  'different selected issues should not share an identical retrieval result set'
);
assert(!promptContext.reportKnowledgeBlock.includes('/Users/'), 'V1.5 report grounding must not expose local paths');
assert(!promptContext.reportKnowledgeBlock.includes('teacher_report_reading_001'), 'V1.5 report grounding must not expose raw source filenames');

const riskyPromptContext = buildReportKnowledgePromptContext({
  ageBand: '高中16-18岁',
  userIdentity: 'parent',
  reportSubject: 'child',
  selectedIssues: ['升学决策：冲名校还是选适合专业'],
  customUserQuestion: '能不能保证升学成功，孩子是不是有心理疾病',
  riskSignals: ['保证升学', '心理疾病', '诊断'],
});

assert(riskyPromptContext.riskKnowledgeBlock.includes('安全边界命中'), 'V1.5 risky context should include risk grounding block');
assert(riskyPromptContext.retrievalSummary.guardrailHitCount > 0, 'V1.5 risky context should count guardrail hits');
assert(!riskyPromptContext.riskKnowledgeBlock.includes('/Users/'), 'V1.5 risk grounding must not expose local paths');

const fourIssueContext = buildReportKnowledgePromptContext({
  ageBand: '高中16-18岁',
  userIdentity: 'parent',
  reportSubject: 'child',
  selectedIssues: [
    '文理/选科，天赋更偏哪边',
    '偏科/学习方法怎么调',
    '升学决策：冲名校还是选适合专业',
    '他和父母的三观差怎么相处',
  ],
  personalityType: '认知型',
  learningChannel: '视觉',
  behaviorPattern: '思考后行动',
  trc: '个人均值26.4 总TRC264',
  atd: '适中',
});
assert(fourIssueContext.issueKnowledgeContexts['偏科/学习方法怎么调'].knowledgeBlock.includes('学习类不必硬凑三段'), '偏科问题没有命中学习方法差异化知识卡');
assert(fourIssueContext.issueKnowledgeContexts['他和父母的三观差怎么相处'].knowledgeBlock.includes('亲子三观差'), '亲子三观问题没有命中对应场景知识卡');

console.log(JSON.stringify({
  ok: true,
  totalEntries: index.entries.length,
  sampleGroundingItems: groundingBlock.split('\n\n').length - 2,
  dryRunStages: juniorDryRun.summary.stageCount,
  dryRunUniqueHits: juniorDryRun.uniqueHitIds.length,
  promptContextHits: promptContext.retrievalSummary.uniqueHitIds.length,
  issueKnowledgeContexts: Object.keys(promptContext.issueKnowledgeContexts).length,
}, null, 2));
