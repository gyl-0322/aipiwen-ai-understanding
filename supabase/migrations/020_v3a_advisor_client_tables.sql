-- AIPIWEN V3a advisor report import foundation.
-- Phase A artifact only. Review before executing in Preview.
-- Creates no business rows and must not be executed in Production without a separate authorization.

begin;

-- Fail before any DDL when the V3a identity/RLS helpers are unavailable.
do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'MIGRATION_020_REQUIRES_USERS';
  end if;
  if to_regprocedure('public.v3a_set_updated_at()') is null
     or to_regprocedure('public.v3a_current_user_id()') is null
     or to_regprocedure('public.v3a_current_role()') is null
     or to_regprocedure('public.v3a_current_status()') is null
     or to_regprocedure('public.v3a_is_super_admin()') is null then
    raise exception 'MIGRATION_020_REQUIRES_V3A_HELPERS';
  end if;
end
$$;

create table public.advisor_clients (
  id                 uuid primary key default gen_random_uuid(),
  advisor_user_id    uuid not null references public.users(id) on delete restrict,
  auth_user_id       uuid references auth.users(id) on delete set null,
  source             text not null,
  display_name       text not null,
  birth_date         date,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,

  constraint advisor_clients_source_check
    check (source in ('invite_link', 'advisor_qr', 'advisor_import')),
  constraint advisor_clients_display_name_length_check
    check (char_length(btrim(display_name)) between 1 and 40),
  constraint advisor_clients_note_length_check
    check (note is null or char_length(note) <= 200)
);

create index advisor_clients_active_by_advisor_idx
  on public.advisor_clients (advisor_user_id, created_at desc)
  where archived_at is null;

create trigger advisor_clients_set_updated_at
  before update on public.advisor_clients
  for each row execute function public.v3a_set_updated_at();

comment on table public.advisor_clients is
  'Advisor-owned client records. Authenticated users receive read-only table access; writes use the guarded import RPC.';
comment on column public.advisor_clients.auth_user_id is
  'Reserved for a separately reviewed future client-account binding flow.';

create table public.advisor_reports (
  id                  uuid primary key default gen_random_uuid(),
  advisor_client_id   uuid not null references public.advisor_clients(id) on delete restrict,
  status              text not null default 'generating',
  source              text not null,
  source_file_path    text,
  structured_input    jsonb not null,
  generated_report    jsonb,
  age_at_report       integer,
  idempotency_key     uuid not null,
  error_code          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint advisor_reports_status_check
    check (status in ('draft', 'reviewed', 'generating', 'ready', 'failed')),
  constraint advisor_reports_source_check
    check (source in ('invite_link', 'advisor_qr', 'advisor_import')),
  constraint advisor_reports_idempotency_key_unique
    unique (idempotency_key),
  constraint advisor_reports_age_at_report_check
    check (age_at_report is null or age_at_report between 0 and 120),
  constraint advisor_reports_source_file_path_length_check
    check (source_file_path is null or char_length(source_file_path) <= 512),
  constraint advisor_reports_structured_input_check
    check (jsonb_typeof(structured_input) = 'object' and structured_input <> '{}'::jsonb),
  constraint advisor_reports_error_code_check
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint advisor_reports_result_state_check
    check (
      (status = 'ready' and generated_report is not null and jsonb_typeof(generated_report) = 'object' and generated_report <> '{}'::jsonb and error_code is null)
      or (status = 'failed' and generated_report is null and error_code is not null)
      or (status in ('draft', 'reviewed', 'generating') and generated_report is null and error_code is null)
    )
);

create index advisor_reports_client_created_idx
  on public.advisor_reports (advisor_client_id, created_at desc);
create index advisor_reports_status_created_idx
  on public.advisor_reports (status, created_at desc);

create trigger advisor_reports_set_updated_at
  before update on public.advisor_reports
  for each row execute function public.v3a_set_updated_at();

comment on table public.advisor_reports is
  'Advisor report records. Ownership is inherited from advisor_clients and all writes use guarded RPCs.';
comment on column public.advisor_reports.idempotency_key is
  'Client-generated request UUID. The create RPC returns the existing owned report on an exact retry.';

alter table public.advisor_clients enable row level security;
alter table public.advisor_reports enable row level security;

revoke all on table public.advisor_clients from public, anon, authenticated;
revoke all on table public.advisor_reports from public, anon, authenticated;
grant select on table public.advisor_clients to authenticated;
grant select on table public.advisor_reports to authenticated;

create policy v3a_advisor_clients_read_own_or_super_admin
on public.advisor_clients
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and public.v3a_current_role() = 'advisor'
    and advisor_user_id = public.v3a_current_user_id()
  )
);

create policy v3a_advisor_reports_read_own_or_super_admin
on public.advisor_reports
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and public.v3a_current_role() = 'advisor'
    and exists (
      select 1
      from public.advisor_clients c
      where c.id = advisor_reports.advisor_client_id
        and c.advisor_user_id = public.v3a_current_user_id()
        and c.archived_at is null
    )
  )
);

-- Atomically resolves/creates the client and creates exactly one report for
-- a browser-generated idempotency key. The advisor id always comes from auth.uid().
create function public.v3a_create_advisor_report_import(
  p_idempotency_key uuid,
  p_existing_client_id uuid,
  p_display_name text,
  p_birth_date date,
  p_note text,
  p_structured_input jsonb,
  p_age_at_report integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_client_id uuid;
  v_client_name text;
  v_client_birth_date date;
  v_client_note text;
  v_report_id uuid;
  v_report_status text;
  v_report_owner uuid;
  v_age_at_report integer;
  v_structured_input jsonb;
  v_idempotent boolean := false;
  v_retry boolean := false;
begin
  select u.id
  into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.role = 'advisor'
    and u.status = 'active'
  limit 1;

  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'REPORT_IMPORT_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if jsonb_typeof(p_structured_input) is distinct from 'object' or p_structured_input = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'INVALID_STRUCTURED_INPUT';
  end if;
  if p_age_at_report is not null and (p_age_at_report < 0 or p_age_at_report > 120) then
    raise exception using errcode = 'P0001', message = 'INVALID_REPORT_AGE';
  end if;
  if (p_existing_client_id is null) = (nullif(btrim(p_display_name), '') is null) then
    raise exception using errcode = 'P0001', message = 'AMBIGUOUS_CLIENT';
  end if;

  select r.id, r.status, c.id, c.display_name, c.birth_date, c.note, c.advisor_user_id
  into v_report_id, v_report_status, v_client_id, v_client_name, v_client_birth_date, v_client_note, v_report_owner
  from public.advisor_reports r
  join public.advisor_clients c on c.id = r.advisor_client_id
  where r.idempotency_key = p_idempotency_key
  limit 1;

  if v_report_id is not null then
    if v_report_owner is distinct from v_advisor_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    if (p_existing_client_id is not null and p_existing_client_id is distinct from v_client_id)
       or (
         p_existing_client_id is null
         and (
           nullif(btrim(p_display_name), '') is distinct from v_client_name
           or p_birth_date is distinct from v_client_birth_date
           or nullif(btrim(p_note), '') is distinct from v_client_note
         )
       )
       or not exists (
         select 1
         from public.advisor_reports r
         where r.id = v_report_id
           and (r.structured_input - 'clientName' - 'importedBy' - 'importedAt') = p_structured_input
           and r.age_at_report is not distinct from p_age_at_report
       ) then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    if v_report_status = 'failed' then
      update public.advisor_reports
      set status = 'generating', generated_report = null, error_code = null
      where id = v_report_id
      returning status into v_report_status;
      v_retry := true;
    end if;
    return jsonb_build_object(
      'clientId', v_client_id,
      'clientName', v_client_name,
      'reportId', v_report_id,
      'status', v_report_status,
      'idempotent', true,
      'retry', v_retry
    );
  end if;

  begin
    if p_existing_client_id is not null then
      select c.id, c.display_name, c.birth_date
      into v_client_id, v_client_name, v_client_birth_date
      from public.advisor_clients c
      where c.id = p_existing_client_id
        and c.advisor_user_id = v_advisor_id
        and c.archived_at is null
      limit 1;

      if v_client_id is null then
        raise exception using errcode = 'P0001', message = 'CLIENT_NOT_FOUND';
      end if;
    else
      if char_length(btrim(p_display_name)) > 40 then
        raise exception using errcode = 'P0001', message = 'INVALID_CLIENT_NAME';
      end if;
      if p_birth_date is not null and p_birth_date > current_date then
        raise exception using errcode = 'P0001', message = 'INVALID_BIRTH_DATE';
      end if;
      if p_note is not null and char_length(p_note) > 200 then
        raise exception using errcode = 'P0001', message = 'INVALID_CLIENT_NOTE';
      end if;

      insert into public.advisor_clients (
        advisor_user_id, source, display_name, birth_date, note
      ) values (
        v_advisor_id, 'advisor_import', btrim(p_display_name), p_birth_date, nullif(btrim(p_note), '')
      )
      returning id, display_name, birth_date
      into v_client_id, v_client_name, v_client_birth_date;
    end if;

    v_age_at_report := p_age_at_report;
    if v_age_at_report is null and v_client_birth_date is not null then
      v_age_at_report := extract(year from age(current_date, v_client_birth_date))::integer;
    end if;

    v_structured_input := p_structured_input || jsonb_build_object(
      'clientName', v_client_name,
      'importedBy', v_advisor_id,
      'importedAt', now()
    );

    insert into public.advisor_reports (
      advisor_client_id, status, source, structured_input, age_at_report, idempotency_key
    ) values (
      v_client_id, 'generating', 'advisor_import', v_structured_input, v_age_at_report, p_idempotency_key
    )
    returning id, status into v_report_id, v_report_status;
  exception
    when unique_violation then
      select r.id, r.status, c.id, c.display_name, c.birth_date, c.note, c.advisor_user_id
      into v_report_id, v_report_status, v_client_id, v_client_name, v_client_birth_date, v_client_note, v_report_owner
      from public.advisor_reports r
      join public.advisor_clients c on c.id = r.advisor_client_id
      where r.idempotency_key = p_idempotency_key
      limit 1;

      if v_report_id is null or v_report_owner is distinct from v_advisor_id then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_CONFLICT';
      end if;
      if (p_existing_client_id is not null and p_existing_client_id is distinct from v_client_id)
         or (
           p_existing_client_id is null
           and (
             nullif(btrim(p_display_name), '') is distinct from v_client_name
             or p_birth_date is distinct from v_client_birth_date
             or nullif(btrim(p_note), '') is distinct from v_client_note
           )
         )
         or not exists (
           select 1
           from public.advisor_reports r
           where r.id = v_report_id
             and (r.structured_input - 'clientName' - 'importedBy' - 'importedAt') = p_structured_input
             and r.age_at_report is not distinct from p_age_at_report
         ) then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
      end if;
      v_idempotent := true;
      if v_report_status = 'failed' then
        update public.advisor_reports
        set status = 'generating', generated_report = null, error_code = null
        where id = v_report_id
        returning status into v_report_status;
        v_retry := true;
      end if;
  end;

  return jsonb_build_object(
    'clientId', v_client_id,
    'clientName', v_client_name,
    'reportId', v_report_id,
    'status', v_report_status,
    'idempotent', v_idempotent,
    'retry', v_retry
  );
end
$$;

create function public.v3a_complete_advisor_report_import(
  p_report_id uuid,
  p_succeeded boolean,
  p_generated_report jsonb,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_status text;
  v_current_status text;
begin
  select u.id
  into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.role = 'advisor'
    and u.status = 'active'
  limit 1;

  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'REPORT_IMPORT_FORBIDDEN';
  end if;
  select r.status
  into v_current_status
  from public.advisor_reports r
  join public.advisor_clients c on c.id = r.advisor_client_id
  where r.id = p_report_id
    and c.advisor_user_id = v_advisor_id
    and c.archived_at is null
  limit 1;

  if v_current_status is null then
    raise exception using errcode = 'P0001', message = 'REPORT_NOT_FOUND';
  end if;
  if v_current_status <> 'generating' then
    raise exception using errcode = 'P0001', message = 'INVALID_REPORT_TRANSITION';
  end if;

  if p_succeeded then
    if jsonb_typeof(p_generated_report) is distinct from 'object' or p_generated_report = '{}'::jsonb then
      raise exception using errcode = 'P0001', message = 'INVALID_GENERATED_REPORT';
    end if;
    update public.advisor_reports
    set status = 'ready', generated_report = p_generated_report, error_code = null
    where id = p_report_id and status = 'generating'
    returning status into v_status;
  else
    if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_ERROR_CODE';
    end if;
    update public.advisor_reports
    set status = 'failed', generated_report = null, error_code = p_error_code
    where id = p_report_id and status = 'generating'
    returning status into v_status;
  end if;

  return jsonb_build_object('reportId', p_report_id, 'status', v_status);
end
$$;

revoke all on function public.v3a_create_advisor_report_import(uuid, uuid, text, date, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_complete_advisor_report_import(uuid, boolean, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.v3a_create_advisor_report_import(uuid, uuid, text, date, text, jsonb, integer)
  to authenticated;
grant execute on function public.v3a_complete_advisor_report_import(uuid, boolean, jsonb, text)
  to authenticated;

comment on function public.v3a_create_advisor_report_import(uuid, uuid, text, date, text, jsonb, integer) is
  'Creates an advisor_import client/report atomically. Advisor ownership is derived from auth.uid(); repeated owned idempotency keys return the existing report.';
comment on function public.v3a_complete_advisor_report_import(uuid, boolean, jsonb, text) is
  'Completes only a report owned by the current active advisor with a ready or failed state.';

-- Postflight assertions remain inside the transaction.
do $$
begin
  if to_regclass('public.advisor_clients') is null
     or to_regclass('public.advisor_reports') is null then
    raise exception 'MIGRATION_020_POSTFLIGHT_TABLES_FAILED';
  end if;
  if to_regprocedure('public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)') is null
     or to_regprocedure('public.v3a_complete_advisor_report_import(uuid,boolean,jsonb,text)') is null then
    raise exception 'MIGRATION_020_POSTFLIGHT_FUNCTIONS_FAILED';
  end if;
  if has_table_privilege('authenticated', 'public.advisor_clients', 'INSERT')
     or has_table_privilege('authenticated', 'public.advisor_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.advisor_reports', 'UPDATE') then
    raise exception 'MIGRATION_020_POSTFLIGHT_BROWSER_WRITE_GRANT_FAILED';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.v3a_create_advisor_report_import(uuid,uuid,text,date,text,jsonb,integer)',
      'EXECUTE'
    ) then
    raise exception 'MIGRATION_020_POSTFLIGHT_RPC_PRIVILEGES_FAILED';
  end if;
end
$$;

commit;
