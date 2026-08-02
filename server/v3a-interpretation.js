'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_FIELDS = ['why', 'say', 'ask', 'no', 'action', 'risk'];
const STEP_TITLES = [
  '建立安全感',
  '严正声明和四条规则',
  '讲性格类型，让客户产生共鸣',
  'TRC / ATD / 左右脑，解释底层数据',
  '讲学习通道 / 行为模式',
  '进入客户关注问题',
  '给行动建议',
  '记录客户反馈 / 必要时提交总部复核'
];
const UNSAFE_OUTPUT = /(?:患有|确诊|必然|注定|保证|一定会|命中注定|未来(?:一定|必然|将会)|智商(?:很高|很低|高|低)|优于(?:别人|他人|同龄人)|劣于(?:别人|他人|同龄人)|天生就是)/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalize(value) {
  return String(value ?? '').trim();
}

function isUuid(value) {
  return UUID_PATTERN.test(normalize(value));
}

function rejectAdvisorId(body) {
  for (const key of ['advisorId', 'advisor_id', 'advisorUserId', 'advisor_user_id']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) fail('ADVISOR_ID_NOT_ALLOWED');
  }
}

function normalizeConcerns(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 6) fail('INVALID_CLIENT_CONCERNS');
  const concerns = value.map(normalize).filter(Boolean);
  if (concerns.some((item) => item.length > 80)) fail('INVALID_CLIENT_CONCERNS');
  return [...new Set(concerns)];
}

function validateIds(body) {
  const reportId = normalize(body.reportId);
  const clientId = normalize(body.clientId);
  if (!isUuid(reportId)) fail('INVALID_REPORT_ID');
  if (!isUuid(clientId)) fail('INVALID_CLIENT_ID');
  return { reportId, clientId };
}

function validateGenerateBody(value) {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  rejectAdvisorId(body);
  const ids = validateIds(body);
  const customNotes = normalize(body.customNotes);
  if (customNotes.length > 500) fail('INVALID_CUSTOM_NOTES');
  return {
    ...ids,
    clientConcerns: normalizeConcerns(body.clientConcerns),
    customNotes: customNotes || null
  };
}

function normalizeStepList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) fail('AI_OUTPUT_INVALID');
  const result = value.map(normalize);
  if (result.some((item) => !item || item.length > 500)) fail('AI_OUTPUT_INVALID');
  if (result.some((item) => UNSAFE_OUTPUT.test(item))) fail('UNSAFE_AI_OUTPUT');
  return result;
}

function validateSteps(value) {
  if (!Array.isArray(value) || value.length !== STEP_TITLES.length) fail('AI_OUTPUT_INVALID');
  const steps = value.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || Number(step.stepIndex) !== index) {
      fail('AI_OUTPUT_INVALID');
    }
    const result = { stepIndex: index, title: STEP_TITLES[index] };
    for (const field of STEP_FIELDS) result[field] = normalizeStepList(step[field]);
    return result;
  });
  if (Buffer.byteLength(JSON.stringify(steps)) > 64 * 1024) fail('AI_OUTPUT_INVALID');
  return steps;
}

function validateSaveBody(value) {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  rejectAdvisorId(body);
  const ids = validateIds(body);
  const interpretationId = normalize(body.interpretationId);
  if (!isUuid(interpretationId)) fail('INVALID_INTERPRETATION_ID');
  return { ...ids, interpretationId, editedSteps: validateSteps(body.editedSteps) };
}

function parseModelText(value) {
  let text = normalize(value);
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('AI_OUTPUT_INVALID');
  }
  return validateSteps(payload?.steps);
}

function compactReportData(report, client, input) {
  const structured = report?.structured_input && typeof report.structured_input === 'object'
    ? report.structured_input
    : {};
  const engineResult = structured.engineResult && typeof structured.engineResult === 'object'
    ? structured.engineResult
    : {};
  const generated = report?.generated_report && typeof report.generated_report === 'object'
    ? report.generated_report
    : {};
  const sections = Array.isArray(generated.sections)
    ? generated.sections.slice(0, 16).map((section) => ({
      title: normalize(section?.title).slice(0, 80),
      content: normalize(section?.content).slice(0, 900)
    })).filter((section) => section.title || section.content)
    : [];
  const data = {
    age: Number.isInteger(report?.age_at_report) ? report.age_at_report : null,
    reportType: normalize(structured.reportType).slice(0, 60) || '报告',
    fingers: structured.fingers || null,
    atd: structured.atd ?? null,
    engineResult,
    reportSections: sections,
    clientConcerns: input.clientConcerns,
    customNotes: input.customNotes
  };
  const fullName = normalize(client?.display_name);
  let json = JSON.stringify(data);
  if (fullName) json = json.split(fullName).join('客户');
  return json.slice(0, 18000);
}

function buildPrompt(report, client, input) {
  const system = [
    '你是AIPIWEN指导师的解读辅助工具。',
    '只能解释报告数据和提供沟通建议，不得诊断、预测、贴标签或与他人比较。',
    '必须输出严格JSON，不得输出Markdown或额外说明。'
  ].join('');
  const user = [
    '请根据以下去标识化报告资料生成8步标准解读方案。',
    '四条规则：1.数值没有好坏；2.不做未来预测；3.不贴标签；4.不与他人比较。',
    `报告资料：${compactReportData(report, client, input)}`,
    `固定步骤：${STEP_TITLES.map((title, index) => `${index}.${title}`).join('；')}`,
    '每步必须包含stepIndex、title、why、say、ask、no、action、risk；stepIndex按0至7排列，title使用对应固定步骤标题。',
    '每个步骤必须严格使用数组字段，例如：{"stepIndex":0,"title":"建立安全感","why":["说明"],"say":["话术"],"ask":["问题"],"no":["禁语"],"action":["行动"],"risk":["提醒"]}。',
    '为保证生成稳定，每个内容字段只写1条，单条不超过60个汉字。',
    '输出格式：{"steps":[...]}'
  ].join('\n');
  return { system, user };
}

module.exports = {
  STEP_FIELDS,
  STEP_TITLES,
  buildPrompt,
  isUuid,
  parseModelText,
  validateGenerateBody,
  validateSaveBody,
  validateSteps
};
