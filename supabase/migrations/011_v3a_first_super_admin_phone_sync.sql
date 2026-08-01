-- Synchronize the verified phone of the 009 first super_admin into public.users.
--
-- The function accepts no identity or phone argument. It derives both from the
-- authenticated Supabase identity, requires the immutable FIRST_SUPER_ADMIN
-- audit marker, and updates only that user's previously-null phone mapping.

begin;

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_action_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check
    check (action in (
      'APPROVE_APPLICATION',
      'REJECT_APPLICATION',
      'FREEZE_USER',
      'UNFREEZE_USER',
      'MANUAL_GRANT_CREDITS',
      'MANUAL_DEDUCT_CREDITS',
      'FIRST_SUPER_ADMIN',
      'BIND_SUPER_ADMIN_PHONE'
    ));

create function public.v3a_sync_own_first_super_admin_phone()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_claims jsonb;
  v_auth_user_id uuid;
  v_auth jsonb;
  v_auth_phone text;
  v_jwt_phone text;
  v_auth_email text;
  v_user public.users%rowtype;
  v_audit_log_id uuid;
begin
  v_claims := coalesce(auth.jwt(), '{}'::jsonb);
  v_auth_user_id := auth.uid();

  if coalesce(auth.role(), '') <> 'authenticated'
    or v_auth_user_id is null
    or nullif(v_claims ->> 'sub', '') is distinct from v_auth_user_id::text
    or nullif(v_claims ->> 'role', '') is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('v3a_sync_own_first_super_admin_phone'),
    hashtext(v_auth_user_id::text)
  );

  select to_jsonb(auth_user)
  into v_auth
  from auth.users auth_user
  where auth_user.id = v_auth_user_id
  for update;

  if v_auth is null
    or coalesce((v_auth ->> 'is_anonymous')::boolean, false)
    or nullif(v_auth ->> 'deleted_at', '') is not null
    or (
      nullif(v_auth ->> 'banned_until', '') is not null
      and (v_auth ->> 'banned_until')::timestamptz > now()
    ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_UNAVAILABLE';
  end if;

  v_auth_phone := nullif(btrim(coalesce(v_auth ->> 'phone', '')), '');
  v_jwt_phone := nullif(btrim(coalesce(v_claims ->> 'phone', '')), '');
  if nullif(v_auth ->> 'phone_confirmed_at', '') is null
    or v_auth_phone is null
    or v_auth_phone !~ '^[+]861[3-9][0-9]{9}$' then
    raise exception using errcode = '22023', message = 'AUTH_PHONE_NOT_VERIFIED';
  end if;
  if v_jwt_phone is distinct from v_auth_phone then
    raise exception using errcode = '22023', message = 'AUTH_PHONE_CLAIM_MISMATCH';
  end if;

  v_auth_email := nullif(btrim(coalesce(v_auth ->> 'email', '')), '');
  if nullif(v_auth ->> 'email_confirmed_at', '') is null or v_auth_email is null then
    raise exception using errcode = '22023', message = 'AUTH_EMAIL_NOT_VERIFIED';
  end if;

  select users_row.*
  into v_user
  from public.users users_row
  where users_row.auth_user_id = v_auth_user_id
  for update;

  if not found
    or v_user.role <> 'super_admin'
    or v_user.status <> 'active'
    or v_user.email is null
    or lower(v_user.email) <> lower(v_auth_email)
    or not exists (
      select 1
      from public.admin_audit_logs audit
      where audit.action = 'FIRST_SUPER_ADMIN'
        and audit.admin_id = v_user.id
        and audit.target_id = v_user.id
        and audit.details ->> 'auth_user_id' = v_auth_user_id::text
    ) then
    raise exception using errcode = '42501', message = 'FIRST_SUPER_ADMIN_REQUIRED';
  end if;

  if v_user.phone is not null then
    if v_user.phone is distinct from v_auth_phone then
      raise exception using errcode = '55000', message = 'IDENTITY_MAPPING_CONFLICT';
    end if;
    select audit.id
    into v_audit_log_id
    from public.admin_audit_logs audit
    where audit.action = 'BIND_SUPER_ADMIN_PHONE'
      and audit.admin_id = v_user.id
      and audit.target_id = v_user.id
    order by audit.created_at
    limit 1;
    if v_audit_log_id is null then
      insert into public.admin_audit_logs (
        admin_id,
        action,
        target_type,
        target_id,
        details
      ) values (
        v_user.id,
        'BIND_SUPER_ADMIN_PHONE',
        'user',
        v_user.id,
        jsonb_build_object(
          'user_id', v_user.id,
          'auth_user_id', v_auth_user_id
        )
      )
      returning id into v_audit_log_id;
    end if;
    return jsonb_build_object(
      'success', true,
      'already_synced', true,
      'user_id', v_user.id,
      'audit_log_id', v_audit_log_id
    );
  end if;

  if exists (
    select 1
    from public.users other_user
    where other_user.phone = v_auth_phone
      and other_user.id <> v_user.id
  ) then
    raise exception using errcode = '23505', message = 'PHONE_ALREADY_MAPPED';
  end if;

  update public.users
  set phone = v_auth_phone
  where id = v_user.id
    and phone is null;

  if not found then
    raise exception using errcode = '55000', message = 'IDENTITY_MAPPING_CONFLICT';
  end if;

  insert into public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_user.id,
    'BIND_SUPER_ADMIN_PHONE',
    'user',
    v_user.id,
    jsonb_build_object(
      'user_id', v_user.id,
      'auth_user_id', v_auth_user_id
    )
  )
  returning id into v_audit_log_id;

  return jsonb_build_object(
    'success', true,
    'already_synced', false,
    'user_id', v_user.id,
    'audit_log_id', v_audit_log_id
  );
end;
$$;

revoke all on function public.v3a_sync_own_first_super_admin_phone()
  from public, anon, authenticated, service_role;
grant execute on function public.v3a_sync_own_first_super_admin_phone()
  to authenticated;

comment on function public.v3a_sync_own_first_super_admin_phone() is
  'Synchronizes the verified Auth phone into the same 009 first-super-admin public.users row. No phone or user argument is accepted.';

commit;
