-- Run only against a disposable local database with migrations 001-011 applied.

begin;

do $$
declare
  fn_oid oid := 'public.v3a_sync_own_first_super_admin_phone()'::regprocedure;
begin
  if has_function_privilege('anon', fn_oid, 'EXECUTE')
    or has_function_privilege('service_role', fn_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', fn_oid, 'EXECUTE') then
    raise exception '011 function grants are incorrect';
  end if;
end;
$$;

insert into auth.users (
  id, email, phone, email_confirmed_at, phone_confirmed_at,
  deleted_at, banned_until, is_anonymous
) values (
  'd1000000-0000-4000-8000-000000000001',
  'admin-011@example.invalid',
  '+8613800138000',
  now(),
  now(),
  null,
  null,
  false
);

select public.v3a_create_first_super_admin_from_auth(
  'd1000000-0000-4000-8000-000000000001',
  'C1D 011 Admin'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","email":"admin-011@example.invalid","phone":"+8613800138000"}',
  true
);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;
do $$
declare
  first_result jsonb;
  repeat_result jsonb;
  public_user_id uuid;
begin
  first_result := public.v3a_sync_own_first_super_admin_phone();
  repeat_result := public.v3a_sync_own_first_super_admin_phone();

  select id into public_user_id
  from public.users
  where auth_user_id = 'd1000000-0000-4000-8000-000000000001';

  if first_result ->> 'success' <> 'true'
    or first_result ->> 'already_synced' <> 'false'
    or repeat_result ->> 'already_synced' <> 'true'
    or not exists (
      select 1 from public.users
      where id = public_user_id
        and phone = '+8613800138000'
        and email = 'admin-011@example.invalid'
        and role = 'super_admin'
        and status = 'active'
    )
    or (
      select count(*) from public.admin_audit_logs
      where action = 'BIND_SUPER_ADMIN_PHONE'
        and admin_id = public_user_id
        and target_id = public_user_id
        and not (details ? 'phone')
    ) <> 1 then
    raise exception '011 same-UUID phone synchronization failed';
  end if;
end;
$$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","email":"admin-011@example.invalid","phone":"+8613900139000"}',
  true
);
set local role authenticated;
do $$
declare
  blocked boolean := false;
begin
  begin
    perform public.v3a_sync_own_first_super_admin_phone();
  exception when invalid_parameter_value then
    blocked := sqlerrm = 'AUTH_PHONE_CLAIM_MISMATCH';
  end;
  if not blocked then raise exception '011 accepted a mismatched JWT phone'; end if;
end;
$$;
reset role;

rollback;

\echo 'PASS 011_v3a_first_super_admin_phone_sync_test.sql'
