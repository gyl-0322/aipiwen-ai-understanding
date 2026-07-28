#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '019_v3a_production_drift_recovery_and_auto_activate.sql'
  ),
  'utf8'
);

function mustContain(fragment, message) {
  assert(migration.includes(fragment), message);
}

function mustMatch(pattern, message) {
  assert(pattern.test(migration), message);
}

try {
  assert.equal((migration.match(/^begin;$/gm) || []).length, 1,
    '019 必须只有一个顶层 begin');
  assert.equal((migration.match(/^commit;$/gm) || []).length, 1,
    '019 必须只有一个顶层 commit');
  assert.equal(/^raise\s+notice\b/gim.test(migration), false,
    'RAISE NOTICE 不得出现在普通 SQL 顶层');

  mustContain("set local lock_timeout = '5s'", '019 必须限制锁等待时间');
  mustContain("set local statement_timeout = '120s'", '019 必须限制整体执行时间');
  mustContain('in share row exclusive mode', '019 必须冻结受检业务表');
  mustContain('expected exactly 1', '019 必须冻结已核验的审核记录数量');
  mustContain(
    'advisor_profiles contains practitioner_type values that require an approved mapping',
    '019 必须在替换分类约束前阻止未经批准的 profile 分类映射'
  );
  mustContain(
    'application_reviews contains practitioner_type values that require an approved mapping',
    '019 必须在替换分类约束前阻止未经批准的 review 分类映射'
  );
  mustContain('expected 5 verified 001/002/006 helper functions',
    '019 必须验证真实 Production helper 基线');
  mustContain('found % unexpected 007-018 RPC(s)',
    '019 必须阻止部分业务 RPC 状态');

  mustContain('rename column operator_user_id to operator_id',
    '019 必须完成 credit_logs post-004 转换');
  mustContain('rename column reason to note',
    '019 必须完成 credit_logs note 转换');
  mustContain('rename column operator_user_id to admin_id',
    '019 必须完成 admin_audit_logs post-004 转换');
  mustContain('add column if not exists rejection_reason text',
    '019 必须恢复 007 rejection_reason 列');
  mustContain('application_reviews_rejection_reason_check',
    '019 必须恢复 rejection_reason 约束');

  [
    'credit_wallets_select_active_own_or_super_admin',
    'credit_logs_select_active_own_or_super_admin',
    'invite_codes_select_active_own_or_super_admin'
  ].forEach((policy) => {
    mustContain(`drop policy if exists ${policy}`,
      `019 必须先删除可能部分存在的 ${policy}`);
    mustContain(`create policy ${policy}`,
      `019 必须创建最终 ${policy}`);
  });

  mustContain('create trigger credit_logs_require_approved_application',
    '019 必须恢复注册奖励触发器');
  mustContain('create or replace function public.v3a_approve_application',
    '019 必须恢复审核通过 RPC');
  mustContain('create or replace function public.v3a_reject_application',
    '019 必须恢复审核拒绝 RPC');
  mustMatch(
    /grant execute on function public\.v3a_approve_application\(uuid, uuid, text\)[\s\S]+to service_role;/,
    '审核 RPC 必须仅由 service_role 调用'
  );

  mustContain('create or replace function public.v3a_submit_pending_application',
    '019 必须恢复最终机构注册 RPC');
  mustContain('text, text, text, text, text, boolean, text, text, text',
    '019 必须包含 9 参数注册 RPC');
  mustContain('Compatibility wrapper for the current V3a authenticated registration RPC.',
    '019 必须包含 8 参数兼容注册 RPC');
  mustContain('revoke insert on table', '019 必须关闭浏览器直接注册写入');

  mustContain('create or replace function public.v3a_auto_activate_advisor',
    '019 必须恢复普通指导师自动开通 RPC');
  mustContain('AUTO_ACTIVATION_INVITE_RULE_UNAPPROVED',
    '邀请码关系规则未批准时必须显式关闭');
  mustContain('AUTO_ACTIVATION_OTHER_NOTE_RULE_UNAPPROVED',
    '其他从业说明存储规则未批准时必须显式关闭');
  assert.equal(/insert into public\.invite_relations/i.test(migration), false,
    '未批准邀请码生命周期前不得自行写 invite_relations');
  mustMatch(
    /if v_register_bonus_exists then[\s\S]+v_wallet_balance is distinct from 500/,
    '已有奖励流水时必须验证钱包余额仍为 500'
  );
  mustMatch(
    /when action = 'AUTO_ACTIVATE_ADVISOR'[\s\S]+then action \|\| ':' \|\| target_id::text/,
    '普通指导师自动开通审计必须由生成列产生稳定幂等键'
  );

  mustContain('create or replace function public.v3a_rebind_verified_phone_account()',
    '019 必须恢复 api/v3a-session.js 依赖的 018 重绑 RPC');
  mustContain('one or more final RPC signatures are missing',
    'Postflight 必须核验最终 RPC 签名');
  mustContain('application_reviews state changed',
    'Postflight 必须证明审核记录状态分布未变化');
  mustContain('migration created forbidden business rows',
    'Postflight 必须证明迁移没有创建业务记录');

  assert.equal(
    /select\s+\*\s+from\s+public\.(users|credit_logs|invite_codes|admin_audit_logs)/i.test(migration),
    false,
    '019 验收说明不得使用会暴露用户或资产数据的 select *'
  );
  assert.equal(
    /(sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}|AKID[A-Za-z0-9]{8,}|[0-9]{11})/.test(migration),
    false,
    '019 不得包含 Secret、Token、AccessKey 或手机号'
  );

  console.log('PASS: V3a Production drift recovery migration contract');
} catch (error) {
  console.error(`FAIL: V3a Production drift recovery migration contract: ${error.message}`);
  process.exit(1);
}
