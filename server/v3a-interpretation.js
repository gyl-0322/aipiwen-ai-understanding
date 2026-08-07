'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_FIELDS = ['why', 'say', 'ask', 'no', 'action', 'risk'];
const LEGACY_STEP_TITLES = [
  '建立安全感', '严正声明和四条规则', '讲性格类型，让客户产生共鸣',
  'TRC / ATD / 左右脑，解释底层数据', '讲学习通道 / 行为模式',
  '进入客户关注问题', '给行动建议',
  '记录客户反馈 / 必要时提交总部复核'
];
const STEP_TITLES = [
  '建立安全感',
  '严正声明四原则',
  '性格类型',
  'TRC',
  'ATD',
  '学习通道',
  '行为模式',
  '左右脑',
  '精神功能',
  '思维功能',
  '体觉功能',
  '听觉功能',
  '视觉功能',
  '客户关注问题',
  '行动建议',
  '记录客户反馈 / 必要时提交总部复核'
];
const STEP_GUIDANCE = [
  '说明本次解读流程、确认客户最想解决的问题；用轻松开场、自我介绍和保密说明建立安全感。',
  '逐条讲清数值没有好坏、不预测未来、只和本人均值比较、不贴标签；确认客户理解并同意继续。',
  '说明主性格类型的定义、优势、使用过度时的代价、压力下表现、学习与关系场景；先描述可观察行为，再邀请客户核对。',
  '说明总TRC与个人均值、容量含义、强势区与发展区、学习承载节奏和沟通支持方式；明确TRC不是智力高低。',
  '说明ATD数值与区间、反应速度和敏感度、优势与代价、启动和缓冲节奏，以及学习、情绪和沟通中的应用。',
  '说明主学习通道及占比、最省力的输入方式、记忆与复习方法、环境安排，以及如何用其他通道补充巩固。',
  '说明行为模式结论、精神与思维的关系、任务启动、目标驱动、压力反应、执行和反馈方式，并核对现实表现。',
  '说明左右脑数据与占比、信息处理偏向、学习和决策方式、关系沟通方式，以及偏向使用过度时需要怎样平衡。',
  '说明右拇开创力与左拇管理力，分别结合数值和个人均值讲优势、代价、现实场景及培养方式。',
  '说明右食逻辑推理与左食创意空间，分别结合数值和个人均值讲优势、代价、学习场景及培养方式。',
  '说明右中精细动作与左中大运动耐力，分别结合数值和个人均值讲优势、代价、行为场景及培养方式。',
  '说明右无名语言表达记忆与左无名音感言外之意，分别结合数值和个人均值讲优势、代价、沟通场景及培养方式。',
  '说明右小指识人方向与左小指色彩图像，分别结合数值和个人均值讲优势、代价、观察场景及培养方式。',
  '围绕客户关注问题，结合报告数据解释可能机制；核对真实场景，区分资料事实、客户反馈与待确认假设。',
  '把报告理解转成家庭、学习或工作中的具体动作；给出执行步骤、观察指标、周期和复盘方式。',
  '复述客户共识、记录异议与待核实信息；明确后续跟进、总部复核和需要转介专业支持的边界。'
];
const STEP_SECTION_KEYWORDS = [
  [], ['严正'], ['性格类型'], ['TRC'], ['ATD'], ['学习通道'], ['行为模式'], ['左右脑'],
  ['精神功能'], ['思维功能'], ['体觉功能'], ['听觉功能'], ['视觉功能'], [], [], []
];
const DETAILED_FIELD_MINIMUMS = { why: 2, say: 3, ask: 2, no: 2, action: 3, risk: 2 };
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

function normalizeStepList(value, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 10) fail('AI_OUTPUT_INVALID');
  const result = value.map(normalize);
  if (result.some((item) => !item || item.length > 500)) fail('AI_OUTPUT_INVALID');
  if (result.some((item) => UNSAFE_OUTPUT.test(item))) fail('UNSAFE_AI_OUTPUT');
  return result;
}

function normalizeStep(step, index, detailed, titles = STEP_TITLES) {
  if (!step || typeof step !== 'object' || Array.isArray(step) || Number(step.stepIndex) !== index) {
    fail('AI_OUTPUT_INVALID');
  }
  const result = { stepIndex: index, title: titles[index] };
  for (const field of STEP_FIELDS) {
    result[field] = normalizeStepList(step[field], detailed ? DETAILED_FIELD_MINIMUMS[field] : 1);
  }
  return result;
}

function validateSteps(value) {
  if (!Array.isArray(value)) fail('AI_OUTPUT_INVALID');
  const titles = value.length === STEP_TITLES.length
    ? STEP_TITLES
    : value.length === LEGACY_STEP_TITLES.length ? LEGACY_STEP_TITLES : null;
  if (!titles) fail('AI_OUTPUT_INVALID');
  const steps = value.map((step, index) => normalizeStep(step, index, false, titles));
  if (Buffer.byteLength(JSON.stringify(steps)) > 64 * 1024) fail('AI_OUTPUT_INVALID');
  return steps;
}

function validateStepChunk(value, expectedIndexes) {
  if (!Array.isArray(expectedIndexes) || expectedIndexes.length < 1) fail('AI_OUTPUT_INVALID');
  if (!Array.isArray(value) || value.length !== expectedIndexes.length) fail('AI_OUTPUT_INVALID');
  const steps = value.map((step, position) => {
    const index = Number(expectedIndexes[position]);
    if (!Number.isInteger(index) || index < 0 || index >= STEP_TITLES.length) fail('AI_OUTPUT_INVALID');
    return normalizeStep(step, index, true);
  });
  if (Buffer.byteLength(JSON.stringify(steps)) > 48 * 1024) fail('AI_OUTPUT_INVALID');
  return steps;
}

function validateDetailedSteps(value) {
  return validateStepChunk(value, STEP_TITLES.map((_, index) => index));
}

function validateDetailedPrefix(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length >= STEP_TITLES.length || value.length % 2 !== 0) {
    fail('AI_OUTPUT_INVALID');
  }
  return validateStepChunk(value, value.map((_, index) => index));
}

function validateSaveBody(value) {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  rejectAdvisorId(body);
  const ids = validateIds(body);
  const interpretationId = normalize(body.interpretationId);
  if (!isUuid(interpretationId)) fail('INVALID_INTERPRETATION_ID');
  return { ...ids, interpretationId, editedSteps: validateSteps(body.editedSteps) };
}

function parseModelText(value, expectedIndexes = null) {
  let text = normalize(value);
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('AI_OUTPUT_INVALID');
  }
  return expectedIndexes ? validateStepChunk(payload?.steps, expectedIndexes) : validateSteps(payload?.steps);
}

function compactReportData(report, client, input, stepIndexes) {
  const structured = report?.structured_input && typeof report.structured_input === 'object'
    ? report.structured_input
    : {};
  const engineResult = structured.engineResult && typeof structured.engineResult === 'object'
    ? structured.engineResult
    : {};
  const generated = report?.generated_report && typeof report.generated_report === 'object'
    ? report.generated_report
    : {};
  const keywords = stepIndexes.flatMap((index) => STEP_SECTION_KEYWORDS[index] || []);
  if (stepIndexes.includes(13)) {
    keywords.push(...input.clientConcerns, input.customNotes || '');
  }
  const sections = Array.isArray(generated.sections)
    ? generated.sections.filter((section) => {
      const title = normalize(section?.title);
      return keywords.some((keyword) => keyword && title.includes(keyword));
    }).slice(0, 4).map((section) => ({
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

function buildPrompt(report, client, input, stepIndexes = STEP_TITLES.map((_, index) => index)) {
  const requestedSteps = stepIndexes.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= STEP_TITLES.length) fail('AI_OUTPUT_INVALID');
    return `${index}.${STEP_TITLES[index]}：${STEP_GUIDANCE[index]}`;
  });
  const system = [
    '你是AIPIWEN指导师的解读辅助工具。',
    '目标是让刚入门的指导师也能按照页面提示，完整、安全地完成一次专业解读。',
    '只能解释报告数据和提供沟通建议，不得诊断、预测、贴标签或与他人比较。',
    '必须输出严格JSON，不得输出Markdown或额外说明。'
  ].join('');
  const user = [
    '请根据以下去标识化报告资料，生成本次指定步骤的详细解读脚本。',
    '四条规则：1.数值没有好坏；2.不做未来预测；3.不贴标签；4.不与他人比较。',
    `报告资料：${compactReportData(report, client, input, stepIndexes)}`,
    '完整版报告解读顺序固定为：性格类型、TRC、ATD、学习通道、行为模式、左右脑、精神功能、思维功能、体觉功能、听觉功能、视觉功能；涉及的数据必须与报告原文一致，不得合并、调序或遗漏。',
    `本次必须且只能生成以下板块：\n${requestedSteps.join('\n')}`,
    '每个板块必须包含stepIndex、title、why、say、ask、no、action、risk；stepIndex与title必须和本次指定板块一致。',
    '每个板块都使用同一详细标准：why至少2条，讲清依据和解读价值；say至少3条，给可以直接照着讲的完整话术；ask至少2条，用于核对生活场景和客户感受；no至少2条，提示禁语和错误解释；action至少3条，写清动作、观察点和复盘；risk至少2条，说明资料边界、复核或转介条件。',
    '不再把内容压缩成一句概括，也不设置60字限制；每条按需要完整表达，但不得重复、注水或脱离报告数据。',
    '先讲用户听得懂的话，再连接具体报告字段；资料没有提供的结论必须明确标为待确认，不能编造。',
    '输出格式：{"steps":[...]}'
  ].join('\n');
  return { system, user };
}

module.exports = {
  LEGACY_STEP_TITLES,
  STEP_FIELDS,
  STEP_TITLES,
  buildPrompt,
  isUuid,
  parseModelText,
  validateDetailedPrefix,
  validateDetailedSteps,
  validateGenerateBody,
  validateSaveBody,
  validateSteps
};
