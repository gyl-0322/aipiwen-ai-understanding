-- AIPIWEN V3a advisor report RLS helper runtime permission repair.
-- Grants only the helper newly required by migration 020 policies.

begin;

do $$
declare
  v_policy_count integer;
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'v3a_current_role'
      and pg_get_function_identity_arguments(p.oid) = ''
      and pg_get_function_result(p.oid) = 'text'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'
  ) then
    raise exception 'MIGRATION_021_REQUIRES_HARDENED_CURRENT_ROLE_HELPER';
  end if;

  select count(*)
  into v_policy_count
  from pg_policy
  where polname in (
    'v3a_advisor_clients_read_own_or_super_admin',
    'v3a_advisor_reports_read_own_or_super_admin'
  )
    and pg_get_expr(polqual, polrelid) like '%v3a_current_role()%';

  if v_policy_count <> 2 then
    raise exception 'MIGRATION_021_REQUIRES_020_RLS_POLICIES';
  end if;

  if not has_function_privilege(
      'authenticated', 'public.v3a_current_user_id()', 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', 'public.v3a_current_status()', 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', 'public.v3a_is_super_admin()', 'EXECUTE'
    ) then
    raise exception 'MIGRATION_021_REQUIRES_EXISTING_RLS_HELPER_PRIVILEGES';
  end if;
end
$$;

revoke all on function public.v3a_current_role()
  from public, anon, authenticated, service_role;
grant execute on function public.v3a_current_role()
  to authenticated;

do $$
begin
  if not has_function_privilege(
      'authenticated', 'public.v3a_current_role()', 'EXECUTE'
    )
    or has_function_privilege(
      'anon', 'public.v3a_current_role()', 'EXECUTE'
    )
    or has_function_privilege(
      'service_role', 'public.v3a_current_role()', 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', 'public.v3a_current_user_id()', 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', 'public.v3a_current_status()', 'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated', 'public.v3a_is_super_admin()', 'EXECUTE'
    ) then
    raise exception 'MIGRATION_021_POSTFLIGHT_PRIVILEGES_FAILED';
  end if;
end
$$;

commit;
