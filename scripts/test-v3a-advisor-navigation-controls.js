#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const customersHtml = read('ai-interpreter-customers.html');
const customersJs = read('static/v3a-attribution.js');
const sessionHtml = read('ai-interpreter-session.html');
const sessionJs = read('static/ai-interpreter.js');
const workbenchHtml = read('ai-interpreter-workbench.html');
const workbenchPages = [
  'ai-interpreter-workbench.html',
  'ai-interpreter-customers.html',
  'ai-interpreter-session.html',
  'ai-interpreter-training.html',
  'ai-interpreter-review.html',
  'ai-interpreter-cases.html'
];

assert(!/document\.createElement\(readyReport \? 'button' : 'div'\)/.test(customersJs),
  '真实客户整行不得作为开始解读按钮');
assert(/className = 'btn ghost customer-start-button'/.test(customersJs),
  '每个 ready 报告必须提供独立开始解读按钮');
assert(/action\.addEventListener\('click'/.test(customersJs),
  '开始解读必须只绑定在独立按钮上');

assert(!sessionHtml.includes('id="generate-plan"'),
  '首次解读应自动生成，不得保留重复的生成按钮');
assert(/await generateInterpretation\(\)/.test(sessionJs),
  '真实报告没有既有方案时必须自动生成');
assert(!/generate-plan/.test(sessionJs),
  '脚本不得继续依赖已移除的生成按钮');

for (const page of workbenchPages) {
  const html = read(page);
  assert(/data-page="session" href="ai-interpreter-customers\.html\?intent=interpret"/.test(html),
    `${page} 的 AI 解读助手入口必须先进入客户选择页`);
}
assert(!/<a class="table-row" href="ai-interpreter-session\.html">/.test(workbenchHtml),
  '工作台学习示例记录不得链接无上下文解读页');
assert(!workbenchHtml.includes('<span>进入</span>'),
  '不可点击的学习示例记录不得继续显示进入操作');

for (const id of ['v3a-customer-search', 'v3a-customer-status-filter', 'v3a-customer-sort']) {
  assert(customersHtml.includes(`id="${id}"`), `缺少真实客户控件 ${id}`);
}
assert(customersHtml.indexOf('id="v3a-customer-search"') < customersHtml.indexOf('id="v3a-real-customers-table"'),
  '搜索筛选控件必须放在真实客户表格之前');
assert(!customersHtml.includes('报告类型：儿童天赋报告') && !customersHtml.includes('日期范围：近 30 天'),
  '不得保留与真实筛选无关的静态标签');
assert(/let allClients = \[\]/.test(customersJs), '必须保存真实客户列表用于筛选排序');
assert(/function applyCustomerView\(\)/.test(customersJs), '必须实现真实客户筛选排序');
assert(/v3a-customer-search[\s\S]*addEventListener\('input', applyCustomerView\)/.test(customersJs),
  '搜索框必须驱动真实客户列表');
assert(/v3a-customer-status-filter[\s\S]*addEventListener\('change', applyCustomerView\)/.test(customersJs),
  '状态筛选必须驱动真实客户列表');
assert(/v3a-customer-sort[\s\S]*addEventListener\('change', applyCustomerView\)/.test(customersJs),
  '排序控件必须驱动真实客户列表');
assert(!customersHtml.includes('手机号 / 报告类型'),
  '客户接口未返回手机号和报告类型时不得展示虚假搜索范围');

console.log('PASS: advisor start button, auto interpretation, navigation, and customer controls');
