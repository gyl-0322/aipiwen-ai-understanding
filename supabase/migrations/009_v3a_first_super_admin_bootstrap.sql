-- AIPIWEN V3a Phase C1-C first super_admin bootstrap hardening.
--
-- Installs an owner-only path that creates the first public.users
-- super_admin mapping from an existing, verified Supabase Auth user. It does
-- not create an advisor application, profile, wallet, credit, invite, or login
-- record.

begin;

-- Extend the immutable audit-key derivation introduced by 008 without
-- changing the existing approve/reject key shapes or unique-index name.
drop index public.admin_audit_logs_idempotency_key_uidx;

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_review_idempotency_key_check,
  drop constraint admin_audit_logs_action_check,
  drop column idempotency_key;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check
    check (action in (
      'APPROVE_APPLICATION',
      'REJECT_APPLICATION',
      'FREEZE_USER',
      'UNFREEZE_USER',
      'MANUAL_GRANT_CREDITS',
      'MANUAL_DEDUCT_CREDITS',
      'FIRST_SUPER_ADMIN'
    )),
  add column idempotency_key text
    generated always as (
      case
        when action in ('APPROVE_APPLICATION', 'REJECT_APPLICATION')
          and nullif(details ->> 'application_id', '') is not null
        then action || ':' || ((details ->> 'application_id')::uuid::text)
        when action = 'FIRST_SUPER_ADMIN'
          and nullif(details ->> 'user_id', '') is not null
        then 'FIRST_SUPER_ADMIN:' || ((details ->> 'user_id')::uuid::text)
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
    ),
  add constraint admin_audit_logs_first_super_admin_key_check
    check (
      action <> 'FIRST_SUPER_ADMIN'
      or (
        idempotency_key is not null
        and target_type = 'user'
        and target_id = ((details ->> 'user_id')::uuid)
        and nullif(details ->> 'auth_user_id', '') is not null
        and idempotency_key =
          'FIRST_SUPER_ADMIN:' || ((details ->> 'user_id')::uuid::text)
      )
    );

create unique index admin_audit_logs_idempotency_key_uidx
  on public.admin_audit_logs (idempotency_key)
  where idempotency_key is not null;

create function public.v3a_create_first_super_admin_from_auth(
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
  v_email text;
  v_display_name text;
  v_public_user_id uuid;
  v_existing_display_name text;
  v_audit_log_id uuid;
  v_masked_email text;
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

  -- A single fixed transaction-scoped lock serializes every attempt, even
  -- when callers target different auth users.
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

  v_email := btrim(coalesce(v_auth ->> 'email', ''));

  if v_email = '' then
    raise exception using
      errcode = '22023',
      message = 'AUTH_EMAIL_REQUIRED';
  end if;

  if nullif(v_auth ->> 'email_confirmed_at', '') is null then
    raise exception using
      errcode = '22023',
      message = 'AUTH_EMAIL_NOT_VERIFIED';
  end if;

  if nullif(v_auth ->> 'deleted_at', '') is not null then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_UNAVAILABLE';
  end if;

  if nullif(v_auth ->> 'banned_until', '') is not null
    and (v_auth ->> 'banned_until')::timestamptz > now() then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_UNAVAILABLE';
  end if;

  if coalesce((v_auth ->> 'is_anonymous')::boolean, false) then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_UNAVAILABLE';
  end if;

  select users_row.id, users_row.display_name
  into v_public_user_id, v_existing_display_name
  from public.users users_row
  where users_row.auth_user_id = p_user_id
  for update;

  if v_public_user_id is not null then
    select audit.id
    into v_audit_log_id
    from public.admin_audit_logs audit
    where audit.idempotency_key =
      'FIRST_SUPER_ADMIN:' || v_public_user_id::text;

    if v_audit_log_id is not null
      and exists (
        select 1
        from public.users users_row
        where users_row.id = v_public_user_id
          and users_row.role = 'super_admin'
          and users_row.status = 'active'
      ) then
      v_masked_email :=
        case
          when position('@' in v_email) > 1 then
            left(split_part(v_email, '@', 1), 1)
              || '***@' || split_part(v_email, '@', 2)
          else '***'
        end;

      return jsonb_build_object(
        'user_id', v_public_user_id,
        'email', v_masked_email,
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

  -- The append-only first-admin audit is also the permanent closure marker.
  -- This prevents a second initialization if the original admin is later
  -- frozen or disabled.
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
    where lower(users_row.email) = lower(v_email)
  ) then
    raise exception using
      errcode = '23505',
      message = 'PUBLIC_USER_EMAIL_ALREADY_EXISTS';
  end if;

  v_public_user_id := gen_random_uuid();

  insert into public.users (
    id,
    auth_user_id,
    role,
    status,
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
    v_email,
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

  v_masked_email :=
    case
      when position('@' in v_email) > 1 then
        left(split_part(v_email, '@', 1), 1)
          || '***@' || split_part(v_email, '@', 2)
      else '***'
    end;

  return jsonb_build_object(
    'user_id', v_public_user_id,
    'email', v_masked_email,
    'display_name', v_display_name,
    'role', 'super_admin',
    'status', 'active',
    'audit_log_id', v_audit_log_id,
    'already_initialized', false
  );
end;
$$;

revoke all on function public.v3a_create_first_super_admin_from_auth(uuid, text)
  from public, anon, authenticated, service_role;

comment on function public.v3a_create_first_super_admin_from_auth(uuid, text) is
  'Owner-only bootstrap that atomically creates the first active super_admin mapping from an existing verified auth.users row and writes one idempotent audit row.';

commit;
