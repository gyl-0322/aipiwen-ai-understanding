-- AIPIWEN V3a Phase C1-C atomic application review transactions.
--
-- This migration does not review any application or create business data.
-- Each RPC call is one PostgreSQL transaction: an uncaught error rolls back
-- every write performed by the function.

alter table public.application_reviews
  add column if not exists rejection_reason text;

-- A rejected application keeps the public user role as pending. The requested
-- practitioner role is promoted only by v3a_approve_application().
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

create unique index if not exists invite_codes_one_active_per_user_idx
  on public.invite_codes (user_id)
  where status = 'active';

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
  v_user_role text;
  v_user_status text;
  v_profile_role text;
  v_profile_status text;
  v_wallet_id uuid;
  v_wallet_balance integer;
  v_credit_log_id uuid;
  v_credit_log_type text;
  v_credit_log_amount integer;
  v_existing_invite_code text;
  v_audit_log_id uuid;
  v_idempotency_key text;
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

  select review.user_id, review.role, review.status
  into v_application_user_id, v_application_role, v_application_status
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

    select credit.id, credit.type, credit.amount
    into v_credit_log_id, v_credit_log_type, v_credit_log_amount
    from public.credit_logs credit
    where credit.idempotency_key = v_idempotency_key;

    select invite.code
    into v_existing_invite_code
    from public.invite_codes invite
    where invite.user_id = v_application_user_id
      and invite.status = 'active';

    select audit.id
    into v_audit_log_id
    from public.admin_audit_logs audit
    where audit.action = 'APPROVE_APPLICATION'
      and audit.target_id = v_application_user_id
      and audit.details ->> 'application_id' = p_application_id::text
    order by audit.created_at desc
    limit 1;

    if v_wallet_id is null
      or v_wallet_balance is distinct from 500
      or v_credit_log_id is null
      or v_credit_log_type is distinct from 'REGISTER_BONUS'
      or v_credit_log_amount is distinct from 500
      or v_existing_invite_code is null
      or v_audit_log_id is null then
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

  v_expected_prefix := case v_application_role
    when 'advisor' then 'ADV'
    when 'agent' then 'AGT'
    when 'center' then 'CTR'
    else null
  end;

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

  insert into public.credit_wallets (user_id, balance)
  values (v_application_user_id, 500)
  returning id, balance into v_wallet_id, v_wallet_balance;

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
  returning id, type, amount
  into v_credit_log_id, v_credit_log_type, v_credit_log_amount;

  begin
    insert into public.invite_codes (code, user_id, role, status)
    values (p_invite_code, v_application_user_id, v_application_role, 'active')
    returning code into v_existing_invite_code;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'INVITE_CODE_CONFLICT';
  end;

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
  returning id into v_audit_log_id;

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
  v_user_role text;
  v_user_status text;
  v_profile_role text;
  v_profile_status text;
  v_audit_log_id uuid;
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

  select review.user_id, review.role, review.status
  into v_application_user_id, v_application_role, v_application_status
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

    select audit.id
    into v_audit_log_id
    from public.admin_audit_logs audit
    where audit.action = 'REJECT_APPLICATION'
      and audit.target_id = v_application_user_id
      and audit.details ->> 'application_id' = p_application_id::text
    order by audit.created_at desc
    limit 1;

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
  returning id into v_audit_log_id;

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
