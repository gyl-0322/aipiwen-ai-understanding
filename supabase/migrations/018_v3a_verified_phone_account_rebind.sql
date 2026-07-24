-- AIPIWEN V3a Preview repair: bind an already-opened business account to the
-- current verified Auth identity when Supabase has duplicate phone Auth users.
--
-- This does not create wallets, credit logs, invite codes, or applications.

begin;

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

commit;
