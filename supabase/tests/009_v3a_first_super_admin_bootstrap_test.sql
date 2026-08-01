-- AIPIWEN V3a Phase C1-C first super_admin bootstrap verification.
--
-- LOCAL/DISPOSABLE DATABASE ONLY. The concurrency phase commits synthetic
-- fixtures. Never paste or run this file in Preview or Production.

\set ON_ERROR_STOP on
\if :{?c1c_local_test}
\else
  \echo 'Refusing to run: pass -v c1c_local_test=1 in a disposable local database.'
  \quit 3
\endif

begin;

do $$
declare
  fn_oid oid := 'public.v3a_create_first_super_admin_from_auth(uuid,text)'::regprocedure;
  fn_config text[];
begin
  if not exists (
    select 1
    from pg_proc
    where oid = fn_oid
      and prosecdef
      and pg_get_function_result(oid) = 'jsonb'
  ) then
    raise exception 'new bootstrap is missing or is not SECURITY DEFINER/jsonb';
  end if;

  select proconfig into fn_config from pg_proc where oid = fn_oid;
  if not ('search_path=public, pg_temp' = any(fn_config))
    or not ('statement_timeout=30s' = any(fn_config)) then
    raise exception 'new bootstrap function settings are unsafe: %', fn_config;
  end if;

  if has_function_privilege('public', fn_oid, 'execute')
    or has_function_privilege('anon', fn_oid, 'execute')
    or has_function_privilege('authenticated', fn_oid, 'execute')
    or has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'a non-owner role can execute the new bootstrap';
  end if;

  if to_regprocedure(
    'public.v3a_bootstrap_first_super_admin(uuid,text)'
  ) is null then
    raise exception 'the existing bootstrap function was removed';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.admin_audit_logs'::regclass
      and idx.relname = 'admin_audit_logs_idempotency_key_uidx'
      and i.indisunique
      and pg_get_expr(i.indpred, i.indrelid) =
        '(idempotency_key IS NOT NULL)'
  ) then
    raise exception 'audit idempotency partial unique index is missing';
  end if;
end;
$$;

insert into auth.users (
  id, email, email_confirmed_at, confirmed_at, deleted_at, banned_until,
  is_anonymous
) values
  (
    '93000000-0000-4000-8000-000000000001',
    'unverified@example.invalid',
    null,
    null,
    null,
    null,
    false
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    'deleted@example.invalid',
    now(),
    now(),
    now(),
    null,
    false
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    'banned@example.invalid',
    now(),
    now(),
    null,
    now() + interval '1 day',
    false
  ),
  (
    '93000000-0000-4000-8000-000000000004',
    null,
    now(),
    now(),
    null,
    null,
    false
  ),
  (
    '93000000-0000-4000-8000-000000000005',
    'anonymous@example.invalid',
    now(),
    now(),
    null,
    null,
    true
  );

do $$
declare
  blocked boolean;
begin
  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000099', 'Missing User'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_USER_NOT_FOUND';
  end;
  if not blocked then
    raise exception 'missing auth user was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000001', 'Unverified User'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_EMAIL_NOT_VERIFIED';
  end;
  if not blocked then
    raise exception 'unverified auth user was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000002', 'Deleted User'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_USER_UNAVAILABLE';
  end;
  if not blocked then
    raise exception 'deleted auth user was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000003', 'Banned User'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_USER_UNAVAILABLE';
  end;
  if not blocked then
    raise exception 'banned auth user was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000004', 'No Email'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_EMAIL_REQUIRED';
  end;
  if not blocked then
    raise exception 'auth user without email was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000005', 'Anonymous User'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_USER_UNAVAILABLE';
  end;
  if not blocked then
    raise exception 'anonymous auth user was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000001', '   '
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'INVALID_DISPLAY_NAME';
  end;
  if not blocked then
    raise exception 'empty display name was accepted';
  end if;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '93000000-0000-4000-8000-000000000001', '<script>'
    );
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'INVALID_DISPLAY_NAME';
  end;
  if not blocked then
    raise exception 'unsafe display name was accepted';
  end if;
end;
$$;

rollback;

-- Normal creation, ordinary-user coexistence, idempotent repeat, artifact
-- isolation, email provenance, and second-user rejection.
begin;

insert into auth.users (
  id, email, email_confirmed_at, confirmed_at, deleted_at, banned_until,
  is_anonymous
) values
  (
    '94000000-0000-4000-8000-000000000001',
    'ordinary@example.invalid',
    now(), now(), null, null, false
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    'first-admin@example.invalid',
    now(), now(), null, null, false
  ),
  (
    '94000000-0000-4000-8000-000000000003',
    'second-admin@example.invalid',
    now(), now(), null, null, false
  );

insert into public.users (
  id, auth_user_id, role, status, email, display_name, city
) values (
  '94100000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'pending',
  'pending',
  'ordinary@example.invalid',
  'Ordinary User',
  'Local'
);

do $$
declare
  first_result jsonb;
  repeat_result jsonb;
  public_user_id uuid;
  blocked boolean := false;
begin
  first_result := public.v3a_create_first_super_admin_from_auth(
    '94000000-0000-4000-8000-000000000002',
    '  First Admin  '
  );
  repeat_result := public.v3a_create_first_super_admin_from_auth(
    '94000000-0000-4000-8000-000000000002',
    'First Admin'
  );
  public_user_id := (first_result ->> 'user_id')::uuid;

  if first_result ->> 'already_initialized' <> 'false'
    or repeat_result ->> 'already_initialized' <> 'true'
    or first_result ->> 'user_id' is distinct from repeat_result ->> 'user_id'
    or first_result ->> 'audit_log_id'
      is distinct from repeat_result ->> 'audit_log_id'
    or first_result ->> 'email' = 'first-admin@example.invalid' then
    raise exception 'same-user repeat was not idempotent';
  end if;

  if not exists (
    select 1
    from public.users users_row
    where users_row.id = public_user_id
      and users_row.auth_user_id =
        '94000000-0000-4000-8000-000000000002'
      and users_row.email = 'first-admin@example.invalid'
      and users_row.display_name = 'First Admin'
      and users_row.role = 'super_admin'
      and users_row.status = 'active'
  ) then
    raise exception 'created public.users row is incorrect';
  end if;

  if (select count(*) from public.admin_audit_logs
      where idempotency_key = 'FIRST_SUPER_ADMIN:' || public_user_id::text
        and action = 'FIRST_SUPER_ADMIN'
        and admin_id = public_user_id
        and target_id = public_user_id) <> 1 then
    raise exception 'FIRST_SUPER_ADMIN audit is missing or duplicated';
  end if;

  blocked := false;
  begin
    insert into public.admin_audit_logs (
      admin_id, action, target_type, target_id, details
    ) values (
      public_user_id,
      'FIRST_SUPER_ADMIN',
      'user',
      public_user_id,
      jsonb_build_object(
        'user_id', public_user_id,
        'auth_user_id', '94000000-0000-4000-8000-000000000002'::uuid
      )
    );
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'database accepted a duplicate FIRST_SUPER_ADMIN audit key';
  end if;

  if exists (
    select 1 from public.advisor_profiles where user_id = public_user_id
  ) or exists (
    select 1 from public.application_reviews where user_id = public_user_id
  ) or exists (
    select 1 from public.credit_wallets where user_id = public_user_id
  ) or exists (
    select 1 from public.credit_logs where user_id = public_user_id
  ) or exists (
    select 1 from public.invite_codes where user_id = public_user_id
  ) or exists (
    select 1 from public.invite_relations
    where inviter_user_id = public_user_id or invitee_user_id = public_user_id
  ) or exists (
    select 1 from public.login_events where user_id = public_user_id
  ) then
    raise exception 'bootstrap created a forbidden advisor/workbench artifact';
  end if;

  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '94000000-0000-4000-8000-000000000003',
      'Second Admin'
    );
  exception when object_not_in_prerequisite_state then
    blocked := sqlerrm = 'FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED';
  end;
  if not blocked then
    raise exception 'a second auth user initialized another first admin';
  end if;

  update public.users
  set status = 'disabled'
  where id = public_user_id;

  blocked := false;
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '94000000-0000-4000-8000-000000000003',
      'Second Admin'
    );
  exception when object_not_in_prerequisite_state then
    blocked := sqlerrm = 'FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED';
  end;
  if not blocked then
    raise exception 'bootstrap reopened after the first admin became inactive';
  end if;
end;
$$;

rollback;

-- Existing target mappings and existing case-insensitive emails are rejected.
begin;

insert into auth.users (
  id, email, email_confirmed_at, confirmed_at, deleted_at, banned_until,
  is_anonymous
) values
  (
    '94500000-0000-4000-8000-000000000001',
    'mapped@example.invalid',
    now(), now(), null, null, false
  ),
  (
    '94500000-0000-4000-8000-000000000002',
    'collision@example.invalid',
    now(), now(), null, null, false
  ),
  (
    '94500000-0000-4000-8000-000000000003',
    'unrelated@example.invalid',
    now(), now(), null, null, false
  );

insert into public.users (
  id, auth_user_id, role, status, email, display_name, city
) values
  (
    '94600000-0000-4000-8000-000000000001',
    '94500000-0000-4000-8000-000000000001',
    'pending', 'pending', 'mapped@example.invalid', 'Mapped User', 'Local'
  ),
  (
    '94600000-0000-4000-8000-000000000002',
    '94500000-0000-4000-8000-000000000003',
    'pending', 'pending', 'COLLISION@example.invalid', 'Other User', 'Local'
  );

do $$
declare
  mapping_blocked boolean := false;
  email_blocked boolean := false;
begin
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '94500000-0000-4000-8000-000000000001', 'Mapped User'
    );
  exception when unique_violation then
    mapping_blocked := sqlerrm = 'PUBLIC_USER_MAPPING_ALREADY_EXISTS';
  end;

  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '94500000-0000-4000-8000-000000000002', 'Collision User'
    );
  exception when unique_violation then
    email_blocked := sqlerrm = 'PUBLIC_USER_EMAIL_ALREADY_EXISTS';
  end;

  if not mapping_blocked or not email_blocked then
    raise exception 'mapping/email collision checks are incomplete';
  end if;
end;
$$;

rollback;

-- A pre-existing active super_admin permanently closes first initialization.
begin;

insert into auth.users (
  id, email, email_confirmed_at, confirmed_at, deleted_at, banned_until,
  is_anonymous
) values
  (
    '95000000-0000-4000-8000-000000000001',
    'existing-admin@example.invalid',
    now(), now(), null, null, false
  ),
  (
    '95000000-0000-4000-8000-000000000002',
    'candidate-admin@example.invalid',
    now(), now(), null, null, false
  );

insert into public.users (
  id, auth_user_id, role, status, email, display_name, city,
  approved_at, approved_by_user_id
) values (
  '95100000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  'super_admin',
  'active',
  'existing-admin@example.invalid',
  'Existing Admin',
  'Local',
  now(),
  '95100000-0000-4000-8000-000000000001'
);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform public.v3a_create_first_super_admin_from_auth(
      '95000000-0000-4000-8000-000000000002',
      'Candidate Admin'
    );
  exception when object_not_in_prerequisite_state then
    blocked := sqlerrm = 'FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED';
  end;
  if not blocked then
    raise exception 'existing active super_admin did not close bootstrap';
  end if;
end;
$$;

rollback;

-- True two-connection race. Synthetic fixtures are committed, so this test
-- must only run in a disposable local database.
create extension dblink;

insert into auth.users (
  id, email, email_confirmed_at, confirmed_at, deleted_at, banned_until,
  is_anonymous
) values
  (
    '96000000-0000-4000-8000-000000000001',
    'concurrent-a@example.invalid',
    now(), now(), null, null, false
  ),
  (
    '96000000-0000-4000-8000-000000000002',
    'concurrent-b@example.invalid',
    now(), now(), null, null, false
  );

create function public.v3a_009_bootstrap_safe(
  p_user_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'ok', true,
    'result', public.v3a_create_first_super_admin_from_auth(
      p_user_id,
      p_display_name
    )
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

do $$
declare
  connection_info text := format(
    'host=127.0.0.1 port=%s dbname=%L user=%L connect_timeout=5',
    current_setting('port'),
    current_database(),
    current_user
  );
  first_result jsonb;
  second_result jsonb;
begin
  perform dblink_connect('v3a_009_bootstrap_a', connection_info);
  perform dblink_connect('v3a_009_bootstrap_b', connection_info);

  perform dblink_exec('v3a_009_bootstrap_a', 'begin');
  perform dblink_send_query(
    'v3a_009_bootstrap_a',
    format(
      'select public.v3a_009_bootstrap_safe(%L::uuid, %L::text)',
      '96000000-0000-4000-8000-000000000001',
      'Concurrent Admin A'
    )
  );

  select result into first_result
  from dblink_get_result('v3a_009_bootstrap_a') as t(result jsonb);
  perform *
  from dblink_get_result('v3a_009_bootstrap_a') as t(result jsonb);

  if first_result ->> 'ok' <> 'true' then
    raise exception 'first concurrent bootstrap failed: %', first_result;
  end if;

  perform dblink_exec('v3a_009_bootstrap_b', 'begin');
  perform dblink_send_query(
    'v3a_009_bootstrap_b',
    format(
      'select public.v3a_009_bootstrap_safe(%L::uuid, %L::text)',
      '96000000-0000-4000-8000-000000000002',
      'Concurrent Admin B'
    )
  );

  perform pg_sleep(0.1);
  if dblink_is_busy('v3a_009_bootstrap_b') <> 1 then
    raise exception 'second concurrent bootstrap did not wait on advisory lock';
  end if;

  perform dblink_exec('v3a_009_bootstrap_a', 'commit');

  select result into second_result
  from dblink_get_result('v3a_009_bootstrap_b') as t(result jsonb);
  perform *
  from dblink_get_result('v3a_009_bootstrap_b') as t(result jsonb);
  perform dblink_exec('v3a_009_bootstrap_b', 'commit');

  if second_result ->> 'ok' <> 'false'
    or second_result ->> 'error' <>
      'FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED' then
    raise exception 'second concurrent bootstrap was not safely rejected: %',
      second_result;
  end if;

  perform dblink_disconnect('v3a_009_bootstrap_a');
  perform dblink_disconnect('v3a_009_bootstrap_b');
exception
  when others then
    if coalesce(
      'v3a_009_bootstrap_a' = any(dblink_get_connections()),
      false
    ) then
      begin
        perform dblink_exec('v3a_009_bootstrap_a', 'rollback');
      exception when others then
        null;
      end;
      perform dblink_disconnect('v3a_009_bootstrap_a');
    end if;

    if coalesce(
      'v3a_009_bootstrap_b' = any(dblink_get_connections()),
      false
    ) then
      begin
        perform dblink_exec('v3a_009_bootstrap_b', 'rollback');
      exception when others then
        null;
      end;
      perform dblink_disconnect('v3a_009_bootstrap_b');
    end if;
    raise;
end;
$$;

do $$
begin
  if (select count(*) from public.users
      where role = 'super_admin' and status = 'active') <> 1 then
    raise exception 'concurrency created an incorrect super_admin count';
  end if;

  if (select count(*) from public.admin_audit_logs
      where action = 'FIRST_SUPER_ADMIN') <> 1 then
    raise exception 'concurrency created an incorrect bootstrap audit count';
  end if;

  if (select count(*) from public.advisor_profiles) <> 0
    or (select count(*) from public.application_reviews) <> 0
    or (select count(*) from public.credit_wallets) <> 0
    or (select count(*) from public.credit_logs) <> 0
    or (select count(*) from public.invite_codes) <> 0
    or (select count(*) from public.invite_relations) <> 0
    or (select count(*) from public.login_events) <> 0 then
    raise exception 'concurrent bootstrap created forbidden artifacts';
  end if;
end;
$$;

drop function public.v3a_009_bootstrap_safe(uuid, text);
drop extension dblink;

\echo 'PASS 009_v3a_first_super_admin_bootstrap_test.sql'
