#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'api/generate-report.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'report-upload.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const start = apiSource.indexOf('function classifyIssueType');
const apiEndCandidates = [
  apiSource.indexOf('const FUNCTION_MODULE_FINGER_REQUIREMENTS', start),
  apiSource.indexOf('function normalizeSections', start),
].filter(index => index > start);
const end = Math.min(...apiEndCandidates);
assert(start >= 0 && end > start, '无法提取四问卡型选择器');

const sandbox = {};
vm.runInNewContext(`${apiSource.slice(start, end)}
this.classifyIssueType = classifyIssueType;
this.buildIssuePresentation = buildIssuePresentation;
this.issueContentSimilarity = issueContentSimilarity;
this.isGenericIssueContent = isGenericIssueContent;
this.issueFallback = issueFallback;`, sandbox);

const pageStart = pageSource.indexOf('function getIssueAnswerCards');
const pageEndCandidates = [
  pageSource.indexOf('function cleanRequiredModuleScaffold', pageStart),
  pageSource.indexOf('function formatContent', pageStart),
].filter(index => index > pageStart);
const pageEnd = Math.min(...pageEndCandidates);
assert(pageStart >= 0 && pageEnd > pageStart, '无法提取网页四问卡片渲染器');

const pageSandbox = {};
vm.runInNewContext(`${pageSource.slice(pageStart, pageEnd)}
this.getIssueAnswerCards = getIssueAnswerCards;`, pageSandbox);

const parts = {
  why: '这是问题背后的具体机制。',
  how: '这是可以马上尝试的动作。',
  future: '这是后续值得观察的方向。',
  cta: '继续看一个具体场景。',
};

const samples = [
  ['文理/选科，天赋更偏哪边', 'learning_direction', 2, ['先看哪种学习入口更顺', '用真实科目表现来验证']],
  ['偏科/学习方法怎么调', 'learning_method', 3, ['先找真正卡住的环节', '换一种入口试一周', '用变化校正方法']],
  ['怎么激励他主动学（内驱力）', 'homework_dragging', 3, ['这不只是“不想做”', '先从第一个小动作开始', '被看见后会长成的力量']],
  ['考试焦虑/输不起怎么疏导', 'emotion_regulation', 2, ['先看情绪在提醒什么', '当下可以怎样接住']],
  ['升学决策：冲名校还是选适合专业', 'education_decision', 3, ['报告能帮你看什么', '把决定拆成小验证', '还要一起考虑什么']],
  ['他和父母的三观差怎么相处', 'parent_child_communication', 3, ['先把“对错”换成具体场景', '双方可能各自在守什么', '下一次对话可以这样开始']],
  ['交朋友/人际上怎么引导', 'social_relationship', 2, ['先定位卡住的场景', '给自己一个低压力入口']],
  ['职业转型应该怎么选', 'career_direction', 3, ['先看什么在消耗你', '做一次低成本验证', '把优势组合看完整']],
  ['我和伴侣适不适合继续在一起', 'relationship_decision', 3, ['先不急着判断去留', '回到一次具体冲突', '真正值得继续观察的事']],
  ['孩子是不是有 ADHD', 'high_risk_diagnosis', 2, ['这个问题不能由报告判断', '建议先整理这些具体情况']],
  ['这个候选人适不适合录用', 'screening_decision', 2, ['报告不能替代筛选决定', '可以安全参考的范围']],
  ['我为什么总觉得自己不够好', 'self_understanding', 2, ['你可能卡在这里', '先试一个低风险动作']],
];

const modes = new Set();
const cardCounts = new Set();
const answerBodies = new Set();
const titleSets = new Set();
for (const [title, expectedType, expectedCount, expectedTitles] of samples) {
  assert(sandbox.classifyIssueType(title) === expectedType, `${title} 分类错误`);
  const result = sandbox.buildIssuePresentation(title, parts);
  const pageCards = pageSandbox.getIssueAnswerCards({ title, ...parts });
  modes.add(result.answerMode);
  cardCounts.add(result.answerCards.length);
  titleSets.add(expectedTitles.join('|'));
  assert(result.answerCards.length === expectedCount, `${title} 卡片数量错误`);
  assert(JSON.stringify(result.answerCards.map(card => card.title)) === JSON.stringify(expectedTitles), `${title} 卡片标题错误`);
  assert(result.answerCards.every(card => card.body.trim()), `${title} 存在空卡片`);
  assert(JSON.stringify(pageCards.map(card => card.title)) === JSON.stringify(expectedTitles), `${title} 网页兜底标题与后端不一致`);
  assert(pageCards.length === expectedCount, `${title} 网页兜底卡片数量与后端不一致`);
  assert(JSON.stringify(expectedTitles) !== JSON.stringify(['为什么会这样', '怎么应对', '未来可期']), `${title} 退回固定三段标题`);
  const fallback = sandbox.issueFallback(title, 'senior_teen');
  answerBodies.add(`${fallback.why}\n${fallback.how}\n${fallback.future}`);
}

assert(modes.size === samples.length, '问题类型没有形成独立回答模式');
assert(cardCounts.size >= 2, '问题仍被强制成相同卡片数量');
assert(titleSets.size >= 10, '问题卡片标题差异不足');
assert(answerBodies.size === samples.length, '四个问题的兜底正文仍然相同');
assert(sandbox.issueContentSimilarity('同一套模板「问题甲」只替换标题。', '同一套模板「问题乙」只替换标题。') > 0.72, '重复模板未被识别');
assert(sandbox.isGenericIssueContent({
  why: '这个问题不能只看表面行为，需要放回当前年龄阶段一起看。',
  how: '先从一个低风险、能马上执行的小动作开始。',
  future: '这个问题背后通常也藏着一部分优势。',
}), '千篇一律的通用兜底正文未被识别');
assert(apiSource.includes('issuePromptGuide(issue)'), '生成提示词没有按问题类型差异化');
assert(pageSource.includes('function getIssueAnswerCards'), '网页没有接入差异化回答卡');
assert(pageSource.includes('getIssueAnswerCards(sec).map'), 'PDF 没有接入差异化回答卡');
assert(!pageSource.includes("${issueCard(1, '为什么会这样', sec.why)}"), 'PDF 仍硬编码固定三段');

const customerIssues = [
  '适合哪种学习方式（听·看·动手）',
  '怎么激励他主动学（内驱力）',
  '开始顶嘴/叛逆，怎么沟通不炸',
  '考试焦虑/输不起怎么疏导',
];
const customerCardShapes = new Set(customerIssues.map(title => {
  const fallback = sandbox.issueFallback(title, 'senior_teen');
  const presentation = sandbox.buildIssuePresentation(title, fallback);
  return presentation.answerCards.map(card => card.title).join('|');
}));
const customerBodies = customerIssues.map(title => {
  const fallback = sandbox.issueFallback(title, 'senior_teen');
  return `${fallback.why}\n${fallback.how}\n${fallback.future}`;
});
assert(customerCardShapes.size === customerIssues.length, '典型四问的卡片结构仍然重复');
for (let i = 0; i < customerBodies.length; i += 1) {
  for (let j = i + 1; j < customerBodies.length; j += 1) {
    assert(sandbox.issueContentSimilarity(customerBodies[i], customerBodies[j]) < 0.72, `典型四问正文过度相似：${customerIssues[i]} / ${customerIssues[j]}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  testedIssues: samples.length,
  answerModes: [...modes],
  cardCounts: [...cardCounts].sort(),
  distinctTitleSets: titleSets.size,
  representativeQuestions: customerIssues.length,
  webAndPdfAligned: true,
}, null, 2));
