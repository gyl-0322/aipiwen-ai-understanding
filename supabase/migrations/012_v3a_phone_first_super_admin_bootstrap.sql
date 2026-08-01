-- AIPIWEN V3a phone-first bootstrap for the first Preview super_admin.
--
-- This owner-only function derives a verified China phone from auth.users and
-- atomically creates only the public.users super_admin mapping plus the
-- immutable FIRST_SUPER_ADMIN audit marker. It creates no advisor application
-- or wallet, credit, or invite data.

begin;

-- Remove the legacy 006 owner-only promotion path. It uses a different lock,
-- creates no FIRST_SUPER_ADMIN audit, and must not race this hardened path.
drop function if exists public.v3a_bootstrap_first_super_admin(uuid, text);

-- Phone is now the only supported first-admin identity. Remove the 009
-- email-era owner-only bootstrap while preserving 011 for already-created
-- historical administrators that still need to synchronize a verified phone.
drop function if exists public.v3a_create_first_super_admin_from_auth(uuid, text);

create function public.v3a_create_first_super_admin_from_phone_auth(
  p_user_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_auth jsonb;
  v_phone text;
  v_display_name text;
  v_public_user_id uuid;
  v_existing_display_name text;
  v_existing_phone text;
  v_audit_log_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'INVALID_AUTH_USER_ID';
  end if;

  v_display_name := btrim(coalesce(p_display_name, ''));
  if char_length(v_display_name) < 2
    or char_length(v_display_name) > 80
    or v_display_name ~ '[[:cntrl:]<>]' then
    raise exception using
      errcode = '22023',
      message = 'INVALID_DISPLAY_NAME';
  end if;

  -- Keep the established global lock key so every phone-first attempt is
  -- serialized against the same immutable first-admin marker.
  perform pg_advisory_xact_lock(
    hashtext('v3a_create_first_super_admin_from_auth')
  );

  select to_jsonb(auth_user)
  into v_auth
  from auth.users auth_user
  where auth_user.id = p_user_id
  for update;

  if v_auth is null then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_NOT_FOUND';
  end if;

  if nullif(v_auth ->> 'deleted_at', '') is not null
    or coalesce((v_auth ->> 'is_anonymous')::boolean, false)
    or (
      nullif(v_auth ->> 'banned_until', '') is not null
      and (v_auth ->> 'banned_until')::timestamptz > now()
    ) then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_UNAVAILABLE';
  end if;

  v_phone := nullif(btrim(coalesce(v_auth ->> 'phone', '')), '');
  if nullif(v_auth ->> 'phone_confirmed_at', '') is null
    or v_phone is null then
    raise exception using
      errcode = '22023',
      message = 'AUTH_PHONE_NOT_VERIFIED';
  end if;

  if v_phone !~ '^[+]861[3-9][0-9]{9}$' then
    raise exception using
      errcode = '22023',
      message = 'AUTH_PHONE_NOT_SUPPORTED';
  end if;

  select users_row.id, users_row.display_name, users_row.phone
  into v_public_user_id, v_existing_display_name, v_existing_phone
  from public.users users_row
  where users_row.auth_user_id = p_user_id
  for update;

  if v_public_user_id is not null then
    select audit.id
    into v_audit_log_id
    from public.admin_audit_logs audit
    where audit.idempotency_key =
      'FIRST_SUPER_ADMIN:' || v_public_user_id::text
      and audit.action = 'FIRST_SUPER_ADMIN'
      and audit.admin_id = v_public_user_id
      and audit.target_id = v_public_user_id
      and audit.details ->> 'auth_user_id' = p_user_id::text;

    if v_audit_log_id is not null
      and v_existing_phone is not distinct from v_phone
      and exists (
        select 1
        from public.users users_row
        where users_row.id = v_public_user_id
          and users_row.role = 'super_admin'
          and users_row.status = 'active'
      ) then
      return jsonb_build_object(
        'user_id', v_public_user_id,
        'display_name', v_existing_display_name,
        'role', 'super_admin',
        'status', 'active',
        'audit_log_id', v_audit_log_id,
        'already_initialized', true
      );
    end if;

    raise exception using
      errcode = '23505',
      message = 'PUBLIC_USER_MAPPING_ALREADY_EXISTS';
  end if;

  -- The 009 audit row remains the permanent closure marker even if the first
  -- administrator is later frozen or disabled.
  if exists (
    select 1
    from public.admin_audit_logs audit
    where audit.action = 'FIRST_SUPER_ADMIN'
  ) then
    raise exception using
      errcode = '55000',
      message = 'FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED';
  end if;

  if exists (
    select 1
    from public.users users_row
    where users_row.role = 'super_admin'
      and users_row.status = 'active'
  ) then
    raise exception using
      errcode = '55000',
      message = 'FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED';
  end if;

  if exists (
    select 1
    from public.users users_row
    where users_row.phone = v_phone
  ) then
    raise exception using
      errcode = '23505',
      message = 'PUBLIC_USER_PHONE_ALREADY_EXISTS';
  end if;

  v_public_user_id := gen_random_uuid();

  insert into public.users (
    id,
    auth_user_id,
    role,
    status,
    phone,
    email,
    display_name,
    city,
    source,
    approved_at,
    approved_by_user_id
  ) values (
    v_public_user_id,
    p_user_id,
    'super_admin',
    'active',
    v_phone,
    null,
    v_display_name,
    '未设置',
    'emma_created',
    now(),
    v_public_user_id
  );

  insert into public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_public_user_id,
    'FIRST_SUPER_ADMIN',
    'user',
    v_public_user_id,
    jsonb_build_object(
      'user_id', v_public_user_id,
      'auth_user_id', p_user_id
    )
  )
  returning id into v_audit_log_id;

  return jsonb_build_object(
    'user_id', v_public_user_id,
    'display_name', v_display_name,
    'role', 'super_admin',
    'status', 'active',
    'audit_log_id', v_audit_log_id,
    'already_initialized', false
  );
end;
$$;

revoke all on function public.v3a_create_first_super_admin_from_phone_auth(uuid, text)
  from public, anon, authenticated, service_role;

comment on function public.v3a_create_first_super_admin_from_phone_auth(uuid, text) is
  'Owner-only phone-first bootstrap that atomically creates the first active super_admin mapping and FIRST_SUPER_ADMIN audit from one verified Auth phone UUID.';

commit;
