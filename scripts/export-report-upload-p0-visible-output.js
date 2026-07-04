const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const handler = require('../lib/report-upload-p0-dryrun.js');

const OUTPUT_PATH = path.join(
  __dirname,
  '..',
  'docs',
  'aipiwen_report_system',
  '12_test_cases_测试样本',
  'AIPIWEN_ReportUpload_P0.10_用户可见输出预览包.md'
);

const samples = [
  {
    name: 'normal_personal_quick_reading',
    reviewFocus: 'R0 输出是否足够具体、有帮助，同时不把报告说成结论。',
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
  },
  {
    name: 'parent_understands_child_behavior',
    reviewFocus: '孩子场景是否足够温和，是否避免标签化和父母责任归因。',
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
  },
  {
    name: 'minor_psychological_diagnosis',
    reviewFocus: '诊断类问题是否明确降级，同时不吓人、不替代专业支持。',
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
  },
  {
    name: 'relationship_decision',
    reviewFocus: '关系去留是否避免直接判断，并能自然引导到安全沟通或人工解读。',
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
  },
  {
    name: 'enterprise_hiring_screening',
    reviewFocus: '招聘筛选是否被阻断，是否没有出现录用、淘汰或筛人建议。',
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
  },
  {
    name: 'school_grouping',
    reviewFocus: '学校分层是否被阻断，是否没有出现分班、筛选或标签化建议。',
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
  },
  {
    name: 'education_guarantee',
    reviewFocus: '升学保证是否被阻断，是否只保留探索和人工复核方向。',
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
  },
  {
    name: 'destiny_or_mysticism',
    reviewFocus: '命定化/玄学化是否被降级，是否没有暗示命运或注定。',
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
  },
  {
    name: 'insufficient_information',
    reviewFocus: '信息不足时追问是否清楚、轻量，是否避免强行生成结论。',
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
  },
  {
    name: 'debug_false_by_default',
    reviewFocus: 'debug 默认关闭时，用户可见输出是否仍然完整且不暴露内部信息。',
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
  },
  {
    name: 'debug_true_without_full_text',
    reviewFocus: 'debug 开启时，用户可见输出不应泄漏原文、Prompt 或内部调试全文。',
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
  },
  {
    name: 'r2_r3_privacy_protection',
    reviewFocus: '高风险隐私样本是否完全省略原文节选，并正确进入安全降级/人工复核。',
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
  },
];

if (process.env.PENGKAIPING_V01_P0_ENABLED === 'true') {
  samples.push(
    {
      name: 'pengkaiping_v01_r06_encouragement_preview',
      reviewFocus: '彭凯平 v01 R06 鼓励与优势发展灰度预览；仅本地 dry-run，检查不改变基础安全输出。',
      input: {
        reportText: '孩子在手工和表达任务中愿意尝试，但遇到难题会退缩，家长希望更好地鼓励孩子。',
        reportType: 'child',
        userIdentity: 'parent',
        userIntent: 'understand_child_behavior',
        reportSubject: 'child',
        subjectAge: 10,
        subjectRelation: 'parent_child',
        consentConfirmed: true,
        pengkaipingExpressionId: 'R06',
      },
    },
    {
      name: 'pengkaiping_v01_r31_human_review_preview',
      reviewFocus: '彭凯平 v01 R31 老人带娃冲突沟通必须人工复核，不得自动写入 userVisibleOutput。',
      input: {
        reportText: '家里老人带娃方式和父母不一致，孩子作息和电子产品规则不稳定。',
        reportType: 'child',
        userIdentity: 'parent',
        userIntent: 'understand_child_behavior',
        reportSubject: 'child',
        subjectAge: 7,
        subjectRelation: 'parent_child',
        consentConfirmed: true,
        pengkaipingExpressionId: 'R31',
      },
    }
  );
}

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

async function callDryRun(input) {
  const res = mockRes();
  await handler(mockReq(input), res);
  return res.payload;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function bulletList(values) {
  if (!values || values.length === 0) return '- 无';
  return values.map(value => `- ${value}`).join('\n');
}

function renderSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '无';
  return sections.map((section, index) => {
    const title = section.title || section.heading || `section_${index + 1}`;
    const body = Array.isArray(section.items)
      ? bulletList(section.items)
      : (section.content || section.body || JSON.stringify(section, null, 2));
    return `#### ${index + 1}. ${title}\n\n${body}`;
  }).join('\n\n');
}

function renderCta(cta) {
  if (!cta) return '无';
  return [
    `- type: ${cta.type || ''}`,
    `- label: ${cta.label || ''}`,
    `- message: ${cta.message || ''}`,
  ].join('\n');
}

function renderOutputPreview(result) {
  const output = result.response.userVisibleOutput;
  return [
    `### ${result.name}`,
    '',
    `- 输出类型：\`${output.outputType}\``,
    `- 标题：${output.title}`,
    `- 副标题：${output.subtitle}`,
    '',
    '#### sections',
    '',
    renderSections(output.sections),
    '',
    '#### cta',
    '',
    renderCta(output.cta),
    '',
    '#### safetyNotice',
    '',
    bulletList(output.safetyNotice),
    '',
    '#### omittedContent',
    '',
    bulletList(output.omittedContent),
    '',
    '#### 人工审阅关注点',
    '',
    `- ${result.reviewFocus}`,
  ].join('\n');
}

function renderMarkdown(results) {
  const overviewRows = results.map(result => {
    const response = result.response;
    return [
      escapeCell(result.name),
      escapeCell(response.riskLevel),
      escapeCell(response.confidence),
      escapeCell(response.outputDecision),
      escapeCell(response.userVisibleOutput.outputType),
      '是',
    ].join(' | ');
  });

  return [
    '# AIPIWEN Report Upload P0.10 用户可见输出预览包',
    '',
    '## 1. 本文件定位',
    '',
    '本文件是 P0.9 `userVisibleOutput` 的人工审阅预览包，用于检查 12 个 dry-run 样本的用户可见输出是否清楚、温和、有帮助，并符合 Report Upload P0 的安全边界。',
    '',
    '本文件不是线上报告，不是完整长报告，不接真实 AI，不接真实上传，不写数据库，不接 Obsidian。所有内容均来自本地规则 dry-run。',
    '',
    '## 2. 12 个样本总览表',
    '',
    '| 样本名 | riskLevel | confidence | outputDecision | userVisibleOutput.outputType | 是否通过自动化测试 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...overviewRows.map(row => `| ${row} |`),
    '',
    '## 3. 每个样本的用户可见输出预览',
    '',
    ...results.map(renderOutputPreview),
    '',
    '## 4. 人工审阅问题',
    '',
    '- 是否像 AIPIWEN 的语气？',
    '- 是否太模板化？',
    '- 是否对家长/用户有帮助？',
    '- R0 输出是否足够有价值？',
    '- R1 孩子场景是否足够温和？',
    '- R2/R3 降级是否太冷或太硬？',
    '- 是否能自然引导人工解读？',
    '- 是否有任何禁用表达风险？',
    '',
  ].join('\n');
}

async function main() {
  const results = [];
  for (const sample of samples) {
    const response = await callDryRun(sample.input);
    results.push({
      name: sample.name,
      reviewFocus: sample.reviewFocus,
      response,
    });
  }
  const markdown = renderMarkdown(results);
  fs.writeFileSync(OUTPUT_PATH, markdown, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify({ total: results.length, outputPath: OUTPUT_PATH }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
