-- AIPIWEN V3a Phase C1-C security hardening verification.
--
-- LOCAL/DISPOSABLE DATABASE ONLY. This file intentionally uses psql meta
-- commands and refuses to run unless the caller passes:
--   psql -v c1c_local_test=1 -f supabase/tests/008_..._test.sql
--
-- Never paste or run this test in a Preview or Production SQL editor.

\set ON_ERROR_STOP on
\if :{?c1c_local_test}
\else
  \echo 'Refusing to run: pass -v c1c_local_test=1 in a disposable local database.'
  \quit 3
\endif

-- Reuse the established C1-C success, sequential-repeat, Step 4/5/7 failure
-- rollback, normal reject, and server permission suite.
\ir 007_v3a_phase_c1c_review_transactions_test.sql

begin;

select set_config('request.jwt.claim.role', 'service_role', true);

-- Synthetic local fixtures do not create real auth users. The FK change and
-- every fixture below are rolled back with this transaction.
alter table public.users
  drop constraint if exists users_auth_user_id_fkey;

-- Final schema, RLS, policy, grant, and function-security assertions.
do $$
declare
  table_name text;
  fn regprocedure;
begin
  if (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'users',
        'advisor_profiles',
        'application_reviews',
        'credit_wallets',
        'credit_logs',
        'invite_codes',
        'admin_audit_logs'
      )
      and c.relkind = 'r'
  ) <> 7 then
    raise exception 'one or more Phase C1-C business tables are missing';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'users',
        'advisor_profiles',
        'application_reviews',
        'credit_wallets',
        'credit_logs',
        'invite_codes',
        'admin_audit_logs',
        'invite_relations',
        'login_events'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'RLS is disabled on a final V3a table';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'users',
        'advisor_profiles',
        'application_reviews',
        'credit_wallets',
        'credit_logs',
        'invite_codes',
        'admin_audit_logs',
        'invite_relations',
        'login_events'
      )
      and roles && array['anon', 'public']::name[]
  ) then
    raise exception 'anon/public is included in a final V3a RLS policy';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'credit_wallets'
          and policyname = 'credit_wallets_select_active_own_or_super_admin')
        or (tablename = 'credit_logs'
          and policyname = 'credit_logs_select_active_own_or_super_admin')
        or (tablename = 'invite_codes'
          and policyname = 'invite_codes_select_active_own_or_super_admin')
      )
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) <> 3 then
    raise exception 'final active-workbench asset policies are incomplete';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in ('credit_wallets', 'credit_logs', 'invite_codes')
  ) <> 3 then
    raise exception 'a superseded asset policy remains active';
  end if;

  foreach table_name in array array[
    'public.users',
    'public.advisor_profiles',
    'public.application_reviews',
    'public.credit_wallets',
    'public.credit_logs',
    'public.invite_codes',
    'public.invite_relations',
    'public.admin_audit_logs',
    'public.login_events'
  ]
  loop
    if has_table_privilege('anon', table_name, 'select')
      or has_table_privilege('anon', table_name, 'insert')
      or has_table_privilege('anon', table_name, 'update')
      or has_table_privilege('anon', table_name, 'delete') then
      raise exception 'anon has a final V3a table privilege on %', table_name;
    end if;

    if not has_table_privilege('authenticated', table_name, 'select')
      or has_table_privilege('authenticated', table_name, 'update')
      or has_table_privilege('authenticated', table_name, 'delete')
      or (
        table_name = any(array[
          'public.users',
          'public.advisor_profiles',
          'public.application_reviews'
        ])
        and not has_table_privilege(
          'authenticated',
          table_name,
          'insert'
        )
      )
      or (
        table_name <> all(array[
          'public.users',
          'public.advisor_profiles',
          'public.application_reviews'
        ])
        and has_table_privilege(
          'authenticated',
          table_name,
          'insert'
        )
      ) then
      raise exception 'authenticated final V3a ACL is incorrect on %', table_name;
    end if;
  end loop;

  foreach table_name in array array[
    'public.credit_wallets',
    'public.credit_logs',
    'public.invite_codes'
  ]
  loop
    if has_table_privilege('anon', table_name, 'select')
      or has_table_privilege('anon', table_name, 'insert')
      or has_table_privilege('anon', table_name, 'update')
      or has_table_privilege('anon', table_name, 'delete') then
      raise exception 'anon has an asset table privilege on %', table_name;
    end if;

    if not has_table_privilege('authenticated', table_name, 'select')
      or has_table_privilege('authenticated', table_name, 'insert')
      or has_table_privilege('authenticated', table_name, 'update')
      or has_table_privilege('authenticated', table_name, 'delete') then
      raise exception 'authenticated asset privileges are incorrect on %', table_name;
    end if;

    if has_table_privilege('service_role', table_name, 'insert')
      or has_table_privilege('service_role', table_name, 'update')
      or has_table_privilege('service_role', table_name, 'delete') then
      raise exception 'service_role can bypass the review RPC on %', table_name;
    end if;
  end loop;

  if has_table_privilege(
      'service_role',
      'public.admin_audit_logs',
      'insert'
    )
    or has_table_privilege(
      'service_role',
      'public.admin_audit_logs',
      'update'
    )
    or has_table_privilege(
      'service_role',
      'public.admin_audit_logs',
      'delete'
    ) then
    raise exception 'service_role can write review audit rows outside the RPC';
  end if;

  foreach table_name in array array[
    'public.users',
    'public.advisor_profiles',
    'public.application_reviews',
    'public.invite_codes'
  ]
  loop
    if not has_table_privilege('service_role', table_name, 'select')
      or has_table_privilege('service_role', table_name, 'insert')
      or has_table_privilege('service_role', table_name, 'update')
      or has_table_privilege('service_role', table_name, 'delete') then
      raise exception 'service_role admin API ACL is incorrect on %', table_name;
    end if;
  end loop;

  if has_table_privilege(
      'service_role',
      'public.credit_wallets',
      'select'
    )
    or has_table_privilege(
      'service_role',
      'public.credit_logs',
      'select'
    )
    or has_table_privilege(
      'service_role',
      'public.admin_audit_logs',
      'select'
    ) then
    raise exception 'service_role has an unneeded direct asset/audit read';
  end if;

  foreach fn in array array[
    'public.v3a_current_user_id()'::regprocedure,
    'public.v3a_current_role()'::regprocedure,
    'public.v3a_current_status()'::regprocedure,
    'public.v3a_is_super_admin()'::regprocedure,
    'public.v3a_bootstrap_first_super_admin(uuid,text)'::regprocedure,
    'public.v3a_approve_application(uuid,uuid,text)'::regprocedure,
    'public.v3a_reject_application(uuid,uuid,text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'anon can execute SECURITY DEFINER function %', fn;
    end if;
  end loop;

  if not has_function_privilege(
      'authenticated',
      'public.v3a_current_user_id()',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.v3a_current_status()',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.v3a_is_super_admin()',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.v3a_current_role()',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.v3a_bootstrap_first_super_admin(uuid,text)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.v3a_approve_application(uuid,uuid,text)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.v3a_reject_application(uuid,uuid,text)',
      'execute'
    ) then
    raise exception 'authenticated helper/RPC execute grants are incorrect';
  end if;

  foreach fn in array array[
    'public.v3a_current_user_id()'::regprocedure,
    'public.v3a_current_role()'::regprocedure,
    'public.v3a_current_status()'::regprocedure,
    'public.v3a_is_super_admin()'::regprocedure,
    'public.v3a_bootstrap_first_super_admin(uuid,text)'::regprocedure
  ]
  loop
    if has_function_privilege('service_role', fn, 'execute') then
      raise exception 'service_role can execute restricted helper %', fn;
    end if;
  end loop;

  if not has_function_privilege(
      'service_role',
      'public.v3a_approve_application(uuid,uuid,text)',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.v3a_reject_application(uuid,uuid,text)',
      'execute'
    ) then
    raise exception 'service_role is missing review RPC execute';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'v3a_current_user_id',
        'v3a_current_role',
        'v3a_current_status',
        'v3a_is_super_admin',
        'v3a_bootstrap_first_super_admin',
        'v3a_approve_application',
        'v3a_reject_application'
      )
      and (
        not p.prosecdef
        or not ('search_path=public, pg_temp' = any(p.proconfig))
      )
  ) then
    raise exception 'SECURITY DEFINER/search_path hardening is incomplete';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'public.v3a_approve_application(uuid,uuid,text)'::regprocedure,
      'public.v3a_reject_application(uuid,uuid,text)'::regprocedure
    )
      and (
        p.prorettype <> 'jsonb'::regtype
        or not ('statement_timeout=30s' = any(p.proconfig))
        or p.proargnames is distinct from
          array[
            'p_application_id',
            'p_reviewer_user_id',
            case
              when p.proname = 'v3a_approve_application'
              then 'p_invite_code'
              else 'p_reason'
            end
          ]::text[]
      )
  ) then
    raise exception 'review RPC signature, return type, or timeout changed';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_wallets'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id)'
  ) then
    raise exception 'credit_wallets user uniqueness is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_logs'::regclass
      and conname = 'credit_logs_idempotency_key_key'
      and contype = 'u'
  ) then
    raise exception 'credit_logs idempotency uniqueness is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_logs'::regclass
      and conname = 'credit_logs_register_bonus_shape_check'
      and contype = 'c'
  ) then
    raise exception 'REGISTER_BONUS shape check is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.credit_logs'::regclass
      and tgname = 'credit_logs_require_approved_application'
      and tgenabled <> 'D'
      and not tgisinternal
  ) then
    raise exception 'REGISTER_BONUS approved-application trigger is missing';
  end if;

  if has_function_privilege(
      'anon',
      'public.v3a_credit_logs_require_approved_application()',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.v3a_credit_logs_require_approved_application()',
      'execute'
    )
    or has_function_privilege(
      'service_role',
      'public.v3a_credit_logs_require_approved_application()',
      'execute'
    ) then
    raise exception 'REGISTER_BONUS trigger helper is publicly callable';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.invite_codes'::regclass
      and conname = 'invite_codes_user_id_key'
      and contype = 'u'
  ) then
    raise exception 'invite user_id uniqueness is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.invite_codes'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (code)'
  ) then
    raise exception 'invite code uniqueness is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'admin_audit_logs'
      and c.column_name = 'idempotency_key'
      and c.is_generated = 'ALWAYS'
      and c.is_nullable = 'YES'
  ) then
    raise exception 'admin audit idempotency_key is not nullable/generated';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.admin_audit_logs'::regclass
      and idx.relname = 'admin_audit_logs_idempotency_key_uidx'
      and i.indisunique
      and i.indpred is not null
  ) then
    raise exception 'partial unique audit idempotency index is missing';
  end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);

do $$
declare
  helper_blocked boolean := false;
  rpc_blocked boolean := false;
begin
  begin
    perform public.v3a_current_user_id();
  exception when insufficient_privilege then
    helper_blocked := true;
  end;

  begin
    perform public.v3a_approve_application(
      '8f000000-0000-4000-8000-000000000001',
      '8f000000-0000-4000-8000-000000000002',
      'ADV-ABCDEFGH'
    );
  exception when insufficient_privilege then
    rpc_blocked := true;
  end;

  if not helper_blocked or not rpc_blocked then
    raise exception 'anon executed a restricted helper or RPC';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.users (
  id, auth_user_id, role, status, email, display_name, city,
  approved_at, approved_by_user_id
) values
  ('81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000101', 'super_admin', 'active', 'c1c-008-admin@example.invalid', 'C1C 008 Admin', 'Local', null, null),
  ('81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000102', 'advisor', 'active', 'c1c-008-active-one@example.invalid', 'Active One', 'Local', now(), '81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000103', 'advisor', 'active', 'c1c-008-active-two@example.invalid', 'Active Two', 'Local', now(), '81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000104', 'advisor', 'active', 'c1c-008-active-three@example.invalid', 'Active Three', 'Local', now(), '81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000105', 'pending', 'pending', 'c1c-008-pending@example.invalid', 'Pending User', 'Local', null, null),
  ('81000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000106', 'pending', 'rejected', 'c1c-008-rejected@example.invalid', 'Rejected User', 'Local', null, null),
  ('81000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000107', 'pending', 'pending', 'c1c-008-approve@example.invalid', 'Approve User', 'Local', null, null),
  ('81000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000108', 'pending', 'pending', 'c1c-008-reject@example.invalid', 'Reject User', 'Local', null, null);

insert into public.advisor_profiles (
  user_id, role, status, nickname, city, practitioner_type,
  agreement_version, agreed_rules_at
) values
  ('81000000-0000-4000-8000-000000000007', 'advisor', 'pending', 'Approve User', 'Local', 'independent', 'c1c-008', now()),
  ('81000000-0000-4000-8000-000000000008', 'agent', 'pending', 'Reject User', 'Local', 'agent', 'c1c-008', now());

insert into public.application_reviews (
  id, user_id, role, status, applied_city, applied_nickname, practitioner_type
) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000007', 'advisor', 'pending', 'Local', 'Approve User', 'independent'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000008', 'agent', 'pending', 'Local', 'Reject User', 'agent');

insert into public.application_reviews (
  id, user_id, reviewer_user_id, role, status, applied_city,
  applied_nickname, practitioner_type, reviewed_at, review_note
) values
  (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    'advisor',
    'approved',
    'Local',
    'Active One',
    'independent',
    now(),
    'local approved fixture'
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001',
    'advisor',
    'approved',
    'Local',
    'Active Two',
    'independent',
    now(),
    'local approved fixture'
  );

insert into public.credit_wallets (id, user_id, balance) values
  ('85000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 500),
  ('85000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', 500);

insert into public.credit_logs (
  wallet_id, user_id, type, amount, balance_before, balance_after,
  idempotency_key, operator_id, note
) values
  (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002',
    'REGISTER_BONUS', 500, 0, 500,
    'REGISTER_BONUS:81000000-0000-4000-8000-000000000002:83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'local RLS fixture'
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000003',
    'REGISTER_BONUS', 500, 0, 500,
    'REGISTER_BONUS:81000000-0000-4000-8000-000000000003:83000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    'local RLS fixture'
  );

insert into public.invite_codes (code, user_id, role, status) values
  ('ADV-ABCDEF23', '81000000-0000-4000-8000-000000000002', 'advisor', 'active'),
  ('ADV-ABCDEF45', '81000000-0000-4000-8000-000000000003', 'advisor', 'active');

-- Pending and rejected users cannot read active-workbench assets.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000105',
  true
);

do $$
begin
  if exists (select 1 from public.credit_wallets)
    or exists (select 1 from public.credit_logs)
    or exists (select 1 from public.invite_codes) then
    raise exception 'pending user can read active-workbench assets';
  end if;
end;
$$;

-- The pending page still reads its own account, profile, and application.
select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000107',
  true
);

do $$
begin
  if (select count(*) from public.users
      where id = '81000000-0000-4000-8000-000000000007') <> 1
    or (select count(*) from public.advisor_profiles
      where user_id = '81000000-0000-4000-8000-000000000007') <> 1
    or (select count(*) from public.application_reviews
      where id = '82000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'pending self-service read flow was broken';
  end if;

  if exists (select 1 from public.credit_wallets)
    or exists (select 1 from public.credit_logs)
    or exists (select 1 from public.invite_codes) then
    raise exception 'pending application owner can read active-workbench assets';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000106',
  true
);

do $$
begin
  if exists (select 1 from public.credit_wallets)
    or exists (select 1 from public.credit_logs)
    or exists (select 1 from public.invite_codes) then
    raise exception 'rejected user can read active-workbench assets';
  end if;
end;
$$;

-- Active users see exactly their own asset rows.
select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000102',
  true
);

do $$
declare
  blocked_wallet boolean := false;
  blocked_credit boolean := false;
  blocked_invite boolean := false;
begin
  if (select count(*) from public.credit_wallets) <> 1
    or (select count(*) from public.credit_logs) <> 1
    or (select count(*) from public.invite_codes) <> 1 then
    raise exception 'active user does not see exactly its own assets';
  end if;

  begin
    update public.credit_wallets set balance = balance + 1;
  exception when insufficient_privilege then
    blocked_wallet := true;
  end;

  begin
    insert into public.credit_logs (
      wallet_id, user_id, type, amount, balance_before, balance_after,
      idempotency_key, operator_id, note
    ) values (
      '85000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      'REGISTER_BONUS', 500, 0, 500,
      'REGISTER_BONUS:81000000-0000-4000-8000-000000000002:83000000-0000-4000-8000-000000000099',
      '81000000-0000-4000-8000-000000000001',
      'must be blocked'
    );
  exception when insufficient_privilege then
    blocked_credit := true;
  end;

  begin
    insert into public.invite_codes (code, user_id, role, status)
    values (
      'ADV-ABCDEF67',
      '81000000-0000-4000-8000-000000000002',
      'advisor',
      'active'
    );
  exception when insufficient_privilege then
    blocked_invite := true;
  end;

  if not blocked_wallet or not blocked_credit or not blocked_invite then
    raise exception 'authenticated direct asset write was not blocked';
  end if;
end;
$$;

-- Active super_admin retains management read access.
select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000101',
  true
);

do $$
begin
  if (select count(*) from public.credit_wallets) <> 2
    or (select count(*) from public.credit_logs) <> 2
    or (select count(*) from public.invite_codes) <> 2 then
    raise exception 'active super_admin management read scope is incomplete';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Database uniqueness rejects duplicate user/code/key rows without deleting or
-- rewriting the existing record.
do $$
declare
  duplicate_user_blocked boolean := false;
  duplicate_code_blocked boolean := false;
  duplicate_credit_blocked boolean := false;
  null_bonus_key_blocked boolean := false;
  unapproved_bonus_blocked boolean := false;
  duplicate_approve_audit_blocked boolean := false;
  duplicate_reject_audit_blocked boolean := false;
begin
  begin
    insert into public.invite_codes (code, user_id, role, status)
    values (
      'ADV-ABCDEF89',
      '81000000-0000-4000-8000-000000000002',
      'advisor',
      'disabled'
    );
  exception when unique_violation then
    duplicate_user_blocked := true;
  end;

  begin
    insert into public.invite_codes (code, user_id, role, status)
    values (
      'ADV-ABCDEF23',
      '81000000-0000-4000-8000-000000000004',
      'advisor',
      'active'
    );
  exception when unique_violation then
    duplicate_code_blocked := true;
  end;

  begin
    insert into public.credit_logs (
      wallet_id, user_id, type, amount, balance_before, balance_after,
      idempotency_key, operator_id, note
    ) values (
      '85000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      'REGISTER_BONUS', 500, 0, 500,
      'REGISTER_BONUS:81000000-0000-4000-8000-000000000002:83000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001',
      'duplicate key must fail'
    );
  exception when unique_violation then
    duplicate_credit_blocked := true;
  end;

  begin
    insert into public.credit_logs (
      wallet_id, user_id, type, amount, balance_before, balance_after,
      idempotency_key, operator_id, note
    ) values (
      '85000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      'REGISTER_BONUS', 500, 0, 500,
      null,
      '81000000-0000-4000-8000-000000000001',
      'null key must fail'
    );
  exception when check_violation then
    null_bonus_key_blocked := true;
  end;

  begin
    insert into public.credit_logs (
      wallet_id, user_id, type, amount, balance_before, balance_after,
      idempotency_key, operator_id, note
    ) values (
      '85000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      'REGISTER_BONUS', 500, 0, 500,
      'REGISTER_BONUS:81000000-0000-4000-8000-000000000002:83000000-0000-4000-8000-000000000099',
      '81000000-0000-4000-8000-000000000001',
      'missing approved application must fail'
    );
  exception when check_violation then
    unapproved_bonus_blocked := true;
  end;

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, details
  ) values (
    '81000000-0000-4000-8000-000000000001',
    'APPROVE_APPLICATION',
    'user',
    '81000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'application_id', '84000000-0000-4000-8000-000000000001'
    )
  );

  begin
    insert into public.admin_audit_logs (
      admin_id, action, target_type, target_id, details
    ) values (
      '81000000-0000-4000-8000-000000000001',
      'APPROVE_APPLICATION',
      'user',
      '81000000-0000-4000-8000-000000000003',
      jsonb_build_object(
        'application_id', '84000000-0000-4000-8000-000000000001'
      )
    );
  exception when unique_violation then
    duplicate_approve_audit_blocked := true;
  end;

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, details
  ) values (
    '81000000-0000-4000-8000-000000000001',
    'REJECT_APPLICATION',
    'user',
    '81000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'application_id', '84000000-0000-4000-8000-000000000002'
    )
  );

  begin
    insert into public.admin_audit_logs (
      admin_id, action, target_type, target_id, details
    ) values (
      '81000000-0000-4000-8000-000000000001',
      'REJECT_APPLICATION',
      'user',
      '81000000-0000-4000-8000-000000000003',
      jsonb_build_object(
        'application_id', '84000000-0000-4000-8000-000000000002'
      )
    );
  exception when unique_violation then
    duplicate_reject_audit_blocked := true;
  end;

  if not duplicate_user_blocked
    or not duplicate_code_blocked
    or not duplicate_credit_blocked
    or not null_bonus_key_blocked
    or not unapproved_bonus_blocked
    or not duplicate_approve_audit_blocked
    or not duplicate_reject_audit_blocked then
    raise exception 'one or more database idempotency constraints did not reject a duplicate';
  end if;
end;
$$;

-- Exact approve/reject keys, sequential repeat behavior, and result contract.
do $$
declare
  first_approve jsonb;
  repeat_approve jsonb;
  first_reject jsonb;
  repeat_reject jsonb;
begin
  first_approve := public.v3a_approve_application(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'ADV-JKMNPQRS'
  );
  repeat_approve := public.v3a_approve_application(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'ADV-TUVWXYZ2'
  );

  if first_approve ->> 'already_processed' <> 'false'
    or repeat_approve ->> 'already_processed' <> 'true'
    or first_approve #>> '{data,wallet,balance}' <> '500'
    or first_approve #>> '{data,credit_log,amount}' <> '500' then
    raise exception 'sequential approve result contract is incorrect';
  end if;

  if (select count(*) from public.credit_wallets
      where user_id = '81000000-0000-4000-8000-000000000007') <> 1
    or (select count(*) from public.credit_logs
      where user_id = '81000000-0000-4000-8000-000000000007'
        and idempotency_key =
          'REGISTER_BONUS:81000000-0000-4000-8000-000000000007:82000000-0000-4000-8000-000000000001'
        and amount = 500) <> 1
    or (select count(*) from public.invite_codes
      where user_id = '81000000-0000-4000-8000-000000000007') <> 1
    or (select count(*) from public.admin_audit_logs
      where idempotency_key =
        'APPROVE_APPLICATION:82000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'sequential approve duplicated or missed a resource';
  end if;

  first_reject := public.v3a_reject_application(
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    '资料信息不完整，请补充后重新提交审核'
  );
  repeat_reject := public.v3a_reject_application(
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    '资料信息不完整，请补充后重新提交审核'
  );

  if first_reject ->> 'already_processed' <> 'false'
    or repeat_reject ->> 'already_processed' <> 'true'
    or (select count(*) from public.admin_audit_logs
      where idempotency_key =
        'REJECT_APPLICATION:82000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'sequential reject idempotency is incorrect';
  end if;
end;
$$;

-- Even the function owner cannot bypass the internal service-role guard by
-- calling the RPC with an ordinary authenticated JWT claim.
do $$
declare
  blocked boolean := false;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform public.v3a_approve_application(
      '82000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001',
      'ADV-3456789A'
    );
  exception when insufficient_privilege then
    blocked := sqlerrm = 'FORBIDDEN';
  end;
  if not blocked then
    raise exception 'authenticated JWT bypassed the RPC internal guard';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

rollback;

-- True two-connection concurrency verification. This phase commits synthetic
-- fixtures so the independent sessions can see them; therefore the containing
-- database must be destroyed after the test.
create extension dblink;

insert into auth.users (id, email) values
  (
    '91000000-0000-4000-8000-000000000101',
    'c1c-008-concurrent-admin@example.invalid'
  ),
  (
    '91000000-0000-4000-8000-000000000102',
    'c1c-008-concurrent-user@example.invalid'
  );

insert into public.users (
  id, auth_user_id, role, status, email, display_name, city
) values
  (
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000101',
    'super_admin',
    'active',
    'c1c-008-concurrent-admin@example.invalid',
    'Concurrent Admin',
    'Local'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000102',
    'pending',
    'pending',
    'c1c-008-concurrent-user@example.invalid',
    'Concurrent User',
    'Local'
  );

insert into public.advisor_profiles (
  user_id, role, status, nickname, city, practitioner_type,
  agreement_version, agreed_rules_at
) values (
  '91000000-0000-4000-8000-000000000002',
  'advisor',
  'pending',
  'Concurrent User',
  'Local',
  'independent',
  'c1c-008',
  now()
);

insert into public.application_reviews (
  id, user_id, role, status, applied_city, applied_nickname, practitioner_type
) values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  'advisor',
  'pending',
  'Local',
  'Concurrent User',
  'independent'
);

do $$
declare
  connection_info text := format(
    'host=127.0.0.1 port=%s dbname=%L user=%L connect_timeout=5',
    inet_server_port(),
    current_database(),
    current_user
  );
  first_result jsonb;
  concurrent_result jsonb;
begin
  perform dblink_connect('v3a_c1c_approve_a', connection_info);
  perform dblink_connect('v3a_c1c_approve_b', connection_info);

  perform dblink_exec('v3a_c1c_approve_a', 'begin');
  perform dblink_exec('v3a_c1c_approve_a', 'set role service_role');
  perform dblink_exec(
    'v3a_c1c_approve_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform dblink_send_query(
    'v3a_c1c_approve_a',
    format(
      'select public.v3a_approve_application(%L::uuid, %L::uuid, %L::text)',
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'ADV-ABCDEFGH'
    )
  );

  select result
  into first_result
  from dblink_get_result('v3a_c1c_approve_a') as t(result jsonb);
  perform *
  from dblink_get_result('v3a_c1c_approve_a') as t(result jsonb);

  if first_result ->> 'already_processed' <> 'false' then
    raise exception 'first concurrent approve did not process the application';
  end if;

  -- Session A has completed the function but has not committed, so its
  -- application row lock and every resource write remain uncommitted.
  perform dblink_exec('v3a_c1c_approve_b', 'begin');
  perform dblink_exec('v3a_c1c_approve_b', 'set role service_role');
  perform dblink_exec(
    'v3a_c1c_approve_b',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform dblink_send_query(
    'v3a_c1c_approve_b',
    format(
      'select public.v3a_approve_application(%L::uuid, %L::uuid, %L::text)',
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'ADV-JKMNPQRS'
    )
  );

  perform pg_sleep(0.1);
  if dblink_is_busy('v3a_c1c_approve_b') <> 1 then
    raise exception 'second concurrent approve did not wait on the row lock';
  end if;

  perform dblink_exec('v3a_c1c_approve_a', 'commit');

  select result
  into concurrent_result
  from dblink_get_result('v3a_c1c_approve_b') as t(result jsonb);
  perform *
  from dblink_get_result('v3a_c1c_approve_b') as t(result jsonb);
  perform dblink_exec('v3a_c1c_approve_b', 'commit');

  if concurrent_result ->> 'already_processed' <> 'true' then
    raise exception 'second concurrent approve was not absorbed idempotently';
  end if;

  if first_result #>> '{data,audit_log_id}'
    is distinct from concurrent_result #>> '{data,audit_log_id}' then
    raise exception 'concurrent approve returned different audit rows';
  end if;

  perform dblink_disconnect('v3a_c1c_approve_a');
  perform dblink_disconnect('v3a_c1c_approve_b');
exception
  when others then
    if coalesce(
      'v3a_c1c_approve_a' = any(dblink_get_connections()),
      false
    ) then
      begin
        perform dblink_exec('v3a_c1c_approve_a', 'rollback');
      exception when others then
        null;
      end;
      perform dblink_disconnect('v3a_c1c_approve_a');
    end if;

    if coalesce(
      'v3a_c1c_approve_b' = any(dblink_get_connections()),
      false
    ) then
      begin
        perform dblink_exec('v3a_c1c_approve_b', 'rollback');
      exception when others then
        null;
      end;
      perform dblink_disconnect('v3a_c1c_approve_b');
    end if;
    raise;
end;
$$;

do $$
begin
  if (select count(*) from public.credit_wallets
      where user_id = '91000000-0000-4000-8000-000000000002'
        and balance = 500) <> 1 then
    raise exception 'concurrent approve did not leave exactly one wallet';
  end if;

  if (select count(*) from public.credit_logs
      where user_id = '91000000-0000-4000-8000-000000000002'
        and type = 'REGISTER_BONUS'
        and amount = 500
        and balance_before = 0
        and balance_after = 500
        and idempotency_key =
          'REGISTER_BONUS:91000000-0000-4000-8000-000000000002:92000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'concurrent approve duplicated or changed REGISTER_BONUS';
  end if;

  if (select count(*) from public.invite_codes
      where user_id = '91000000-0000-4000-8000-000000000002'
        and code = 'ADV-ABCDEFGH') <> 1 then
    raise exception 'concurrent approve did not leave exactly one invite code';
  end if;

  if (select count(*) from public.admin_audit_logs
      where action = 'APPROVE_APPLICATION'
        and idempotency_key =
          'APPROVE_APPLICATION:92000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'concurrent approve duplicated or missed its audit row';
  end if;

  if not exists (
    select 1
    from public.users
    where id = '91000000-0000-4000-8000-000000000002'
      and role = 'advisor'
      and status = 'active'
  ) or not exists (
    select 1
    from public.advisor_profiles
    where user_id = '91000000-0000-4000-8000-000000000002'
      and status = 'active'
  ) or not exists (
    select 1
    from public.application_reviews
    where id = '92000000-0000-4000-8000-000000000001'
      and status = 'approved'
  ) then
    raise exception 'concurrent approve did not complete the related state';
  end if;
end;
$$;

drop extension dblink;

\echo 'PASS 008_v3a_phase_c1c_security_hardening_test.sql'
