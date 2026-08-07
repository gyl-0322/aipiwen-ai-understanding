-- AIPIWEN advisor interpretation V3: persist one detailed module per request.
-- Execute in Preview only after migration 030.

begin;

do $$
begin
  if to_regclass('public.advisor_reports') is null
     or to_regprocedure('public.v3a_save_advisor_interpretation(uuid,jsonb)') is null
     or not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.advisor_reports'::regclass
         and conname = 'advisor_reports_interpretation_data_check'
     ) then
    raise exception 'MIGRATION_031_REQUIRES_MIGRATION_030';
  end if;

  if exists (
    select 1
    from public.advisor_reports r
    where r.interpretation_data is not null
      and not (
        jsonb_typeof(r.interpretation_data) = 'object'
        and r.interpretation_data ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and jsonb_typeof(r.interpretation_data -> 'steps') = 'array'
        and octet_length(r.interpretation_data::text) <= 65536
        and (
          (
            r.interpretation_data ->> 'version' = '1'
            and r.interpretation_data ->> 'status' in ('generated', 'edited')
            and jsonb_array_length(r.interpretation_data -> 'steps') = 8
          )
          or (
            r.interpretation_data ->> 'version' = '3'
            and (
              (
                r.interpretation_data ->> 'status' = 'generating'
                and jsonb_array_length(r.interpretation_data -> 'steps') between 1 and 15
              )
              or (
                r.interpretation_data ->> 'status' in ('generated', 'edited')
                and jsonb_array_length(r.interpretation_data -> 'steps') = 16
              )
            )
          )
        )
      )
  ) then
    raise exception 'MIGRATION_031_UNEXPECTED_EXISTING_INTERPRETATION_DATA';
  end if;
end
$$;

lock table public.advisor_reports in share row exclusive mode;

alter table public.advisor_reports
  drop constraint advisor_reports_interpretation_data_check;

alter table public.advisor_reports
  add constraint advisor_reports_interpretation_data_check
    check (
      interpretation_data is null
      or (
        jsonb_typeof(interpretation_data) = 'object'
        and interpretation_data ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and jsonb_typeof(interpretation_data -> 'steps') = 'array'
        and octet_length(interpretation_data::text) <= 65536
        and (
          (
            interpretation_data ->> 'version' = '1'
            and interpretation_data ->> 'status' in ('generated', 'edited')
            and jsonb_array_length(interpretation_data -> 'steps') = 8
          )
          or (
            interpretation_data ->> 'version' = '3'
            and (
              (
                interpretation_data ->> 'status' = 'generating'
                and jsonb_array_length(interpretation_data -> 'steps') between 1 and 15
              )
              or (
                interpretation_data ->> 'status' in ('generated', 'edited')
                and jsonb_array_length(interpretation_data -> 'steps') = 16
              )
            )
          )
        )
      )
    );

create or replace function public.v3a_save_advisor_interpretation(
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
  v_version text;
  v_status text;
  v_step_count integer;
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
     or coalesce(p_interpretation_data ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or jsonb_typeof(p_interpretation_data -> 'steps') is distinct from 'array'
     or octet_length(p_interpretation_data::text) > 65536 then
    raise exception using errcode = 'P0001', message = 'INVALID_INTERPRETATION_DATA';
  end if;

  v_version := p_interpretation_data ->> 'version';
  v_status := p_interpretation_data ->> 'status';
  v_step_count := jsonb_array_length(p_interpretation_data -> 'steps');

  if not (
    (v_version = '1' and v_status in ('generated', 'edited') and v_step_count = 8)
    or (
      v_version = '3'
      and (
        (v_status = 'generating' and v_step_count between 1 and 15)
        or (v_status in ('generated', 'edited') and v_step_count = 16)
      )
    )
  ) then
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
    from pg_constraint
    where conrelid = 'public.advisor_reports'::regclass
      and conname = 'advisor_reports_interpretation_data_check'
      and convalidated
      and pg_get_constraintdef(oid) like '%>= 1%'
      and pg_get_constraintdef(oid) like '%<= 15%'
  ) then
    raise exception 'MIGRATION_031_POSTFLIGHT_CONSTRAINT_FAILED';
  end if;
  if not has_function_privilege(
    'authenticated', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'service_role', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) then
    raise exception 'MIGRATION_031_POSTFLIGHT_RPC_PRIVILEGES_FAILED';
  end if;
  if has_table_privilege('authenticated', 'public.advisor_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.advisor_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.advisor_reports', 'DELETE') then
    raise exception 'MIGRATION_031_POSTFLIGHT_TABLE_PRIVILEGES_FAILED';
  end if;
end
$$;

commit;
