-- AIPIWEN V3a Production Drift Recovery from the verified 001/002/006 baseline.
-- ============================================================================
-- 用途: 一次性修复 Production 数据库迁移漂移，恢复最终核心表结构、安全加固、
--       审核 RPC、注册 RPC、普通指导师自动开通和已验证手机号账号重绑。
-- 执行方式: 在 Supabase Dashboard → SQL Editor (确认选中 Production 项目) 中执行本文件。
-- 回滚: 任何错误都会整段回滚，不会留下部分迁移状态。
-- ⚠️ 执行前必须先确认 Production 项目 ref = tysbwijizgebnrazxpvo
-- ⚠️ 本文件不包含任何 Secret、手机号、Token、Cookie 或 Session 数据。
-- ⚠️ 当前为 REVIEW CANDIDATE；邀请码关系和“其他”从业说明规则未批准前禁止执行。
-- ============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ============================================================================
-- PHASE 0: PREFLIGHT ASSERTIONS
-- 条件不满足时主动 raise exception，不继续执行。
-- ============================================================================

lock table
  public.users,
  public.advisor_profiles,
  public.application_reviews,
  public.credit_wallets,
  public.credit_logs,
  public.invite_codes,
  public.invite_relations,
  public.admin_audit_logs
in share row exclusive mode;

create temporary table v3a_019_preflight_state (
  review_count bigint not null,
  pending_count bigint not null,
  approved_count bigint not null,
  rejected_count bigint not null
) on commit drop;

insert into v3a_019_preflight_state (
  review_count,
  pending_count,
  approved_count,
  rejected_count
)
select
  count(*),
  count(*) filter (where status = 'pending'),
  count(*) filter (where status = 'approved'),
  count(*) filter (where status = 'rejected')
from public.application_reviews;

do $$
declare
  v_admin_count integer;
  v_credit_count integer;
  v_wallet_count integer;
  v_invite_count integer;
  v_relation_count integer;
  v_review_count integer;
  v_required_helper_count integer;
  v_forbidden_rpc_count integer;
begin
  -- 0.1 行数安全核验：会发生结构变化的资产、审计和邀请表必须为空。
  select count(*) into v_admin_count from public.admin_audit_logs;
  select count(*) into v_credit_count from public.credit_logs;
  select count(*) into v_wallet_count from public.credit_wallets;
  select count(*) into v_invite_count from public.invite_codes;
  select count(*) into v_relation_count from public.invite_relations;

  if v_admin_count <> 0 then
    raise exception 'PRECHECK_FAILED: admin_audit_logs has % row(s), expected 0', v_admin_count;
  end if;
  if v_credit_count <> 0 then
    raise exception 'PRECHECK_FAILED: credit_logs has % row(s), expected 0', v_credit_count;
  end if;
  if v_wallet_count <> 0 then
    raise exception 'PRECHECK_FAILED: credit_wallets has % row(s), expected 0', v_wallet_count;
  end if;
  if v_invite_count <> 0 then
    raise exception 'PRECHECK_FAILED: invite_codes has % row(s), expected 0', v_invite_count;
  end if;
  if v_relation_count <> 0 then
    raise exception 'PRECHECK_FAILED: invite_relations has % row(s), expected 0', v_relation_count;
  end if;

  -- 0.2 现场证据冻结为恰好一条审核记录。发生变化时必须重新 Review。
  select count(*) into v_review_count from public.application_reviews;
  if v_review_count <> 1 then
    raise exception 'PRECHECK_FAILED: application_reviews has % row(s), expected exactly 1', v_review_count;
  end if;

  -- 0.3 不推断旧分类含义。若现有数据无法直接满足 014 最终分类，停止并要求业务映射决策。
  if exists (
    select 1
    from public.advisor_profiles
    where practitioner_type not in (
      'independent',
      'organization',
      'education_family',
      'psychological_consulting',
      'child_growth_quality',
      'assessment_collection',
      'other'
    )
  ) then
    raise exception 'PRECHECK_FAILED: advisor_profiles contains practitioner_type values that require an approved mapping';
  end if;

  if exists (
    select 1
    from public.application_reviews
    where practitioner_type not in (
      'independent',
      'organization',
      'education_family',
      'psychological_consulting',
      'child_growth_quality',
      'assessment_collection',
      'other'
    )
  ) then
    raise exception 'PRECHECK_FAILED: application_reviews contains practitioner_type values that require an approved mapping';
  end if;

  -- 0.4 确认真实 pre-004 核心表状态。
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_audit_logs'
      and column_name = 'operator_user_id'
  ) then
    raise exception 'PRECHECK_FAILED: admin_audit_logs.operator_user_id must exist (pre-004 state expected)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_audit_logs'
      and column_name = 'admin_id'
  ) then
    raise exception 'PRECHECK_FAILED: admin_audit_logs.admin_id already exists — 004 may have been partially applied';
  end if;

  -- 0.5 确认 pre-004 状态：credit_logs 有 operator_user_id 和 reason
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'credit_logs'
      and column_name = 'operator_user_id'
  ) then
    raise exception 'PRECHECK_FAILED: credit_logs.operator_user_id must exist (pre-004 state expected)';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'credit_logs'
      and column_name = 'reason'
  ) then
    raise exception 'PRECHECK_FAILED: credit_logs.reason must exist (pre-004 state expected)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'credit_logs'
      and column_name in ('operator_id', 'note')
  ) then
    raise exception 'PRECHECK_FAILED: credit_logs has post-004 columns';
  end if;

  -- 0.6 001/002/006 基线 helper 必须存在，签名漂移时停止。
  select count(*)
  into v_required_helper_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      (p.proname = 'v3a_current_user_id'
        and pg_get_function_identity_arguments(p.oid) = '')
      or (p.proname = 'v3a_current_role'
        and pg_get_function_identity_arguments(p.oid) = '')
      or (p.proname = 'v3a_current_status'
        and pg_get_function_identity_arguments(p.oid) = '')
      or (p.proname = 'v3a_is_super_admin'
        and pg_get_function_identity_arguments(p.oid) = '')
      or (p.proname = 'v3a_bootstrap_first_super_admin'
        and pg_get_function_identity_arguments(p.oid) = 'p_auth_user_id uuid, p_email text')
    );
  if v_required_helper_count <> 5 then
    raise exception 'PRECHECK_FAILED: expected 5 verified 001/002/006 helper functions, found %',
      v_required_helper_count;
  end if;

  -- 0.7 007–018 的最终业务 RPC 现场均不存在；任何部分生效都要求重新 Review。
  select count(*)
  into v_forbidden_rpc_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'v3a_approve_application',
      'v3a_reject_application',
      'v3a_submit_pending_application',
      'v3a_auto_activate_advisor',
      'v3a_rebind_verified_phone_account',
      'v3a_credit_logs_require_approved_application'
    );
  if v_forbidden_rpc_count <> 0 then
    raise exception 'PRECHECK_FAILED: found % unexpected 007-018 RPC(s)', v_forbidden_rpc_count;
  end if;

  -- 0.8 007/008/010 的最终约束和触发器必须尚未存在。
  if exists (
    select 1 from pg_constraint
    where conname in (
      'application_reviews_rejection_reason_check',
      'credit_logs_register_bonus_shape_check',
      'invite_codes_user_id_key',
      'admin_audit_logs_review_idempotency_key_check',
      'users_phone_china_e164_check'
    )
  ) then
    raise exception 'PRECHECK_FAILED: final 007/008/010 constraints already exist';
  end if;
  if exists (
    select 1 from information_schema.triggers
    where trigger_schema = 'public'
      and event_object_table = 'credit_logs'
      and trigger_name = 'credit_logs_require_approved_application'
  ) then
    raise exception 'PRECHECK_FAILED: final credit registration trigger already exists';
  end if;
end;
$$;

-- ============================================================================
-- PHASE 1: 004 STRUCTURAL CHANGES
-- 将核心表从 Phase A (pre-004) 结构迁移到 Phase C1-A (post-004) 结构。
-- 所有受影响表当前为空表，无数据丢失风险。
-- ============================================================================

-- 1.1 credit_wallets — 精简到最小列集
drop trigger if exists credit_wallets_require_credit_mutation_context
  on public.credit_wallets;
drop function if exists public.v3a_require_credit_mutation_context();

drop index if exists public.credit_wallets_role_status_idx;
drop index if exists public.credit_wallets_balance_idx;

alter table public.credit_wallets
  drop constraint if exists credit_wallets_role_check,
  drop constraint if exists credit_wallets_status_check,
  drop constraint if exists credit_wallets_non_negative_check,
  drop constraint if exists credit_wallets_locked_balance_check,
  drop column if exists role,
  drop column if exists status,
  drop column if exists total_earned,
  drop column if exists total_spent,
  drop column if exists locked_balance,
  add constraint credit_wallets_balance_non_negative_check
    check (balance >= 0);

comment on table public.credit_wallets is
  'Phase C1-A wallet structure only. This migration does not create wallets or grant credits.';

-- 1.2 credit_logs — 重命名列、精简约束
drop trigger if exists credit_logs_require_register_bonus_approved_review
  on public.credit_logs;
drop function if exists public.v3a_require_register_bonus_approved_review();

drop index if exists public.credit_logs_idempotency_key_unique_idx;

alter table public.credit_logs
  drop constraint if exists credit_logs_role_check,
  drop constraint if exists credit_logs_status_check,
  drop constraint if exists credit_logs_type_check,
  drop constraint if exists credit_logs_register_bonus_check,
  drop constraint if exists credit_logs_emma_manual_check,
  drop constraint if exists credit_logs_emma_deduct_negative_check,
  drop constraint if exists credit_logs_emma_grant_positive_check,
  drop column if exists role,
  drop column if exists status,
  drop column if exists ref_type,
  drop column if exists ref_id,
  drop column if exists updated_at;

alter table public.credit_logs
  rename column operator_user_id to operator_id;

alter table public.credit_logs
  rename column reason to note;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'credit_logs'
      and constraint_name = 'credit_logs_operator_user_id_fkey'
  ) then
    alter table public.credit_logs
      rename constraint credit_logs_operator_user_id_fkey
        to credit_logs_operator_id_fkey;
  end if;
end;
$$;

alter index if exists public.credit_logs_operator_user_id_idx
  rename to credit_logs_operator_id_idx;

alter table public.credit_logs
  alter column note drop not null,
  add constraint credit_logs_type_check
    check (type in ('REGISTER_BONUS', 'MANUAL_GRANT', 'MANUAL_DEDUCT')),
  add constraint credit_logs_idempotency_key_key unique (idempotency_key);

comment on table public.credit_logs is
  'Phase C1-A append-only credit ledger structure. This migration inserts no credit logs.';
comment on column public.credit_logs.idempotency_key is
  'REGISTER_BONUS keys must use REGISTER_BONUS:{user_id}:{application_id}; uniqueness prevents duplicate issuance.';

-- 1.3 invite_codes — 精简到最小列集
drop trigger if exists invite_codes_set_updated_at on public.invite_codes;
drop index if exists public.invite_codes_expires_at_idx;

alter table public.invite_codes
  drop constraint if exists invite_codes_role_check,
  drop constraint if exists invite_codes_status_check,
  drop constraint if exists invite_codes_invite_type_check,
  drop constraint if exists invite_codes_usage_check,
  drop column if exists invite_type,
  drop column if exists max_uses,
  drop column if exists used_count,
  drop column if exists expires_at,
  drop column if exists updated_at,
  add constraint invite_codes_role_check
    check (role in ('advisor', 'agent', 'center')),
  add constraint invite_codes_status_check
    check (status in ('active', 'disabled'));

comment on table public.invite_codes is
  'Phase C1-A stores one simple invite code record; invitation usage tracking is out of scope.';

-- 1.4 admin_audit_logs — 重命名列、添加 details jsonb
drop trigger if exists admin_audit_logs_set_updated_at
  on public.admin_audit_logs;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_role_check,
  drop constraint if exists admin_audit_logs_status_check,
  drop constraint if exists admin_audit_logs_action_check,
  drop constraint if exists admin_audit_logs_target_type_check,
  drop constraint if exists admin_audit_logs_sensitive_reason_check,
  drop column if exists user_id,
  drop column if exists role,
  drop column if exists status,
  drop column if exists before_snapshot,
  drop column if exists after_snapshot,
  drop column if exists reason,
  drop column if exists ip_address,
  drop column if exists user_agent,
  drop column if exists updated_at;

alter table public.admin_audit_logs
  rename column operator_user_id to admin_id;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'admin_audit_logs'
      and constraint_name = 'admin_audit_logs_operator_user_id_fkey'
  ) then
    alter table public.admin_audit_logs
      rename constraint admin_audit_logs_operator_user_id_fkey
        to admin_audit_logs_admin_id_fkey;
  end if;
end;
$$;

alter index if exists public.admin_audit_logs_operator_created_at_idx
  rename to admin_audit_logs_admin_created_at_idx;

alter table public.admin_audit_logs
  add column if not exists details jsonb not null default '{}'::jsonb,
  add constraint admin_audit_logs_action_check
    check (action in (
      'APPROVE_APPLICATION',
      'REJECT_APPLICATION',
      'FREEZE_USER',
      'UNFREEZE_USER',
      'MANUAL_GRANT_CREDITS',
      'MANUAL_DEDUCT_CREDITS'
    ));

comment on table public.admin_audit_logs is
  'Phase C1-A append-only super_admin audit trail.';

-- ============================================================================
-- PHASE 2: 007 STRUCTURE + 008 SECURITY HARDENING
-- 恢复审核结构、RLS、约束、触发器、幂等审计和最终审核 RPC。
-- application_reviews 表不会被重建，现有 1 条记录保持不变。
-- ============================================================================

-- 2.1 007 审核结构前置对象。
alter table public.application_reviews
  add column if not exists rejection_reason text;

alter table public.users
  drop constraint if exists users_pending_role_status_check;

alter table public.users
  add constraint users_pending_role_status_check
  check (
    (role = 'pending' and status in ('pending', 'rejected'))
    or role <> 'pending'
  );

alter table public.application_reviews
  drop constraint if exists application_reviews_rejection_reason_check;

alter table public.application_reviews
  add constraint application_reviews_rejection_reason_check
  check (
    status <> 'rejected'
    or length(btrim(coalesce(rejection_reason, ''))) >= 10
  ) not valid;

-- 2.1 Helper 函数 search_path 加固
alter function public.v3a_current_user_id() set search_path = public, pg_temp;
alter function public.v3a_current_role() set search_path = public, pg_temp;
alter function public.v3a_current_status() set search_path = public, pg_temp;
alter function public.v3a_is_super_admin() set search_path = public, pg_temp;

-- 2.2 撤销非必要的 helper 执行权限，仅保留 authenticated 需要的三个
revoke all on function public.v3a_current_user_id()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_current_role()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_current_status()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_is_super_admin()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'v3a_bootstrap_first_super_admin'
  ) then
    revoke all on function public.v3a_bootstrap_first_super_admin(uuid, text)
      from public, anon, authenticated, service_role;
  end if;
end;
$$;

grant execute on function public.v3a_current_user_id()
  to authenticated;
grant execute on function public.v3a_current_status()
  to authenticated;
grant execute on function public.v3a_is_super_admin()
  to authenticated;

-- 2.3 显式表 ACL（覆盖 002 的宽松授权）
alter table public.credit_wallets enable row level security;
alter table public.credit_logs enable row level security;
alter table public.invite_codes enable row level security;

revoke all on table public.users from public, anon, authenticated;
revoke all on table public.advisor_profiles from public, anon, authenticated;
revoke all on table public.application_reviews from public, anon, authenticated;
revoke all on table public.credit_wallets from public, anon, authenticated;
revoke all on table public.credit_logs from public, anon, authenticated;
revoke all on table public.invite_codes from public, anon, authenticated;
revoke all on table public.invite_relations from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;
revoke all on table public.login_events from public, anon, authenticated;

revoke all on table public.users from service_role;
revoke all on table public.advisor_profiles from service_role;
revoke all on table public.application_reviews from service_role;
revoke all on table public.credit_wallets from service_role;
revoke all on table public.credit_logs from service_role;
revoke all on table public.invite_codes from service_role;
revoke all on table public.invite_relations from service_role;
revoke all on table public.admin_audit_logs from service_role;
revoke all on table public.login_events from service_role;

grant select, insert on table public.users to authenticated;
grant select, insert on table public.advisor_profiles to authenticated;
grant select, insert on table public.application_reviews to authenticated;
grant select on table public.credit_wallets to authenticated;
grant select on table public.credit_logs to authenticated;
grant select on table public.invite_codes to authenticated;
grant select on table public.invite_relations to authenticated;
grant select on table public.admin_audit_logs to authenticated;
grant select on table public.login_events to authenticated;
grant select on table public.users to service_role;
grant select on table public.advisor_profiles to service_role;
grant select on table public.application_reviews to service_role;
grant select on table public.invite_codes to service_role;

-- 2.4 RLS 策略
drop policy if exists v3a_credit_wallets_read_own on public.credit_wallets;
drop policy if exists v3a_credit_logs_read_own on public.credit_logs;
drop policy if exists v3a_invite_codes_read_active_own on public.invite_codes;
drop policy if exists v3a_credit_wallets_read_active_own_or_super_admin
  on public.credit_wallets;
drop policy if exists v3a_credit_logs_read_active_own_or_super_admin
  on public.credit_logs;
drop policy if exists v3a_invite_codes_read_active_own_or_super_admin
  on public.invite_codes;
drop policy if exists credit_wallets_select_active_own_or_super_admin
  on public.credit_wallets;
drop policy if exists credit_logs_select_active_own_or_super_admin
  on public.credit_logs;
drop policy if exists invite_codes_select_active_own_or_super_admin
  on public.invite_codes;

create policy credit_wallets_select_active_own_or_super_admin
  on public.credit_wallets
  for select
  to authenticated
  using (
    public.v3a_is_super_admin()
    or (
      public.v3a_current_status() = 'active'
      and user_id = public.v3a_current_user_id()
    )
  );

create policy credit_logs_select_active_own_or_super_admin
  on public.credit_logs
  for select
  to authenticated
  using (
    public.v3a_is_super_admin()
    or (
      public.v3a_current_status() = 'active'
      and user_id = public.v3a_current_user_id()
    )
  );

create policy invite_codes_select_active_own_or_super_admin
  on public.invite_codes
  for select
  to authenticated
  using (
    public.v3a_is_super_admin()
    or (
      public.v3a_current_status() = 'active'
      and user_id = public.v3a_current_user_id()
    )
  );

-- 2.5 invite_codes 每人唯一（覆盖旧 invite_codes_one_active_per_user_idx）
drop index if exists public.invite_codes_one_active_per_user_idx;
alter table public.invite_codes
  drop constraint if exists invite_codes_user_id_key;
alter table public.invite_codes
  add constraint invite_codes_user_id_key unique (user_id);

-- 2.6 审核审计幂等键（idempotency_key generated column）
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_audit_logs'
      and column_name = 'idempotency_key'
  ) then
    alter table public.admin_audit_logs
      drop constraint if exists admin_audit_logs_review_idempotency_key_check;
    drop index if exists public.admin_audit_logs_idempotency_key_uidx;
    alter table public.admin_audit_logs
      drop column idempotency_key;
  end if;
end;
$$;

alter table public.admin_audit_logs
  add column idempotency_key text
  generated always as (
    case
      when action in ('APPROVE_APPLICATION', 'REJECT_APPLICATION')
        and nullif(details ->> 'application_id', '') is not null
      then action || ':' || ((details ->> 'application_id')::uuid::text)
      else null
    end
  ) stored;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_review_idempotency_key_check
  check (
    action not in ('APPROVE_APPLICATION', 'REJECT_APPLICATION')
    or (
      idempotency_key is not null
      and idempotency_key =
        action || ':' || ((details ->> 'application_id')::uuid::text)
    )
  );

create unique index admin_audit_logs_idempotency_key_uidx
  on public.admin_audit_logs (idempotency_key)
  where idempotency_key is not null;

-- 2.7 注册奖励形态约束
alter table public.credit_logs
  drop constraint if exists credit_logs_register_bonus_shape_check;

alter table public.credit_logs
  add constraint credit_logs_register_bonus_shape_check
  check (
    type <> 'REGISTER_BONUS'
    or (
      amount = 500
      and balance_before = 0
      and balance_after = 500
      and idempotency_key is not null
      and idempotency_key ~
        '^REGISTER_BONUS:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(idempotency_key, ':', 2) = user_id::text
    )
  );

-- 2.8 验证现有 REGISTER_BONUS 记录（credit_logs 当前为空，此检查应通过）
do $$
begin
  if exists (
    select 1
    from public.credit_logs credit
    where credit.type = 'REGISTER_BONUS'
      and not exists (
        select 1
        from public.application_reviews review
        where review.id =
          split_part(credit.idempotency_key, ':', 3)::uuid
          and review.user_id = credit.user_id
          and review.status = 'approved'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'EXISTING_REGISTER_BONUS_WITHOUT_APPROVED_APPLICATION';
  end if;
end;
$$;

-- 2.9 积分触发器函数（008 版本，不含 AUTO_ADVISOR_ACTIVATION 支持）
create or replace function public.v3a_credit_logs_require_approved_application()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_application_id uuid;
begin
  if new.type <> 'REGISTER_BONUS'
    or new.idempotency_key is null
    or new.idempotency_key !~
      '^REGISTER_BONUS:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;

  v_application_id := split_part(new.idempotency_key, ':', 3)::uuid;

  if not exists (
    select 1
    from public.application_reviews review
    where review.id = v_application_id
      and review.user_id = new.user_id
      and review.status = 'approved'
  ) then
    raise exception using
      errcode = '23514',
      message = 'REGISTER_BONUS_REQUIRES_APPROVED_APPLICATION';
  end if;

  return new;
end;
$$;

revoke all on function public.v3a_credit_logs_require_approved_application()
  from public, anon, authenticated, service_role;

drop trigger if exists credit_logs_require_approved_application
  on public.credit_logs;
create trigger credit_logs_require_approved_application
before insert on public.credit_logs
for each row
execute function public.v3a_credit_logs_require_approved_application();

comment on function public.v3a_credit_logs_require_approved_application() is
  'Requires REGISTER_BONUS application idempotency keys to reference an approved application for the same user.';

-- 2.10 验证 rejection_reason 约束
alter table public.application_reviews
  validate constraint application_reviews_rejection_reason_check;

-- 2.11 更新审核 RPC 为 008 增强版（含 ON CONFLICT 幂等写和完整验证）
create or replace function public.v3a_approve_application(
  p_application_id uuid,
  p_reviewer_user_id uuid,
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_application_user_id uuid;
  v_application_role text;
  v_application_status text;
  v_application_reviewer_user_id uuid;
  v_user_role text;
  v_user_status text;
  v_profile_role text;
  v_profile_status text;
  v_wallet_id uuid;
  v_wallet_balance integer;
  v_credit_log_id uuid;
  v_credit_log_wallet_id uuid;
  v_credit_log_user_id uuid;
  v_credit_log_type text;
  v_credit_log_amount integer;
  v_credit_log_balance_before integer;
  v_credit_log_balance_after integer;
  v_existing_invite_code text;
  v_existing_invite_role text;
  v_existing_invite_status text;
  v_audit_log_id uuid;
  v_audit_admin_id uuid;
  v_audit_target_id uuid;
  v_audit_action text;
  v_audit_details jsonb;
  v_idempotency_key text;
  v_audit_idempotency_key text := format(
    'APPROVE_APPLICATION:%s',
    p_application_id
  );
  v_expected_prefix text;
  v_reviewed_at timestamptz := now();
  v_affected_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.users reviewer
    where reviewer.id = p_reviewer_user_id
      and reviewer.role = 'super_admin'
      and reviewer.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select
    review.user_id,
    review.role,
    review.status,
    review.reviewer_user_id
  into
    v_application_user_id,
    v_application_role,
    v_application_status,
    v_application_reviewer_user_id
  from public.application_reviews review
  where review.id = p_application_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'APPLICATION_NOT_FOUND';
  end if;

  select app_user.role, app_user.status
  into v_user_role, v_user_status
  from public.users app_user
  where app_user.id = v_application_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPLICATION_USER_NOT_FOUND';
  end if;

  select profile.role, profile.status
  into v_profile_role, v_profile_status
  from public.advisor_profiles profile
  where profile.user_id = v_application_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPLICATION_PROFILE_NOT_FOUND';
  end if;

  v_idempotency_key := format(
    'REGISTER_BONUS:%s:%s',
    v_application_user_id,
    p_application_id
  );

  v_expected_prefix := case v_application_role
    when 'advisor' then 'ADV'
    when 'agent' then 'AGT'
    when 'center' then 'CTR'
    else null
  end;

  if v_application_status = 'approved' then
    if v_user_status is distinct from 'active'
      or v_user_role is distinct from v_application_role
      or v_profile_status is distinct from 'active' then
      raise exception using errcode = 'P0001', message = 'INCOMPLETE_APPROVAL_STATE';
    end if;

    select wallet.id, wallet.balance
    into v_wallet_id, v_wallet_balance
    from public.credit_wallets wallet
    where wallet.user_id = v_application_user_id;

    select
      credit.id,
      credit.wallet_id,
      credit.user_id,
      credit.type,
      credit.amount,
      credit.balance_before,
      credit.balance_after
    into
      v_credit_log_id,
      v_credit_log_wallet_id,
      v_credit_log_user_id,
      v_credit_log_type,
      v_credit_log_amount,
      v_credit_log_balance_before,
      v_credit_log_balance_after
    from public.credit_logs credit
    where credit.idempotency_key = v_idempotency_key;

    select invite.code, invite.role, invite.status
    into
      v_existing_invite_code,
      v_existing_invite_role,
      v_existing_invite_status
    from public.invite_codes invite
    where invite.user_id = v_application_user_id
      and invite.status = 'active';

    select
      audit.id,
      audit.admin_id,
      audit.target_id,
      audit.action,
      audit.details
    into
      v_audit_log_id,
      v_audit_admin_id,
      v_audit_target_id,
      v_audit_action,
      v_audit_details
    from public.admin_audit_logs audit
    where audit.idempotency_key = v_audit_idempotency_key
      and audit.action = 'APPROVE_APPLICATION'
      and audit.target_id = v_application_user_id
      and audit.details ->> 'application_id' = p_application_id::text
    limit 1;

    if v_wallet_id is null
      or v_wallet_balance is distinct from 500
      or v_credit_log_id is null
      or v_credit_log_wallet_id is distinct from v_wallet_id
      or v_credit_log_user_id is distinct from v_application_user_id
      or v_credit_log_type is distinct from 'REGISTER_BONUS'
      or v_credit_log_amount is distinct from 500
      or v_credit_log_balance_before is distinct from 0
      or v_credit_log_balance_after is distinct from 500
      or v_expected_prefix is null
      or v_existing_invite_code is null
      or v_existing_invite_role is distinct from v_application_role
      or v_existing_invite_status is distinct from 'active'
      or v_existing_invite_code !~
        '^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'
      or split_part(v_existing_invite_code, '-', 1) <> v_expected_prefix
      or v_audit_log_id is null
      or v_audit_admin_id is distinct from v_application_reviewer_user_id
      or v_audit_target_id is distinct from v_application_user_id
      or v_audit_action is distinct from 'APPROVE_APPLICATION'
      or v_audit_details ->> 'approved_role' is distinct from v_application_role
      or v_audit_details ->> 'wallet_id' is distinct from v_wallet_id::text
      or v_audit_details ->> 'credit_log_id' is distinct from v_credit_log_id::text
      or v_audit_details ->> 'invite_code' is distinct from v_existing_invite_code then
      raise exception using errcode = 'P0001', message = 'INCOMPLETE_APPROVAL_STATE';
    end if;

    return jsonb_build_object(
      'success', true,
      'already_processed', true,
      'data', jsonb_build_object(
        'application_id', p_application_id,
        'user_id', v_application_user_id,
        'user_status', 'active',
        'wallet', jsonb_build_object('id', v_wallet_id, 'balance', v_wallet_balance),
        'credit_log', jsonb_build_object(
          'id', v_credit_log_id,
          'type', v_credit_log_type,
          'amount', v_credit_log_amount
        ),
        'invite_code', v_existing_invite_code,
        'audit_log_id', v_audit_log_id
      )
    );
  end if;

  if v_application_status = 'rejected' or v_user_status = 'rejected' then
    raise exception using errcode = 'P0001', message = 'APPLICATION_ALREADY_REJECTED';
  end if;

  if v_application_status is distinct from 'pending' then
    raise exception using errcode = 'P0001', message = 'APPLICATION_NOT_PENDING';
  end if;

  if v_user_status is distinct from 'pending'
    or v_user_role is distinct from 'pending'
    or v_profile_status is distinct from 'pending'
    or v_profile_role is distinct from v_application_role then
    raise exception using errcode = 'P0001', message = 'APPLICATION_RELATED_DATA_NOT_PENDING';
  end if;

  if v_expected_prefix is null
    or p_invite_code is null
    or p_invite_code !~ '^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'
    or split_part(p_invite_code, '-', 1) <> v_expected_prefix then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITE_CODE';
  end if;

  update public.users
  set role = v_application_role,
      status = 'active',
      approved_at = v_reviewed_at,
      approved_by_user_id = p_reviewer_user_id
  where id = v_application_user_id
    and role = 'pending'
    and status = 'pending';

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'APPLICATION_NOT_PENDING';
  end if;

  update public.advisor_profiles
  set status = 'active'
  where user_id = v_application_user_id
    and role = v_application_role
    and status = 'pending';

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'APPLICATION_PROFILE_NOT_PENDING';
  end if;

  update public.application_reviews
  set status = 'approved',
      reviewer_user_id = p_reviewer_user_id,
      reviewed_at = v_reviewed_at,
      review_note = '审核通过',
      rejection_reason = null
  where id = p_application_id
    and status = 'pending';

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'APPLICATION_NOT_PENDING';
  end if;

  insert into public.credit_wallets (user_id, balance)
  values (v_application_user_id, 500)
  on conflict (user_id) do nothing
  returning id, balance into v_wallet_id, v_wallet_balance;

  if v_wallet_id is null then
    select wallet.id, wallet.balance
    into v_wallet_id, v_wallet_balance
    from public.credit_wallets wallet
    where wallet.user_id = v_application_user_id;
  end if;

  if v_wallet_balance is distinct from 500 then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_APPROVAL_STATE';
  end if;

  insert into public.credit_logs (
    wallet_id,
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    idempotency_key,
    operator_id,
    note
  ) values (
    v_wallet_id,
    v_application_user_id,
    'REGISTER_BONUS',
    500,
    0,
    500,
    v_idempotency_key,
    p_reviewer_user_id,
    '注册奖励 500 积分'
  )
  on conflict (idempotency_key) do nothing
  returning
    id,
    wallet_id,
    user_id,
    type,
    amount,
    balance_before,
    balance_after
  into
    v_credit_log_id,
    v_credit_log_wallet_id,
    v_credit_log_user_id,
    v_credit_log_type,
    v_credit_log_amount,
    v_credit_log_balance_before,
    v_credit_log_balance_after;

  if v_credit_log_id is null then
    select
      credit.id,
      credit.wallet_id,
      credit.user_id,
      credit.type,
      credit.amount,
      credit.balance_before,
      credit.balance_after
    into
      v_credit_log_id,
      v_credit_log_wallet_id,
      v_credit_log_user_id,
      v_credit_log_type,
      v_credit_log_amount,
      v_credit_log_balance_before,
      v_credit_log_balance_after
    from public.credit_logs credit
    where credit.idempotency_key = v_idempotency_key;
  end if;

  if v_credit_log_wallet_id is distinct from v_wallet_id
    or v_credit_log_user_id is distinct from v_application_user_id
    or v_credit_log_type is distinct from 'REGISTER_BONUS'
    or v_credit_log_amount is distinct from 500
    or v_credit_log_balance_before is distinct from 0
    or v_credit_log_balance_after is distinct from 500 then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_APPROVAL_STATE';
  end if;

  begin
    insert into public.invite_codes (code, user_id, role, status)
    values (p_invite_code, v_application_user_id, v_application_role, 'active')
    on conflict do nothing
    returning code, role, status
    into
      v_existing_invite_code,
      v_existing_invite_role,
      v_existing_invite_status;
  end;

  if v_existing_invite_code is null then
    select invite.code, invite.role, invite.status
    into
      v_existing_invite_code,
      v_existing_invite_role,
      v_existing_invite_status
    from public.invite_codes invite
    where invite.user_id = v_application_user_id;
  end if;

  if v_existing_invite_code is null then
    raise exception using errcode = 'P0001', message = 'INVITE_CODE_CONFLICT';
  end if;

  if v_existing_invite_role is distinct from v_application_role
    or v_existing_invite_status is distinct from 'active'
    or v_existing_invite_code !~
      '^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'
    or split_part(v_existing_invite_code, '-', 1) <> v_expected_prefix then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_APPROVAL_STATE';
  end if;

  insert into public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    p_reviewer_user_id,
    'APPROVE_APPLICATION',
    'user',
    v_application_user_id,
    jsonb_build_object(
      'application_id', p_application_id,
      'approved_role', v_application_role,
      'wallet_id', v_wallet_id,
      'credit_log_id', v_credit_log_id,
      'invite_code', v_existing_invite_code
    )
  )
  on conflict (idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id, admin_id, target_id, action, details
  into
    v_audit_log_id,
    v_audit_admin_id,
    v_audit_target_id,
    v_audit_action,
    v_audit_details;

  if v_audit_log_id is null then
    select
      audit.id,
      audit.admin_id,
      audit.target_id,
      audit.action,
      audit.details
    into
      v_audit_log_id,
      v_audit_admin_id,
      v_audit_target_id,
      v_audit_action,
      v_audit_details
    from public.admin_audit_logs audit
    where audit.idempotency_key = v_audit_idempotency_key;
  end if;

  if v_audit_admin_id is distinct from p_reviewer_user_id
    or v_audit_target_id is distinct from v_application_user_id
    or v_audit_action is distinct from 'APPROVE_APPLICATION'
    or v_audit_details ->> 'approved_role' is distinct from v_application_role
    or v_audit_details ->> 'wallet_id' is distinct from v_wallet_id::text
    or v_audit_details ->> 'credit_log_id' is distinct from v_credit_log_id::text
    or v_audit_details ->> 'invite_code' is distinct from v_existing_invite_code then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_APPROVAL_STATE';
  end if;

  return jsonb_build_object(
    'success', true,
    'already_processed', false,
    'data', jsonb_build_object(
      'application_id', p_application_id,
      'user_id', v_application_user_id,
      'user_status', 'active',
      'wallet', jsonb_build_object('id', v_wallet_id, 'balance', v_wallet_balance),
      'credit_log', jsonb_build_object(
        'id', v_credit_log_id,
        'type', v_credit_log_type,
        'amount', v_credit_log_amount
      ),
      'invite_code', v_existing_invite_code,
      'audit_log_id', v_audit_log_id
    )
  );
end;
$$;

create or replace function public.v3a_reject_application(
  p_application_id uuid,
  p_reviewer_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_application_user_id uuid;
  v_application_role text;
  v_application_status text;
  v_application_reviewer_user_id uuid;
  v_application_rejection_reason text;
  v_user_role text;
  v_user_status text;
  v_profile_role text;
  v_profile_status text;
  v_audit_log_id uuid;
  v_audit_admin_id uuid;
  v_audit_target_id uuid;
  v_audit_action text;
  v_audit_details jsonb;
  v_audit_idempotency_key text := format(
    'REJECT_APPLICATION:%s',
    p_application_id
  );
  v_reason text := btrim(coalesce(p_reason, ''));
  v_reviewed_at timestamptz := now();
  v_affected_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.users reviewer
    where reviewer.id = p_reviewer_user_id
      and reviewer.role = 'super_admin'
      and reviewer.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if length(v_reason) < 10 then
    raise exception using errcode = 'P0001', message = 'REJECTION_REASON_TOO_SHORT';
  end if;

  select
    review.user_id,
    review.role,
    review.status,
    review.reviewer_user_id,
    review.rejection_reason
  into
    v_application_user_id,
    v_application_role,
    v_application_status,
    v_application_reviewer_user_id,
    v_application_rejection_reason
  from public.application_reviews review
  where review.id = p_application_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'APPLICATION_NOT_FOUND';
  end if;

  select app_user.role, app_user.status
  into v_user_role, v_user_status
  from public.users app_user
  where app_user.id = v_application_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPLICATION_USER_NOT_FOUND';
  end if;

  select profile.role, profile.status
  into v_profile_role, v_profile_status
  from public.advisor_profiles profile
  where profile.user_id = v_application_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPLICATION_PROFILE_NOT_FOUND';
  end if;

  if v_application_status = 'rejected' then
    if v_user_status is distinct from 'rejected'
      or v_profile_status is distinct from 'rejected' then
      raise exception using errcode = 'P0001', message = 'INCOMPLETE_REJECTION_STATE';
    end if;

    select
      audit.id,
      audit.admin_id,
      audit.target_id,
      audit.action,
      audit.details
    into
      v_audit_log_id,
      v_audit_admin_id,
      v_audit_target_id,
      v_audit_action,
      v_audit_details
    from public.admin_audit_logs audit
    where audit.idempotency_key = v_audit_idempotency_key
      and audit.action = 'REJECT_APPLICATION'
      and audit.target_id = v_application_user_id
      and audit.details ->> 'application_id' = p_application_id::text
    limit 1;

    if v_audit_log_id is null
      or v_audit_admin_id is distinct from v_application_reviewer_user_id
      or v_audit_target_id is distinct from v_application_user_id
      or v_audit_action is distinct from 'REJECT_APPLICATION'
      or v_audit_details ->> 'rejection_reason'
        is distinct from v_application_rejection_reason then
      raise exception using errcode = 'P0001', message = 'INCOMPLETE_REJECTION_STATE';
    end if;

    return jsonb_build_object(
      'success', true,
      'already_processed', true,
      'data', jsonb_build_object(
        'application_id', p_application_id,
        'user_id', v_application_user_id,
        'user_status', 'rejected',
        'review_id', p_application_id,
        'audit_log_id', v_audit_log_id
      )
    );
  end if;

  if v_application_status is distinct from 'pending'
    or v_user_status is distinct from 'pending'
    or v_user_role is distinct from 'pending'
    or v_profile_status is distinct from 'pending'
    or v_profile_role is distinct from v_application_role then
    raise exception using errcode = 'P0001', message = 'APPLICATION_NOT_PENDING';
  end if;

  update public.users
  set status = 'rejected'
  where id = v_application_user_id
    and role = 'pending'
    and status = 'pending';

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'APPLICATION_NOT_PENDING';
  end if;

  update public.advisor_profiles
  set status = 'rejected'
  where user_id = v_application_user_id
    and role = v_application_role
    and status = 'pending';

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'APPLICATION_PROFILE_NOT_PENDING';
  end if;

  update public.application_reviews
  set status = 'rejected',
      reviewer_user_id = p_reviewer_user_id,
      reviewed_at = v_reviewed_at,
      review_note = v_reason,
      rejection_reason = v_reason
  where id = p_application_id
    and status = 'pending';

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'APPLICATION_NOT_PENDING';
  end if;

  insert into public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    p_reviewer_user_id,
    'REJECT_APPLICATION',
    'user',
    v_application_user_id,
    jsonb_build_object(
      'application_id', p_application_id,
      'rejection_reason', v_reason
    )
  )
  on conflict (idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id, admin_id, target_id, action, details
  into
    v_audit_log_id,
    v_audit_admin_id,
    v_audit_target_id,
    v_audit_action,
    v_audit_details;

  if v_audit_log_id is null then
    select
      audit.id,
      audit.admin_id,
      audit.target_id,
      audit.action,
      audit.details
    into
      v_audit_log_id,
      v_audit_admin_id,
      v_audit_target_id,
      v_audit_action,
      v_audit_details
    from public.admin_audit_logs audit
    where audit.idempotency_key = v_audit_idempotency_key;
  end if;

  if v_audit_admin_id is distinct from p_reviewer_user_id
    or v_audit_target_id is distinct from v_application_user_id
    or v_audit_action is distinct from 'REJECT_APPLICATION'
    or v_audit_details ->> 'rejection_reason' is distinct from v_reason then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_REJECTION_STATE';
  end if;

  return jsonb_build_object(
    'success', true,
    'already_processed', false,
    'data', jsonb_build_object(
      'application_id', p_application_id,
      'user_id', v_application_user_id,
      'user_status', 'rejected',
      'review_id', p_application_id,
      'audit_log_id', v_audit_log_id
    )
  );
end;
$$;

-- 2.12 审核 RPC 权限
revoke all on function public.v3a_approve_application(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.v3a_reject_application(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.v3a_approve_application(uuid, uuid, text)
  to service_role;
grant execute on function public.v3a_reject_application(uuid, uuid, text)
  to service_role;

comment on function public.v3a_approve_application(uuid, uuid, text) is
  'Phase C1-C atomic approval: activates the account, grants one 500-point REGISTER_BONUS, creates one active invite code, and writes the audit row.';
comment on function public.v3a_reject_application(uuid, uuid, text) is
  'Phase C1-C atomic rejection: rejects the pending account and application and writes the audit row without creating wallet, credits, or invite codes.';

-- ============================================================================
-- PHASE 3: FINAL PHONE REGISTRATION RPC
-- 恢复 010/014 的结构约束和 016 的最终 9/8 参数注册 RPC。
-- ============================================================================

alter table public.users
  drop constraint if exists users_phone_china_e164_check;
alter table public.users
  add constraint users_phone_china_e164_check
  check (
    phone is null
    or (
      phone = btrim(phone)
      and phone ~ '^[+]861[3-9][0-9]{9}$'
    )
  );

alter table public.advisor_profiles
  drop constraint if exists advisor_profiles_practitioner_type_check,
  add constraint advisor_profiles_practitioner_type_check
    check (practitioner_type in (
      'independent',
      'organization',
      'education_family',
      'psychological_consulting',
      'child_growth_quality',
      'assessment_collection',
      'other'
    ));

alter table public.application_reviews
  drop constraint if exists application_reviews_practitioner_type_check,
  add constraint application_reviews_practitioner_type_check
    check (practitioner_type in (
      'independent',
      'organization',
      'education_family',
      'psychological_consulting',
      'child_growth_quality',
      'assessment_collection',
      'other'
    ));

create or replace function public.v3a_submit_pending_application(
  p_display_name text,
  p_city text,
  p_requested_role text,
  p_practitioner_type text,
  p_agreement_version text,
  p_accepted_rules boolean,
  p_invite_code text default null,
  p_application_identity text default null,
  p_practitioner_type_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_auth_user_id uuid;
  v_jwt jsonb;
  v_auth jsonb;
  v_auth_phone_raw text;
  v_jwt_phone_raw text;
  v_auth_phone text;
  v_jwt_phone text;
  v_phone text;
  v_auth_email text;
  v_email text;
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_requested_role text := btrim(coalesce(p_requested_role, ''));
  v_practitioner_type text := btrim(coalesce(p_practitioner_type, ''));
  v_practitioner_type_note text :=
    nullif(btrim(coalesce(p_practitioner_type_note, '')), '');
  v_application_identity text :=
    nullif(btrim(coalesce(p_application_identity, '')), '');
  v_agreement_version text := btrim(coalesce(p_agreement_version, ''));
  v_expected_agreement_version constant text :=
    'v3a-phase-b-preview-2026-07-09';
  v_invite_code text := upper(nullif(btrim(coalesce(p_invite_code, '')), ''));
  v_application_note text;
  v_user public.users%rowtype;
  v_profile public.advisor_profiles%rowtype;
  v_review public.application_reviews%rowtype;
  v_profile_count integer;
  v_review_count integer;
  v_user_id uuid;
  v_profile_id uuid;
  v_application_id uuid;
begin
  v_auth_user_id := auth.uid();
  v_jwt := coalesce(auth.jwt(), '{}'::jsonb);

  if coalesce(auth.role(), '') <> 'authenticated'
    or v_auth_user_id is null
    or nullif(v_jwt ->> 'sub', '') is distinct from v_auth_user_id::text
    or nullif(v_jwt ->> 'role', '') is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  if char_length(v_display_name) < 2
    or char_length(v_display_name) > 80
    or v_display_name ~ '[[:cntrl:]<>]' then
    raise exception using errcode = '22023', message = 'INVALID_DISPLAY_NAME';
  end if;

  if char_length(v_city) < 1
    or char_length(v_city) > 80
    or v_city ~ '[[:cntrl:]<>]' then
    raise exception using errcode = '22023', message = 'INVALID_CITY';
  end if;

  if v_requested_role not in ('advisor', 'agent', 'center') then
    raise exception using errcode = '22023', message = 'INVALID_REQUESTED_ROLE';
  end if;

  if v_application_identity not in (
    'branch_company',
    'service_center',
    'collection_center',
    'ordinary_advisor'
  ) and v_application_identity is not null then
    raise exception using errcode = '22023', message = 'INVALID_APPLICATION_IDENTITY';
  end if;

  if (v_application_identity is null and v_requested_role <> 'advisor')
    or (v_application_identity = 'ordinary_advisor' and v_requested_role <> 'advisor')
    or (v_application_identity = 'branch_company' and v_requested_role <> 'agent')
    or (v_application_identity in ('service_center', 'collection_center')
      and v_requested_role <> 'center') then
    raise exception using errcode = '22023', message = 'INVALID_REQUESTED_ROLE';
  end if;

  if v_practitioner_type not in (
    'independent',
    'organization',
    'education_family',
    'psychological_consulting',
    'child_growth_quality',
    'assessment_collection',
    'other'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE';
  end if;

  if v_practitioner_type = 'other' then
    if v_practitioner_type_note is null
      or char_length(v_practitioner_type_note) < 2
      or char_length(v_practitioner_type_note) > 80
      or v_practitioner_type_note ~ '[[:cntrl:]<>]' then
      raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE_NOTE';
    end if;
  elsif v_practitioner_type_note is not null then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE_NOTE';
  end if;

  if p_accepted_rules is not true
    or v_agreement_version is distinct from v_expected_agreement_version then
    raise exception using errcode = '22023', message = 'INVALID_AGREEMENT';
  end if;

  if v_invite_code is not null
    and v_invite_code !~
      '^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception using errcode = '22023', message = 'INVALID_INVITE_CODE';
  end if;

  v_application_note := concat_ws(
    '; ',
    case v_application_identity
      when 'branch_company' then '申请身份：分公司'
      when 'service_center' then '申请身份：服务中心'
      when 'collection_center' then '申请身份：采集中心'
      when 'ordinary_advisor' then '申请身份：普通指导师'
      else null
    end,
    case when v_practitioner_type = 'other'
      then '从业类型补充：' || v_practitioner_type_note
      else null
    end,
    'V3a Phase C1-D authenticated registration RPC'
  );

  perform pg_advisory_xact_lock(
    hashtext('v3a_submit_pending_application'),
    hashtext(v_auth_user_id::text)
  );

  select to_jsonb(auth_user)
  into v_auth
  from auth.users auth_user
  where auth_user.id = v_auth_user_id
  for update;

  if v_auth is null then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  if coalesce((v_auth ->> 'is_anonymous')::boolean, false)
    or nullif(v_auth ->> 'deleted_at', '') is not null
    or (
      nullif(v_auth ->> 'banned_until', '') is not null
      and (v_auth ->> 'banned_until')::timestamptz > now()
    ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_UNAVAILABLE';
  end if;

  v_auth_phone_raw := nullif(btrim(coalesce(v_auth ->> 'phone', '')), '');
  v_jwt_phone_raw := nullif(btrim(coalesce(v_jwt ->> 'phone', '')), '');

  if v_auth_phone_raw ~ '^[+]861[3-9][0-9]{9}$' then
    v_auth_phone := v_auth_phone_raw;
  elsif v_auth_phone_raw ~ '^861[3-9][0-9]{9}$' then
    v_auth_phone := '+' || v_auth_phone_raw;
  else
    v_auth_phone := null;
  end if;

  if v_jwt_phone_raw ~ '^[+]861[3-9][0-9]{9}$' then
    v_jwt_phone := v_jwt_phone_raw;
  elsif v_jwt_phone_raw ~ '^861[3-9][0-9]{9}$' then
    v_jwt_phone := '+' || v_jwt_phone_raw;
  else
    v_jwt_phone := null;
  end if;

  if nullif(v_auth ->> 'phone_confirmed_at', '') is not null then
    if v_auth_phone_raw is null then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
    end if;
    if v_auth_phone is null then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_SUPPORTED';
    end if;
    if v_jwt_phone_raw is not null
      and v_jwt_phone is distinct from v_auth_phone then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_CLAIM_MISMATCH';
    end if;
    v_phone := v_auth_phone;
  else
    if v_jwt_phone_raw is not null then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
    end if;
    v_phone := null;
  end if;

  v_auth_email := nullif(btrim(coalesce(v_auth ->> 'email', '')), '');
  if nullif(v_auth ->> 'email_confirmed_at', '') is not null
    and v_auth_email is not null then
    v_email := v_auth_email;
  else
    v_email := null;
  end if;

  if v_phone is null and v_email is null then
    raise exception using errcode = '22023', message = 'AUTH_IDENTITY_NOT_VERIFIED';
  end if;

  select users_row.*
  into v_user
  from public.users users_row
  where users_row.auth_user_id = v_auth_user_id
  for update;

  if found then
    if v_user.phone is distinct from v_phone
      or (
        v_user.email is not null
        and v_email is not null
        and lower(v_user.email) <> lower(v_email)
      )
      or ((v_user.email is null) <> (v_email is null)) then
      raise exception using errcode = '55000', message = 'IDENTITY_MAPPING_CONFLICT';
    end if;

    select count(*) into v_profile_count
    from public.advisor_profiles profile
    where profile.user_id = v_user.id;

    select count(*) into v_review_count
    from public.application_reviews review
    where review.user_id = v_user.id;

    if v_profile_count <> 1 or v_review_count <> 1 then
      raise exception using errcode = '55000', message = 'PARTIAL_REGISTRATION_STATE';
    end if;

    select profile.* into strict v_profile
    from public.advisor_profiles profile
    where profile.user_id = v_user.id;

    select review.* into strict v_review
    from public.application_reviews review
    where review.user_id = v_user.id;

    if v_user.status = 'pending' then
      if v_user.role <> 'pending'
        or v_profile.status <> 'pending'
        or v_review.status <> 'pending' then
        raise exception using errcode = '55000', message = 'PARTIAL_REGISTRATION_STATE';
      end if;

      if v_user.display_name is distinct from v_display_name
        or v_user.city is distinct from v_city
        or v_profile.role is distinct from v_requested_role
        or v_profile.nickname is distinct from v_display_name
        or v_profile.city is distinct from v_city
        or v_profile.practitioner_type is distinct from v_practitioner_type
        or v_profile.agreement_version is distinct from v_agreement_version
        or v_review.role is distinct from v_requested_role
        or v_review.applied_nickname is distinct from v_display_name
        or v_review.applied_city is distinct from v_city
        or v_review.practitioner_type is distinct from v_practitioner_type
        or v_review.invite_code is distinct from v_invite_code
        or v_review.application_note is distinct from v_application_note then
        raise exception using errcode = '55000', message = 'REGISTRATION_CONFLICT';
      end if;
    elsif v_user.status = 'active' then
      if v_user.role not in ('advisor', 'agent', 'center')
        or v_profile.role is distinct from v_user.role
        or v_profile.status is distinct from 'active'
        or v_review.role is distinct from v_user.role
        or v_review.status is distinct from 'approved' then
        raise exception using errcode = '55000', message = 'PARTIAL_REGISTRATION_STATE';
      end if;
    elsif v_user.status = 'rejected' then
      if v_user.role is distinct from 'pending'
        or v_profile.role not in ('advisor', 'agent', 'center')
        or v_profile.status is distinct from 'rejected'
        or v_review.role is distinct from v_profile.role
        or v_review.status is distinct from 'rejected' then
        raise exception using errcode = '55000', message = 'PARTIAL_REGISTRATION_STATE';
      end if;
    elsif v_user.status in ('frozen', 'disabled') then
      if v_user.role not in ('advisor', 'agent', 'center')
        or v_profile.role is distinct from v_user.role
        or v_profile.status is distinct from 'active'
        or v_review.role is distinct from v_user.role
        or v_review.status is distinct from 'approved' then
        raise exception using errcode = '55000', message = 'PARTIAL_REGISTRATION_STATE';
      end if;
    else
      raise exception using errcode = '55000', message = 'PARTIAL_REGISTRATION_STATE';
    end if;

    return jsonb_build_object(
      'success', true,
      'already_exists', true,
      'data', jsonb_build_object(
        'user_id', v_user.id,
        'profile_id', v_profile.id,
        'application_id', v_review.id,
        'user_status', v_user.status,
        'profile_status', v_profile.status,
        'application_status', v_review.status,
        'requested_role', v_profile.role,
        'application_identity', v_application_identity,
        'practitioner_type_note', v_practitioner_type_note
      )
    );
  end if;

  insert into public.users (
    auth_user_id,
    role,
    status,
    phone,
    email,
    display_name,
    city,
    source
  ) values (
    v_auth_user_id,
    'pending',
    'pending',
    v_phone,
    v_email,
    v_display_name,
    v_city,
    'direct'
  )
  returning id into v_user_id;

  insert into public.advisor_profiles (
    user_id,
    role,
    status,
    nickname,
    city,
    practitioner_type,
    agreement_version,
    agreed_rules_at
  ) values (
    v_user_id,
    v_requested_role,
    'pending',
    v_display_name,
    v_city,
    v_practitioner_type,
    v_agreement_version,
    now()
  )
  returning id into v_profile_id;

  insert into public.application_reviews (
    user_id,
    role,
    status,
    applied_city,
    applied_nickname,
    practitioner_type,
    invite_code,
    application_note
  ) values (
    v_user_id,
    v_requested_role,
    'pending',
    v_city,
    v_display_name,
    v_practitioner_type,
    v_invite_code,
    v_application_note
  )
  returning id into v_application_id;

  return jsonb_build_object(
    'success', true,
    'already_exists', false,
    'data', jsonb_build_object(
      'user_id', v_user_id,
      'profile_id', v_profile_id,
      'application_id', v_application_id,
      'user_status', 'pending',
      'profile_status', 'pending',
      'application_status', 'pending',
      'requested_role', v_requested_role,
      'application_identity', v_application_identity,
      'practitioner_type_note', v_practitioner_type_note
    )
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'REGISTRATION_IDENTITY_CONFLICT';
  when others then
    if sqlerrm in (
      'UNAUTHENTICATED',
      'INVALID_DISPLAY_NAME',
      'INVALID_CITY',
      'INVALID_REQUESTED_ROLE',
      'INVALID_APPLICATION_IDENTITY',
      'INVALID_PRACTITIONER_TYPE',
      'INVALID_PRACTITIONER_TYPE_NOTE',
      'INVALID_AGREEMENT',
      'INVALID_INVITE_CODE',
      'AUTH_USER_NOT_FOUND',
      'AUTH_USER_UNAVAILABLE',
      'AUTH_PHONE_NOT_VERIFIED',
      'AUTH_PHONE_NOT_SUPPORTED',
      'AUTH_PHONE_CLAIM_MISMATCH',
      'AUTH_IDENTITY_NOT_VERIFIED',
      'IDENTITY_MAPPING_CONFLICT',
      'PARTIAL_REGISTRATION_STATE',
      'REGISTRATION_CONFLICT'
    ) then
      raise;
    end if;
    raise exception using errcode = 'P0001', message = 'REGISTRATION_FAILED';
end;
$$;

comment on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text, text
) is
  'Creates one pending users/profile/application set atomically from the current verified Supabase Auth identity; supports required note when practitioner_type is other.';

create or replace function public.v3a_submit_pending_application(
  p_display_name text,
  p_city text,
  p_requested_role text,
  p_practitioner_type text,
  p_agreement_version text,
  p_accepted_rules boolean,
  p_invite_code text default null,
  p_application_identity text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
begin
  return public.v3a_submit_pending_application(
    p_display_name,
    p_city,
    p_requested_role,
    p_practitioner_type,
    p_agreement_version,
    p_accepted_rules,
    p_invite_code,
    p_application_identity,
    null
  );
end;
$$;

comment on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) is
  'Compatibility wrapper for the current V3a authenticated registration RPC.';

revoke all on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text, text
) to authenticated;

grant execute on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) to authenticated;

revoke insert on table
  public.users,
  public.advisor_profiles,
  public.application_reviews
from public, anon, authenticated, service_role;

revoke update on table public.users
from public, anon, authenticated, service_role;

drop policy if exists v3a_users_insert_own_pending on public.users;
drop policy if exists v3a_advisor_profiles_insert_own_pending
  on public.advisor_profiles;
drop policy if exists v3a_application_reviews_insert_own_pending
  on public.application_reviews;

-- ============================================================================
-- PHASE 4: 017 AUTO-ACTIVATION
-- 普通指导师自动开通 RPC + 相关约束和触发器更新。
-- 不修改身份/积分/审核业务规则，不创建 application_reviews。
-- ============================================================================

-- 3.1 放宽 users active 审核一致性约束（允许 advisor/direct 自动开通）
alter table public.users
  drop constraint if exists users_approval_consistency_check;

alter table public.users
  add constraint users_approval_consistency_check
  check (
    status <> 'active'
    or role = 'super_admin'
    or (
      approved_at is not null
      and approved_by_user_id is not null
    )
    or (
      role = 'advisor'
      and source = 'direct'
      and approved_at is not null
      and approved_by_user_id is null
    )
  );

-- 3.2 admin_audit_logs：admin_id 允许为 null，添加 AUTO_ACTIVATE_ADVISOR action
alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;

alter table public.admin_audit_logs
  alter column admin_id drop not null;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check
  check (action in (
    'APPROVE_APPLICATION',
    'REJECT_APPLICATION',
    'FREEZE_USER',
    'UNFREEZE_USER',
    'MANUAL_GRANT_CREDITS',
    'MANUAL_DEDUCT_CREDITS',
    'AUTO_ACTIVATE_ADVISOR'
  ));

-- 3.3 admin_audit_logs 幂等键重建（加入 AUTO_ADVISOR_ACTIVATION）
drop index if exists public.admin_audit_logs_idempotency_key_uidx;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_review_idempotency_key_check;

alter table public.admin_audit_logs
  drop column if exists idempotency_key;

alter table public.admin_audit_logs
  add column idempotency_key text
  generated always as (
    case
      when action in ('APPROVE_APPLICATION', 'REJECT_APPLICATION')
        and nullif(details ->> 'application_id', '') is not null
      then action || ':' || ((details ->> 'application_id')::uuid::text)
      when action = 'AUTO_ACTIVATE_ADVISOR'
        and target_type = 'user'
        and target_id is not null
      then action || ':' || target_id::text
      else null
    end
  ) stored;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_review_idempotency_key_check
  check (
    (
      action not in ('APPROVE_APPLICATION', 'REJECT_APPLICATION', 'AUTO_ACTIVATE_ADVISOR')
    )
    or (
      action in ('APPROVE_APPLICATION', 'REJECT_APPLICATION')
      and idempotency_key is not null
      and idempotency_key =
        action || ':' || ((details ->> 'application_id')::uuid::text)
    )
    or (
      action = 'AUTO_ACTIVATE_ADVISOR'
      and target_type = 'user'
      and target_id is not null
      and idempotency_key = 'AUTO_ACTIVATE_ADVISOR:' || target_id::text
      and details = jsonb_build_object(
        'source', 'phone_verified_auto_activation',
        'reason', 'first_advisor_activation'
      )
    )
  );

create unique index admin_audit_logs_idempotency_key_uidx
  on public.admin_audit_logs (idempotency_key)
  where idempotency_key is not null;

-- 3.4 credit_logs 形态约束更新（加入 AUTO_ADVISOR_ACTIVATION）
alter table public.credit_logs
  drop constraint if exists credit_logs_register_bonus_shape_check;

alter table public.credit_logs
  add constraint credit_logs_register_bonus_shape_check
  check (
    type <> 'REGISTER_BONUS'
    or (
      amount = 500
      and balance_before = 0
      and balance_after = 500
      and idempotency_key is not null
      and idempotency_key ~
        '^REGISTER_BONUS:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|AUTO_ADVISOR_ACTIVATION)$'
      and split_part(idempotency_key, ':', 2) = user_id::text
    )
  );

-- 3.5 积分触发器函数（017 版本，支持 AUTO_ADVISOR_ACTIVATION）
create or replace function public.v3a_credit_logs_require_approved_application()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bonus_key text;
  v_application_id uuid;
begin
  if new.type <> 'REGISTER_BONUS' then
    return new;
  end if;

  if new.idempotency_key is null
    or new.idempotency_key !~
      '^REGISTER_BONUS:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|AUTO_ADVISOR_ACTIVATION)$'
    or split_part(new.idempotency_key, ':', 2) <> new.user_id::text
    or new.amount <> 500
    or new.balance_before <> 0
    or new.balance_after <> 500 then
    raise exception using
      errcode = '23514',
      message = 'INVALID_REGISTER_BONUS_SHAPE';
  end if;

  v_bonus_key := split_part(new.idempotency_key, ':', 3);

  if v_bonus_key = 'AUTO_ADVISOR_ACTIVATION' then
    if new.operator_id is not null then
      raise exception using
        errcode = '23514',
        message = 'AUTO_REGISTER_BONUS_MUST_NOT_HAVE_OPERATOR';
    end if;

    if not exists (
      select 1
      from public.users users_row
      join public.advisor_profiles profile
        on profile.user_id = users_row.id
      where users_row.id = new.user_id
        and users_row.role = 'advisor'
        and users_row.status = 'active'
        and profile.role = 'advisor'
        and profile.status = 'active'
    ) then
      raise exception using
        errcode = '23514',
        message = 'AUTO_REGISTER_BONUS_REQUIRES_ACTIVE_ADVISOR';
    end if;

    return new;
  end if;

  v_application_id := v_bonus_key::uuid;

  if not exists (
    select 1
    from public.application_reviews review
    where review.id = v_application_id
      and review.user_id = new.user_id
      and review.status = 'approved'
  ) then
    raise exception using
      errcode = '23514',
      message = 'REGISTER_BONUS_REQUIRES_APPROVED_APPLICATION';
  end if;

  return new;
end;
$$;

comment on function public.v3a_credit_logs_require_approved_application() is
  'Validates REGISTER_BONUS issuance: institution bonuses require an approved application; ordinary advisor auto bonuses require an active advisor account/profile and no operator.';

revoke all on function public.v3a_credit_logs_require_approved_application()
  from public, anon, authenticated, service_role;

-- 3.6 普通指导师自动开通 RPC
create or replace function public.v3a_auto_activate_advisor(
  p_display_name text,
  p_city text,
  p_practitioner_type text,
  p_agreement_version text,
  p_accepted_rules boolean,
  p_invite_code text default null,
  p_application_identity text default null,
  p_practitioner_type_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_auth_user_id uuid;
  v_jwt jsonb;
  v_auth jsonb;
  v_auth_phone_raw text;
  v_jwt_phone_raw text;
  v_auth_phone text;
  v_jwt_phone text;
  v_phone text;
  v_auth_email text;
  v_email text;
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_practitioner_type text := btrim(coalesce(p_practitioner_type, ''));
  v_practitioner_type_note text :=
    nullif(btrim(coalesce(p_practitioner_type_note, '')), '');
  v_application_identity text :=
    nullif(btrim(coalesce(p_application_identity, '')), '');
  v_agreement_version text := btrim(coalesce(p_agreement_version, ''));
  v_expected_agreement_version constant text :=
    'v3a-phase-b-preview-2026-07-09';
  v_invite_code_input text := upper(nullif(btrim(coalesce(p_invite_code, '')), ''));
  v_user public.users%rowtype;
  v_profile public.advisor_profiles%rowtype;
  v_user_id uuid;
  v_wallet_id uuid;
  v_wallet_balance integer;
  v_credit_log_id uuid;
  v_credit_log_wallet_id uuid;
  v_credit_log_user_id uuid;
  v_credit_log_type text;
  v_credit_log_amount integer;
  v_credit_log_balance_before integer;
  v_credit_log_balance_after integer;
  v_credit_idempotency_key text;
  v_register_bonus_exists boolean;
  v_existing_invite_code text;
  v_existing_invite_role text;
  v_existing_invite_status text;
  v_candidate_code text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt integer;
  v_char_index integer;
  v_audit_log_id uuid;
  v_audit_target_id uuid;
  v_audit_action text;
  v_audit_details jsonb;
  v_activated_at timestamptz := now();
begin
  v_auth_user_id := auth.uid();
  v_jwt := coalesce(auth.jwt(), '{}'::jsonb);

  if coalesce(auth.role(), '') <> 'authenticated'
    or v_auth_user_id is null
    or nullif(v_jwt ->> 'sub', '') is distinct from v_auth_user_id::text
    or nullif(v_jwt ->> 'role', '') is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  if char_length(v_display_name) < 2
    or char_length(v_display_name) > 80
    or v_display_name ~ '[[:cntrl:]<>]' then
    raise exception using errcode = '22023', message = 'INVALID_DISPLAY_NAME';
  end if;

  if char_length(v_city) < 1
    or char_length(v_city) > 80
    or v_city ~ '[[:cntrl:]<>]' then
    raise exception using errcode = '22023', message = 'INVALID_CITY';
  end if;

  if v_application_identity is not null
    and v_application_identity <> 'ordinary_advisor' then
    raise exception using errcode = '22023', message = 'INVALID_APPLICATION_IDENTITY';
  end if;

  if v_practitioner_type not in (
    'independent',
    'organization',
    'education_family',
    'psychological_consulting',
    'child_growth_quality',
    'assessment_collection',
    'other'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE';
  end if;

  if v_practitioner_type = 'other' then
    if v_practitioner_type_note is null
      or char_length(v_practitioner_type_note) < 2
      or char_length(v_practitioner_type_note) > 80
      or v_practitioner_type_note ~ '[[:cntrl:]<>]' then
      raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE_NOTE';
    end if;
  elsif v_practitioner_type_note is not null then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE_NOTE';
  end if;

  if p_accepted_rules is not true
    or v_agreement_version is distinct from v_expected_agreement_version then
    raise exception using errcode = '22023', message = 'INVALID_AGREEMENT';
  end if;

  if v_invite_code_input is not null
    and v_invite_code_input !~
      '^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception using errcode = '22023', message = 'INVALID_INVITE_CODE';
  end if;

  -- Existing 017 only validated these values and then silently discarded them.
  -- Keep Production closed until the frozen identity lifecycle defines where
  -- an ordinary-advisor "other" note is stored and how an invited direct
  -- activation changes users.source/approved_by and invite_relations status.
  if v_practitioner_type = 'other' then
    raise exception using
      errcode = '55000',
      message = 'AUTO_ACTIVATION_OTHER_NOTE_RULE_UNAPPROVED';
  end if;
  if v_invite_code_input is not null then
    raise exception using
      errcode = '55000',
      message = 'AUTO_ACTIVATION_INVITE_RULE_UNAPPROVED';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('v3a_auto_activate_advisor'),
    hashtext(v_auth_user_id::text)
  );

  select to_jsonb(auth_user)
  into v_auth
  from auth.users auth_user
  where auth_user.id = v_auth_user_id
  for update;

  if v_auth is null then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  if coalesce((v_auth ->> 'is_anonymous')::boolean, false)
    or nullif(v_auth ->> 'deleted_at', '') is not null
    or (
      nullif(v_auth ->> 'banned_until', '') is not null
      and (v_auth ->> 'banned_until')::timestamptz > now()
    ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_UNAVAILABLE';
  end if;

  v_auth_phone_raw := nullif(btrim(coalesce(v_auth ->> 'phone', '')), '');
  v_jwt_phone_raw := nullif(btrim(coalesce(v_jwt ->> 'phone', '')), '');

  if v_auth_phone_raw ~ '^[+]861[3-9][0-9]{9}$' then
    v_auth_phone := v_auth_phone_raw;
  elsif v_auth_phone_raw ~ '^861[3-9][0-9]{9}$' then
    v_auth_phone := '+' || v_auth_phone_raw;
  else
    v_auth_phone := null;
  end if;

  if v_jwt_phone_raw ~ '^[+]861[3-9][0-9]{9}$' then
    v_jwt_phone := v_jwt_phone_raw;
  elsif v_jwt_phone_raw ~ '^861[3-9][0-9]{9}$' then
    v_jwt_phone := '+' || v_jwt_phone_raw;
  else
    v_jwt_phone := null;
  end if;

  if nullif(v_auth ->> 'phone_confirmed_at', '') is not null then
    if v_auth_phone_raw is null then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
    end if;
    if v_auth_phone is null then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_SUPPORTED';
    end if;
    if v_jwt_phone_raw is not null
      and v_jwt_phone is distinct from v_auth_phone then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_CLAIM_MISMATCH';
    end if;
    v_phone := v_auth_phone;
  else
    if v_jwt_phone_raw is not null then
      raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
    end if;
    v_phone := null;
  end if;

  v_auth_email := nullif(btrim(coalesce(v_auth ->> 'email', '')), '');
  if nullif(v_auth ->> 'email_confirmed_at', '') is not null
    and v_auth_email is not null then
    v_email := v_auth_email;
  else
    v_email := null;
  end if;

  if v_phone is null then
    raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
  end if;

  select users_row.*
  into v_user
  from public.users users_row
  where users_row.auth_user_id = v_auth_user_id
  for update;

  if found then
    v_user_id := v_user.id;
    if v_user.phone is distinct from v_phone
      or (
        v_user.email is not null
        and v_email is not null
        and lower(v_user.email) <> lower(v_email)
      )
      or ((v_user.email is null) <> (v_email is null)) then
      raise exception using errcode = '55000', message = 'IDENTITY_MAPPING_CONFLICT';
    end if;

    if v_user.status <> 'active' or v_user.role <> 'advisor' then
      raise exception using errcode = '55000', message = 'ACCOUNT_NOT_ELIGIBLE_FOR_AUTO_ACTIVATION';
    end if;
  else
    insert into public.users (
      auth_user_id,
      role,
      status,
      phone,
      email,
      display_name,
      city,
      source,
      approved_at
    ) values (
      v_auth_user_id,
      'advisor',
      'active',
      v_phone,
      v_email,
      v_display_name,
      v_city,
      'direct',
      v_activated_at
    )
    returning * into v_user;
    v_user_id := v_user.id;
  end if;

  select profile.*
  into v_profile
  from public.advisor_profiles profile
  where profile.user_id = v_user_id
  for update;

  if found then
    if v_profile.role <> 'advisor' or v_profile.status <> 'active' then
      raise exception using errcode = '55000', message = 'ACCOUNT_NOT_ELIGIBLE_FOR_AUTO_ACTIVATION';
    end if;
  else
    insert into public.advisor_profiles (
      user_id,
      role,
      status,
      nickname,
      city,
      practitioner_type,
      agreement_version,
      agreed_rules_at
    ) values (
      v_user_id,
      'advisor',
      'active',
      v_display_name,
      v_city,
      v_practitioner_type,
      v_agreement_version,
      v_activated_at
    )
    returning * into v_profile;
  end if;

  select wallet.id, wallet.balance
  into v_wallet_id, v_wallet_balance
  from public.credit_wallets wallet
  where wallet.user_id = v_user_id
  for update;

  if not found then
    insert into public.credit_wallets (user_id, balance)
    values (v_user_id, 500)
    returning id, balance into v_wallet_id, v_wallet_balance;
  end if;

  v_credit_idempotency_key := format(
    'REGISTER_BONUS:%s:AUTO_ADVISOR_ACTIVATION',
    v_user_id
  );

  select exists (
    select 1
    from public.credit_logs credit
    where credit.idempotency_key = v_credit_idempotency_key
  )
  into v_register_bonus_exists;

  if v_register_bonus_exists then
    if v_wallet_balance is distinct from 500 then
      raise exception using errcode = 'P0001', message = 'INCOMPLETE_AUTO_ACTIVATION_STATE';
    end if;
  elsif v_wallet_balance = 0 then
    update public.credit_wallets
    set balance = 500
    where id = v_wallet_id
    returning balance into v_wallet_balance;
  elsif v_wallet_balance is distinct from 500 then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_AUTO_ACTIVATION_STATE';
  end if;

  insert into public.credit_logs (
    wallet_id,
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    idempotency_key,
    operator_id,
    note
  ) values (
    v_wallet_id,
    v_user_id,
    'REGISTER_BONUS',
    500,
    0,
    500,
    v_credit_idempotency_key,
    null,
    '普通指导师账号自动开通：注册体验积分 500'
  )
  on conflict (idempotency_key) do nothing
  returning
    id,
    wallet_id,
    user_id,
    type,
    amount,
    balance_before,
    balance_after
  into
    v_credit_log_id,
    v_credit_log_wallet_id,
    v_credit_log_user_id,
    v_credit_log_type,
    v_credit_log_amount,
    v_credit_log_balance_before,
    v_credit_log_balance_after;

  if v_credit_log_id is null then
    select
      credit.id,
      credit.wallet_id,
      credit.user_id,
      credit.type,
      credit.amount,
      credit.balance_before,
      credit.balance_after
    into
      v_credit_log_id,
      v_credit_log_wallet_id,
      v_credit_log_user_id,
      v_credit_log_type,
      v_credit_log_amount,
      v_credit_log_balance_before,
      v_credit_log_balance_after
    from public.credit_logs credit
    where credit.idempotency_key = v_credit_idempotency_key;
  end if;

  if v_credit_log_wallet_id is distinct from v_wallet_id
    or v_credit_log_user_id is distinct from v_user_id
    or v_credit_log_type is distinct from 'REGISTER_BONUS'
    or v_credit_log_amount is distinct from 500
    or v_credit_log_balance_before is distinct from 0
    or v_credit_log_balance_after is distinct from 500 then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_AUTO_ACTIVATION_STATE';
  end if;

  select invite.code, invite.role, invite.status
  into v_existing_invite_code, v_existing_invite_role, v_existing_invite_status
  from public.invite_codes invite
  where invite.user_id = v_user_id
  for update;

  if v_existing_invite_code is null then
    for v_attempt in 1..12 loop
      v_candidate_code := 'ADV-';
      for v_char_index in 1..8 loop
        v_candidate_code := v_candidate_code ||
          substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
      end loop;

      begin
        insert into public.invite_codes (code, user_id, role, status)
        values (v_candidate_code, v_user_id, 'advisor', 'active')
        returning code, role, status
        into v_existing_invite_code, v_existing_invite_role, v_existing_invite_status;
        exit;
      exception
        when unique_violation then
          v_existing_invite_code := null;
      end;
    end loop;
  end if;

  if v_existing_invite_code is null
    or v_existing_invite_role <> 'advisor'
    or v_existing_invite_status <> 'active'
    or v_existing_invite_code !~ '^ADV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_AUTO_ACTIVATION_STATE';
  end if;

  insert into public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    null,
    'AUTO_ACTIVATE_ADVISOR',
    'user',
    v_user_id,
    jsonb_build_object(
      'source', 'phone_verified_auto_activation',
      'reason', 'first_advisor_activation'
    )
  )
  on conflict (idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id, target_id, action, details
  into v_audit_log_id, v_audit_target_id, v_audit_action, v_audit_details;

  if v_audit_log_id is null then
    select audit.id, audit.target_id, audit.action, audit.details
    into v_audit_log_id, v_audit_target_id, v_audit_action, v_audit_details
    from public.admin_audit_logs audit
    where audit.idempotency_key = format('AUTO_ACTIVATE_ADVISOR:%s', v_user_id);
  end if;

  if v_audit_log_id is null
    or v_audit_target_id is distinct from v_user_id
    or v_audit_action is distinct from 'AUTO_ACTIVATE_ADVISOR'
    or v_audit_details is distinct from jsonb_build_object(
      'source', 'phone_verified_auto_activation',
      'reason', 'first_advisor_activation'
    ) then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_AUTO_ACTIVATION_STATE';
  end if;

  return jsonb_build_object(
    'activated', true,
    'user_id', v_user_id,
    'role', 'advisor',
    'wallet_balance', 500,
    'invite_code', v_existing_invite_code,
    'activation_type', 'AUTO_ADVISOR'
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'AUTO_ACTIVATION_IDENTITY_CONFLICT';
  when others then
    if sqlerrm in (
      'UNAUTHENTICATED',
      'INVALID_DISPLAY_NAME',
      'INVALID_CITY',
      'INVALID_APPLICATION_IDENTITY',
      'INVALID_PRACTITIONER_TYPE',
      'INVALID_PRACTITIONER_TYPE_NOTE',
      'INVALID_AGREEMENT',
      'INVALID_INVITE_CODE',
      'AUTO_ACTIVATION_OTHER_NOTE_RULE_UNAPPROVED',
      'AUTO_ACTIVATION_INVITE_RULE_UNAPPROVED',
      'AUTH_USER_NOT_FOUND',
      'AUTH_USER_UNAVAILABLE',
      'AUTH_PHONE_NOT_VERIFIED',
      'AUTH_PHONE_NOT_SUPPORTED',
      'AUTH_PHONE_CLAIM_MISMATCH',
      'IDENTITY_MAPPING_CONFLICT',
      'ACCOUNT_NOT_ELIGIBLE_FOR_AUTO_ACTIVATION',
      'INCOMPLETE_AUTO_ACTIVATION_STATE'
    ) then
      raise;
    end if;
    raise exception using errcode = 'P0001', message = 'AUTO_ACTIVATION_FAILED';
end;
$$;

comment on function public.v3a_auto_activate_advisor(
  text, text, text, text, boolean, text, text, text
) is
  'Auto-activates the current verified-phone Auth user as an ordinary advisor without creating application_reviews; creates active user/profile, wallet, one 500-point register bonus, one invite code, and AUTO_ACTIVATE_ADVISOR audit log in one transaction.';

revoke all on function public.v3a_auto_activate_advisor(
  text, text, text, text, boolean, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.v3a_auto_activate_advisor(
  text, text, text, text, boolean, text, text, text
) to authenticated;

-- ============================================================================
-- PHASE 5: VERIFIED PHONE ACCOUNT REBIND
-- 恢复 api/v3a-session.js 已调用的 018 用户态账号重绑 RPC。
-- ============================================================================

create or replace function public.v3a_rebind_verified_phone_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '10s'
as $$
declare
  v_auth_user_id uuid;
  v_jwt jsonb;
  v_auth jsonb;
  v_auth_phone_raw text;
  v_jwt_phone_raw text;
  v_auth_phone text;
  v_jwt_phone text;
  v_phone text;
  v_user public.users%rowtype;
  v_user_count integer;
begin
  v_auth_user_id := auth.uid();
  v_jwt := coalesce(auth.jwt(), '{}'::jsonb);

  if coalesce(auth.role(), '') <> 'authenticated'
    or v_auth_user_id is null
    or nullif(v_jwt ->> 'sub', '') is distinct from v_auth_user_id::text
    or nullif(v_jwt ->> 'role', '') is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  select to_jsonb(auth_user)
  into v_auth
  from auth.users auth_user
  where auth_user.id = v_auth_user_id
  for update;

  if v_auth is null then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  if coalesce((v_auth ->> 'is_anonymous')::boolean, false)
    or nullif(v_auth ->> 'deleted_at', '') is not null
    or (
      nullif(v_auth ->> 'banned_until', '') is not null
      and (v_auth ->> 'banned_until')::timestamptz > now()
    ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_UNAVAILABLE';
  end if;

  v_auth_phone_raw := nullif(btrim(coalesce(v_auth ->> 'phone', '')), '');
  v_jwt_phone_raw := nullif(btrim(coalesce(v_jwt ->> 'phone', '')), '');

  if v_auth_phone_raw ~ '^[+]861[3-9][0-9]{9}$' then
    v_auth_phone := v_auth_phone_raw;
  elsif v_auth_phone_raw ~ '^861[3-9][0-9]{9}$' then
    v_auth_phone := '+' || v_auth_phone_raw;
  else
    v_auth_phone := null;
  end if;

  if v_jwt_phone_raw ~ '^[+]861[3-9][0-9]{9}$' then
    v_jwt_phone := v_jwt_phone_raw;
  elsif v_jwt_phone_raw ~ '^861[3-9][0-9]{9}$' then
    v_jwt_phone := '+' || v_jwt_phone_raw;
  else
    v_jwt_phone := null;
  end if;

  if nullif(v_auth ->> 'phone_confirmed_at', '') is null
    or v_auth_phone is null then
    raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
  end if;

  if v_jwt_phone is not null
    and v_jwt_phone is distinct from v_auth_phone then
    raise exception using errcode = '22023', message = 'AUTH_PHONE_CLAIM_MISMATCH';
  end if;

  v_phone := v_auth_phone;

  perform pg_advisory_xact_lock(
    hashtext('v3a_rebind_verified_phone_account'),
    hashtext(v_phone)
  );

  select count(*)
  into v_user_count
  from public.users users_row
  where users_row.phone = v_phone;

  if v_user_count = 0 then
    return jsonb_build_object(
      'rebound', false,
      'reason', 'NO_BUSINESS_USER'
    );
  end if;

  if v_user_count <> 1 then
    raise exception using errcode = '55000', message = 'PHONE_BUSINESS_ACCOUNT_CONFLICT';
  end if;

  select users_row.*
  into strict v_user
  from public.users users_row
  where users_row.phone = v_phone
  for update;

  if v_user.auth_user_id = v_auth_user_id then
    return jsonb_build_object(
      'rebound', false,
      'reason', 'ALREADY_BOUND',
      'user_id', v_user.id,
      'role', v_user.role,
      'status', v_user.status
    );
  end if;

  if exists (
    select 1
    from public.users users_row
    where users_row.auth_user_id = v_auth_user_id
      and users_row.id <> v_user.id
  ) then
    raise exception using errcode = '55000', message = 'IDENTITY_MAPPING_CONFLICT';
  end if;

  if v_user.status not in ('active', 'pending', 'rejected', 'frozen', 'disabled')
    or v_user.role not in ('advisor', 'agent', 'center', 'pending') then
    raise exception using errcode = '55000', message = 'BUSINESS_ACCOUNT_NOT_REBINDABLE';
  end if;

  update public.users
  set auth_user_id = v_auth_user_id,
      updated_at = now()
  where id = v_user.id;

  return jsonb_build_object(
    'rebound', true,
    'user_id', v_user.id,
    'role', v_user.role,
    'status', v_user.status
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'IDENTITY_MAPPING_CONFLICT';
  when others then
    if sqlerrm in (
      'UNAUTHENTICATED',
      'AUTH_USER_NOT_FOUND',
      'AUTH_USER_UNAVAILABLE',
      'AUTH_PHONE_NOT_VERIFIED',
      'AUTH_PHONE_CLAIM_MISMATCH',
      'PHONE_BUSINESS_ACCOUNT_CONFLICT',
      'IDENTITY_MAPPING_CONFLICT',
      'BUSINESS_ACCOUNT_NOT_REBINDABLE'
    ) then
      raise;
    end if;
    raise exception using errcode = 'P0001', message = 'PHONE_ACCOUNT_REBIND_FAILED';
end;
$$;

comment on function public.v3a_rebind_verified_phone_account() is
  'Rebinds one existing public.users row to the current verified-phone Auth user when duplicate Preview Auth identities caused a login/session mismatch.';

revoke all on function public.v3a_rebind_verified_phone_account()
from public, anon, authenticated, service_role;

grant execute on function public.v3a_rebind_verified_phone_account()
to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- PHASE 6: POSTFLIGHT ASSERTIONS
-- 验证所有关键对象存在且配置正确。
-- ============================================================================

do $$
declare
  v_review_count bigint;
  v_pending_count bigint;
  v_approved_count bigint;
  v_rejected_count bigint;
begin
  -- 6.1 最终 RPC 签名必须全部存在。
  if to_regprocedure(
    'public.v3a_approve_application(uuid,uuid,text)'
  ) is null
    or to_regprocedure(
      'public.v3a_reject_application(uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.v3a_submit_pending_application(text,text,text,text,text,boolean,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.v3a_submit_pending_application(text,text,text,text,text,boolean,text,text)'
    ) is null
    or to_regprocedure(
      'public.v3a_auto_activate_advisor(text,text,text,text,boolean,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.v3a_rebind_verified_phone_account()'
    ) is null then
    raise exception 'POSTFLIGHT_FAILED: one or more final RPC signatures are missing';
  end if;

  -- 6.2 用户态 RPC 仅 authenticated 可执行。
  if not has_function_privilege(
    'authenticated',
    'public.v3a_auto_activate_advisor(text,text,text,text,boolean,text,text,text)',
    'EXECUTE'
  )
    or has_function_privilege(
      'anon',
      'public.v3a_auto_activate_advisor(text,text,text,text,boolean,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.v3a_auto_activate_advisor(text,text,text,text,boolean,text,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.v3a_submit_pending_application(text,text,text,text,text,boolean,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.v3a_submit_pending_application(text,text,text,text,text,boolean,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.v3a_submit_pending_application(text,text,text,text,text,boolean,text,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.v3a_rebind_verified_phone_account()',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.v3a_rebind_verified_phone_account()',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.v3a_rebind_verified_phone_account()',
      'EXECUTE'
    ) then
    raise exception 'POSTFLIGHT_FAILED: user RPC execute grants are unsafe';
  end if;

  -- 6.3 审核 RPC 仅 service_role 可执行。
  if not has_function_privilege(
    'service_role',
    'public.v3a_approve_application(uuid,uuid,text)',
    'EXECUTE'
  )
    or has_function_privilege(
      'authenticated',
      'public.v3a_approve_application(uuid,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.v3a_approve_application(uuid,uuid,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.v3a_reject_application(uuid,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.v3a_reject_application(uuid,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.v3a_reject_application(uuid,uuid,text)',
      'EXECUTE'
    ) then
    raise exception 'POSTFLIGHT_FAILED: review RPC execute grants are unsafe';
  end if;

  -- 6.4 注册奖励触发器必须绑定最终函数。
  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_class table_row on table_row.oid = trigger_row.tgrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    join pg_proc function_row on function_row.oid = trigger_row.tgfoid
    where namespace_row.nspname = 'public'
      and table_row.relname = 'credit_logs'
      and trigger_row.tgname = 'credit_logs_require_approved_application'
      and function_row.proname = 'v3a_credit_logs_require_approved_application'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'POSTFLIGHT_FAILED: final credit registration trigger is missing';
  end if;

  -- 6.5 核心列必须完成 post-004 转换。
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_audit_logs'
      and column_name = 'admin_id'
      and is_nullable = 'YES'
  )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'admin_audit_logs'
        and column_name = 'details'
    )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'credit_logs'
        and column_name = 'operator_id'
    )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'credit_logs'
        and column_name = 'note'
    )
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'admin_audit_logs' and column_name = 'operator_user_id')
          or (table_name = 'credit_logs' and column_name in ('operator_user_id', 'reason'))
        )
    ) then
    raise exception 'POSTFLIGHT_FAILED: post-004 core columns are incomplete';
  end if;

  -- 6.6 最终约束和 RLS 策略必须存在。
  if (
    select count(*)
    from pg_constraint
    where conname in (
      'users_approval_consistency_check',
      'users_pending_role_status_check',
      'users_phone_china_e164_check',
      'application_reviews_rejection_reason_check',
      'advisor_profiles_practitioner_type_check',
      'application_reviews_practitioner_type_check',
      'credit_logs_register_bonus_shape_check',
      'invite_codes_user_id_key',
      'admin_audit_logs_review_idempotency_key_check'
    )
  ) <> 9 then
    raise exception 'POSTFLIGHT_FAILED: final constraints are incomplete';
  end if;
  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'credit_wallets_select_active_own_or_super_admin',
        'credit_logs_select_active_own_or_super_admin',
        'invite_codes_select_active_own_or_super_admin'
      )
  ) <> 3 then
    raise exception 'POSTFLIGHT_FAILED: final asset RLS policies are incomplete';
  end if;

  -- 6.7 迁移不得创建资产、审计或邀请业务记录。
  if exists (select 1 from public.admin_audit_logs)
    or exists (select 1 from public.credit_logs)
    or exists (select 1 from public.credit_wallets)
    or exists (select 1 from public.invite_codes)
    or exists (select 1 from public.invite_relations) then
    raise exception 'POSTFLIGHT_FAILED: migration created forbidden business rows';
  end if;

  -- 6.8 既有审核记录数量和状态分布必须保持不变。
  select
    count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'rejected')
  into
    v_review_count,
    v_pending_count,
    v_approved_count,
    v_rejected_count
  from public.application_reviews;

  if not exists (
    select 1
    from v3a_019_preflight_state state
    where state.review_count = v_review_count
      and state.pending_count = v_pending_count
      and state.approved_count = v_approved_count
      and state.rejected_count = v_rejected_count
  ) then
    raise exception 'POSTFLIGHT_FAILED: application_reviews state changed';
  end if;
end;
$$;

-- ============================================================================
-- NOTIFY SCHEMA CACHE RELOAD
-- ============================================================================
notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- 执行后验证步骤（人工操作）：
-- 1. 当前 REVIEW CANDIDATE 禁止执行，直到邀请码关系和“其他”说明规则获批。
-- 2. 获批后只使用脱敏布尔值/聚合查询验收；禁止 select * 读取用户、积分或审计行。
-- 3. 真实 OTP、普通指导师、机构 pending、重复提交与账号重绑均需人工验收。
-- 4. Schema Cache 通过 notify pgrst 刷新。
-- ============================================================================
