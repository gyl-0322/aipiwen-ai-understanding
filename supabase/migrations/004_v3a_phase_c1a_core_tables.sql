-- AIPIWEN V3a Phase C1-A core database tables.
-- Phase A pre-created broader draft versions of these tables. This migration
-- narrows them to the reviewed C1-A schema without inserting business data.

-- credit_wallets

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

-- credit_logs

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

alter table public.credit_logs
  rename constraint credit_logs_operator_user_id_fkey
    to credit_logs_operator_id_fkey;

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

-- invite_codes

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

-- admin_audit_logs

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

alter table public.admin_audit_logs
  rename constraint admin_audit_logs_operator_user_id_fkey
    to admin_audit_logs_admin_id_fkey;

alter index if exists public.admin_audit_logs_operator_created_at_idx
  rename to admin_audit_logs_admin_created_at_idx;

alter table public.admin_audit_logs
  add column details jsonb not null default '{}'::jsonb,
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
