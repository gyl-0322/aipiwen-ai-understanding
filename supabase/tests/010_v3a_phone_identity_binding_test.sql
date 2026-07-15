-- AIPIWEN V3a Phase C1-D phone identity and atomic registration verification.
--
-- LOCAL/DISPOSABLE DATABASE ONLY. The final concurrency section commits
-- synthetic fixtures on separate connections. Never run this file in Preview
-- or Production.

\set ON_ERROR_STOP on
\if :{?c1d_local_test}
\else
  \echo 'Refusing to run: pass -v c1d_local_test=1 in a disposable local database.'
  \quit 3
\endif

begin;

-- Final catalog, ACL, RLS, constraint, and function-security assertions.
do $$
declare
  fn_oid oid := 'public.v3a_submit_pending_application(text,text,text,text,text,boolean,text)'::regprocedure;
  fn_config text[];
  constraint_def text;
begin
  if not exists (
    select 1
    from pg_proc
    where oid = fn_oid
      and prosecdef
      and pg_get_function_result(oid) = 'jsonb'
  ) then
    raise exception 'registration RPC is missing or unsafe';
  end if;

  select proconfig into fn_config from pg_proc where oid = fn_oid;
  if not ('search_path=public, pg_temp' = any(fn_config))
    or not ('statement_timeout=30s' = any(fn_config)) then
    raise exception 'registration RPC settings are unsafe: %', fn_config;
  end if;

  if has_function_privilege('public', fn_oid, 'execute')
    or has_function_privilege('anon', fn_oid, 'execute')
    or has_function_privilege('service_role', fn_oid, 'execute')
    or not has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'registration RPC grants are incorrect';
  end if;

  if has_table_privilege('authenticated', 'public.users', 'insert')
    or has_table_privilege('authenticated', 'public.advisor_profiles', 'insert')
    or has_table_privilege('authenticated', 'public.application_reviews', 'insert')
    or has_table_privilege('anon', 'public.users', 'insert')
    or has_table_privilege('service_role', 'public.users', 'insert') then
    raise exception 'direct pending table INSERT remains open';
  end if;

  if has_table_privilege('authenticated', 'public.users', 'update')
    or has_column_privilege('authenticated', 'public.users', 'phone', 'update') then
    raise exception 'authenticated can update phone';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users', 'advisor_profiles', 'application_reviews')
      and cmd = 'INSERT'
  ) then
    raise exception 'browser INSERT RLS policy remains installed';
  end if;

  if (
    select count(*)
    from pg_class table_row
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname in ('users', 'advisor_profiles', 'application_reviews')
      and table_row.relrowsecurity
  ) <> 3 then
    raise exception 'RLS was disabled on a registration table';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users', 'advisor_profiles', 'application_reviews')
      and cmd = 'SELECT'
  ) < 3 then
    raise exception 'owner SELECT RLS policies were removed';
  end if;

  select pg_get_constraintdef(oid)
  into constraint_def
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and conname = 'users_phone_china_e164_check'
    and contype = 'c';

  if constraint_def is null
    or position('861[3-9]' in constraint_def) = 0 then
    raise exception 'China E.164 CHECK is missing or too broad: %', constraint_def;
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_class on index_class.oid = index_row.indexrelid
    where index_row.indrelid = 'public.users'::regclass
      and index_class.relname = 'users_phone_unique_idx'
      and index_row.indisunique
  ) then
    raise exception 'users_phone_unique_idx is missing';
  end if;

  if exists (
    select 1
    from pg_proc function_row,
      unnest(coalesce(function_row.proargnames, array[]::text[])) argument_name
    where function_row.oid = fn_oid
      and argument_name in (
        'user_id', 'auth_user_id', 'phone', 'email', 'status', 'role'
      )
  ) then
    raise exception 'registration RPC accepts a forbidden identity/state parameter';
  end if;
end;
$$;

insert into auth.users (
  id, email, phone, email_confirmed_at, phone_confirmed_at, confirmed_at,
  deleted_at, banned_until, is_anonymous
) values
  ('a1000000-0000-4000-8000-000000000001', 'email@example.invalid', null, now(), null, now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000002', null, '+8613800138000', null, now(), now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000003', null, '+8613900139000', null, now(), now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000004', null, '+8613700137000', null, now(), now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000005', null, '+8613600136000', null, null, null, null, null, false),
  ('a1000000-0000-4000-8000-000000000006', null, '13800138000', null, now(), now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000007', 'anonymous@example.invalid', null, now(), null, now(), null, null, true),
  ('a1000000-0000-4000-8000-000000000008', 'deleted@example.invalid', null, now(), null, now(), now(), null, false),
  ('a1000000-0000-4000-8000-000000000009', 'banned@example.invalid', null, now(), null, now(), null, now() + interval '1 day', false),
  ('a1000000-0000-4000-8000-000000000010', null, null, null, null, null, null, null, false),
  ('a1000000-0000-4000-8000-000000000011', 'profile-fail@example.invalid', null, now(), null, now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000012', 'review-fail@example.invalid', null, now(), null, now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000013', 'partial-user@example.invalid', null, now(), null, now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000014', 'partial-profile@example.invalid', null, now(), null, now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000015', 'conflict@example.invalid', null, now(), null, now(), null, null, false),
  ('a1000000-0000-4000-8000-000000000016', 'admin@example.invalid', null, now(), null, now(), null, null, false);

-- Verified email registration succeeds with phone=null and is idempotent.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","email":"email@example.invalid","phone":""}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare
  first_result jsonb;
  repeat_result jsonb;
  invalid_agreement_blocked boolean := false;
  invalid_invite_blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Email Advisor', 'Shanghai', 'advisor', 'independent',
      'client-invented-version', true, null
    );
  exception when invalid_parameter_value then
    invalid_agreement_blocked := sqlerrm = 'INVALID_AGREEMENT';
  end;

  begin
    perform public.v3a_submit_pending_application(
      'Email Advisor', 'Shanghai', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, 'A--B'
    );
  exception when invalid_parameter_value then
    invalid_invite_blocked := sqlerrm = 'INVALID_INVITE_CODE';
  end;

  if not invalid_agreement_blocked or not invalid_invite_blocked then
    raise exception 'client-controlled agreement or malformed invite was accepted';
  end if;

  first_result := public.v3a_submit_pending_application(
    'Email Advisor', 'Shanghai', 'advisor', 'independent',
    'v3a-phase-b-preview-2026-07-09', true, null
  );
  repeat_result := public.v3a_submit_pending_application(
    'Email Advisor', 'Shanghai', 'advisor', 'independent',
    'v3a-phase-b-preview-2026-07-09', true, null
  );

  if first_result ->> 'already_exists' <> 'false'
    or repeat_result ->> 'already_exists' <> 'true'
    or first_result #>> '{data,user_id}' is distinct from repeat_result #>> '{data,user_id}'
    or first_result #>> '{data,profile_id}' is distinct from repeat_result #>> '{data,profile_id}'
    or first_result #>> '{data,application_id}' is distinct from repeat_result #>> '{data,application_id}' then
    raise exception 'email registration is not idempotent';
  end if;
end;
$$;
reset role;

do $$
declare
  registered_user_id uuid;
begin
  select id into registered_user_id
  from public.users
  where auth_user_id = 'a1000000-0000-4000-8000-000000000001';

  if registered_user_id is null
    or not exists (
      select 1 from public.users
      where id = registered_user_id
        and email = 'email@example.invalid'
        and phone is null
        and role = 'pending'
        and status = 'pending'
    )
    or (select count(*) from public.advisor_profiles where user_id = registered_user_id) <> 1
    or (select count(*) from public.application_reviews where user_id = registered_user_id) <> 1
    or exists (select 1 from public.credit_wallets where user_id = registered_user_id)
    or exists (select 1 from public.credit_logs where user_id = registered_user_id)
    or exists (select 1 from public.invite_codes where user_id = registered_user_id)
    or exists (select 1 from public.admin_audit_logs where target_id = registered_user_id) then
    raise exception 'email registration created incorrect artifacts';
  end if;
end;
$$;

-- Verified phone registration derives the exact auth.users phone.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","email":"","phone":"+8613800138000"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.v3a_submit_pending_application(
  'Phone Advisor', 'Beijing', 'advisor', 'independent',
  'v3a-phase-b-preview-2026-07-09', true, null
);
reset role;

do $$
declare
  registered_user_id uuid;
begin
  select id into registered_user_id
  from public.users
  where auth_user_id = 'a1000000-0000-4000-8000-000000000002';

  if registered_user_id is null
    or not exists (
      select 1 from public.users
      where id = registered_user_id
        and phone = '+8613800138000'
        and email is null
        and role = 'pending'
        and status = 'pending'
    )
    or (select count(*) from public.advisor_profiles where user_id = registered_user_id) <> 1
    or (select count(*) from public.application_reviews where user_id = registered_user_id) <> 1 then
    raise exception 'phone registration did not use the verified Auth phone';
  end if;
end;
$$;

-- Wrong/other phone, missing phone claim, unconfirmed phone, and non-China
-- formats are rejected without creating any public row.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","phone":"+8613800138000"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Wrong Phone', 'Beijing', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_PHONE_CLAIM_MISMATCH';
  end;
  if not blocked then raise exception 'another user phone was accepted'; end if;
end;
$$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated","phone":""}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Null Phone', 'Beijing', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_PHONE_CLAIM_MISMATCH';
  end;
  if not blocked then raise exception 'verified phone user bypassed with null phone claim'; end if;
end;
$$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000005","role":"authenticated","phone":"+8613600136000"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Unconfirmed Phone', 'Beijing', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_PHONE_NOT_VERIFIED';
  end;
  if not blocked then raise exception 'unconfirmed phone was accepted'; end if;
end;
$$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000006","role":"authenticated","phone":"13800138000"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Bad Format', 'Beijing', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_PHONE_NOT_SUPPORTED';
  end;
  if not blocked then raise exception 'non-China E.164 phone was accepted'; end if;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.users
    where auth_user_id in (
      'a1000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000004',
      'a1000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000006'
    )
  ) then
    raise exception 'rejected phone identity left a public user';
  end if;
end;
$$;

-- Auth lifecycle guards reject anonymous/deleted/banned/unverified identities.
do $$
declare
  fixture record;
  expected_error text;
  blocked boolean;
begin
  for fixture in
    select * from (values
      ('a1000000-0000-4000-8000-000000000007'::uuid, 'AUTH_USER_UNAVAILABLE'),
      ('a1000000-0000-4000-8000-000000000008'::uuid, 'AUTH_USER_UNAVAILABLE'),
      ('a1000000-0000-4000-8000-000000000009'::uuid, 'AUTH_USER_UNAVAILABLE'),
      ('a1000000-0000-4000-8000-000000000010'::uuid, 'AUTH_IDENTITY_NOT_VERIFIED')
    ) as fixtures(auth_user_id, error_marker)
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', fixture.auth_user_id,
        'role', 'authenticated',
        'email', '',
        'phone', ''
      )::text,
      true
    );
    perform set_config('request.jwt.claim.sub', fixture.auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    blocked := false;
    expected_error := fixture.error_marker;
    begin
      perform public.v3a_submit_pending_application(
        'Blocked User', 'Local', 'advisor', 'independent',
        'v3a-phase-b-preview-2026-07-09', true, null
      );
    exception when invalid_parameter_value then
      blocked := sqlerrm = expected_error;
    end;
    execute 'reset role';
    if not blocked then
      raise exception 'Auth lifecycle guard failed for %', fixture.auth_user_id;
    end if;
  end loop;
end;
$$;

-- Injected second- and third-table failures roll back the whole RPC.
create function public.v3a_010_fail_profile_insert()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.nickname = 'Profile Failure' then
    raise exception 'TEST_PROFILE_FAILURE';
  end if;
  return new;
end;
$$;
create trigger v3a_010_fail_profile_insert
before insert on public.advisor_profiles
for each row execute function public.v3a_010_fail_profile_insert();

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000011","role":"authenticated","email":"profile-fail@example.invalid","phone":""}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Profile Failure', 'Local', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when raise_exception then
    blocked := sqlerrm = 'REGISTRATION_FAILED';
  end;
  if not blocked then raise exception 'profile failure was not surfaced safely'; end if;
end;
$$;
reset role;
drop trigger v3a_010_fail_profile_insert on public.advisor_profiles;
drop function public.v3a_010_fail_profile_insert();

create function public.v3a_010_fail_review_insert()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.applied_nickname = 'Review Failure' then
    raise exception 'TEST_REVIEW_FAILURE';
  end if;
  return new;
end;
$$;
create trigger v3a_010_fail_review_insert
before insert on public.application_reviews
for each row execute function public.v3a_010_fail_review_insert();

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000012","role":"authenticated","email":"review-fail@example.invalid","phone":""}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000012', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Review Failure', 'Local', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when raise_exception then
    blocked := sqlerrm = 'REGISTRATION_FAILED';
  end;
  if not blocked then raise exception 'review failure was not surfaced safely'; end if;
end;
$$;
reset role;
drop trigger v3a_010_fail_review_insert on public.application_reviews;
drop function public.v3a_010_fail_review_insert();

do $$
begin
  if exists (
    select 1 from public.users
    where auth_user_id in (
      'a1000000-0000-4000-8000-000000000011',
      'a1000000-0000-4000-8000-000000000012'
    )
  ) then
    raise exception 'failed registration left a partial public user';
  end if;
end;
$$;

-- Historical partial states fail explicitly and are not repaired.
insert into public.users (
  id, auth_user_id, role, status, email, display_name, city, source
) values
  ('b1000000-0000-4000-8000-000000000013', 'a1000000-0000-4000-8000-000000000013', 'pending', 'pending', 'partial-user@example.invalid', 'Partial User', 'Local', 'direct'),
  ('b1000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000014', 'pending', 'pending', 'partial-profile@example.invalid', 'Partial Profile', 'Local', 'direct');

insert into public.advisor_profiles (
  user_id, role, status, nickname, city, practitioner_type,
  agreement_version, agreed_rules_at
) values (
  'b1000000-0000-4000-8000-000000000014', 'advisor', 'pending',
  'Partial Profile', 'Local', 'independent',
  'v3a-phase-b-preview-2026-07-09', now()
);

do $$
declare
  fixture_id uuid;
  blocked boolean;
begin
  foreach fixture_id in array array[
    'a1000000-0000-4000-8000-000000000013'::uuid,
    'a1000000-0000-4000-8000-000000000014'::uuid
  ]
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', fixture_id,
        'role', 'authenticated',
        'email', case fixture_id
          when 'a1000000-0000-4000-8000-000000000013'::uuid
            then 'partial-user@example.invalid'
          else 'partial-profile@example.invalid'
        end,
        'phone', ''
      )::text,
      true
    );
    perform set_config('request.jwt.claim.sub', fixture_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    blocked := false;
    begin
      perform public.v3a_submit_pending_application(
        case fixture_id
          when 'a1000000-0000-4000-8000-000000000013'::uuid then 'Partial User'
          else 'Partial Profile'
        end,
        'Local', 'advisor', 'independent',
        'v3a-phase-b-preview-2026-07-09', true, null
      );
    exception when object_not_in_prerequisite_state then
      blocked := sqlerrm = 'PARTIAL_REGISTRATION_STATE';
    end;
    execute 'reset role';
    if not blocked then
      raise exception 'partial registration was silently repaired for %', fixture_id;
    end if;
  end loop;

  if exists (
    select 1 from public.application_reviews
    where user_id in (
      'b1000000-0000-4000-8000-000000000013',
      'b1000000-0000-4000-8000-000000000014'
    )
  ) or exists (
    select 1 from public.advisor_profiles
    where user_id = 'b1000000-0000-4000-8000-000000000013'
  ) then
    raise exception 'partial registration was modified';
  end if;
end;
$$;

-- A different repeat payload is rejected without overwriting the first one.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000015","role":"authenticated","email":"conflict@example.invalid","phone":""}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000015', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  perform public.v3a_submit_pending_application(
    'Conflict User', 'Shanghai', 'advisor', 'independent',
    'v3a-phase-b-preview-2026-07-09', true, null
  );
  begin
    perform public.v3a_submit_pending_application(
      'Conflict User', 'Beijing', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when object_not_in_prerequisite_state then
    blocked := sqlerrm = 'REGISTRATION_CONFLICT';
  end;
  if not blocked then raise exception 'different repeat payload was accepted'; end if;
end;
$$;
reset role;

-- A complete row set with a corrupted non-pending state is not accepted as
-- an idempotent success.
update public.users
set role = 'advisor',
    status = 'active',
    approved_at = now(),
    approved_by_user_id = id
where auth_user_id = 'a1000000-0000-4000-8000-000000000015';

set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Conflict User', 'Shanghai', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when object_not_in_prerequisite_state then
    blocked := sqlerrm = 'PARTIAL_REGISTRATION_STATE';
  end;
  if not blocked then
    raise exception 'corrupted active registration was accepted as idempotent';
  end if;
end;
$$;
reset role;

-- Direct INSERT, phone UPDATE, anon RPC, and cross-user SELECT stay blocked.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","email":"","phone":"+8613800138000"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare
  blocked_count integer := 0;
  own_user_id uuid;
begin
  select id into own_user_id
  from public.users
  where auth_user_id = 'a1000000-0000-4000-8000-000000000002';

  begin
    insert into public.users (
      auth_user_id, role, status, phone, display_name, city
    ) values (
      'a1000000-0000-4000-8000-000000000003', 'pending', 'pending',
      null, 'Direct User', 'Local'
    );
  exception when insufficient_privilege then blocked_count := blocked_count + 1;
  end;

  begin
    insert into public.advisor_profiles (
      user_id, role, status, nickname, city, practitioner_type,
      agreement_version, agreed_rules_at
    ) values (
      own_user_id, 'advisor', 'pending', 'Direct Profile', 'Local',
      'independent', 'v3a-phase-b-preview-2026-07-09', now()
    );
  exception when insufficient_privilege then blocked_count := blocked_count + 1;
  end;

  begin
    insert into public.application_reviews (
      user_id, role, status, applied_city, applied_nickname, practitioner_type
    ) values (
      own_user_id, 'advisor', 'pending', 'Local', 'Direct Review', 'independent'
    );
  exception when insufficient_privilege then blocked_count := blocked_count + 1;
  end;

  begin
    update public.users set phone = '+8613500135000' where id = own_user_id;
  exception when insufficient_privilege then blocked_count := blocked_count + 1;
  end;

  if blocked_count <> 4 then
    raise exception 'one or more direct writes remain open: %', blocked_count;
  end if;

  if (select count(*) from public.users) <> 1
    or (select count(*) from public.advisor_profiles) <> 1
    or (select count(*) from public.application_reviews) <> 1 then
    raise exception 'RLS exposed another user registration';
  end if;
end;
$$;
reset role;

set local role anon;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.v3a_submit_pending_application(
      'Anon User', 'Local', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'anon executed registration RPC'; end if;
end;
$$;
reset role;

-- The existing public.users unique index independently blocks phone reuse.
do $$
declare blocked boolean := false;
begin
  begin
    insert into public.users (
      auth_user_id, role, status, phone, display_name, city
    ) values (
      'a1000000-0000-4000-8000-000000000003', 'pending', 'pending',
      '+8613800138000', 'Duplicate Phone', 'Local'
    );
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'duplicate public phone was accepted'; end if;
end;
$$;

-- 009 owner-only verified-email bootstrap remains valid with phone=null.
do $$
declare
  result jsonb;
  admin_user_id uuid;
begin
  result := public.v3a_create_first_super_admin_from_auth(
    'a1000000-0000-4000-8000-000000000016',
    'C1D Admin'
  );
  admin_user_id := (result ->> 'user_id')::uuid;

  if result ->> 'already_initialized' <> 'false'
    or not exists (
      select 1 from public.users
      where id = admin_user_id
        and email = 'admin@example.invalid'
        and phone is null
        and role = 'super_admin'
        and status = 'active'
    )
    or exists (select 1 from public.advisor_profiles where user_id = admin_user_id)
    or exists (select 1 from public.application_reviews where user_id = admin_user_id)
    or exists (select 1 from public.credit_wallets where user_id = admin_user_id)
    or exists (select 1 from public.credit_logs where user_id = admin_user_id)
    or exists (select 1 from public.invite_codes where user_id = admin_user_id) then
    raise exception '009 email bootstrap was broken by 010';
  end if;
end;
$$;

rollback;

-- True two-connection repeat race. This section commits synthetic fixtures and
-- is safe only because the caller must destroy the whole local database.
create extension dblink;

insert into auth.users (
  id, email, phone, email_confirmed_at, phone_confirmed_at, confirmed_at,
  deleted_at, banned_until, is_anonymous
) values (
  'c1000000-0000-4000-8000-000000000001',
  'concurrent@example.invalid',
  null,
  now(),
  null,
  now(),
  null,
  null,
  false
);

do $$
declare
  connection_info text := format(
    'host=127.0.0.1 port=%s dbname=%L user=%L connect_timeout=5',
    current_setting('port'),
    current_database(),
    current_user
  );
  claims text := '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","email":"concurrent@example.invalid","phone":""}';
  first_result jsonb;
  second_result jsonb;
begin
  perform dblink_connect('v3a_010_register_a', connection_info);
  perform dblink_connect('v3a_010_register_b', connection_info);

  perform dblink_exec('v3a_010_register_a', 'begin');
  perform dblink_exec('v3a_010_register_a', 'set local role authenticated');
  perform dblink_exec('v3a_010_register_a', format('set local "request.jwt.claims" = %L', claims));
  perform dblink_exec('v3a_010_register_a', 'set local "request.jwt.claim.sub" = ''c1000000-0000-4000-8000-000000000001''');
  perform dblink_exec('v3a_010_register_a', 'set local "request.jwt.claim.role" = ''authenticated''');
  perform dblink_send_query(
    'v3a_010_register_a',
    $query$select public.v3a_submit_pending_application(
      'Concurrent User', 'Local', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    )$query$
  );

  select result into first_result
  from dblink_get_result('v3a_010_register_a') as result_row(result jsonb);
  perform *
  from dblink_get_result('v3a_010_register_a') as result_row(result jsonb);

  if first_result ->> 'already_exists' <> 'false' then
    raise exception 'first concurrent registration did not create records';
  end if;

  perform dblink_exec('v3a_010_register_b', 'begin');
  perform dblink_exec('v3a_010_register_b', 'set local role authenticated');
  perform dblink_exec('v3a_010_register_b', format('set local "request.jwt.claims" = %L', claims));
  perform dblink_exec('v3a_010_register_b', 'set local "request.jwt.claim.sub" = ''c1000000-0000-4000-8000-000000000001''');
  perform dblink_exec('v3a_010_register_b', 'set local "request.jwt.claim.role" = ''authenticated''');
  perform dblink_send_query(
    'v3a_010_register_b',
    $query$select public.v3a_submit_pending_application(
      'Concurrent User', 'Local', 'advisor', 'independent',
      'v3a-phase-b-preview-2026-07-09', true, null
    )$query$
  );

  perform pg_sleep(0.1);
  if dblink_is_busy('v3a_010_register_b') <> 1 then
    raise exception 'second registration did not wait on advisory lock';
  end if;

  perform dblink_exec('v3a_010_register_a', 'commit');

  select result into second_result
  from dblink_get_result('v3a_010_register_b') as result_row(result jsonb);
  perform *
  from dblink_get_result('v3a_010_register_b') as result_row(result jsonb);
  perform dblink_exec('v3a_010_register_b', 'commit');

  if second_result ->> 'already_exists' <> 'true'
    or first_result #>> '{data,user_id}' is distinct from second_result #>> '{data,user_id}'
    or first_result #>> '{data,profile_id}' is distinct from second_result #>> '{data,profile_id}'
    or first_result #>> '{data,application_id}' is distinct from second_result #>> '{data,application_id}' then
    raise exception 'concurrent repeat was not absorbed idempotently';
  end if;

  perform dblink_disconnect('v3a_010_register_a');
  perform dblink_disconnect('v3a_010_register_b');
exception
  when others then
    if coalesce('v3a_010_register_a' = any(dblink_get_connections()), false) then
      begin
        perform dblink_exec('v3a_010_register_a', 'rollback');
      exception when others then null;
      end;
      perform dblink_disconnect('v3a_010_register_a');
    end if;
    if coalesce('v3a_010_register_b' = any(dblink_get_connections()), false) then
      begin
        perform dblink_exec('v3a_010_register_b', 'rollback');
      exception when others then null;
      end;
      perform dblink_disconnect('v3a_010_register_b');
    end if;
    raise;
end;
$$;

do $$
declare registered_user_id uuid;
begin
  select users_row.id into registered_user_id
  from public.users
  as users_row
  where auth_user_id = 'c1000000-0000-4000-8000-000000000001';

  if registered_user_id is null
    or (select count(*) from public.users users_row where users_row.id = registered_user_id) <> 1
    or (select count(*) from public.advisor_profiles profile where profile.user_id = registered_user_id) <> 1
    or (select count(*) from public.application_reviews review where review.user_id = registered_user_id) <> 1
    or exists (select 1 from public.credit_wallets wallet where wallet.user_id = registered_user_id)
    or exists (select 1 from public.credit_logs credit where credit.user_id = registered_user_id)
    or exists (select 1 from public.invite_codes invite where invite.user_id = registered_user_id)
    or exists (select 1 from public.admin_audit_logs audit where audit.target_id = registered_user_id) then
    raise exception 'concurrent registration produced incorrect artifacts';
  end if;
end;
$$;

delete from public.application_reviews
where user_id in (
  select id from public.users
  where auth_user_id = 'c1000000-0000-4000-8000-000000000001'
);
delete from public.advisor_profiles
where user_id in (
  select id from public.users
  where auth_user_id = 'c1000000-0000-4000-8000-000000000001'
);
delete from public.users
where auth_user_id = 'c1000000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'c1000000-0000-4000-8000-000000000001';

drop extension dblink;

\echo 'PASS 010_v3a_phone_identity_binding_test.sql'
