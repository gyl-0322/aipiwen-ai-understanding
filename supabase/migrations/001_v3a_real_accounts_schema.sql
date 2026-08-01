-- AIPIWEN V3a Phase A real accounts schema draft.
-- Draft only: do not run against production until reviewed and approved.
-- Scope: practitioner accounts, profiles, credit wallets/logs, invites, admin audit,
-- login events, and application reviews. No customer report, Report OS, AI model,
-- payment, PDF, or production report data is modeled here.

create extension if not exists pgcrypto;

create or replace function public.v3a_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.v3a_prevent_credit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_logs are append-only in V3a';
end;
$$;

create or replace function public.v3a_prevent_admin_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_logs are append-only in V3a';
end;
$$;

create or replace function public.v3a_require_credit_mutation_context()
returns trigger
language plpgsql
as $$
begin
  if (
    new.balance is distinct from old.balance
    or new.total_earned is distinct from old.total_earned
    or new.total_spent is distinct from old.total_spent
    or new.locked_balance is distinct from old.locked_balance
  ) and coalesce(current_setting('app.v3a_credit_mutation', true), '') <> 'service_tx' then
    raise exception 'credit_wallets balances must be changed by server-side credit transaction APIs';
  end if;

  return new;
end;
$$;

create or replace function public.v3a_credit_logs_require_active_user()
returns trigger
language plpgsql
as $$
declare
  target_status text;
begin
  select status into target_status
  from public.users
  where id = new.user_id;

  if target_status is distinct from 'active' then
    raise exception 'credit_logs can only be posted for active approved users';
  end if;

  return new;
end;
$$;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'pending',
  status text not null default 'pending',
  phone text,
  email text,
  wechat_openid text,
  wechat_unionid text,
  wechat_bound_at timestamptz,
  display_name text not null,
  real_name text,
  city text not null,
  source text not null default 'direct',
  invited_by_user_id uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  approved_by_user_id uuid references public.users(id) on delete set null,
  frozen_at timestamptz,
  frozen_reason text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_check
    check (role in ('super_admin', 'advisor', 'agent', 'center', 'pending')),
  constraint users_status_check
    check (status in ('pending', 'active', 'rejected', 'frozen', 'disabled')),
  constraint users_source_check
    check (source in ('direct', 'invited', 'emma_created')),
  constraint users_pending_role_status_check
    check ((role = 'pending' and status = 'pending') or role <> 'pending'),
  constraint users_approval_consistency_check
    check (
      (status = 'active' and approved_at is not null and approved_by_user_id is not null)
      or status <> 'active'
      or role = 'super_admin'
    ),
  constraint users_frozen_reason_check
    check ((status <> 'frozen') or (frozen_at is not null and frozen_reason is not null))
);

create unique index users_email_unique_idx on public.users (lower(email)) where email is not null;
create unique index users_phone_unique_idx on public.users (phone) where phone is not null;
create unique index users_wechat_openid_unique_idx on public.users (wechat_openid) where wechat_openid is not null;
create unique index users_wechat_unionid_unique_idx on public.users (wechat_unionid) where wechat_unionid is not null;
create index users_role_status_idx on public.users (role, status);
create index users_invited_by_user_id_idx on public.users (invited_by_user_id);
create index users_created_at_idx on public.users (created_at desc);

create trigger users_set_updated_at
before update on public.users
for each row execute function public.v3a_set_updated_at();

create table public.advisor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  role text not null,
  status text not null default 'pending',
  nickname text not null,
  city text not null,
  province text,
  organization_name text,
  practitioner_type text not null default 'independent',
  bio text,
  service_scope text,
  certification_status text not null default 'none',
  certification_note text,
  agreement_version text not null,
  agreed_rules_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advisor_profiles_role_check
    check (role in ('advisor', 'agent', 'center', 'pending')),
  constraint advisor_profiles_status_check
    check (status in ('pending', 'active', 'rejected', 'frozen', 'disabled')),
  constraint advisor_profiles_practitioner_type_check
    check (practitioner_type in ('independent', 'organization', 'agent', 'center', 'other')),
  constraint advisor_profiles_certification_status_check
    check (certification_status in ('none', 'pending', 'certified', 'revoked'))
);

create index advisor_profiles_role_status_idx on public.advisor_profiles (role, status);
create index advisor_profiles_city_idx on public.advisor_profiles (city);

create trigger advisor_profiles_set_updated_at
before update on public.advisor_profiles
for each row execute function public.v3a_set_updated_at();

create table public.credit_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  balance integer not null default 0,
  total_earned integer not null default 0,
  total_spent integer not null default 0,
  locked_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_wallets_role_check
    check (role in ('advisor', 'agent', 'center')),
  constraint credit_wallets_status_check
    check (status in ('active', 'frozen', 'closed')),
  constraint credit_wallets_non_negative_check
    check (balance >= 0 and total_earned >= 0 and total_spent >= 0 and locked_balance >= 0),
  constraint credit_wallets_locked_balance_check
    check (locked_balance <= balance)
);

comment on table public.credit_wallets is
  'V3a credit wallet. Balance changes must be made only by server-side transaction APIs that also append credit_logs.';
comment on column public.credit_wallets.balance is
  'Not directly writable by browser clients. Server transaction must set app.v3a_credit_mutation=service_tx and append credit_logs.';

create index credit_wallets_role_status_idx on public.credit_wallets (role, status);
create index credit_wallets_balance_idx on public.credit_wallets (balance);

create trigger credit_wallets_set_updated_at
before update on public.credit_wallets
for each row execute function public.v3a_set_updated_at();

create trigger credit_wallets_require_credit_mutation_context
before update on public.credit_wallets
for each row execute function public.v3a_require_credit_mutation_context();

create table public.credit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  wallet_id uuid not null references public.credit_wallets(id) on delete restrict,
  role text not null,
  status text not null default 'posted',
  type text not null,
  amount integer not null,
  balance_before integer not null,
  balance_after integer not null,
  ref_type text,
  ref_id uuid,
  reason text not null,
  operator_user_id uuid references public.users(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_logs_role_check
    check (role in ('advisor', 'agent', 'center')),
  constraint credit_logs_status_check
    check (status in ('posted', 'reversed', 'failed')),
  constraint credit_logs_type_check
    check (type in (
      'REGISTER_BONUS',
      'INVITE_REGISTER',
      'INVITE_FIRST_USE',
      'INVITE_CERTIFIED',
      'EMMA_GRANT',
      'EMMA_DEDUCT',
      'SYSTEM_ADJUST'
    )),
  constraint credit_logs_amount_non_zero_check check (amount <> 0),
  constraint credit_logs_balance_math_check check (balance_after = balance_before + amount),
  constraint credit_logs_balance_non_negative_check check (balance_before >= 0 and balance_after >= 0),
  constraint credit_logs_register_bonus_check
    check (type <> 'REGISTER_BONUS' or (amount = 500 and ref_type = 'application_review' and ref_id is not null)),
  constraint credit_logs_emma_manual_check
    check (
      type not in ('EMMA_GRANT', 'EMMA_DEDUCT')
      or (operator_user_id is not null and length(btrim(reason)) > 0)
    ),
  constraint credit_logs_emma_deduct_negative_check
    check (type <> 'EMMA_DEDUCT' or amount < 0),
  constraint credit_logs_emma_grant_positive_check
    check (type <> 'EMMA_GRANT' or amount > 0)
);

comment on table public.credit_logs is
  'Append-only V3a credit ledger. Do not delete or update rows; corrections require a new compensating log.';
comment on column public.credit_logs.amount is
  'Positive values add credits, negative values deduct credits. Credits are not cash, withdrawable, or transferable assets.';

create unique index credit_logs_idempotency_key_unique_idx
  on public.credit_logs (idempotency_key)
  where idempotency_key is not null;
create index credit_logs_user_created_at_idx on public.credit_logs (user_id, created_at desc);
create index credit_logs_wallet_created_at_idx on public.credit_logs (wallet_id, created_at desc);
create index credit_logs_type_created_at_idx on public.credit_logs (type, created_at desc);
create index credit_logs_operator_user_id_idx on public.credit_logs (operator_user_id);

create trigger credit_logs_no_update
before update on public.credit_logs
for each row execute function public.v3a_prevent_credit_log_mutation();

create trigger credit_logs_no_delete
before delete on public.credit_logs
for each row execute function public.v3a_prevent_credit_log_mutation();

create trigger credit_logs_require_active_user
before insert on public.credit_logs
for each row execute function public.v3a_credit_logs_require_active_user();

create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  code text not null unique,
  invite_type text not null default 'practitioner',
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invite_codes_role_check
    check (role in ('advisor', 'agent', 'center')),
  constraint invite_codes_status_check
    check (status in ('active', 'disabled', 'expired')),
  constraint invite_codes_invite_type_check check (invite_type = 'practitioner'),
  constraint invite_codes_usage_check
    check (used_count >= 0 and (max_uses is null or max_uses >= used_count))
);

create index invite_codes_user_id_idx on public.invite_codes (user_id);
create index invite_codes_status_idx on public.invite_codes (status);
create index invite_codes_expires_at_idx on public.invite_codes (expires_at);

create trigger invite_codes_set_updated_at
before update on public.invite_codes
for each row execute function public.v3a_set_updated_at();

create table public.invite_relations (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.users(id) on delete restrict,
  invitee_user_id uuid not null references public.users(id) on delete restrict,
  invite_code_id uuid not null references public.invite_codes(id) on delete restrict,
  role text not null,
  status text not null default 'pending',
  invitee_application_status text not null default 'pending',
  register_bonus_log_id uuid references public.credit_logs(id) on delete set null,
  invite_register_log_id uuid references public.credit_logs(id) on delete set null,
  invite_first_use_log_id uuid references public.credit_logs(id) on delete set null,
  invite_certified_log_id uuid references public.credit_logs(id) on delete set null,
  risk_flag boolean not null default false,
  risk_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invite_relations_role_check
    check (role in ('advisor', 'agent', 'center')),
  constraint invite_relations_status_check
    check (status in ('pending', 'approved', 'rejected', 'rewarded', 'invalid')),
  constraint invite_relations_application_status_check
    check (invitee_application_status in ('pending', 'active', 'rejected')),
  constraint invite_relations_no_self_invite_check
    check (inviter_user_id <> invitee_user_id),
  constraint invite_relations_risk_reason_check
    check (risk_flag = false or risk_reason is not null)
);

create unique index invite_relations_invitee_effective_unique_idx
  on public.invite_relations (invitee_user_id)
  where status <> 'invalid';
create index invite_relations_inviter_created_at_idx on public.invite_relations (inviter_user_id, created_at desc);
create index invite_relations_code_idx on public.invite_relations (invite_code_id);
create index invite_relations_status_idx on public.invite_relations (status);

create trigger invite_relations_set_updated_at
before update on public.invite_relations
for each row execute function public.v3a_set_updated_at();

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  operator_user_id uuid not null references public.users(id) on delete restrict,
  role text not null,
  status text not null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text not null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_audit_logs_role_check check (role = 'super_admin'),
  constraint admin_audit_logs_status_check check (status in ('success', 'failed')),
  constraint admin_audit_logs_action_check
    check (action in (
      'approve_application',
      'reject_application',
      'freeze_user',
      'unfreeze_user',
      'grant_credit',
      'deduct_credit',
      'mark_invite_risk',
      'clear_invite_risk',
      'system_adjust'
    )),
  constraint admin_audit_logs_target_type_check
    check (target_type in ('user', 'wallet', 'application', 'invite_relation', 'credit_log')),
  constraint admin_audit_logs_sensitive_reason_check
    check (
      action not in ('reject_application', 'freeze_user', 'grant_credit', 'deduct_credit', 'mark_invite_risk')
      or length(btrim(reason)) > 0
    )
);

comment on table public.admin_audit_logs is
  'Emma/super_admin audit trail. Browser clients must not directly insert high-privilege audit logs.';

create index admin_audit_logs_operator_created_at_idx on public.admin_audit_logs (operator_user_id, created_at desc);
create index admin_audit_logs_user_created_at_idx on public.admin_audit_logs (user_id, created_at desc);
create index admin_audit_logs_target_idx on public.admin_audit_logs (target_type, target_id);
create index admin_audit_logs_action_created_at_idx on public.admin_audit_logs (action, created_at desc);

create trigger admin_audit_logs_set_updated_at
before update on public.admin_audit_logs
for each row execute function public.v3a_set_updated_at();

create trigger admin_audit_logs_no_update
before update on public.admin_audit_logs
for each row execute function public.v3a_prevent_admin_audit_log_mutation();

create trigger admin_audit_logs_no_delete
before delete on public.admin_audit_logs
for each row execute function public.v3a_prevent_admin_audit_log_mutation();

create table public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  role text,
  status text not null,
  login_method text not null,
  ip_address inet,
  user_agent text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint login_events_role_check
    check (role is null or role in ('super_admin', 'advisor', 'agent', 'center', 'pending')),
  constraint login_events_status_check check (status in ('success', 'failed', 'blocked')),
  constraint login_events_login_method_check
    check (login_method in ('email', 'phone', 'wechat', 'magic_link', 'oauth')),
  constraint login_events_failure_reason_check
    check (status = 'success' or failure_reason is not null)
);

create index login_events_user_created_at_idx on public.login_events (user_id, created_at desc);
create index login_events_auth_user_created_at_idx on public.login_events (auth_user_id, created_at desc);
create index login_events_status_created_at_idx on public.login_events (status, created_at desc);
create index login_events_ip_created_at_idx on public.login_events (ip_address, created_at desc);

create trigger login_events_set_updated_at
before update on public.login_events
for each row execute function public.v3a_set_updated_at();

create table public.application_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reviewer_user_id uuid references public.users(id) on delete set null,
  role text not null,
  status text not null default 'pending',
  applied_city text not null,
  applied_name text,
  applied_nickname text not null,
  practitioner_type text not null,
  organization_name text,
  invite_code text,
  application_note text,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_reviews_role_check
    check (role in ('advisor', 'agent', 'center')),
  constraint application_reviews_status_check
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint application_reviews_practitioner_type_check
    check (practitioner_type in ('independent', 'organization', 'agent', 'center', 'other')),
  constraint application_reviews_review_consistency_check
    check (
      (status in ('approved', 'rejected') and reviewer_user_id is not null and reviewed_at is not null)
      or status not in ('approved', 'rejected')
    )
);

create unique index application_reviews_active_review_unique_idx
  on public.application_reviews (user_id)
  where status in ('pending', 'approved');
create index application_reviews_reviewer_created_at_idx on public.application_reviews (reviewer_user_id, created_at desc);
create index application_reviews_status_created_at_idx on public.application_reviews (status, created_at desc);
create index application_reviews_role_status_idx on public.application_reviews (role, status);
create index application_reviews_invite_code_idx on public.application_reviews (invite_code) where invite_code is not null;

create trigger application_reviews_set_updated_at
before update on public.application_reviews
for each row execute function public.v3a_set_updated_at();

alter table public.users enable row level security;
alter table public.advisor_profiles enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_logs enable row level security;
alter table public.invite_codes enable row level security;
alter table public.invite_relations enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.login_events enable row level security;
alter table public.application_reviews enable row level security;
