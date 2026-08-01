-- Fix the Supabase runtime schema resolution for service-code generation.
-- Review artifact only. Do not execute without separate Preview authorization.

begin;

do $$
begin
  if to_regclass('public.attribution_tokens') is null
     or to_regprocedure('public.v3a_create_attribution_token(integer)') is null
     or to_regprocedure('public.v3a_validate_attribution_service_code(text)') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'attribution_tokens'
         and column_name = 'service_code'
         and is_nullable = 'NO'
     ) then
    raise exception 'MIGRATION_026_REQUIRES_SERVICE_CODE_BASELINE';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'MIGRATION_026_REQUIRES_EXTENSIONS_RANDOM_BYTES';
  end if;
  if not exists (
    select 1
    from public.users
    where role = 'advisor'
      and status = 'active'
      and auth_user_id is not null
  ) then
    raise exception 'MIGRATION_026_REQUIRES_ACTIVE_ADVISOR_PROBE';
  end if;
end
$$;

create or replace function public.v3a_create_attribution_token(p_max_uses integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_token text;
  v_service_code text;
  v_expires_at timestamptz := now() + interval '24 hours';
begin
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_MAX_USES';
  end if;

  select u.id
  into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.role = 'advisor'
    and u.status = 'active'
  limit 1;

  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_FORBIDDEN';
  end if;

  loop
    v_token := replace(gen_random_uuid()::text, '-', '');
    v_service_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));
    begin
      insert into public.attribution_tokens (
        advisor_user_id, token, service_code, max_uses, expires_at
      ) values (
        v_advisor_id, v_token, v_service_code, p_max_uses, v_expires_at
      );
      exit;
    exception when unique_violation then
      -- Retry both independently generated capabilities.
    end;
  end loop;

  return jsonb_build_object(
    'token', v_token,
    'serviceCode', v_service_code,
    'maxUses', p_max_uses,
    'expiresAt', v_expires_at
  );
end
$$;

revoke all on function public.v3a_create_attribution_token(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.v3a_create_attribution_token(integer)
  to authenticated;

do $$
declare
  v_advisor_auth_id uuid;
  v_probe jsonb;
  v_probe_token text;
  v_deleted integer;
begin
  if position(
    'extensions.gen_random_bytes(5)'
    in pg_get_functiondef('public.v3a_create_attribution_token(integer)'::regprocedure)
  ) = 0 then
    raise exception 'MIGRATION_026_POSTFLIGHT_SCHEMA_QUALIFICATION_FAILED';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.v3a_create_attribution_token(integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.v3a_create_attribution_token(integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.v3a_create_attribution_token(integer)',
    'EXECUTE'
  ) then
    raise exception 'MIGRATION_026_POSTFLIGHT_PRIVILEGES_FAILED';
  end if;

  select auth_user_id
  into v_advisor_auth_id
  from public.users
  where role = 'advisor'
    and status = 'active'
    and auth_user_id is not null
  order by created_at, id
  limit 1;

  perform set_config('request.jwt.claim.sub', v_advisor_auth_id::text, true);
  v_probe := public.v3a_create_attribution_token(1);
  v_probe_token := v_probe ->> 'token';

  if v_probe_token !~ '^[0-9a-f]{32}$'
     or coalesce(v_probe ->> 'serviceCode', '') !~ '^[0-9A-F]{10}$' then
    raise exception 'MIGRATION_026_POSTFLIGHT_RUNTIME_RESULT_FAILED';
  end if;

  delete from public.attribution_tokens
  where token = v_probe_token;
  get diagnostics v_deleted = row_count;

  if v_deleted <> 1 or exists (
    select 1
    from public.attribution_tokens
    where token = v_probe_token
  ) then
    raise exception 'MIGRATION_026_POSTFLIGHT_RUNTIME_CLEANUP_FAILED';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
