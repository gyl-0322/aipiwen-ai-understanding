-- AIPIWEN V3a Phase C1-A RLS and browser privileges.
-- No browser role receives INSERT, UPDATE, or DELETE privileges on these tables.

alter table public.credit_wallets enable row level security;
alter table public.credit_logs enable row level security;
alter table public.invite_codes enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.credit_wallets from public, anon, authenticated;
revoke all on table public.credit_logs from public, anon, authenticated;
revoke all on table public.invite_codes from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;

grant select on table public.credit_wallets to authenticated;
grant select on table public.credit_logs to authenticated;
grant select on table public.invite_codes to authenticated;
grant select on table public.admin_audit_logs to authenticated;

drop policy if exists v3a_credit_wallets_read_active_own_or_super_admin
  on public.credit_wallets;
drop policy if exists v3a_credit_wallets_read_own
  on public.credit_wallets;
create policy v3a_credit_wallets_read_own
on public.credit_wallets
for select
to authenticated
using (user_id = public.v3a_current_user_id());

drop policy if exists v3a_credit_logs_read_active_own_or_super_admin
  on public.credit_logs;
drop policy if exists v3a_credit_logs_read_own
  on public.credit_logs;
create policy v3a_credit_logs_read_own
on public.credit_logs
for select
to authenticated
using (user_id = public.v3a_current_user_id());

drop policy if exists v3a_invite_codes_read_active_own_or_super_admin
  on public.invite_codes;
drop policy if exists v3a_invite_codes_read_active_own
  on public.invite_codes;
create policy v3a_invite_codes_read_active_own
on public.invite_codes
for select
to authenticated
using (
  public.v3a_current_status() = 'active'
  and user_id = public.v3a_current_user_id()
);

drop policy if exists v3a_admin_audit_logs_read_super_admin_only
  on public.admin_audit_logs;
create policy v3a_admin_audit_logs_read_super_admin_only
on public.admin_audit_logs
for select
to authenticated
using (public.v3a_is_super_admin());
