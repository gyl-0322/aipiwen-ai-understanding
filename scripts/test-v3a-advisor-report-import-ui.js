#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('ai-interpreter-customers.html');
const source = read('static/v3a-attribution.js');

for (const id of [
  'v3a-report-import-panel',
  'v3a-report-import-file',
  'v3a-report-import-extract',
  'v3a-report-import-confirm',
  'v3a-report-import-client',
  'v3a-report-import-name',
  'v3a-report-import-type',
  'v3a-report-import-issue',
  'v3a-report-import-data-confirmed',
  'v3a-report-import-fingers'
]) {
  assert(html.includes(`id="${id}"`), `代客户上传界面缺少 ${id}`);
}

assert(/function openReportImport\(\)/.test(source), '代客户上传按钮必须打开工作台内面板');
assert(/v3a-customer-upload[\s\S]*addEventListener\('click', openReportImport\)/.test(source),
  '代客户上传按钮不得继续跳转公开上传页');
assert(!/function uploadForCustomer\(\)/.test(source), '不得保留公开上传页跳转处理器');
assert(/\/api\/v3a-report-import\?action=extract/.test(source), '图片识别必须复用 report-import extract');
assert(/\/api\/v3a-report-import\?action=confirm/.test(source), '确认入库必须复用 report-import confirm');
assert(/new FormData\(\)/.test(source), '识别请求必须使用 multipart FormData');
assert(/X-CSRF-Token/.test(source) && /credentials: 'same-origin'/.test(source),
  'extract/confirm 必须携带 Session 与 CSRF');
assert(/existingClientId[\s\S]*newClient/.test(source), '必须支持已有客户或新客户二选一');
assert(/dataConfirmed: true/.test(source), '人工确认后才能提交入库');
assert(/loadCustomers\(\)/.test(source), '入库完成后必须刷新真实客户列表');
assert(!/advisor(?:_user)?_id\s*:|advisorId\s*:/.test(source), '浏览器不得提交 advisor id');
assert(!/imageBase64|localStorage|console\.(?:log|error)/.test(source),
  '代客户上传前端不得保存或记录图片及客户数据');

console.log('PASS: protected advisor report import UI contract');
