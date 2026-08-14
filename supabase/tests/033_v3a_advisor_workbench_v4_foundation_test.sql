\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.users (
  id uuid primary key,
  auth_user_id uuid unique,
  role text not null,
  status text not null
);
create table public.advisor_clients (
  id uuid primary key,
  advisor_user_id uuid references public.users(id),
  archived_at timestamptz
);
create table public.advisor_reports (id uuid primary key);

create function public.v3a_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end
$$;
create function public.v3a_current_user_id() returns uuid language sql stable security definer as $$
  select id from public.users where auth_user_id = auth.uid() limit 1
$$;
create function public.v3a_current_role() returns text language sql stable security definer as $$
  select role from public.users where auth_user_id = auth.uid() limit 1
$$;
create function public.v3a_current_status() returns text language sql stable security definer as $$
  select status from public.users where auth_user_id = auth.uid() limit 1
$$;
create function public.v3a_is_super_admin() returns boolean language sql stable security definer as $$
  select exists(select 1 from public.users where auth_user_id = auth.uid() and role = 'super_admin' and status = 'active')
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid(), public.v3a_current_user_id(), public.v3a_current_role(), public.v3a_current_status(), public.v3a_is_super_admin() to authenticated;

\ir ../migrations/033_v3a_advisor_workbench_v4_foundation.sql

begin;

do $$
begin
  if to_regclass('public.growth_records') is null
     or to_regclass('public.coaching_sessions') is null
     or to_regclass('public.service_stage_log') is null
     or to_regclass('public.case_card') is null then
    raise exception 'TEST_033_TABLES_MISSING';
  end if;
  if has_table_privilege('authenticated', 'public.growth_records', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.growth_records', 'SELECT')
     or has_function_privilege('anon', 'public.v3a_create_growth_record(uuid,text,text[],text,text[],text,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.v3a_create_growth_record(uuid,text,text[],text,text[],text,text,text)', 'EXECUTE') then
    raise exception 'TEST_033_PRIVILEGE_EXPANSION';
  end if;
end
$$;

insert into public.users(id, auth_user_id, role, status) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'advisor', 'active'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'advisor', 'active');
insert into public.advisor_clients(id, advisor_user_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);

select public.v3a_create_growth_record(
  '30000000-0000-4000-8000-000000000001', 'advisor_obs', array['learning'], 'improving',
  array['TRC'], 'advisor_only', '隔离成长记录', 'advisor_workbench'
);
select public.v3a_create_coaching_session(
  '30000000-0000-4000-8000-000000000001', 'phone_follow_up', 'pre_call', '隔离辅导话题',
  '{"understanding":"test"}'::jsonb, null, null, null
);
select public.v3a_create_case_card(
  '30000000-0000-4000-8000-000000000001', '隔离案例', '仅用于迁移演练', array['other'],
  'private', array['A1'], '[]'::jsonb
);

do $$
begin
  if (select count(*) from public.growth_records) <> 1
     or (select count(*) from public.coaching_sessions) <> 1
     or (select count(*) from public.case_card) <> 1 then
    raise exception 'TEST_033_RPC_WRITE_FAILED';
  end if;
end
$$;

do $$
begin
  perform public.v3a_create_growth_record(
    '30000000-0000-4000-8000-000000000002', 'advisor_obs', '{}', 'stable', '{}',
    'advisor_only', '越权记录', 'advisor_workbench'
  );
  raise exception 'TEST_033_CROSS_ADVISOR_WRITE_NOT_BLOCKED';
exception when others then
  if sqlerrm = 'TEST_033_CROSS_ADVISOR_WRITE_NOT_BLOCKED' then raise; end if;
end
$$;

reset role;
rollback;

select 'AIPIWEN migration 033 rehearsal PASS' as result;
