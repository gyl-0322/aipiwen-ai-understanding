#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '026_v3a_attribution_service_code_runtime_fix.sql'),
  'utf8'
);

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert(condition, message);
}
function match(pattern, message) {
  check(pattern.test(migration), message);
}
function noMatch(pattern, message) {
  check(!pattern.test(migration), message);
}

match(/^begin;[\s\S]*commit;\s*$/m, '026 必须是单事务');
match(/MIGRATION_026_REQUIRES_SERVICE_CODE_BASELINE/, '026 必须预检已执行的 025 基线');
match(/to_regprocedure\('extensions\.gen_random_bytes\(integer\)'\)/,
  '026 必须预检 Supabase extensions 随机函数');
match(/create or replace function public\.v3a_create_attribution_token\(p_max_uses integer default 1\)/,
  '026 只能替换既有创建 RPC');
match(/security definer[\s\S]*set search_path = pg_catalog, public/,
  '026 必须保持原 SECURITY DEFINER 与冻结 search_path');
match(/extensions\.gen_random_bytes\(5\)/,
  '运行时随机字节函数必须显式限定 extensions schema');
noMatch(/[^.]gen_random_bytes\(5\)/,
  '026 不得保留未限定 schema 的随机字节调用');
match(/set_config\('request\.jwt\.claim\.sub'/,
  '026 必须在事务内模拟受控 advisor 身份执行 runtime probe');
match(/v_probe := public\.v3a_create_attribution_token\(1\)/,
  '026 必须真实调用修复后的创建 RPC');
match(/delete from public\.attribution_tokens[\s\S]*where token = v_probe_token/,
  '026 必须精确删除 runtime probe token');
match(/MIGRATION_026_POSTFLIGHT_RUNTIME_CLEANUP_FAILED/,
  '026 必须验证 runtime probe 没有留下测试数据');
match(/grant execute on function public\.v3a_create_attribution_token\(integer\)[\s\S]*to authenticated;/,
  '026 必须保持创建 RPC 仅授权 authenticated');
noMatch(/alter table|create table|drop table/i,
  '026 不得修改任何表结构');
noMatch(/(?:insert into|update|delete from)\s+auth\./i,
  '026 不得修改 Auth 数据');
noMatch(/invite_codes|credit_wallets|credit_logs/i,
  '026 不得修改邀请码或积分模型');

console.log(`PASS: attribution service code runtime fix (${checks} checks)`);
