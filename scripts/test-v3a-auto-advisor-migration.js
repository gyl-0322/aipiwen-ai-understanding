#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '017_v3a_auto_activate_advisor.sql'),
  'utf8'
);

function mustContain(fragment, message) {
  assert(migration.includes(fragment), message);
}

function mustMatch(pattern, message) {
  assert(pattern.test(migration), message);
}

try {
  mustContain('create or replace function public.v3a_auto_activate_advisor', '必须新增普通指导师自动开通 RPC');
  mustContain("'AUTO_ACTIVATE_ADVISOR'", '自动开通审计动作必须独立于人工审核');
  mustContain('alter column admin_id drop not null', '自动开通不得伪造 super_admin，admin_id 必须允许为空');
  mustContain("'source', 'phone_verified_auto_activation'", '自动开通审计必须记录来源');
  mustContain('REGISTER_BONUS:%s:AUTO_ADVISOR_ACTIVATION', '注册 500 积分必须使用自动开通幂等键');
  mustContain('amount = 500', '注册体验积分必须固定为 500');
  mustContain('on conflict (idempotency_key) do nothing', '积分和审计必须幂等');
  mustContain('insert into public.credit_wallets', '自动开通必须创建钱包');
  mustContain('insert into public.credit_logs', '自动开通必须写积分流水');
  mustContain('insert into public.invite_codes', '自动开通必须生成邀请码');
  mustContain("values (v_candidate_code, v_user_id, 'advisor', 'active')", '自动邀请码必须属于 advisor');
  mustContain("v_user.status <> 'active' or v_user.role <> 'advisor'", '已有 pending 机构申请不得被自动激活');
  mustContain('ACCOUNT_NOT_ELIGIBLE_FOR_AUTO_ACTIVATION', '不合格账号必须阻止自动开通');
  mustContain('grant execute on function public.v3a_auto_activate_advisor', '自动开通 RPC 必须显式授权');
  mustContain('to authenticated', '自动开通 RPC 只给 authenticated 用户态调用');
  mustMatch(/revoke all on function public\.v3a_auto_activate_advisor[\s\S]+from public, anon, authenticated, service_role;/,
    '自动开通 RPC 必须先撤销 public/anon/service_role 权限');
  assert.equal(/grant execute on function public\.v3a_auto_activate_advisor[\s\S]+to service_role/.test(migration), false,
    '自动开通 RPC 不得给 service_role 作为管理入口');
  assert.equal(/update public\.application_reviews[\s\S]+status = 'approved'/.test(migration), false,
    'migration 文件本身不得批量审核现有 pending 申请');
  console.log('PASS: V3a auto advisor migration contract');
} catch (error) {
  console.error(`FAIL: V3a auto advisor migration contract: ${error.message}`);
  process.exit(1);
}
