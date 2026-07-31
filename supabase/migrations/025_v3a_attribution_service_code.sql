-- AIPIWEN advisor attribution manual service-code fallback.
-- Review artifact only. Do not execute in Preview or Production without separate authorization.

begin;

do $$
begin
  if to_regclass('public.attribution_tokens') is null
     or to_regprocedure('public.v3a_create_attribution_token(integer)') is null
     or to_regprocedure('public.v3a_validate_attribution_token(text)') is null
     or to_regprocedure('public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)') is null then
    raise exception 'MIGRATION_025_REQUIRES_ATTRIBUTION_BASELINE';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attribution_tokens'
      and column_name = 'service_code'
  ) or to_regprocedure('public.v3a_validate_attribution_service_code(text)') is not null then
    raise exception 'MIGRATION_025_ALREADY_APPLIED_OR_PARTIAL';
  end if;
end
$$;

lock table public.users in share row exclusive mode;
lock table public.attribution_tokens in share row exclusive mode;

alter table public.attribution_tokens
  add column service_code text;

do $$
declare
  v_row record;
  v_service_code text;
begin
  for v_row in
    select id
    from public.attribution_tokens
    order by id
  loop
    loop
      v_service_code := upper(encode(gen_random_bytes(5), 'hex'));
      exit when not exists (
        select 1
        from public.attribution_tokens existing
        where existing.service_code = v_service_code
      );
    end loop;
    update public.attribution_tokens
    set service_code = v_service_code
    where id = v_row.id;
  end loop;
end
$$;

alter table public.attribution_tokens
  alter column service_code set not null,
  add constraint attribution_tokens_service_code_check
    check (service_code ~ '^[0-9A-F]{10}$'),
  add constraint attribution_tokens_service_code_key
    unique (service_code);

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
    v_service_code := upper(encode(gen_random_bytes(5), 'hex'));
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

create function public.v3a_validate_attribution_service_code(p_service_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_raw text := upper(btrim(coalesce(p_service_code, '')));
  v_service_code text;
  v_token text;
  v_status text;
  v_max_uses integer;
  v_used_count integer;
  v_expires_at timestamptz;
  v_advisor_role text;
  v_advisor_status text;
  v_advisor_name text;
begin
  if v_raw !~ '^[0-9A-F -]+$' then
    return jsonb_build_object('valid', false, 'code', 'INVALID_ATTRIBUTION_SERVICE_CODE');
  end if;
  v_service_code := replace(replace(v_raw, '-', ''), ' ', '');
  if v_service_code !~ '^[0-9A-F]{10}$' then
    return jsonb_build_object('valid', false, 'code', 'INVALID_ATTRIBUTION_SERVICE_CODE');
  end if;

  select t.token, t.status, t.max_uses, t.used_count, t.expires_at,
         u.role, u.status, coalesce(nullif(btrim(u.display_name), ''), 'AIPIWEN指导师')
  into v_token, v_status, v_max_uses, v_used_count, v_expires_at,
       v_advisor_role, v_advisor_status, v_advisor_name
  from public.attribution_tokens t
  join public.users u on u.id = t.advisor_user_id
  where t.service_code = v_service_code
  limit 1;

  if v_status is null then
    return jsonb_build_object('valid', false, 'code', 'INVALID_ATTRIBUTION_SERVICE_CODE');
  end if;
  if v_advisor_role <> 'advisor' or v_advisor_status <> 'active' then
    return jsonb_build_object('valid', false, 'code', 'ATTRIBUTION_ADVISOR_UNAVAILABLE');
  end if;
  if v_status = 'revoked' then
    return jsonb_build_object('valid', false, 'code', 'ATTRIBUTION_TOKEN_REVOKED');
  end if;
  if v_status = 'expired' or v_expires_at <= now() then
    return jsonb_build_object('valid', false, 'code', 'ATTRIBUTION_TOKEN_EXPIRED');
  end if;
  if v_status = 'exhausted' or v_used_count >= v_max_uses then
    return jsonb_build_object('valid', false, 'code', 'ATTRIBUTION_TOKEN_EXHAUSTED');
  end if;

  return jsonb_build_object(
    'valid', true,
    'attributionToken', v_token,
    'advisorDisplayName', v_advisor_name,
    'expiresAt', v_expires_at,
    'remainingUses', v_max_uses - v_used_count
  );
end
$$;

revoke all on function public.v3a_create_attribution_token(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_validate_attribution_service_code(text)
  from public, anon, authenticated, service_role;

grant execute on function public.v3a_create_attribution_token(integer)
  to authenticated;
grant execute on function public.v3a_validate_attribution_service_code(text)
  to anon, authenticated;

comment on column public.attribution_tokens.service_code is
  'Short-lived manual fallback for the same opaque attribution token; independent from practitioner invite_codes.';
comment on function public.v3a_validate_attribution_service_code(text) is
  'Validates a short-lived customer service code and exchanges it for the same one-use attribution capability used by the QR path.';

do $$
begin
  if to_regprocedure('public.v3a_validate_attribution_service_code(text)') is null then
    raise exception 'MIGRATION_025_POSTFLIGHT_FUNCTION_FAILED';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attribution_tokens'
      and column_name = 'service_code'
      and is_nullable = 'NO'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.attribution_tokens'::regclass
      and conname = 'attribution_tokens_service_code_check'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.attribution_tokens'::regclass
      and conname = 'attribution_tokens_service_code_key'
  ) then
    raise exception 'MIGRATION_025_POSTFLIGHT_SCHEMA_FAILED';
  end if;
  if exists (
    select 1
    from public.attribution_tokens
    where service_code !~ '^[0-9A-F]{10}$'
  ) or (
    select count(*) from public.attribution_tokens
  ) <> (
    select count(distinct service_code) from public.attribution_tokens
  ) then
    raise exception 'MIGRATION_025_POSTFLIGHT_DATA_FAILED';
  end if;
  if not has_function_privilege('authenticated', 'public.v3a_create_attribution_token(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.v3a_create_attribution_token(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.v3a_create_attribution_token(integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.v3a_validate_attribution_service_code(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.v3a_validate_attribution_service_code(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.v3a_validate_attribution_service_code(text)', 'EXECUTE') then
    raise exception 'MIGRATION_025_POSTFLIGHT_PRIVILEGES_FAILED';
  end if;
  if has_table_privilege('anon', 'public.attribution_tokens', 'SELECT')
     or has_table_privilege('authenticated', 'public.attribution_tokens', 'SELECT')
     or has_table_privilege('service_role', 'public.attribution_tokens', 'SELECT') then
    raise exception 'MIGRATION_025_POSTFLIGHT_TABLE_PRIVILEGES_FAILED';
  end if;
end
$$;

commit;
