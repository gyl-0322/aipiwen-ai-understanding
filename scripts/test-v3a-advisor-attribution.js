#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SESSION_SECRET ||= 'TEST_SESSION_SECRET_NOT_REAL';

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/022_v3a_advisor_attribution.sql');
const attributionSource = read('api/v3a-attribution.js');
const reportStoreSource = read('api/generate-report.js');
const adminSource = read('api/v3a-admin.js');
const uploadPage = read('report-upload.html');
const customersPage = read('ai-interpreter-customers.html');
const adminPage = read('admin-unassigned.html');
const adminClient = read('static/v3a-admin-unassigned.js');
const vercel = JSON.parse(read('vercel.json'));
const attributionTest = require('../api/v3a-attribution')._test;
const reportStoreTest = require('../api/generate-report')._test;
const adminTest = require('../api/v3a-admin')._test;

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

// Migration 022: one transaction, explicit baseline checks, immutable source and least privilege.
match(migration, /^begin;[\s\S]*commit;\s*$/m, '022 必须是单事务');
match(migration, /MIGRATION_022_REQUIRES_PHASE_A/, '022 必须预检 Phase A 表和 RPC');
match(migration, /create table public\.attribution_tokens/, '必须创建独立 attribution_tokens 表');
noMatch(migration, /alter table public\.invite_codes|update public\.invite_codes/i, '022 不得修改 invite_codes');
match(migration, /alter column advisor_user_id drop not null/, 'unguided 客户必须允许 advisor_user_id 为 NULL');
match(migration, /add column assigned_by_user_id uuid[\s\S]*add column assigned_at timestamptz/, '必须增加归属审计字段');
match(migration, /check \(source in \('invite_link', 'advisor_qr', 'advisor_import', 'unguided'\)\)/g,
  '客户和报告来源必须兼容旧值并支持 unguided');
match(migration, /SOURCE_IS_IMMUTABLE/, 'source 必须由数据库拒绝修改');
match(migration, /drop trigger advisor_clients_set_updated_at[\s\S]*when \([\s\S]*old\.auth_user_id[\s\S]*old\.archived_at[\s\S]*execute function public\.v3a_set_updated_at\(\)/,
  '纯归属调整不得额外修改 updated_at');
match(migration, /'ASSIGN_CLIENT'/, '审计 action 必须支持 ASSIGN_CLIENT');

for (const fn of [
  'v3a_create_attribution_token(integer)',
  'v3a_validate_attribution_token(text)',
  'v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)',
  'v3a_assign_advisor_client(uuid,uuid,uuid,text)'
]) {
  match(migration, new RegExp(`to_regprocedure\\('public\\.${fn.replace(/[()]/g, '\\$&')}'\\)`), `${fn} 必须通过 postflight`);
}
match(migration, /grant execute on function public\.v3a_create_attribution_token\(integer\)[\s\S]*to authenticated;/,
  '只有 authenticated 可创建 token');
match(migration, /grant execute on function public\.v3a_validate_attribution_token\(text\)[\s\S]*to anon, authenticated;/,
  '公开验证只暴露受控 RPC');
match(migration, /grant execute on function public\.v3a_store_attributed_report[\s\S]*to service_role;/,
  '报告归属写入只能由 service_role 调用');
match(migration, /grant execute on function public\.v3a_assign_advisor_client[\s\S]*to service_role;/,
  '总部归属事务只能由 service_role 调用');
match(migration, /for update of t;/i, 'token 消耗必须锁定 token 行');
match(migration, /v_expires_at <= now\(\)[\s\S]*v_used_count >= v_max_uses/i,
  'token 消耗必须校验过期时间与使用次数');
match(migration, /IDEMPOTENCY_PAYLOAD_MISMATCH/, '归属入库必须拒绝幂等键不同 payload');
match(migration, /CLIENT_ALREADY_ASSIGNED/, '归属调整必须只接受未分配客户');
match(migration, /TARGET_ADVISOR_NOT_ACTIVE/, '归属调整必须校验 active advisor');
match(migration, /insert into public\.admin_audit_logs[\s\S]*'ASSIGN_CLIENT'/,
  '归属调整必须写入现有审计表');

// API and route security contracts.
match(attributionSource, /requireSameOrigin/, 'token 创建必须执行 SameOrigin');
match(attributionSource, /requireCsrf/, 'token 创建必须执行 CSRF');
match(attributionSource, /user\.role !== 'advisor'[\s\S]*user\.status !== 'active'/,
  'token 创建必须限制 active advisor');
match(attributionSource, /action === 'validate'/, '必须支持公开 validate action');
noMatch(attributionSource, /invite_codes/, '客户归属 API 不得复用 invite_codes');
noMatch(attributionSource, /advisor_id\s*[:=]\s*(?:body|req\.)/i, '不得从浏览器接受 advisor_id');

check(attributionTest.normalizeToken('A'.repeat(32)) === 'a'.repeat(32), 'token 必须规范化为小写');
throwsCode(() => attributionTest.normalizeToken('bad'), 'INVALID_ATTRIBUTION_TOKEN', '必须拒绝非法 token 格式');
check(attributionTest.publicAdvisor({ valid: true, advisorDisplayName: '张老师', advisorUserId: 'secret-id' })
  .advisor.displayName === '张老师', '公开验证必须返回指导师展示名');
check(!JSON.stringify(attributionTest.publicAdvisor({ valid: true, advisorDisplayName: '张老师', advisorUserId: 'secret-id' }))
  .includes('secret-id'), '公开验证不得返回内部 advisor id');

match(reportStoreSource, /v3a_store_attributed_report/, 'report-store 必须调用归属原子 RPC');
match(reportStoreSource, /attributionToken/, 'report-store 必须接收归属 token');
match(reportStoreSource, /source:\s*attribution\.source/, 'Redis 报告必须记录来源');
match(reportStoreSource, /advisor_id:\s*attribution\.advisorUserId/, 'Redis 内部记录必须注入 advisor_id');
match(reportStoreSource, /delete publicReport\.advisor_id/, '公开读取不得泄露 advisor_id');
noMatch(reportStoreSource, /console\.(?:log|warn|error)\([^\n]*(?:attributionToken|engineResult|fingers|sections|name)/,
  '日志不得输出 token 或客户报告内容');

const uuid = '11111111-1111-4111-8111-111111111111';
check(reportStoreTest.normalizeAttributionInput({ attributionToken: 'b'.repeat(32), idempotencyKey: uuid }).token === 'b'.repeat(32),
  'report-store 必须保留合法 token');
check(reportStoreTest.normalizeAttributionInput({ idempotencyKey: uuid }).token === null,
  '无 token 必须走 unguided');
throwsCode(() => reportStoreTest.normalizeAttributionInput({ attributionToken: 'bad', idempotencyKey: uuid }),
  'INVALID_ATTRIBUTION_TOKEN', '带无效 token 必须 fail closed');

match(uploadPage, /searchParams\.get\('token'\)/, '唯一上传页必须读取 token 参数');
match(uploadPage, /attributionToken:\s*_attributionToken/, '唯一上传页必须把 token 交给 report-store');
match(uploadPage, /idempotencyKey:\s*_attributionIdempotencyKey/, '上传页必须复用稳定幂等键');
noMatch(uploadPage, /localStorage\.setItem\([^\n]*attribution/i, '归属 token 不得写入 localStorage');

match(adminSource, /action === 'unassigned'/, '管理 API 必须支持无归属池');
match(adminSource, /action === 'assign'/, '管理 API 必须支持单客户归属');
match(adminSource, /requireActiveSuperAdmin/, '归属管理必须复用 super_admin 门禁');
match(adminSource, /requireSameOrigin[\s\S]*requireCsrf/, '归属写入必须同时通过 SameOrigin 和 CSRF');
check(adminTest.validateAssignmentBody({ clientId: uuid, targetAdvisorUserId: uuid, reason: '人工核对客户归属' }).clientId === uuid,
  '合法归属请求必须通过');
throwsCode(() => adminTest.validateAssignmentBody({ clientId: uuid, targetAdvisorUserId: uuid, reason: '' }),
  'REASON_REQUIRED', '归属调整必须记录原因');

match(customersPage, /替客户上传报告/, '客户页必须提供替客户上传入口');
match(customersPage, /客户归属二维码/, '客户页必须提供客户归属二维码入口');
match(adminPage, /data-v3a-admin-page="unassigned"/, '无归属池页面必须标记管理页面');
match(adminClient, /\/api\/v3a-admin\/unassigned/, '无归属池页面必须调用受控 API');
noMatch(adminClient, /\/assign|method:\s*'POST'/, 'MVP 页面必须保持只读');

const aliases = new Map(vercel.routes.map((route) => [route.src, route.dest]));
check(aliases.get('/api/v3a-customers') === '/api/v3a-attribution?action=customers', '客户 API URL 必须兼容');
check(aliases.get('/api/v3a-admin/unassigned') === '/api/v3a-admin?action=unassigned', '必须注册无归属 API');
check(aliases.get('/api/v3a-admin/assign') === '/api/v3a-admin?action=assign', '必须注册归属写 API');
check(Object.prototype.hasOwnProperty.call(vercel.functions, 'api/v3a-attribution.js'), '必须登记 attribution function');
check(!Object.prototype.hasOwnProperty.call(vercel.functions, 'api/v3a-customers.js'), 'customers 必须合并以保持函数预算');
const functions = fs.readdirSync(path.join(root, 'api')).filter((file) => file.endsWith('.js') && !file.startsWith('_'));
check(functions.length === 12, 'Vercel Functions 必须保持 12/12');

console.log(`PASS: advisor attribution contract (${checks} checks)`);
