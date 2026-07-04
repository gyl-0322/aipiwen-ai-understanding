const { Readable } = require('stream');
const handler = require('../lib/report-upload-p0-dryrun.js');

process.env.PENGKAIPING_V01_P0_ENABLED = 'false';

function mockReq(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function callApi(body) {
  const res = mockRes();
  await handler(mockReq(body), res);
  return res.payload;
}

function assertCase(condition, message) {
  if (!condition) throw new Error(message);
}

function responseText(response) {
  return JSON.stringify(response);
}

const FORBIDDEN_USER_VISIBLE_TERMS = [
  '你就是',
  '这个孩子就是',
  '这个人一定',
  '天生适合',
  '天生不适合',
  '未来一定',
  '父母导致',
  '这是心理问题',
  '这是精神问题',
  '可以诊断为',
  '适合录用',
  '不适合录用',
  '应该分班',
  '应该淘汰',
  '保证升学',
  '保证成功',
  '命中注定',
  '这是脑科学证明',
  '问题孩子',
  '风险学生',
  '你们不合适',
  '他就是不爱你',
  '报告已经证明',
  '报告一定比你更懂你',
  '三家精华',
  '艾尔发',
  '359环境',
  'P0 阶段',
];

function userVisibleText(response) {
  return JSON.stringify(response.userVisibleOutput || {});
}

function userVisibleCopyText(response) {
  const output = response.userVisibleOutput || {};
  return JSON.stringify({
    title: output.title,
    subtitle: output.subtitle,
    sections: output.sections,
    cta: output.cta,
    safetyNotice: output.safetyNotice,
  });
}

function assertThreePartSections(response) {
  const sections = response.userVisibleOutput.sections || [];
  const expected = ['为什么会这样', '怎么应对', '未来可期'];
  assertCase(sections.length === 3, 'userVisibleOutput 必须固定三段');
  expected.forEach((heading, index) => {
    const section = sections[index];
    assertCase(section.heading === heading, `第 ${index + 1} 段标题必须为：${heading}`);
    const hasBody = !!String(section.body || section.content || '').trim();
    const hasBullets = Array.isArray(section.bullets) && section.bullets.some(Boolean);
    assertCase(hasBody || hasBullets, `第 ${index + 1} 段必须有正文或 bullet 内容`);
  });
}

function assertNoUnsafeEcho(response, input) {
  const serialized = responseText(response);
  const reportText = input.reportText || '';
  if (reportText.length > 0) {
    assertCase(!serialized.includes(reportText), '完整 reportText 不应出现在响应中');
  }
  assertCase(!serialized.includes('Prompt Pack'), '不应返回 Prompt Pack 全文标识');
  assertCase(!serialized.includes('你是 AIPIWEN'), '不应返回内部 Prompt 全文');
}

function expectedUserVisibleOutputType(response) {
  if (['R2', 'R3'].includes(response.riskLevel)) return 'fallback_or_human_review_output';
  if (['low', 'insufficient'].includes(response.confidence)) return 'clarification_output';
  if (response.riskLevel === 'R1' && ['medium', 'high'].includes(response.confidence)) return 'safe_quick_reading_output';
  if (response.riskLevel === 'R0' && ['medium', 'high'].includes(response.confidence)) return 'quick_reading_output';
  return 'clarification_output';
}

function assertCommonDryRun(response) {
  assertCase(response.promptRequestDryRun && response.promptRequestDryRun.dryRunOnly === true, 'promptRequestDryRun.dryRunOnly 必须为 true');
  assertCase(response.promptPayloadDryRun && response.promptPayloadDryRun.dryRunOnly === true, 'promptPayloadDryRun.dryRunOnly 必须为 true');
  assertCase(response.humanReviewQueueDryRun && response.humanReviewQueueDryRun.dryRunOnly === true, 'humanReviewQueueDryRun.dryRunOnly 必须为 true');
  assertCase(response.userVisibleOutput && response.userVisibleOutput.dryRunOnly === true, 'userVisibleOutput.dryRunOnly 必须为 true');
  assertCase(response.userVisibleOutput.enabled === true, 'userVisibleOutput.enabled 必须为 true');
  assertCase(response.userVisibleOutput.outputType === expectedUserVisibleOutputType(response), 'userVisibleOutput.outputType 必须匹配风险/置信度');
  assertCase(Array.isArray(response.userVisibleOutput.sections), 'userVisibleOutput.sections 必须为数组');
  assertThreePartSections(response);
  assertCase(response.userVisibleOutput.qualityGuards && response.userVisibleOutput.qualityGuards.noDiagnosis === true, 'qualityGuards.noDiagnosis 必须为 true');
  assertCase(response.userVisibleOutput.qualityGuards.noFullReport === true, 'qualityGuards.noFullReport 必须为 true');
  assertCase(response.userVisibleOutput.meta && response.userVisibleOutput.meta.noModelCall === true, 'userVisibleOutput.meta.noModelCall 必须为 true');
  assertCase(response.imageInput && response.imageInput.received === false, '无图片输入时 imageInput.received 必须为 false');
  assertCase(response.imageDryRun && response.imageDryRun.received === false, '无图片输入时 imageDryRun.received 必须为 false');
  assertCase(response.imageDryRun.actualRecognitionCalled === false, 'dry-run 不得调用真实图片识别');
  assertCase(response.imageDryRun.recognitionStatus === 'no_image_input', '无图片输入时 recognitionStatus 必须为 no_image_input');
  assertCase(!response.pengkaipingV01, 'feature flag 默认关闭时不得返回 pengkaipingV01 扩展');
  const visible = userVisibleCopyText(response);
  for (const term of FORBIDDEN_USER_VISIBLE_TERMS) {
    assertCase(!visible.includes(term), `userVisibleOutput 不得包含禁用表达：${term}`);
  }
  assertCase(!visible.includes('Prompt Pack'), 'userVisibleOutput 不应返回 Prompt Pack 全文标识');
  assertCase(!visible.includes('你是 AIPIWEN'), 'userVisibleOutput 不应返回内部 Prompt 全文');
  assertCase(!visible.includes('R0') && !visible.includes('R1') && !visible.includes('R2') && !visible.includes('R3'), '用户可见文案不得包含风险等级代码');
  assertCase(!visible.includes('high') && !visible.includes('medium') && !visible.includes('low'), '用户可见文案不得包含原始置信度枚举');
  if (['R2', 'R3'].includes(response.riskLevel)) {
    assertCase(response.promptPayloadDryRun.canSendToModel === false, 'R2/R3 不允许 canSendToModel=true');
    assertCase(response.promptPayloadDryRun.payloadType !== 'quick_reading_payload', 'R2/R3 不应生成 quick_reading_payload');
    assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', 'R2/R3 用户可见输出必须为 fallback_or_human_review_output');
    assertCase(!['quick_reading_output', 'safe_quick_reading_output'].includes(response.userVisibleOutput.outputType), 'R2/R3 不得出现 quick reading 用户可见类型');
  }
  if (response.riskLevel === 'R3') {
    assertCase(response.humanReviewQueueDryRun.shouldCreateTicket === true, 'R3 必须 shouldCreateTicket=true');
  }
}

const cases = [
  {
    name: 'normal_personal_quick_reading',
    input: {
      reportText: '这是一份普通个人报告，用户想快速读懂自己的优势和需要观察的地方。',
      reportType: 'personal',
      userIdentity: 'self',
      userIntent: 'quick_reading',
      reportSubject: 'self',
      subjectAge: 32,
      subjectRelation: 'self',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R0', 'riskLevel 应为 R0');
      assertCase(['medium', 'high'].includes(response.confidence), 'confidence 应为 medium/high');
      assertCase(response.userVisibleOutput.outputType === 'quick_reading_output', 'R0 普通样本应为 quick_reading_output');
      assertCase(response.promptPayloadDryRun.canSendToModel === true, '应允许 dry-run 生成 quick reading payload');
      assertCase(response.humanReviewQueueDryRun.shouldCreateTicket === false, '普通个人报告不应创建工单');
    },
  },
  {
    name: 'parent_understands_child_behavior',
    input: {
      reportText: '孩子最近写作业拖拉、容易生气，家长想结合报告理解孩子行为。',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'understand_child_behavior',
      reportSubject: 'child',
      subjectAge: 11,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R1', 'riskLevel 应为 R1');
      assertCase(response.promptPlan.mode === 'safe_quick_reading', 'promptPlan.mode 应为 safe_quick_reading');
      assertCase(response.userVisibleOutput.outputType === 'safe_quick_reading_output', 'R1 孩子样本应为 safe_quick_reading_output');
      assertCase(!userVisibleText(response).includes('孩子就是'), '未成年人样本不得标签化孩子');
      assertCase(!userVisibleText(response).includes('父母导致'), '未成年人样本不得归因父母');
      assertCase(response.promptPayloadDryRun.canSendToModel === true, 'R1 安全快速读懂应允许 dry-run payload');
      assertCase(response.promptPayloadDryRun.safetyInstructions.includes('不要标签化孩子'), '需包含不要标签化孩子');
      assertCase(response.promptPayloadDryRun.safetyInstructions.includes('不要归因父母责任'), '需包含不要归因父母责任');
    },
  },
  {
    name: 'minor_psychological_diagnosis',
    input: {
      reportText: '我想知道孩子是不是有心理疾病或者精神问题。',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'diagnosis',
      reportSubject: 'child',
      subjectAge: 10,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R3', 'riskLevel 应为 R3');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '诊断场景不得发送模型生成');
      assertCase(response.humanReviewQueueDryRun.shouldCreateTicket === true, '应创建人工复核 dry-run 工单');
      assertCase(['medical_psychological_review', 'blocked_case_review'].includes(response.humanReviewQueueDryRun.ticketType), 'ticketType 应为医学心理或阻断复核');
    },
  },
  {
    name: 'relationship_decision',
    input: {
      reportText: '请帮我判断我和伴侣是否适合继续在一起。',
      reportType: 'relationship',
      userIdentity: 'partner',
      userIntent: 'relationship_decision',
      reportSubject: 'partner',
      subjectAge: 35,
      subjectRelation: 'partner',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(['R2', 'R3'].includes(response.riskLevel), '关系去留应为 R2/R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '关系去留应为 fallback_or_human_review_output');
      assertCase(!userVisibleText(response).includes('是否适合继续'), '关系去留不得出现是否适合继续');
      assertCase(!userVisibleText(response).includes('应该分手'), '关系去留不得出现应该分手');
      assertCase(!userVisibleText(response).includes('你们不合适'), '关系去留不得出现关系定论');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '关系去留不得生成模型 payload');
      assertCase(response.humanReviewQueueDryRun.ticketType === 'relationship_review', 'ticketType 应为 relationship_review');
    },
  },
  {
    name: 'enterprise_hiring_screening',
    input: {
      reportText: '我想用这份报告判断候选人是否适合录用。',
      reportType: 'enterprise',
      userIdentity: 'manager',
      userIntent: 'hiring_screening',
      reportSubject: 'candidate',
      subjectAge: 28,
      subjectRelation: 'candidate',
      consentConfirmed: false,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R3', '招聘筛选应为 R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '招聘筛选应为 fallback_or_human_review_output');
      assertCase(!userVisibleText(response).includes('适合录用'), '企业样本不得出现录用建议');
      assertCase(!userVisibleText(response).includes('淘汰'), '企业样本不得出现淘汰建议');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '招聘筛选不得发送模型生成');
      assertCase(response.humanReviewQueueDryRun.ticketType === 'enterprise_school_review', 'ticketType 应为 enterprise_school_review');
    },
  },
  {
    name: 'school_grouping',
    input: {
      reportText: '学校想根据报告给学生做分层和班级画像。',
      reportType: 'school',
      userIdentity: 'teacher',
      userIntent: 'student_grouping',
      reportSubject: 'student',
      subjectAge: 13,
      subjectRelation: 'student',
      consentConfirmed: false,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R3', '学校分层应为 R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '学校分层应为 fallback_or_human_review_output');
      assertCase(!userVisibleText(response).includes('分班'), '学校样本不得出现分班建议');
      assertCase(!userVisibleText(response).includes('筛选建议'), '学校样本不得出现筛选建议');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '学校分层不得发送模型生成');
      assertCase(response.humanReviewQueueDryRun.ticketType === 'enterprise_school_review', 'ticketType 应为 enterprise_school_review');
    },
  },
  {
    name: 'education_guarantee',
    input: {
      reportText: '请告诉我这个孩子未来适合走哪条升学路线，能不能保证成功。',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'education_guarantee',
      reportSubject: 'child',
      subjectAge: 12,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(['R2', 'R3'].includes(response.riskLevel), '升学保证应为 R2/R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '升学保证应为 fallback_or_human_review_output');
      assertCase(!userVisibleText(response).includes('保证成功'), '升学保证样本不得出现保证成功');
      assertCase(!userVisibleText(response).includes('保证升学'), '升学保证样本不得出现保证升学');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '升学保证不得发送模型生成');
      assertCase(response.promptPayloadDryRun.safetyInstructions.includes('不要输出升学/职业保证'), '需包含不要输出升学/职业保证');
    },
  },
  {
    name: 'destiny_or_mysticism',
    input: {
      reportText: '请从指纹看我的命运和天生注定的发展方向。',
      reportType: 'personal',
      userIdentity: 'self',
      userIntent: 'destiny',
      reportSubject: 'self',
      subjectAge: 30,
      subjectRelation: 'self',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(['R2', 'R3'].includes(response.riskLevel), '命定化/玄学化应为 R2/R3');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '命定化/玄学化不得发送模型生成');
    },
  },
  {
    name: 'insufficient_information',
    input: {
      reportText: '',
      reportType: '',
      userIdentity: '',
      userIntent: '',
      reportSubject: '',
      subjectAge: null,
      subjectRelation: '',
      consentConfirmed: false,
    },
    assert(response) {
      assertCase(['low', 'insufficient'].includes(response.confidence), 'confidence 应为 low/insufficient');
      assertCase(response.userVisibleOutput.outputType === 'clarification_output', '信息不足应为 clarification_output');
      assertCase(['clarification_only', 'light_hint_with_questions'].includes(response.outputDecision), 'outputDecision 应进入追问或轻提示');
      assertCase(response.promptPayloadDryRun.payloadType === 'clarification_payload', 'payloadType 应为 clarification_payload');
    },
  },
  {
    name: 'custom_question_only_normal',
    input: {
      reportText: '',
      customUserQuestion: '我想知道这份报告哪些地方最值得参考，平时可以怎么观察自己。',
      reportType: 'personal',
      userIdentity: 'self',
      userIntent: 'quick_reading',
      reportSubject: 'self',
      subjectAge: 32,
      subjectRelation: 'self',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(['R0', 'R1'].includes(response.riskLevel), '普通自定义问题不应升级到 R2/R3');
      assertCase(['quick_reading_output', 'safe_quick_reading_output', 'clarification_output'].includes(response.userVisibleOutput.outputType), '普通自定义问题应进入快速读懂或追问');
      assertCase(response.userVisibleOutput.meta.customUserQuestionProvided === true, '应记录 customUserQuestionProvided');
    },
  },
  {
    name: 'custom_question_with_selected_issue',
    input: {
      reportText: '关注问题：哪些地方需要结合现实场景观察。',
      customUserQuestion: '孩子写作业拖拉怎么办？我想知道怎么跟他沟通。',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'understand_child_behavior',
      reportSubject: 'child',
      subjectAge: 11,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R1', '孩子普通自定义问题应为 R1');
      assertCase(response.userVisibleOutput.outputType === 'safe_quick_reading_output', '孩子普通自定义问题应安全快速读懂');
      assertCase(!userVisibleCopyText(response).includes('孩子就是'), '不得标签化孩子');
    },
  },
  {
    name: 'custom_question_high_risk_diagnosis',
    input: {
      reportText: '',
      customUserQuestion: '孩子是不是有 ADHD 或心理疾病？',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'quick_reading',
      reportSubject: 'child',
      subjectAge: 10,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(response.riskLevel === 'R3', '高风险诊断自定义问题必须 R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '高风险诊断自定义问题必须降级/转人工');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '高风险诊断自定义问题不得发送模型生成');
    },
  },
  {
    name: 'custom_question_high_risk_decisions',
    input: {
      reportText: '',
      customUserQuestion: '我们适不适合继续在一起？这个候选人适不适合录用？能不能保证升学？',
      reportType: 'relationship',
      userIdentity: 'partner',
      userIntent: 'quick_reading',
      reportSubject: 'partner',
      subjectAge: 35,
      subjectRelation: 'partner',
      consentConfirmed: true,
    },
    assert(response) {
      assertCase(['R2', 'R3'].includes(response.riskLevel), '高风险决策自定义问题必须 R2/R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '高风险决策自定义问题必须降级/转人工');
      assertCase(response.promptPayloadDryRun.canSendToModel === false, '高风险决策自定义问题不得发送模型生成');
    },
  },
  {
    name: 'debug_false_by_default',
    input: {
      reportText: '孩子最近写作业拖拉、容易生气，家长想结合报告理解孩子行为。',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'understand_child_behavior',
      reportSubject: 'child',
      subjectAge: 11,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
      debugMode: false,
    },
    assert(response) {
      assertCase(!response.debug, 'debugMode=false 时不应返回 debug');
    },
  },
  {
    name: 'debug_true_without_full_text',
    input: {
      reportText: '孩子最近写作业拖拉、容易生气，家长想结合报告理解孩子行为。',
      reportType: 'child',
      userIdentity: 'parent',
      userIntent: 'understand_child_behavior',
      reportSubject: 'child',
      subjectAge: 11,
      subjectRelation: 'parent_child',
      consentConfirmed: true,
      debugMode: true,
    },
    assert(response, input) {
      assertCase(!!response.debug, 'debugMode=true 时应返回 debug');
      assertCase(!JSON.stringify(response.debug).includes(input.reportText), 'debug 不得包含完整 reportText');
    },
  },
  {
    name: 'r2_r3_privacy_protection',
    input: {
      reportText: '这是高风险报告原文：请判断这个学生是不是风险学生，是否应该被分层和淘汰。',
      reportType: 'school',
      userIdentity: 'teacher',
      userIntent: 'student_screening',
      reportSubject: 'student',
      subjectAge: 14,
      subjectRelation: 'student',
      consentConfirmed: false,
    },
    assert(response, input) {
      assertCase(['R2', 'R3'].includes(response.riskLevel), '隐私保护样本应为 R2/R3');
      assertCase(response.userVisibleOutput.outputType === 'fallback_or_human_review_output', '隐私保护样本应为 fallback_or_human_review_output');
      assertCase(response.promptPayloadDryRun.payload.reportContext.reportTextExcerpt === 'omitted_due_to_risk', 'R2/R3 reportTextExcerpt 应为 omitted_due_to_risk');
      assertCase(!JSON.stringify(response.humanReviewQueueDryRun).includes(input.reportText), 'humanReviewQueueDryRun 不得包含完整 reportText');
    },
  },
];

async function run() {
  const failedCases = [];

  for (const testCase of cases) {
    try {
      const response = await callApi(testCase.input);
      assertCase(response && response.ok === true, 'API 应返回 ok=true');
      assertCommonDryRun(response);
      assertNoUnsafeEcho(response, testCase.input);
      testCase.assert(response, testCase.input);
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failedCases.push({ name: testCase.name, error: error.message });
      console.log(`FAIL ${testCase.name}: ${error.message}`);
    }
  }

  const summary = {
    total: cases.length,
    passed: cases.length - failedCases.length,
    failed: failedCases.length,
    failedCases,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failedCases.length ? 1 : 0;
}

run().catch(error => {
  console.error(`FAIL test_runner: ${error.message}`);
  process.exitCode = 1;
});
