#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SESSION_SECRET ||= 'TEST_SESSION_SECRET_NOT_REAL';

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/025_v3a_attribution_service_code.sql');
const api = read('api/v3a-attribution.js');
const upload = read('report-upload.html');
const customers = read('ai-interpreter-customers.html');
const customerClient = read('static/v3a-attribution.js');
const helpers = require('../api/v3a-attribution')._test;

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert(condition, message);
}
function match(source, pattern, message) {
  check(pattern.test(source), message);
}
function noMatch(source, pattern, message) {
  check(!pattern.test(source), message);
}
function throwsCode(fn, code, message) {
  checks += 1;
  assert.throws(fn, (error) => error?.code === code, message);
}

match(migration, /^begin;[\s\S]*commit;\s*$/m, '025 必须是单事务');
match(migration, /MIGRATION_025_REQUIRES_ATTRIBUTION_BASELINE/, '025 必须预检 Phase B attribution 基线');
match(migration, /lock table public\.attribution_tokens in share row exclusive mode;/,
  '025 必须锁定 attribution token 数据集');
match(migration, /add column service_code text;/, '025 必须只为现有 token 增加服务码');
match(migration, /alter column service_code set not null/, '服务码回填后必须为非空');
match(migration, /check \(service_code ~ '\^\[0-9A-F\]\{10\}\$'\)/, '数据库必须固定 10 位服务码格式');
match(migration, /unique \(service_code\)/, '服务码必须唯一');
match(migration, /upper\(encode\(gen_random_bytes\(5\), 'hex'\)\)/,
  '服务码必须由数据库安全随机生成');
match(migration, /'serviceCode', v_service_code/, 'token 创建结果必须返回同一行服务码');
match(migration, /create function public\.v3a_validate_attribution_service_code\(p_service_code text\)/,
  '必须增加独立服务码验证 RPC');
match(migration, /'attributionToken', v_token/, '有效服务码必须换取现有 attribution token');
match(migration, /grant execute on function public\.v3a_validate_attribution_service_code\(text\)[\s\S]*to anon, authenticated;/,
  '服务码验证必须只暴露受控函数');
match(migration, /has_function_privilege\('service_role'[\s\S]*v3a_validate_attribution_service_code[\s\S]*'EXECUTE'\)/,
  'postflight 必须拒绝 service_role 直接验证服务码');
noMatch(migration, /(?:alter|update|insert into|delete from)\s+(?:table\s+)?public\.invite_codes/i,
  '025 不得修改指导师注册邀请码');
noMatch(migration, /create or replace function public\.v3a_store_attributed_report/i,
  '025 不得复制或替换已验证的归属入库 RPC');

check(helpers.normalizeServiceCode('abcd-ef12-34') === 'ABCDEF1234', '服务码必须接受分组输入');
check(helpers.normalizeServiceCode(' AB CD EF 12 34 ') === 'ABCDEF1234', '服务码必须接受安全空格');
throwsCode(() => helpers.normalizeServiceCode('ABCD'), 'INVALID_ATTRIBUTION_SERVICE_CODE',
  '短服务码必须拒绝');
throwsCode(() => helpers.normalizeServiceCode('ABCD-EFGH-IJ'), 'INVALID_ATTRIBUTION_SERVICE_CODE',
  '非十六进制服务码必须拒绝');
check(helpers.requestIp({ headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' } }) === '203.0.113.8',
  '服务码限流必须使用请求链路首个 IP');

const publicPayload = helpers.publicServiceCode({
  valid: true,
  attributionToken: 'a'.repeat(32),
  advisorDisplayName: '张老师',
  advisorUserId: 'internal-advisor-id'
});
check(publicPayload.attributionToken === 'a'.repeat(32), '有效服务码只换取现有 token');
check(publicPayload.advisor.displayName === '张老师', '服务码验证必须显示指导师名称');
check(!JSON.stringify(publicPayload).includes('internal-advisor-id'), '服务码响应不得泄露内部指导师 id');

match(api, /hasToken === hasServiceCode/, '公开验证必须拒绝同时提交或同时缺少两种凭证');
match(api, /v3a_validate_attribution_service_code/, 'BFF 必须调用服务码验证 RPC');
match(api, /consumeRateLimit\(config, 'attribution-service-code-validate-ip', requestIp\(req\), 20, 600\)/,
  '手工服务码验证必须执行 IP 级速率限制');
match(api, /serviceCode,\s*uploadPath:/, '创建归属凭证必须同时返回服务码与原二维码路径');
noMatch(api, /invite_codes/, '服务码 BFF 不得复用注册邀请码');

match(customers, /id="v3a-attribution-service-code"/, '指导师客户页必须显示服务码');
match(customers, /id="v3a-attribution-code-copy"/, '指导师客户页必须提供服务码复制');
match(customerClient, /payload\.serviceCode/, '二维码面板必须读取同一 token 的服务码');
match(customerClient, /navigator\.clipboard\.writeText\(serviceCode\)/, '复制操作必须只复制服务码');

match(upload, /id="advisor-service-code-input"/, '首页上传必须提供可选服务码入口');
match(upload, /action=validate&code=/, '上传页必须先通过 BFF 验证服务码');
match(upload, /_attributionToken = payload\.attributionToken/, '服务码必须解析到现有 attribution token');
match(upload, /attributionToken:\s*_attributionToken/, '报告入库必须继续使用现有 token 字段');
match(upload, /请先确认指导师服务码，或清空服务码后作为无归属客户继续/, '填写但未验证的服务码必须 fail closed');
noMatch(upload, /localStorage\.setItem\([^\n]*(?:serviceCode|attributionToken)/,
  '服务码和归属 token 不得写入 localStorage');

const inputHandler = upload.match(
  /qs\('#advisor-service-code-input'\)\.addEventListener\('input', \(\) => \{\s*([^}]+)\s*\}\);/
);
check(Boolean(inputHandler), '必须能定位服务码输入变更处理器');
if (inputHandler) {
  const runInputHandler = new Function(
    'qs',
    'state',
    inputHandler[1].replaceAll('_attributionToken', 'state.attributionToken')
  );
  const editableState = { attributionToken: 'a'.repeat(32) };
  runInputHandler(() => ({ disabled: false }), editableState);
  check(editableState.attributionToken === null,
    '服务码验证后重新编辑输入必须清除旧 attribution token');

  const lockedState = { attributionToken: 'a'.repeat(32) };
  runInputHandler(() => ({ disabled: true }), lockedState);
  check(lockedState.attributionToken === 'a'.repeat(32),
    '验证成功后锁定的输入框不得意外清除有效 attribution token');
}

console.log(`PASS: attribution service code contract (${checks} checks)`);
