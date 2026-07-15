-- AIPIWEN V3a Phase B RLS policies and REGISTER_BONUS review guard.
-- Preview-only migration draft. Do not run against production without review.
-- Browser clients can create only their own pending application rows through RLS.
-- High-privilege writes remain reviewed backend/API operations in later phases.

alter table public.users enable row level security;
alter table public.advisor_profiles enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_logs enable row level security;
alter table public.invite_codes enable row level security;
alter table public.invite_relations enable row level security;
alter table public.application_reviews enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.login_events enable row level security;

create or replace function public.v3a_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.v3a_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.v3a_current_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.status
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.v3a_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.role = 'super_admin'
      and u.status = 'active'
  )
$$;

grant execute on function public.v3a_current_user_id() to anon, authenticated;
grant execute on function public.v3a_current_role() to anon, authenticated;
grant execute on function public.v3a_current_status() to anon, authenticated;
grant execute on function public.v3a_is_super_admin() to anon, authenticated;

grant select, insert on public.users to authenticated;
grant select, insert on public.advisor_profiles to authenticated;
grant select, insert on public.application_reviews to authenticated;
grant select on public.credit_wallets to authenticated;
grant select on public.credit_logs to authenticated;
grant select on public.invite_codes to authenticated;
grant select on public.invite_relations to authenticated;
grant select on public.admin_audit_logs to authenticated;
grant select on public.login_events to authenticated;

create or replace function public.v3a_require_register_bonus_approved_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  review_status text;
  review_user_id uuid;
begin
  if new.type <> 'REGISTER_BONUS' then
    return new;
  end if;

  select ar.status, ar.user_id
  into review_status, review_user_id
  from public.application_reviews ar
  where ar.id = new.ref_id;

  if review_status is distinct from 'approved' or review_user_id is distinct from new.user_id then
    raise exception 'REGISTER_BONUS requires an approved application_review for the same user';
  end if;

  return new;
end;
$$;

comment on function public.v3a_require_register_bonus_approved_review() is
  'Phase B database guard for Phase C credit issuance: REGISTER_BONUS must reference an approved application_review for the same user.';

drop trigger if exists credit_logs_require_register_bonus_approved_review on public.credit_logs;
create trigger credit_logs_require_register_bonus_approved_review
before insert on public.credit_logs
for each row execute function public.v3a_require_register_bonus_approved_review();

drop policy if exists v3a_users_read_own_or_super_admin on public.users;
create policy v3a_users_read_own_or_super_admin
on public.users
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or id = public.v3a_current_user_id()
);

drop policy if exists v3a_users_insert_own_pending on public.users;
create policy v3a_users_insert_own_pending
on public.users
for insert
to authenticated
with check (
  auth_user_id = auth.uid()
  and role = 'pending'
  and status = 'pending'
);

drop policy if exists v3a_advisor_profiles_read_own_or_super_admin on public.advisor_profiles;
create policy v3a_advisor_profiles_read_own_or_super_admin
on public.advisor_profiles
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or user_id = public.v3a_current_user_id()
);

drop policy if exists v3a_advisor_profiles_insert_own_pending on public.advisor_profiles;
create policy v3a_advisor_profiles_insert_own_pending
on public.advisor_profiles
for insert
to authenticated
with check (
  user_id = public.v3a_current_user_id()
  and role in ('advisor', 'agent', 'center')
  and status = 'pending'
);

drop policy if exists v3a_credit_wallets_read_active_own_or_super_admin on public.credit_wallets;
create policy v3a_credit_wallets_read_active_own_or_super_admin
on public.credit_wallets
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and user_id = public.v3a_current_user_id()
  )
);

drop policy if exists v3a_credit_logs_read_active_own_or_super_admin on public.credit_logs;
create policy v3a_credit_logs_read_active_own_or_super_admin
on public.credit_logs
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and user_id = public.v3a_current_user_id()
  )
);

drop policy if exists v3a_invite_codes_read_active_own_or_super_admin on public.invite_codes;
create policy v3a_invite_codes_read_active_own_or_super_admin
on public.invite_codes
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and user_id = public.v3a_current_user_id()
  )
);

drop policy if exists v3a_invite_relations_read_active_own_or_super_admin on public.invite_relations;
create policy v3a_invite_relations_read_active_own_or_super_admin
on public.invite_relations
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and (
      inviter_user_id = public.v3a_current_user_id()
      or invitee_user_id = public.v3a_current_user_id()
    )
  )
);

drop policy if exists v3a_application_reviews_read_own_or_super_admin on public.application_reviews;
create policy v3a_application_reviews_read_own_or_super_admin
on public.application_reviews
for select
to authenticated
using (
  public.v3a_is_super_admin()
  or user_id = public.v3a_current_user_id()
);

drop policy if exists v3a_application_reviews_insert_own_pending on public.application_reviews;
create policy v3a_application_reviews_insert_own_pending
on public.application_reviews
for insert
to authenticated
with check (
  user_id = public.v3a_current_user_id()
  and role in ('advisor', 'agent', 'center')
  and status = 'pending'
);

drop policy if exists v3a_admin_audit_logs_read_super_admin_only on public.admin_audit_logs;
create policy v3a_admin_audit_logs_read_super_admin_only
on public.admin_audit_logs
for select
to authenticated
using (public.v3a_is_super_admin());

drop policy if exists v3a_login_events_read_super_admin_only on public.login_events;
create policy v3a_login_events_read_super_admin_only
on public.login_events
for select
to authenticated
using (public.v3a_is_super_admin());

comment on table public.users is
  'V3a users. Browser can insert only its own pending row; role/status approval writes are later reviewed backend operations.';
comment on table public.advisor_profiles is
  'V3a practitioner profiles. Phase B browser can insert/select only its own pending profile; status and certification changes are later reviewed backend operations.';
comment on table public.credit_wallets is
  'V3a credit wallet. Browser writes are not opened; wallet creation and balance mutation are later reviewed backend operations.';
comment on table public.credit_logs is
  'Append-only V3a credit ledger. Browser writes are not opened; REGISTER_BONUS is guarded by approved application_review validation.';
comment on table public.invite_codes is
  'V3a invite codes. Pending users cannot read or create invite codes.';
comment on table public.invite_relations is
  'V3a invite relations. Phase B zero-function preview records invite_code on application_reviews only; relation creation moves to a later backend phase.';
comment on table public.application_reviews is
  'V3a application reviews. Browser can insert/select only its own pending application state; review writes move to a later backend phase.';
comment on table public.admin_audit_logs is
  'V3a admin audit logs. Only super_admin can read; writes move to a later backend phase.';
comment on table public.login_events is
  'V3a login events. Zero-function Phase B does not write login events; Supabase Auth hooks or later backend APIs can add them.';
