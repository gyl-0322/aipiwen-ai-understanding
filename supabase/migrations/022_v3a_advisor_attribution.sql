-- AIPIWEN Phase B-1 advisor attribution and client assignment foundation.
-- Review artifact only. Do not execute in Preview or Production without separate authorization.

begin;

-- Phase A must already be complete. Lock the affected tables so the assertions and
-- constraint replacement describe one stable database state.
do $$
begin
  if to_regclass('public.advisor_clients') is null
     or to_regclass('public.advisor_reports') is null
     or to_regclass('public.admin_audit_logs') is null
     or to_regprocedure('public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)') is null
     or to_regprocedure('public.v3a_complete_advisor_report_import(uuid,boolean,jsonb,text)') is null then
    raise exception 'MIGRATION_022_REQUIRES_PHASE_A';
  end if;
  if to_regclass('public.attribution_tokens') is not null then
    raise exception 'MIGRATION_022_ALREADY_APPLIED';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisor_clients'
      and column_name in ('assigned_by_user_id', 'assigned_at')
  ) then
    raise exception 'MIGRATION_022_PARTIAL_CLIENT_COLUMNS';
  end if;
end
$$;

lock table public.users in share row exclusive mode;
lock table public.advisor_clients in share row exclusive mode;
lock table public.advisor_reports in share row exclusive mode;
lock table public.admin_audit_logs in share row exclusive mode;

create table public.attribution_tokens (
  id              uuid primary key default gen_random_uuid(),
  advisor_user_id uuid not null references public.users(id) on delete restrict,
  token           text not null unique,
  max_uses        integer not null default 1,
  used_count      integer not null default 0,
  expires_at      timestamptz not null default (now() + interval '24 hours'),
  status          text not null default 'active',
  created_at      timestamptz not null default now(),

  constraint attribution_tokens_token_check
    check (token ~ '^[0-9a-f]{32}$'),
  constraint attribution_tokens_max_uses_check
    check (max_uses between 1 and 100),
  constraint attribution_tokens_used_count_check
    check (used_count between 0 and max_uses),
  constraint attribution_tokens_status_check
    check (status in ('active', 'exhausted', 'revoked', 'expired'))
);

create index attribution_tokens_advisor_created_idx
  on public.attribution_tokens (advisor_user_id, created_at desc);
create index attribution_tokens_active_expiry_idx
  on public.attribution_tokens (expires_at)
  where status = 'active';

alter table public.attribution_tokens enable row level security;
revoke all on table public.attribution_tokens from public, anon, authenticated, service_role;

alter table public.advisor_clients
  drop constraint advisor_clients_source_check,
  alter column advisor_user_id drop not null,
  add column assigned_by_user_id uuid references public.users(id) on delete restrict,
  add column assigned_at timestamptz,
  add constraint advisor_clients_source_check
    check (source in ('invite_link', 'advisor_qr', 'advisor_import', 'unguided')),
  add constraint advisor_clients_assignment_shape_check
    check (
      (assigned_by_user_id is null and assigned_at is null)
      or (assigned_by_user_id is not null and assigned_at is not null)
    );

alter table public.advisor_reports
  drop constraint advisor_reports_source_check,
  add constraint advisor_reports_source_check
    check (source in ('invite_link', 'advisor_qr', 'advisor_import', 'unguided'));

-- A pure administrative attribution change is frozen to exactly three columns.
-- Keep the Phase A updated_at behavior for actual client-profile changes only.
drop trigger advisor_clients_set_updated_at on public.advisor_clients;
create trigger advisor_clients_set_updated_at
  before update on public.advisor_clients
  for each row
  when (
    old.auth_user_id is distinct from new.auth_user_id
    or old.source is distinct from new.source
    or old.display_name is distinct from new.display_name
    or old.birth_date is distinct from new.birth_date
    or old.note is distinct from new.note
    or old.archived_at is distinct from new.archived_at
  )
  execute function public.v3a_set_updated_at();

create index advisor_clients_unassigned_created_idx
  on public.advisor_clients (created_at desc)
  where source = 'unguided' and advisor_user_id is null and archived_at is null;

create function public.v3a_prevent_attribution_source_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.source is distinct from old.source then
    raise exception using errcode = 'P0001', message = 'SOURCE_IS_IMMUTABLE';
  end if;
  return new;
end
$$;

revoke all on function public.v3a_prevent_attribution_source_change()
  from public, anon, authenticated, service_role;

create trigger advisor_clients_source_immutable
  before update of source on public.advisor_clients
  for each row execute function public.v3a_prevent_attribution_source_change();

create trigger advisor_reports_source_immutable
  before update of source on public.advisor_reports
  for each row execute function public.v3a_prevent_attribution_source_change();

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
    'AUTO_ACTIVATE_ADVISOR',
    'ASSIGN_CLIENT'
  ));

create function public.v3a_create_attribution_token(p_max_uses integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_token text;
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
    begin
      insert into public.attribution_tokens (
        advisor_user_id, token, max_uses, expires_at
      ) values (
        v_advisor_id, v_token, p_max_uses, v_expires_at
      );
      exit;
    exception when unique_violation then
      -- Retry the independently generated opaque token.
    end;
  end loop;

  return jsonb_build_object(
    'token', v_token,
    'maxUses', p_max_uses,
    'expiresAt', v_expires_at
  );
end
$$;

create function public.v3a_validate_attribution_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_status text;
  v_max_uses integer;
  v_used_count integer;
  v_expires_at timestamptz;
  v_advisor_role text;
  v_advisor_status text;
  v_advisor_name text;
begin
  if v_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('valid', false, 'code', 'INVALID_ATTRIBUTION_TOKEN');
  end if;

  select t.status, t.max_uses, t.used_count, t.expires_at,
         u.role, u.status, coalesce(nullif(btrim(u.display_name), ''), 'AIPIWEN指导师')
  into v_status, v_max_uses, v_used_count, v_expires_at,
       v_advisor_role, v_advisor_status, v_advisor_name
  from public.attribution_tokens t
  join public.users u on u.id = t.advisor_user_id
  where t.token = v_token
  limit 1;

  if v_status is null then
    return jsonb_build_object('valid', false, 'code', 'INVALID_ATTRIBUTION_TOKEN');
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
    'advisorDisplayName', v_advisor_name,
    'expiresAt', v_expires_at,
    'remainingUses', v_max_uses - v_used_count
  );
end
$$;

create function public.v3a_store_attributed_report(
  p_token text,
  p_idempotency_key uuid,
  p_report_store_id text,
  p_display_name text,
  p_age_at_report integer,
  p_structured_input jsonb,
  p_generated_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token text := nullif(lower(btrim(coalesce(p_token, ''))), '');
  v_token_id uuid;
  v_advisor_id uuid;
  v_token_status text;
  v_max_uses integer;
  v_used_count integer;
  v_expires_at timestamptz;
  v_advisor_role text;
  v_advisor_status text;
  v_source text;
  v_client_id uuid;
  v_report_id uuid;
  v_existing_advisor_id uuid;
  v_existing_source text;
  v_existing_name text;
  v_existing_age integer;
  v_existing_input jsonb;
  v_existing_report jsonb;
  v_existing_store_id text;
  v_existing_token_id text;
  v_idempotent boolean := false;
begin
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_report_store_id is null or p_report_store_id !~ '^[0-9a-f]{8}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_REPORT_STORE_ID';
  end if;
  if nullif(btrim(p_display_name), '') is null or char_length(btrim(p_display_name)) > 40 then
    raise exception using errcode = 'P0001', message = 'INVALID_CLIENT_NAME';
  end if;
  if p_age_at_report is not null and (p_age_at_report < 0 or p_age_at_report > 120) then
    raise exception using errcode = 'P0001', message = 'INVALID_REPORT_AGE';
  end if;
  if jsonb_typeof(p_structured_input) is distinct from 'object' or p_structured_input = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'INVALID_STRUCTURED_INPUT';
  end if;
  if jsonb_typeof(p_generated_report) is distinct from 'object' or p_generated_report = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'INVALID_GENERATED_REPORT';
  end if;
  if v_token is not null and v_token !~ '^[0-9a-f]{32}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ATTRIBUTION_TOKEN';
  end if;

  if v_token is not null then
    select t.id, t.advisor_user_id, t.status, t.max_uses, t.used_count, t.expires_at,
           u.role, u.status
    into v_token_id, v_advisor_id, v_token_status, v_max_uses, v_used_count, v_expires_at,
         v_advisor_role, v_advisor_status
    from public.attribution_tokens t
    join public.users u on u.id = t.advisor_user_id
    where t.token = v_token
    for update of t;

    if v_token_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_ATTRIBUTION_TOKEN';
    end if;
    if v_advisor_role <> 'advisor' or v_advisor_status <> 'active' then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_ADVISOR_UNAVAILABLE';
    end if;
    v_source := 'advisor_qr';
  else
    v_source := 'unguided';
    v_advisor_id := null;
  end if;

  select r.id, c.id, c.advisor_user_id, c.source, c.display_name,
         r.age_at_report,
         r.structured_input - '_reportStoreId' - '_attributionTokenId',
         r.generated_report,
         r.structured_input ->> '_reportStoreId',
         r.structured_input ->> '_attributionTokenId'
  into v_report_id, v_client_id, v_existing_advisor_id, v_existing_source, v_existing_name,
       v_existing_age, v_existing_input, v_existing_report,
       v_existing_store_id, v_existing_token_id
  from public.advisor_reports r
  join public.advisor_clients c on c.id = r.advisor_client_id
  where r.idempotency_key = p_idempotency_key
  limit 1;

  if v_report_id is not null then
    if v_existing_advisor_id is distinct from v_advisor_id
       or v_existing_source is distinct from v_source
       or v_existing_name is distinct from btrim(p_display_name)
       or v_existing_age is distinct from p_age_at_report
       or v_existing_input is distinct from p_structured_input
       or v_existing_report is distinct from p_generated_report
       or v_existing_token_id is distinct from v_token_id::text then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    return jsonb_build_object(
      'clientId', v_client_id,
      'reportId', v_report_id,
      'reportStoreId', v_existing_store_id,
      'source', v_existing_source,
      'advisorUserId', v_existing_advisor_id,
      'idempotent', true
    );
  end if;

  if v_token_id is not null then
    if v_token_status = 'expired' or v_expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_TOKEN_EXPIRED';
    end if;
    if v_token_status = 'revoked' then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_TOKEN_REVOKED';
    end if;
    if v_token_status = 'exhausted' or v_used_count >= v_max_uses then
      raise exception using errcode = 'P0001', message = 'ATTRIBUTION_TOKEN_EXHAUSTED';
    end if;
    if v_token_status <> 'active' then
      raise exception using errcode = 'P0001', message = 'INVALID_ATTRIBUTION_TOKEN';
    end if;
  end if;

  begin
    insert into public.advisor_clients (
      advisor_user_id, source, display_name
    ) values (
      v_advisor_id, v_source, btrim(p_display_name)
    ) returning id into v_client_id;

    insert into public.advisor_reports (
      advisor_client_id,
      status,
      source,
      structured_input,
      generated_report,
      age_at_report,
      idempotency_key
    ) values (
      v_client_id,
      'ready',
      v_source,
      p_structured_input || jsonb_build_object(
        '_reportStoreId', p_report_store_id,
        '_attributionTokenId', v_token_id
      ),
      p_generated_report,
      p_age_at_report,
      p_idempotency_key
    ) returning id into v_report_id;
  exception when unique_violation then
    select r.id, c.id, c.advisor_user_id, c.source, c.display_name,
           r.age_at_report,
           r.structured_input - '_reportStoreId' - '_attributionTokenId',
           r.generated_report,
           r.structured_input ->> '_reportStoreId',
           r.structured_input ->> '_attributionTokenId'
    into v_report_id, v_client_id, v_existing_advisor_id, v_existing_source, v_existing_name,
         v_existing_age, v_existing_input, v_existing_report,
         v_existing_store_id, v_existing_token_id
    from public.advisor_reports r
    join public.advisor_clients c on c.id = r.advisor_client_id
    where r.idempotency_key = p_idempotency_key
    limit 1;

    if v_report_id is null
       or v_existing_advisor_id is distinct from v_advisor_id
       or v_existing_source is distinct from v_source
       or v_existing_name is distinct from btrim(p_display_name)
       or v_existing_age is distinct from p_age_at_report
       or v_existing_input is distinct from p_structured_input
       or v_existing_report is distinct from p_generated_report
       or v_existing_token_id is distinct from v_token_id::text then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    v_idempotent := true;
    p_report_store_id := v_existing_store_id;
  end;

  if v_token_id is not null and not v_idempotent then
    update public.attribution_tokens
    set used_count = used_count + 1,
        status = case when used_count + 1 >= max_uses then 'exhausted' else status end
    where id = v_token_id;
  end if;

  return jsonb_build_object(
    'clientId', v_client_id,
    'reportId', v_report_id,
    'reportStoreId', p_report_store_id,
    'source', v_source,
    'advisorUserId', v_advisor_id,
    'idempotent', v_idempotent
  );
end
$$;

create function public.v3a_assign_advisor_client(
  p_admin_user_id uuid,
  p_client_id uuid,
  p_target_advisor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_ok boolean;
  v_target_ok boolean;
  v_client_name text;
  v_client_source text;
  v_current_advisor_id uuid;
  v_assigned_at timestamptz := now();
  v_audit_id uuid;
begin
  if p_admin_user_id is null or p_client_id is null or p_target_advisor_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_ASSIGNMENT_REQUEST';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;
  if char_length(p_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'REASON_TOO_LONG';
  end if;

  select exists (
    select 1 from public.users u
    where u.id = p_admin_user_id
      and u.role = 'super_admin'
      and u.status = 'active'
  ) into v_admin_ok;
  if not v_admin_ok then
    raise exception using errcode = 'P0001', message = 'ASSIGN_CLIENT_FORBIDDEN';
  end if;

  select c.display_name, c.source, c.advisor_user_id
  into v_client_name, v_client_source, v_current_advisor_id
  from public.advisor_clients c
  where c.id = p_client_id
    and c.archived_at is null
  for update;

  if v_client_name is null then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
  end if;
  if v_current_advisor_id is not null then
    raise exception using errcode = 'P0001', message = 'CLIENT_ALREADY_ASSIGNED';
  end if;
  if v_client_source <> 'unguided' then
    raise exception using errcode = 'P0001', message = 'CLIENT_NOT_ASSIGNABLE';
  end if;

  select exists (
    select 1 from public.users u
    where u.id = p_target_advisor_user_id
      and u.role = 'advisor'
      and u.status = 'active'
  ) into v_target_ok;
  if not v_target_ok then
    raise exception using errcode = 'P0001', message = 'TARGET_ADVISOR_NOT_ACTIVE';
  end if;

  update public.advisor_clients
  set advisor_user_id = p_target_advisor_user_id,
      assigned_by_user_id = p_admin_user_id,
      assigned_at = v_assigned_at
  where id = p_client_id
    and advisor_user_id is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_ALREADY_ASSIGNED';
  end if;

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, details
  ) values (
    p_admin_user_id,
    'ASSIGN_CLIENT',
    'advisor_client',
    p_client_id,
    jsonb_build_object(
      'clientId', p_client_id,
      'clientName', v_client_name,
      'previousAdvisorId', v_current_advisor_id,
      'newAdvisorId', p_target_advisor_user_id,
      'reason', btrim(p_reason),
      'assignedAt', v_assigned_at
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'clientId', p_client_id,
    'advisorUserId', p_target_advisor_user_id,
    'assignedAt', v_assigned_at,
    'auditLogId', v_audit_id
  );
end
$$;

revoke all on function public.v3a_create_attribution_token(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_validate_attribution_token(text)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_assign_advisor_client(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

grant execute on function public.v3a_create_attribution_token(integer)
  to authenticated;
grant execute on function public.v3a_validate_attribution_token(text)
  to anon, authenticated;
grant execute on function public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)
  to service_role;
grant execute on function public.v3a_assign_advisor_client(uuid,uuid,uuid,text)
  to service_role;

comment on table public.attribution_tokens is
  'Opaque client-attribution tokens, independent from practitioner invite_codes.';
comment on column public.advisor_clients.source is
  'Immutable original source. Administrative assignment never changes this value.';
comment on function public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb) is
  'Atomically validates/consumes an attribution token and creates a ready client/report relation. No token creates an unguided relation.';
comment on function public.v3a_assign_advisor_client(uuid,uuid,uuid,text) is
  'Assigns one currently unassigned unguided client to one active advisor and appends ASSIGN_CLIENT audit evidence.';

-- Postflight: prove the intended schema and privilege surface before commit.
do $$
begin
  if to_regclass('public.attribution_tokens') is null
     or to_regprocedure('public.v3a_create_attribution_token(integer)') is null
     or to_regprocedure('public.v3a_validate_attribution_token(text)') is null
     or to_regprocedure('public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)') is null
     or to_regprocedure('public.v3a_assign_advisor_client(uuid,uuid,uuid,text)') is null then
    raise exception 'MIGRATION_022_POSTFLIGHT_OBJECTS_FAILED';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisor_clients'
      and column_name = 'advisor_user_id'
      and is_nullable = 'YES'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisor_clients'
      and column_name = 'assigned_by_user_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisor_clients'
      and column_name = 'assigned_at'
  ) then
    raise exception 'MIGRATION_022_POSTFLIGHT_CLIENT_COLUMNS_FAILED';
  end if;
  if has_table_privilege('anon', 'public.attribution_tokens', 'SELECT')
     or has_table_privilege('authenticated', 'public.attribution_tokens', 'SELECT')
     or has_table_privilege('authenticated', 'public.attribution_tokens', 'INSERT') then
    raise exception 'MIGRATION_022_POSTFLIGHT_TOKEN_TABLE_PRIVILEGES_FAILED';
  end if;
  if not has_function_privilege('authenticated', 'public.v3a_create_attribution_token(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.v3a_create_attribution_token(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.v3a_create_attribution_token(integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.v3a_validate_attribution_token(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.v3a_assign_advisor_client(uuid,uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.v3a_assign_advisor_client(uuid,uuid,uuid,text)', 'EXECUTE') then
    raise exception 'MIGRATION_022_POSTFLIGHT_RPC_PRIVILEGES_FAILED';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)',
      'EXECUTE'
    ) then
    raise exception 'MIGRATION_022_POSTFLIGHT_PHASE_A_PRIVILEGES_CHANGED';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'advisor_clients_source_immutable' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'advisor_reports_source_immutable' and not tgisinternal
  ) then
    raise exception 'MIGRATION_022_POSTFLIGHT_SOURCE_IMMUTABILITY_FAILED';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'advisor_clients_set_updated_at'
      and not tgisinternal
      and pg_get_triggerdef(oid) like '%auth_user_id%'
      and pg_get_triggerdef(oid) not like '%assigned_by_user_id%'
  ) then
    raise exception 'MIGRATION_022_POSTFLIGHT_ASSIGNMENT_COLUMNS_FAILED';
  end if;
end
$$;

commit;
