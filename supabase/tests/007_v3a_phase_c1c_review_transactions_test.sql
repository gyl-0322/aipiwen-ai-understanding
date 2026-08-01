-- Repeatable Phase C1-C RPC verification.
-- Run only in a disposable/local Supabase database after migration 007.
-- The outer transaction rolls back fixtures, temporary triggers, and all DDL.

begin;

select set_config('request.jwt.claim.role', 'service_role', true);

-- Test fixtures use synthetic auth_user_id values. Dropping this FK is safe
-- only because this entire local verification is rolled back at the end.
alter table public.users
  drop constraint if exists users_auth_user_id_fkey;

insert into public.users (
  id, auth_user_id, role, status, email, display_name, city,
  approved_at, approved_by_user_id
) values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000101', 'super_admin', 'active', 'c1c-admin@example.invalid', 'C1C Admin', 'Test City', null, null),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000102', 'pending', 'pending', 'c1c-approve@example.invalid', 'Approve Fixture', 'Test City', null, null),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000103', 'pending', 'pending', 'c1c-reject@example.invalid', 'Reject Fixture', 'Test City', null, null),
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000104', 'pending', 'pending', 'c1c-step4@example.invalid', 'Step4 Fixture', 'Test City', null, null),
  ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000105', 'pending', 'pending', 'c1c-step5@example.invalid', 'Step5 Fixture', 'Test City', null, null),
  ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000106', 'pending', 'pending', 'c1c-step7@example.invalid', 'Step7 Fixture', 'Test City', null, null),
  ('10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000107', 'advisor', 'active', 'c1c-code-owner@example.invalid', 'Code Owner', 'Test City', now(), '10000000-0000-4000-8000-000000000001');

insert into public.advisor_profiles (
  user_id, role, status, nickname, city, practitioner_type,
  agreement_version, agreed_rules_at
) values
  ('10000000-0000-4000-8000-000000000002', 'advisor', 'pending', 'Approve Fixture', 'Test City', 'independent', 'c1c-test', now()),
  ('10000000-0000-4000-8000-000000000003', 'agent', 'pending', 'Reject Fixture', 'Test City', 'agent', 'c1c-test', now()),
  ('10000000-0000-4000-8000-000000000004', 'advisor', 'pending', 'Step4 Fixture', 'Test City', 'independent', 'c1c-test', now()),
  ('10000000-0000-4000-8000-000000000005', 'center', 'pending', 'Step5 Fixture', 'Test City', 'center', 'c1c-test', now()),
  ('10000000-0000-4000-8000-000000000006', 'advisor', 'pending', 'Step7 Fixture', 'Test City', 'independent', 'c1c-test', now());

insert into public.application_reviews (
  id, user_id, role, status, applied_city, applied_nickname, practitioner_type
) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'advisor', 'pending', 'Test City', 'Approve Fixture', 'independent'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'agent', 'pending', 'Test City', 'Reject Fixture', 'agent'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'advisor', 'pending', 'Test City', 'Step4 Fixture', 'independent'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', 'center', 'pending', 'Test City', 'Step5 Fixture', 'center'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006', 'advisor', 'pending', 'Test City', 'Step7 Fixture', 'independent');

-- Successful approve and idempotent repeat.
do $$
declare
  first_result jsonb;
  repeat_result jsonb;
begin
  first_result := public.v3a_approve_application(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'ADV-ABCDEFGH'
  );
  if first_result ->> 'already_processed' <> 'false' then
    raise exception 'approve should process the pending application';
  end if;

  repeat_result := public.v3a_approve_application(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'ADV-JKMNPQRS'
  );
  if repeat_result ->> 'already_processed' <> 'true' then
    raise exception 'repeat approve should be idempotent';
  end if;

  if not exists (
    select 1 from public.users
    where id = '10000000-0000-4000-8000-000000000002'
      and role = 'advisor' and status = 'active'
  ) then raise exception 'approved user state is incorrect'; end if;

  if not exists (
    select 1 from public.advisor_profiles
    where user_id = '10000000-0000-4000-8000-000000000002'
      and status = 'active'
  ) then raise exception 'approved profile state is incorrect'; end if;

  if (select count(*) from public.credit_wallets where user_id = '10000000-0000-4000-8000-000000000002' and balance = 500) <> 1
    then raise exception 'approve must create exactly one 500-point wallet'; end if;
  if (select count(*) from public.credit_logs where user_id = '10000000-0000-4000-8000-000000000002' and type = 'REGISTER_BONUS' and amount = 500) <> 1
    then raise exception 'approve must create exactly one REGISTER_BONUS'; end if;
  if (select count(*) from public.invite_codes where user_id = '10000000-0000-4000-8000-000000000002' and status = 'active') <> 1
    then raise exception 'approve must create exactly one active invite code'; end if;
  if (select count(*) from public.admin_audit_logs where target_id = '10000000-0000-4000-8000-000000000002' and action = 'APPROVE_APPLICATION') <> 1
    then raise exception 'approve must create exactly one audit log'; end if;
  if not exists (
    select 1 from public.application_reviews
    where id = '20000000-0000-4000-8000-000000000001'
      and status = 'approved'
      and reviewer_user_id = '10000000-0000-4000-8000-000000000001'
  ) then raise exception 'application review was not approved'; end if;
end;
$$;

-- Step 4 failure must roll back user/profile/wallet changes.
create function public.v3a_c1c_test_fail_credit_insert()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = '10000000-0000-4000-8000-000000000004' then
    raise exception 'C1C_TEST_STEP4_FAILURE';
  end if;
  return new;
end;
$$;

create trigger aaa_v3a_c1c_fail_credit_insert
before insert on public.credit_logs
for each row execute function public.v3a_c1c_test_fail_credit_insert();

do $$
declare
  failed boolean := false;
begin
  begin
    perform public.v3a_approve_application(
      '20000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      'ADV-TUVWXYZ2'
    );
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'Step 4 failure was not raised'; end if;
  if not exists (select 1 from public.users where id = '10000000-0000-4000-8000-000000000004' and role = 'pending' and status = 'pending')
    then raise exception 'Step 4 failure did not roll back users'; end if;
  if exists (select 1 from public.credit_wallets where user_id = '10000000-0000-4000-8000-000000000004')
    then raise exception 'Step 4 failure left a wallet'; end if;
  if exists (select 1 from public.credit_logs where user_id = '10000000-0000-4000-8000-000000000004')
    then raise exception 'Step 4 failure left a credit log'; end if;
end;
$$;

drop trigger aaa_v3a_c1c_fail_credit_insert on public.credit_logs;

-- Step 5 invite-code collision must roll back the entire approval.
insert into public.invite_codes (user_id, role, status, code)
values ('10000000-0000-4000-8000-000000000007', 'advisor', 'active', 'CTR-ABCDEFGH');

do $$
declare
  failed boolean := false;
begin
  begin
    perform public.v3a_approve_application(
      '20000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000001',
      'CTR-ABCDEFGH'
    );
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'Step 5 collision was not raised'; end if;
  if not exists (select 1 from public.users where id = '10000000-0000-4000-8000-000000000005' and role = 'pending' and status = 'pending')
    then raise exception 'Step 5 collision did not roll back users'; end if;
  if exists (select 1 from public.credit_wallets where user_id = '10000000-0000-4000-8000-000000000005')
    then raise exception 'Step 5 collision left a wallet'; end if;
  if exists (select 1 from public.credit_logs where user_id = '10000000-0000-4000-8000-000000000005')
    then raise exception 'Step 5 collision left a credit log'; end if;
end;
$$;

-- Step 7 audit failure must roll back all previous writes.
create function public.v3a_c1c_test_fail_audit_insert()
returns trigger
language plpgsql
as $$
begin
  if new.details ->> 'application_id' = '20000000-0000-4000-8000-000000000005' then
    raise exception 'C1C_TEST_STEP7_FAILURE';
  end if;
  return new;
end;
$$;

create trigger aaa_v3a_c1c_fail_audit_insert
before insert on public.admin_audit_logs
for each row execute function public.v3a_c1c_test_fail_audit_insert();

do $$
declare
  failed boolean := false;
begin
  begin
    perform public.v3a_approve_application(
      '20000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000001',
      'ADV-3456789A'
    );
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'Step 7 failure was not raised'; end if;
  if not exists (select 1 from public.users where id = '10000000-0000-4000-8000-000000000006' and role = 'pending' and status = 'pending')
    then raise exception 'Step 7 failure did not roll back users'; end if;
  if exists (select 1 from public.credit_wallets where user_id = '10000000-0000-4000-8000-000000000006')
    then raise exception 'Step 7 failure left a wallet'; end if;
  if exists (select 1 from public.credit_logs where user_id = '10000000-0000-4000-8000-000000000006')
    then raise exception 'Step 7 failure left a credit log'; end if;
  if exists (select 1 from public.invite_codes where user_id = '10000000-0000-4000-8000-000000000006')
    then raise exception 'Step 7 failure left an invite code'; end if;
end;
$$;

drop trigger aaa_v3a_c1c_fail_audit_insert on public.admin_audit_logs;

-- Reject validation, success, no financial artifacts, and repeat idempotency.
do $$
declare
  failed boolean := false;
  first_result jsonb;
  repeat_result jsonb;
begin
  begin
    perform public.v3a_reject_application(
      '20000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      'too short'
    );
  exception when others then
    failed := sqlerrm = 'REJECTION_REASON_TOO_SHORT';
  end;
  if not failed then raise exception 'short rejection reason should fail'; end if;

  first_result := public.v3a_reject_application(
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '资料信息不完整，请补充后重新申请'
  );
  repeat_result := public.v3a_reject_application(
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '资料信息不完整，请补充后重新申请'
  );

  if first_result ->> 'already_processed' <> 'false' or repeat_result ->> 'already_processed' <> 'true'
    then raise exception 'reject idempotency result is incorrect'; end if;
  if not exists (select 1 from public.users where id = '10000000-0000-4000-8000-000000000003' and role = 'pending' and status = 'rejected')
    then raise exception 'rejected user state is incorrect'; end if;
  if not exists (select 1 from public.advisor_profiles where user_id = '10000000-0000-4000-8000-000000000003' and status = 'rejected')
    then raise exception 'rejected profile state is incorrect'; end if;
  if not exists (select 1 from public.application_reviews where id = '20000000-0000-4000-8000-000000000002' and status = 'rejected' and length(rejection_reason) >= 10)
    then raise exception 'application rejection fields are incorrect'; end if;
  if (select count(*) from public.admin_audit_logs where target_id = '10000000-0000-4000-8000-000000000003' and action = 'REJECT_APPLICATION') <> 1
    then raise exception 'reject must create exactly one audit log'; end if;
  if exists (select 1 from public.credit_wallets where user_id = '10000000-0000-4000-8000-000000000003')
    or exists (select 1 from public.credit_logs where user_id = '10000000-0000-4000-8000-000000000003')
    or exists (select 1 from public.invite_codes where user_id = '10000000-0000-4000-8000-000000000003')
    then raise exception 'reject created wallet, credits, or invite code'; end if;
end;
$$;

-- The internal auth-context check rejects ordinary authenticated callers.
do $$
declare
  failed boolean := false;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform public.v3a_approve_application(
      '20000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      'ADV-BCDEFGHJ'
    );
  exception when insufficient_privilege then
    failed := sqlerrm = 'FORBIDDEN';
  end;
  if not failed then raise exception 'ordinary authenticated caller should be forbidden'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

do $$
begin
  if has_function_privilege('authenticated', 'public.v3a_approve_application(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.v3a_reject_application(uuid,uuid,text)', 'execute') then
    raise exception 'authenticated role has RPC execute privilege';
  end if;
  if not has_function_privilege('service_role', 'public.v3a_approve_application(uuid,uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.v3a_reject_application(uuid,uuid,text)', 'execute') then
    raise exception 'service_role is missing RPC execute privilege';
  end if;
  if has_table_privilege('authenticated', 'public.credit_wallets', 'update')
    or has_table_privilege('authenticated', 'public.credit_wallets', 'insert')
    or has_table_privilege('authenticated', 'public.credit_logs', 'insert')
    or has_table_privilege('authenticated', 'public.users', 'update') then
    raise exception 'authenticated role has a forbidden write privilege';
  end if;
end;
$$;

rollback;
