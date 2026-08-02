#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pages = [
  'ai-interpreter-workbench.html',
  'ai-interpreter-customers.html',
  'ai-interpreter-session.html',
  'ai-interpreter-training.html',
  'ai-interpreter-review.html',
  'ai-interpreter-cases.html'
];
const auth = read('static/v3a-auth.js');
const customers = read('static/v3a-attribution.js');
const interpreter = read('static/ai-interpreter.js');
const handlers = new Map([
  ['v3a-workbench-logout', auth],
  ['v3a-attribution-qr', customers],
  ['v3a-customer-upload', customers],
  ['v3a-report-import-close', customers],
  ['v3a-report-import-extract', customers],
  ['v3a-report-import-submit', customers],
  ['v3a-attribution-close', customers],
  ['v3a-attribution-code-copy', customers],
  ['save-interpretation', interpreter],
  ['prev-step', interpreter],
  ['next-step', interpreter],
  ['skip-step', interpreter]
]);

let count = 0;
for (const page of pages) {
  const html = read(page);
  const buttons = Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g));
  for (const [, attributes] of buttons) {
    count += 1;
    const id = attributes.match(/\bid="([^"]+)"/)?.[1] || '';
    if (/\bdata-v3a-detail(?:=|\s|$)/.test(attributes)) {
      assert(/querySelectorAll\('\[data-v3a-detail\]'\)[\s\S]*addEventListener\('click'/.test(auth),
        `${page} 身份详情按钮缺少处理器`);
      continue;
    }
    if (/\bdata-v3a-detail-close(?:=|\s|$)/.test(attributes)) {
      assert(/data-v3a-detail-close[\s\S]*addEventListener\('click'/.test(auth),
        `${page} 详情关闭按钮缺少处理器`);
      continue;
    }
    if (/\bdata-review-target=/.test(attributes)) {
      assert(/\.tab-btn[\s\S]*addEventListener\('click'/.test(interpreter),
        `${page} 复核标签缺少处理器`);
      continue;
    }
    assert(id, `${page} 存在无法识别的无 ID 按钮`);
    const source = handlers.get(id);
    assert(source, `${page} 按钮 ${id} 未登记处理器`);
    if (id === 'v3a-report-import-submit') {
      assert(/v3a-report-import-confirm[\s\S]*addEventListener\('submit'/.test(source),
        `${page} 提交按钮没有表单 submit 处理器`);
    } else {
      assert(source.includes(`#${id}`) && /addEventListener\('click'/.test(source),
        `${page} 按钮 ${id} 缺少 click 处理器`);
    }
  }

  for (const href of Array.from(html.matchAll(/href="([^"]+)"/g), (match) => match[1])) {
    if (!href || href.startsWith('#') || href.startsWith('/') || href.startsWith('data:') || /^https?:/.test(href)) continue;
    const target = href.split(/[?#]/)[0];
    if (target.endsWith('.html')) assert(fs.existsSync(path.join(root, target)), `${page} 链接目标不存在：${href}`);
  }
}

assert.equal(count, 19, '工作台静态按钮数量发生变化，必须更新清单并核对处理器');
assert(!/<a class="table-row" href="ai-interpreter-session\.html">/.test(read('ai-interpreter-workbench.html')),
  '学习示例记录不得指向无上下文解读页');
assert(!/data-page="session" href="ai-interpreter-session\.html"/.test(pages.map(read).join('\n')),
  '侧栏 AI 解读助手不得指向无上下文空页');

console.log(`PASS: ${count} workbench buttons and all local HTML targets are registered`);
