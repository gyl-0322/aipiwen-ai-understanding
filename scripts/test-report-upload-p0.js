const { Readable } = require('stream');
const handler = require('../lib/report-upload-p0-dryrun.js');

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

function assertNoUnsafeEcho(response, input) {
  const serialized = responseText(response);
  const reportText = input.reportText || '';
  if (reportText.length > 0) {
    assertCase(!serialized.includes(reportText), '完整 reportText 不应出现在响应中');
  }
  assertCase(!serialized.includes('Prompt Pack'), '不应返回 Prompt Pack 全文标识');
  assertCase(!serialized.includes('你是 AIPIWEN'), '不应返回内部 Prompt 全文');
}

function assertCommonDryRun(response) {
  assertCase(response.promptRequestDryRun && response.promptRequestDryRun.dryRunOnly === true, 'promptRequestDryRun.dryRunOnly 必须为 true');
  assertCase(response.promptPayloadDryRun && response.promptPayloadDryRun.dryRunOnly === true, 'promptPayloadDryRun.dryRunOnly 必须为 true');
  assertCase(response.humanReviewQueueDryRun && response.humanReviewQueueDryRun.dryRunOnly === true, 'humanReviewQueueDryRun.dryRunOnly 必须为 true');
  if (['R2', 'R3'].includes(response.riskLevel)) {
    assertCase(response.promptPayloadDryRun.canSendToModel === false, 'R2/R3 不允许 canSendToModel=true');
    assertCase(response.promptPayloadDryRun.payloadType !== 'quick_reading_payload', 'R2/R3 不应生成 quick_reading_payload');
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
      assertCase(['clarification_only', 'light_hint_with_questions'].includes(response.outputDecision), 'outputDecision 应进入追问或轻提示');
      assertCase(response.promptPayloadDryRun.payloadType === 'clarification_payload', 'payloadType 应为 clarification_payload');
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
