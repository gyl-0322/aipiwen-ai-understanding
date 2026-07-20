-- AIPIWEN V3a Preview auto activation for ordinary advisors.
--
-- This migration defines schema rules and one authenticated RPC for the new
-- ordinary-advisor path. It does not update existing pending institution
-- applications and does not create wallets, credits, or invite codes by itself.

begin;

alter table public.application_reviews
  drop constraint if exists application_reviews_review_consistency_check;

alter table public.application_reviews
  add constraint application_reviews_review_consistency_check
  check (
    (
      status = 'approved'
      and reviewed_at is not null
      and (
        reviewer_user_id is not null
        or application_note like '%AUTO_ACTIVATE_ADVISOR%'
      )
    )
    or (
      status = 'rejected'
      and reviewer_user_id is not null
      and reviewed_at is not null
    )
    or status not in ('approved', 'rejected')
  );

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
        and nullif(details ->> 'user_id', '') is not null
      then action || ':' || ((details ->> 'user_id')::uuid::text)
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
      and idempotency_key is not null
      and idempotency_key =
        'AUTO_ACTIVATE_ADVISOR:' || ((details ->> 'user_id')::uuid::text)
    )
  );

create unique index admin_audit_logs_idempotency_key_uidx
  on public.admin_audit_logs (idempotency_key)
  where idempotency_key is not null;

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

create or replace function public.v3a_credit_logs_require_approved_application()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_application_key text;
  v_application_id uuid;
begin
  if new.type <> 'REGISTER_BONUS' then
    return new;
  end if;

  if new.idempotency_key is null
    or new.idempotency_key !~
      '^REGISTER_BONUS:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|AUTO_ADVISOR_ACTIVATION)$' then
    raise exception using
      errcode = '23514',
      message = 'REGISTER_BONUS_REQUIRES_APPROVED_APPLICATION';
  end if;

  v_application_key := split_part(new.idempotency_key, ':', 3);

  if v_application_key = 'AUTO_ADVISOR_ACTIVATION' then
    if not exists (
      select 1
      from public.application_reviews review
      where review.user_id = new.user_id
        and review.role = 'advisor'
        and review.status = 'approved'
        and review.application_note like '%AUTO_ACTIVATE_ADVISOR%'
    ) then
      raise exception using
        errcode = '23514',
        message = 'REGISTER_BONUS_REQUIRES_APPROVED_APPLICATION';
    end if;
    return new;
  end if;

  v_application_id := v_application_key::uuid;

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
  v_application_note text;
  v_user public.users%rowtype;
  v_profile public.advisor_profiles%rowtype;
  v_review public.application_reviews%rowtype;
  v_user_id uuid;
  v_profile_id uuid;
  v_application_id uuid;
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
  v_audit_action text;
  v_audit_target_id uuid;
  v_audit_details jsonb;
  v_reviewed_at timestamptz := now();
  v_affected_rows integer;
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

  v_application_note := concat_ws(
    '; ',
    case when v_application_identity = 'ordinary_advisor'
      then '申请身份：普通指导师'
      else '申请身份：普通指导师基础账号'
    end,
    case when v_practitioner_type = 'other'
      then '从业类型补充：' || v_practitioner_type_note
      else null
    end,
    'AUTO_ACTIVATE_ADVISOR',
    '普通指导师账号自动开通'
  );

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

  if v_phone is null and v_email is null then
    raise exception using errcode = '22023', message = 'AUTH_IDENTITY_NOT_VERIFIED';
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
      v_reviewed_at
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
    v_profile_id := v_profile.id;
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
      v_reviewed_at
    )
    returning * into v_profile;
    v_profile_id := v_profile.id;
  end if;

  select review.*
  into v_review
  from public.application_reviews review
  where review.user_id = v_user_id
  order by review.created_at asc
  limit 1
  for update;

  if found then
    if v_review.status <> 'approved'
      or v_review.role <> 'advisor'
      or v_review.application_note not like '%AUTO_ACTIVATE_ADVISOR%' then
      raise exception using errcode = '55000', message = 'ACCOUNT_NOT_ELIGIBLE_FOR_AUTO_ACTIVATION';
    end if;
    v_application_id := v_review.id;
  else
    insert into public.application_reviews (
      user_id,
      role,
      status,
      applied_city,
      applied_nickname,
      practitioner_type,
      invite_code,
      application_note,
      review_note,
      reviewed_at
    ) values (
      v_user_id,
      'advisor',
      'approved',
      v_city,
      v_display_name,
      v_practitioner_type,
      v_invite_code_input,
      v_application_note,
      '普通指导师账号自动开通',
      v_reviewed_at
    )
    returning * into v_review;
    v_application_id := v_review.id;
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

  if v_wallet_balance is distinct from 500 and not v_register_bonus_exists then
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
      'user_id', v_user_id,
      'application_id', v_application_id,
      'wallet_id', v_wallet_id,
      'credit_log_id', v_credit_log_id,
      'invite_code', v_existing_invite_code,
      'user_visible_note', '普通指导师账号自动开通'
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
    or v_audit_details ->> 'source' is distinct from 'phone_verified_auto_activation' then
    raise exception using errcode = 'P0001', message = 'INCOMPLETE_AUTO_ACTIVATION_STATE';
  end if;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'user_id', v_user_id,
      'user_status', 'active',
      'role', 'advisor',
      'application_id', v_application_id,
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
      'AUTH_USER_NOT_FOUND',
      'AUTH_USER_UNAVAILABLE',
      'AUTH_PHONE_NOT_VERIFIED',
      'AUTH_PHONE_NOT_SUPPORTED',
      'AUTH_PHONE_CLAIM_MISMATCH',
      'AUTH_IDENTITY_NOT_VERIFIED',
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
  'Auto-activates the current verified-phone Auth user as an ordinary advisor; creates approved auto application, wallet, one 500-point register bonus, one invite code, and AUTO_ACTIVATE_ADVISOR audit log in one transaction.';

revoke all on function public.v3a_auto_activate_advisor(
  text, text, text, text, boolean, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.v3a_auto_activate_advisor(
  text, text, text, text, boolean, text, text, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
