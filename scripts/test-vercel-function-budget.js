#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'api');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const functionFiles = fs.readdirSync(apiDir)
  .filter((name) => name.endsWith('.js') && !name.startsWith('_'))
  .sort();

const expectedFunctions = [
  'admin-convs.js',
  'auth.js',
  'children.js',
  'digest.js',
  'extract-fp.js',
  'generate-report.js',
  'guest-chat.js',
  'v3a-admin.js',
  'v3a-attribution.js',
  'v3a-report-import.js',
  'v3a-send-sms-hook.js',
  'v3a-session.js'
].sort();

assert.deepStrictEqual(functionFiles, expectedFunctions,
  'api 目录必须只保留 12 个已登记 Serverless Functions');
assert(functionFiles.length <= 12, `Hobby Function 数量超限：${functionFiles.length}/12`);

const aliases = new Map(vercel.routes.map((route) => [route.src, route.dest]));
for (const [source, destination] of [
  ['/api/invite', '/api/auth'],
  ['/api/synthesize', '/api/guest-chat'],
  ['/api/track', '/api/admin-convs'],
  ['/api/knowledge', '/api/admin-convs'],
  ['/api/report-store', '/api/generate-report'],
  ['/api/v3a-customers', '/api/v3a-attribution?action=customers'],
  ['/api/v3a-admin/unassigned', '/api/v3a-admin?action=unassigned'],
  ['/api/v3a-admin/assign', '/api/v3a-admin?action=assign']
]) {
  assert.equal(aliases.get(source), destination, `${source} 必须继续路由到已合并实现`);
}

for (const duplicate of ['invite.js', 'synthesize.js', 'track.js', 'knowledge.js', 'report-store.js']) {
  assert.equal(fs.existsSync(path.join(apiDir, duplicate)), false, `${duplicate} 不得继续生成可直达重复函数`);
}

for (const [file, markers] of [
  ['auth.js', ['handleInvite']],
  ['guest-chat.js', ['handleSynthesize']],
  ['admin-convs.js', ['handleTrack', 'handleKnowledge']],
  ['generate-report.js', ['handleReportStore']]
]) {
  const source = fs.readFileSync(path.join(apiDir, file), 'utf8');
  markers.forEach((marker) => assert(source.includes(marker), `${file} 缺少合并处理器 ${marker}`));
}

assert.deepStrictEqual(Object.keys(vercel.functions).sort(), expectedFunctions.map((name) => `api/${name}`).sort(),
  'vercel.functions 配置必须与 10 个实际函数一一对应');

console.log('PASS: Vercel Function budget is 12/12 with advisor attribution included');
