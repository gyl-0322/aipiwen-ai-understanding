-- AIPIWEN advisor-owned AI interpretation storage.
-- Review artifact only. Do not execute in Preview or Production without separate authorization.

begin;

do $$
begin
  if to_regclass('public.advisor_clients') is null
     or to_regclass('public.advisor_reports') is null
     or to_regprocedure('public.v3a_current_user_id()') is null then
    raise exception 'MIGRATION_029_REQUIRES_ADVISOR_REPORT_BASELINE';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisor_reports'
      and column_name = 'interpretation_data'
  ) or to_regprocedure('public.v3a_save_advisor_interpretation(uuid,jsonb)') is not null then
    raise exception 'MIGRATION_029_ALREADY_APPLIED_OR_PARTIAL';
  end if;
end
$$;

lock table public.advisor_reports in share row exclusive mode;

alter table public.advisor_reports
  add column interpretation_data jsonb,
  add constraint advisor_reports_interpretation_data_check
    check (
      interpretation_data is null
      or (
        jsonb_typeof(interpretation_data) = 'object'
        and interpretation_data ->> 'version' = '1'
        and interpretation_data ->> 'status' in ('generated', 'edited')
        and interpretation_data ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and jsonb_typeof(interpretation_data -> 'steps') = 'array'
        and jsonb_array_length(interpretation_data -> 'steps') = 8
        and octet_length(interpretation_data::text) <= 65536
      )
    );

comment on column public.advisor_reports.interpretation_data is
  'Latest advisor-reviewed AI interpretation plan. No history or payment state is stored in this MVP.';

create function public.v3a_save_advisor_interpretation(
  p_report_id uuid,
  p_interpretation_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_report_status text;
begin
  select u.id
  into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.role = 'advisor'
    and u.status = 'active'
  limit 1;

  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'INTERPRETATION_FORBIDDEN';
  end if;
  if p_report_id is null then
    raise exception using errcode = 'P0001', message = 'REPORT_NOT_FOUND';
  end if;
  if jsonb_typeof(p_interpretation_data) is distinct from 'object'
     or p_interpretation_data ->> 'version' is distinct from '1'
     or p_interpretation_data ->> 'status' not in ('generated', 'edited')
     or coalesce(p_interpretation_data ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or jsonb_typeof(p_interpretation_data -> 'steps') is distinct from 'array'
     or jsonb_array_length(p_interpretation_data -> 'steps') <> 8
     or octet_length(p_interpretation_data::text) > 65536 then
    raise exception using errcode = 'P0001', message = 'INVALID_INTERPRETATION_DATA';
  end if;

  select r.status
  into v_report_status
  from public.advisor_reports r
  join public.advisor_clients c on c.id = r.advisor_client_id
  where r.id = p_report_id
    and c.advisor_user_id = v_advisor_id
    and c.archived_at is null
  for update of r;

  if v_report_status is null then
    raise exception using errcode = 'P0001', message = 'REPORT_NOT_FOUND';
  end if;
  if v_report_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'INTERPRETATION_REPORT_NOT_READY';
  end if;

  update public.advisor_reports r
  set interpretation_data = p_interpretation_data
  from public.advisor_clients c
  where r.id = p_report_id
    and r.status = 'ready'
    and c.id = r.advisor_client_id
    and c.advisor_user_id = v_advisor_id
    and c.archived_at is null;

  return jsonb_build_object(
    'reportId', p_report_id,
    'interpretationId', p_interpretation_data ->> 'id',
    'status', p_interpretation_data ->> 'status',
    'updatedAt', now()
  );
end
$$;

revoke all on function public.v3a_save_advisor_interpretation(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.v3a_save_advisor_interpretation(uuid,jsonb)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisor_reports'
      and column_name = 'interpretation_data'
      and data_type = 'jsonb'
      and is_nullable = 'YES'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.advisor_reports'::regclass
      and conname = 'advisor_reports_interpretation_data_check'
  ) then
    raise exception 'MIGRATION_029_POSTFLIGHT_SCHEMA_FAILED';
  end if;
  if not has_function_privilege(
    'authenticated', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'service_role', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) then
    raise exception 'MIGRATION_029_POSTFLIGHT_RPC_PRIVILEGES_FAILED';
  end if;
  if has_table_privilege('authenticated', 'public.advisor_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.advisor_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.advisor_reports', 'DELETE') then
    raise exception 'MIGRATION_029_POSTFLIGHT_TABLE_PRIVILEGES_FAILED';
  end if;
end
$$;

commit;
