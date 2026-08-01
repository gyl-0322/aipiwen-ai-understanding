-- AIPIWEN V3a Phase C1-B Preview first super_admin bootstrap.
--
-- This migration only installs a guarded bootstrap function. It does not
-- promote a user automatically and does not create wallets, credits, invite
-- codes, or admin audit rows.
--
-- Run exactly one of the commented examples manually in the Supabase Preview
-- SQL editor after replacing the placeholder with the intended existing user.
-- Never use this bootstrap against Production.
--
-- By auth_user_id:
-- select public.v3a_bootstrap_first_super_admin(
--   p_auth_user_id => '00000000-0000-0000-0000-000000000000'::uuid,
--   p_email => null
-- );
--
-- Or by email:
-- select public.v3a_bootstrap_first_super_admin(
--   p_auth_user_id => null,
--   p_email => 'YOUR_EMMA_EMAIL@example.com'
-- );

create or replace function public.v3a_bootstrap_first_super_admin(
  p_auth_user_id uuid default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_auth_user_id uuid;
  target_public_user_id uuid;
begin
  if (p_auth_user_id is null) = (p_email is null) then
    raise exception 'Provide exactly one of p_auth_user_id or p_email';
  end if;

  if p_email is not null and length(btrim(p_email)) = 0 then
    raise exception 'p_email must not be empty';
  end if;

  perform pg_advisory_xact_lock(hashtext('v3a_bootstrap_first_super_admin'));

  select au.id
  into target_auth_user_id
  from auth.users au
  where (
    p_auth_user_id is not null
    and au.id = p_auth_user_id
  ) or (
    p_email is not null
    and lower(au.email) = lower(btrim(p_email))
  )
  limit 1;

  if target_auth_user_id is null then
    raise exception 'Target auth.users row does not exist';
  end if;

  select u.id
  into target_public_user_id
  from public.users u
  where u.auth_user_id = target_auth_user_id
  for update;

  if target_public_user_id is null then
    raise exception 'Target public.users row does not exist';
  end if;

  if exists (
    select 1
    from public.users u
    where u.role = 'super_admin'
      and u.id <> target_public_user_id
  ) then
    raise exception 'A different super_admin already exists; first-admin bootstrap is closed';
  end if;

  update public.users
  set role = 'super_admin',
      status = 'active'
  where id = target_public_user_id;

  return target_public_user_id;
end;
$$;

revoke all on function public.v3a_bootstrap_first_super_admin(uuid, text)
  from public, anon, authenticated;

comment on function public.v3a_bootstrap_first_super_admin(uuid, text) is
  'Preview-only, one-time bootstrap for the first V3a super_admin. Requires an existing auth.users and public.users mapping and performs no wallet, credit, invite, or audit-log writes.';
