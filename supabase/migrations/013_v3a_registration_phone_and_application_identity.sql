-- AIPIWEN V3a Preview registration hardening.
--
-- Fixes Supabase phone Auth rows that store China numbers as 86... instead of
-- +86... while keeping public.users.phone canonical. Also lets the application
-- form carry an optional channel identity without turning it into a required
-- system role.

begin;

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
    'branch_company', 'service_center', 'collection_center'
  ) and v_application_identity is not null then
    raise exception using errcode = '22023', message = 'INVALID_APPLICATION_IDENTITY';
  end if;

  if (v_application_identity is null and v_requested_role <> 'advisor')
    or (v_application_identity = 'branch_company' and v_requested_role <> 'agent')
    or (v_application_identity in ('service_center', 'collection_center')
      and v_requested_role <> 'center') then
    raise exception using errcode = '22023', message = 'INVALID_REQUESTED_ROLE';
  end if;

  if v_practitioner_type not in ('independent', 'organization', 'other') then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE';
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
      when 'branch_company' then '代理身份：分公司'
      when 'service_center' then '代理身份：服务中心'
      when 'collection_center' then '代理身份：采集中心'
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
        'application_identity', v_application_identity
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
      'application_identity', v_application_identity
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

create or replace function public.v3a_submit_pending_application(
  p_display_name text,
  p_city text,
  p_requested_role text,
  p_practitioner_type text,
  p_agreement_version text,
  p_accepted_rules boolean,
  p_invite_code text default null
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
    null
  );
end;
$$;

comment on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) is
  'Creates one pending users/profile/application set atomically from the current verified Supabase Auth identity; accepts 86/+86 Auth phone forms and optional application identity.';

revoke all on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) to authenticated;

revoke all on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text
) from public, anon, authenticated, service_role;

grant execute on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
