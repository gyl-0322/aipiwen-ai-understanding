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
const end = apiSource.indexOf('const FUNCTION_MODULE_FINGER_REQUIREMENTS', start);
assert(start >= 0 && end > start, '无法提取四问卡型选择器');

const sandbox = {};
vm.runInNewContext(`${apiSource.slice(start, end)}
this.classifyIssueType = classifyIssueType;
this.buildIssuePresentation = buildIssuePresentation;
this.issueContentSimilarity = issueContentSimilarity;
this.isGenericIssueContent = isGenericIssueContent;
this.issueFallback = issueFallback;`, sandbox);

const parts = {
  why: '这是问题背后的具体机制。',
  how: '这是可以马上尝试的动作。',
  future: '这是后续值得观察的方向。',
  cta: '继续看一个具体场景。',
};

const samples = [
  ['文理/选科，天赋更偏哪边', 'learning_method', 2, ['先别急着定方向', '接下来观察并试这几步']],
  ['偏科/学习方法怎么调', 'learning_method', 2, ['先别急着定方向', '接下来观察并试这几步']],
  ['升学决策：冲名校还是选适合专业', 'education_decision', 3, ['报告能帮你看什么', '把决定拆成小验证', '还要一起考虑什么']],
  ['他和父母的三观差怎么相处', 'parent_child_communication', 3, ['先把“对错”换成具体场景', '双方可能各自在守什么', '下一次对话可以这样开始']],
];

const modes = new Set();
const cardCounts = new Set();
const answerBodies = new Set();
for (const [title, expectedType, expectedCount, expectedTitles] of samples) {
  assert(sandbox.classifyIssueType(title) === expectedType, `${title} 分类错误`);
  const result = sandbox.buildIssuePresentation(title, parts);
  modes.add(result.answerMode);
  cardCounts.add(result.answerCards.length);
  assert(result.answerCards.length === expectedCount, `${title} 卡片数量错误`);
  assert(JSON.stringify(result.answerCards.map(card => card.title)) === JSON.stringify(expectedTitles), `${title} 卡片标题错误`);
  assert(result.answerCards.every(card => card.body.trim()), `${title} 存在空卡片`);
  const fallback = sandbox.issueFallback(title, 'senior_teen');
  answerBodies.add(`${fallback.why}\n${fallback.how}\n${fallback.future}`);
}

assert(modes.size >= 3, '四个问题没有形成差异化回答模式');
assert(cardCounts.size >= 2, '四个问题仍被强制成相同卡片数量');
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

console.log(JSON.stringify({
  ok: true,
  testedIssues: samples.length,
  answerModes: [...modes],
  cardCounts: [...cardCounts].sort(),
  webAndPdfAligned: true,
}, null, 2));
