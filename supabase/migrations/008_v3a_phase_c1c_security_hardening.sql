-- AIPIWEN V3a Phase C1-C final security and idempotency hardening.
--
-- This migration is intentionally limited to the Phase C1-C boundary:
-- helper/RPC privileges, active-workbench asset RLS, and database-level
-- uniqueness for invites, review audits, and the 500-point registration bonus.

begin;

-- SECURITY DEFINER helpers are implementation details of authenticated RLS.
-- Anonymous clients need none of them. Only the three helpers referenced by
-- final authenticated policies remain callable by authenticated.
alter function public.v3a_current_user_id() set search_path = public, pg_temp;
alter function public.v3a_current_role() set search_path = public, pg_temp;
alter function public.v3a_current_status() set search_path = public, pg_temp;
alter function public.v3a_is_super_admin() set search_path = public, pg_temp;

revoke all on function public.v3a_current_user_id()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_current_role()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_current_status()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_is_super_admin()
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_bootstrap_first_super_admin(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.v3a_current_user_id()
  to authenticated;
grant execute on function public.v3a_current_status()
  to authenticated;
grant execute on function public.v3a_is_super_admin()
  to authenticated;

-- Active workbench assets are read-only from the browser. Pending, rejected,
-- inactive, and anonymous users cannot read them. Active super_admin users
-- retain the management read scope established by Phase C.
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

-- Define the server API table ACL explicitly instead of depending on the
-- project's "automatically expose new tables" setting. The current admin API
-- reads these four tables, while all review writes must go through the RPCs.
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

drop policy if exists v3a_credit_wallets_read_own on public.credit_wallets;
drop policy if exists v3a_credit_logs_read_own on public.credit_logs;
drop policy if exists v3a_invite_codes_read_active_own on public.invite_codes;

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

-- A user may own exactly one invite code for all time. Existing duplicates
-- make this migration fail explicitly; no row is deleted or rewritten.
alter table public.invite_codes
  add constraint invite_codes_user_id_key unique (user_id);

-- Review audit keys are derived from immutable action/application identity.
-- The column is nullable for unrelated audit actions.
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

-- The Phase C1-C registration reward remains exactly +500, with the frozen
-- user/application key shape. Existing idempotency_key uniqueness is retained.
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

alter table public.application_reviews
  validate constraint application_reviews_rejection_reason_check;

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

commit;
