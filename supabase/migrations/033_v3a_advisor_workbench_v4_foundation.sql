-- AIPIWEN Advisor Workbench V4 foundation.
-- Creates only new public-schema objects. Review before any environment execution.

begin;

do $$
begin
  if to_regclass('public.users') is null
     or to_regclass('public.advisor_clients') is null
     or to_regclass('public.advisor_reports') is null
     or to_regprocedure('public.v3a_set_updated_at()') is null
     or to_regprocedure('public.v3a_current_user_id()') is null
     or to_regprocedure('public.v3a_current_role()') is null
     or to_regprocedure('public.v3a_current_status()') is null
     or to_regprocedure('public.v3a_is_super_admin()') is null then
    raise exception 'MIGRATION_033_REQUIRES_V3A_ADVISOR_FOUNDATION';
  end if;

  if to_regclass('public.growth_records') is not null
     or to_regclass('public.coaching_sessions') is not null
     or to_regclass('public.service_stage_log') is not null
     or to_regclass('public.case_card') is not null then
    raise exception 'MIGRATION_033_ALREADY_OR_PARTIALLY_APPLIED';
  end if;

  if not has_function_privilege('authenticated', 'public.v3a_current_user_id()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.v3a_current_role()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.v3a_current_status()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.v3a_is_super_admin()', 'EXECUTE') then
    raise exception 'MIGRATION_033_REQUIRES_RLS_HELPER_PERMISSIONS';
  end if;
end
$$;

lock table public.users in share row exclusive mode;
lock table public.advisor_clients in share row exclusive mode;
lock table public.advisor_reports in share row exclusive mode;

create table public.growth_records (
  id                          uuid primary key default gen_random_uuid(),
  advisor_client_id           uuid not null references public.advisor_clients(id) on delete restrict,
  advisor_user_id             uuid not null references public.users(id) on delete restrict,
  record_type                 text not null,
  domain_tags                 text[] not null default '{}',
  change_direction            text not null,
  related_fingerprint_markers text[] not null default '{}',
  visibility                  text not null default 'advisor_only',
  content                     text not null,
  source                      text not null default 'advisor_workbench',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint growth_records_record_type_check
    check (record_type in ('advisor_obs', 'parent_feedback', 'child_self_report', 'key_event', 'service_decision')),
  constraint growth_records_domain_tags_check
    check (domain_tags <@ array['learning', 'behavior', 'emotion', 'social', 'parent_child', 'family_system', 'physical']::text[]),
  constraint growth_records_direction_check
    check (change_direction in ('improving', 'stable', 'declining', 'new_emergence', 'resolved')),
  constraint growth_records_markers_check
    check (related_fingerprint_markers <@ array['TRC', 'ATD', 'pattern', 'personality', 'channel', 'brain']::text[]),
  constraint growth_records_visibility_check
    check (visibility in ('advisor_only', 'shared')),
  constraint growth_records_content_check
    check (char_length(btrim(content)) between 1 and 2000),
  constraint growth_records_source_check
    check (source in ('advisor_workbench', 'coaching_session'))
);

create index growth_records_advisor_client_created_idx
  on public.growth_records (advisor_user_id, advisor_client_id, created_at desc);
create index growth_records_direction_created_idx
  on public.growth_records (advisor_user_id, change_direction, created_at desc);

create trigger growth_records_set_updated_at
  before update on public.growth_records
  for each row execute function public.v3a_set_updated_at();

create table public.coaching_sessions (
  id                uuid primary key default gen_random_uuid(),
  advisor_client_id uuid not null references public.advisor_clients(id) on delete restrict,
  advisor_user_id   uuid not null references public.users(id) on delete restrict,
  coaching_type     text not null,
  session_type      text not null,
  topic             text not null,
  suggestion        jsonb not null,
  parent_reaction   text,
  session_effect    text,
  next_plan         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint coaching_sessions_coaching_type_check
    check (coaching_type in ('phone_follow_up', 'deep_coaching', 'initial_interpretation', 'emergency', 'daily_follow_up')),
  constraint coaching_sessions_session_type_check
    check (session_type in ('pre_call', 'post_call', 'free')),
  constraint coaching_sessions_topic_check
    check (char_length(btrim(topic)) between 2 and 1000),
  constraint coaching_sessions_suggestion_check
    check (jsonb_typeof(suggestion) = 'object' and suggestion <> '{}'::jsonb and octet_length(suggestion::text) <= 32768),
  constraint coaching_sessions_notes_check
    check (
      (parent_reaction is null or char_length(parent_reaction) <= 2000)
      and (session_effect is null or char_length(session_effect) <= 2000)
      and (next_plan is null or char_length(next_plan) <= 2000)
    )
);

create index coaching_sessions_advisor_client_created_idx
  on public.coaching_sessions (advisor_user_id, advisor_client_id, created_at desc);

create trigger coaching_sessions_set_updated_at
  before update on public.coaching_sessions
  for each row execute function public.v3a_set_updated_at();

create table public.service_stage_log (
  id                uuid primary key default gen_random_uuid(),
  advisor_client_id uuid not null references public.advisor_clients(id) on delete restrict,
  advisor_user_id   uuid not null references public.users(id) on delete restrict,
  from_stage        text,
  to_stage          text not null,
  reason            text not null,
  created_at        timestamptz not null default now(),

  constraint service_stage_log_from_stage_check
    check (from_stage is null or from_stage in ('initial', 'early', 'deep', 'consolidation')),
  constraint service_stage_log_to_stage_check
    check (to_stage in ('initial', 'early', 'deep', 'consolidation')),
  constraint service_stage_log_transition_check
    check (from_stage is null or from_stage <> to_stage),
  constraint service_stage_log_reason_check
    check (char_length(btrim(reason)) between 1 and 500)
);

create index service_stage_log_advisor_client_created_idx
  on public.service_stage_log (advisor_user_id, advisor_client_id, created_at desc);

create table public.case_card (
  id                       uuid primary key default gen_random_uuid(),
  advisor_client_id        uuid not null references public.advisor_clients(id) on delete restrict,
  advisor_user_id          uuid not null references public.users(id) on delete restrict,
  title                    text not null,
  content                  text not null,
  case_type                text[] not null default '{}',
  auto_detected            boolean not null default false,
  detection_rule           text,
  visibility               text not null default 'private',
  hq_review_comment        text,
  hq_reviewed_by           uuid references public.users(id) on delete restrict,
  hq_reviewed_at           timestamptz,
  related_knowledge_cards  text[] not null default '{}',
  key_turning_points       jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint case_card_title_check
    check (char_length(btrim(title)) between 1 and 120),
  constraint case_card_content_check
    check (char_length(btrim(content)) between 1 and 5000),
  constraint case_card_type_check
    check (
      cardinality(case_type) between 1 and 7
      and case_type <@ array[
        'fingerprint_rare', 'coaching_effective', 'turning_point', 'stubborn_problem',
        'parent_child_improvement', 'long_term_tracking', 'other'
      ]::text[]
    ),
  constraint case_card_detection_rule_check
    check (
      (auto_detected and detection_rule is not null and char_length(detection_rule) between 1 and 80)
      or (not auto_detected and detection_rule is null)
    ),
  constraint case_card_visibility_check
    check (visibility in ('private', 'submitted', 'shared', 'returned')),
  constraint case_card_review_shape_check
    check (
      (visibility in ('shared', 'returned') and hq_reviewed_by is not null and hq_reviewed_at is not null)
      or (visibility in ('private', 'submitted') and hq_reviewed_by is null and hq_reviewed_at is null)
    ),
  constraint case_card_review_comment_check
    check (hq_review_comment is null or char_length(hq_review_comment) <= 1000),
  constraint case_card_knowledge_cards_check
    check (cardinality(related_knowledge_cards) <= 30),
  constraint case_card_turning_points_check
    check (jsonb_typeof(key_turning_points) = 'array' and octet_length(key_turning_points::text) <= 16384)
);

create index case_card_advisor_created_idx
  on public.case_card (advisor_user_id, created_at desc);
create index case_card_visibility_created_idx
  on public.case_card (visibility, created_at desc);
create unique index case_card_auto_detection_unique_idx
  on public.case_card (advisor_client_id, detection_rule)
  where auto_detected;

create trigger case_card_set_updated_at
  before update on public.case_card
  for each row execute function public.v3a_set_updated_at();

alter table public.growth_records enable row level security;
alter table public.coaching_sessions enable row level security;
alter table public.service_stage_log enable row level security;
alter table public.case_card enable row level security;

revoke all on table public.growth_records from public, anon, authenticated, service_role;
revoke all on table public.coaching_sessions from public, anon, authenticated, service_role;
revoke all on table public.service_stage_log from public, anon, authenticated, service_role;
revoke all on table public.case_card from public, anon, authenticated, service_role;

grant select on table public.growth_records to authenticated;
grant select on table public.coaching_sessions to authenticated;
grant select on table public.service_stage_log to authenticated;
grant select on table public.case_card to authenticated;

create policy v3a_growth_records_read_own_or_super_admin
on public.growth_records for select to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and public.v3a_current_role() = 'advisor'
    and advisor_user_id = public.v3a_current_user_id()
  )
);

create policy v3a_coaching_sessions_read_own_or_super_admin
on public.coaching_sessions for select to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and public.v3a_current_role() = 'advisor'
    and advisor_user_id = public.v3a_current_user_id()
  )
);

create policy v3a_service_stage_log_read_own_or_super_admin
on public.service_stage_log for select to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and public.v3a_current_role() = 'advisor'
    and advisor_user_id = public.v3a_current_user_id()
  )
);

create policy v3a_case_card_read_own_shared_or_super_admin
on public.case_card for select to authenticated
using (
  public.v3a_is_super_admin()
  or (
    public.v3a_current_status() = 'active'
    and public.v3a_current_role() = 'advisor'
    and (advisor_user_id = public.v3a_current_user_id() or visibility = 'shared')
  )
);

create function public.v3a_create_growth_record(
  p_client_id uuid,
  p_record_type text,
  p_domain_tags text[],
  p_change_direction text,
  p_related_fingerprint_markers text[],
  p_visibility text,
  p_content text,
  p_source text default 'advisor_workbench'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_record public.growth_records%rowtype;
begin
  select u.id into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'advisor' and u.status = 'active'
  limit 1;
  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.advisor_clients c
    where c.id = p_client_id and c.advisor_user_id = v_advisor_id and c.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CLIENT_NOT_FOUND';
  end if;

  insert into public.growth_records (
    advisor_client_id, advisor_user_id, record_type, domain_tags, change_direction,
    related_fingerprint_markers, visibility, content, source
  ) values (
    p_client_id, v_advisor_id, p_record_type, coalesce(p_domain_tags, '{}'), p_change_direction,
    coalesce(p_related_fingerprint_markers, '{}'), p_visibility, btrim(p_content), p_source
  ) returning * into v_record;

  return jsonb_build_object(
    'id', v_record.id,
    'personId', v_record.advisor_client_id,
    'recordType', v_record.record_type,
    'domainTags', v_record.domain_tags,
    'changeDirection', v_record.change_direction,
    'visibility', v_record.visibility,
    'content', v_record.content,
    'source', v_record.source,
    'createdAt', v_record.created_at
  );
end
$$;

create function public.v3a_create_coaching_session(
  p_client_id uuid,
  p_coaching_type text,
  p_session_type text,
  p_topic text,
  p_suggestion jsonb,
  p_parent_reaction text,
  p_session_effect text,
  p_next_plan text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_session public.coaching_sessions%rowtype;
begin
  select u.id into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'advisor' and u.status = 'active'
  limit 1;
  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.advisor_clients c
    where c.id = p_client_id and c.advisor_user_id = v_advisor_id and c.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CLIENT_NOT_FOUND';
  end if;

  insert into public.coaching_sessions (
    advisor_client_id, advisor_user_id, coaching_type, session_type, topic, suggestion,
    parent_reaction, session_effect, next_plan
  ) values (
    p_client_id, v_advisor_id, p_coaching_type, p_session_type, btrim(p_topic), p_suggestion,
    nullif(btrim(p_parent_reaction), ''), nullif(btrim(p_session_effect), ''), nullif(btrim(p_next_plan), '')
  ) returning * into v_session;

  return jsonb_build_object('id', v_session.id, 'personId', v_session.advisor_client_id, 'createdAt', v_session.created_at);
end
$$;

create function public.v3a_create_case_card(
  p_client_id uuid,
  p_title text,
  p_content text,
  p_case_type text[],
  p_visibility text,
  p_related_knowledge_cards text[],
  p_key_turning_points jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_case public.case_card%rowtype;
begin
  select u.id into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'advisor' and u.status = 'active'
  limit 1;
  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_FORBIDDEN';
  end if;
  if p_visibility not in ('private', 'submitted') then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_INVALID_CASE_VISIBILITY';
  end if;
  if not exists (
    select 1 from public.advisor_clients c
    where c.id = p_client_id and c.advisor_user_id = v_advisor_id and c.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CLIENT_NOT_FOUND';
  end if;

  insert into public.case_card (
    advisor_client_id, advisor_user_id, title, content, case_type, visibility,
    related_knowledge_cards, key_turning_points
  ) values (
    p_client_id, v_advisor_id, btrim(p_title), btrim(p_content), coalesce(p_case_type, '{}'), p_visibility,
    coalesce(p_related_knowledge_cards, '{}'), coalesce(p_key_turning_points, '[]'::jsonb)
  ) returning * into v_case;

  return jsonb_build_object('id', v_case.id, 'visibility', v_case.visibility, 'createdAt', v_case.created_at);
end
$$;

create function public.v3a_update_case_card(
  p_case_id uuid,
  p_title text,
  p_content text,
  p_case_type text[],
  p_related_knowledge_cards text[],
  p_key_turning_points jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_case public.case_card%rowtype;
begin
  select u.id into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'advisor' and u.status = 'active'
  limit 1;
  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_FORBIDDEN';
  end if;

  update public.case_card c
  set title = btrim(p_title),
      content = btrim(p_content),
      case_type = coalesce(p_case_type, '{}'),
      related_knowledge_cards = coalesce(p_related_knowledge_cards, '{}'),
      key_turning_points = coalesce(p_key_turning_points, '[]'::jsonb),
      hq_review_comment = case when c.visibility = 'returned' then null else c.hq_review_comment end,
      hq_reviewed_by = case when c.visibility = 'returned' then null else c.hq_reviewed_by end,
      hq_reviewed_at = case when c.visibility = 'returned' then null else c.hq_reviewed_at end,
      visibility = case when c.visibility = 'returned' then 'private' else c.visibility end
  where c.id = p_case_id
    and c.advisor_user_id = v_advisor_id
    and c.visibility in ('private', 'returned')
  returning * into v_case;

  if v_case.id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CASE_NOT_EDITABLE';
  end if;
  return jsonb_build_object('id', v_case.id, 'visibility', v_case.visibility, 'updatedAt', v_case.updated_at);
end
$$;

create function public.v3a_submit_case_card(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_case public.case_card%rowtype;
begin
  select u.id into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'advisor' and u.status = 'active'
  limit 1;
  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_FORBIDDEN';
  end if;

  update public.case_card c
  set visibility = 'submitted', hq_review_comment = null, hq_reviewed_by = null, hq_reviewed_at = null
  where c.id = p_case_id and c.advisor_user_id = v_advisor_id and c.visibility in ('private', 'returned')
  returning * into v_case;
  if v_case.id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CASE_NOT_SUBMITTABLE';
  end if;
  return jsonb_build_object('id', v_case.id, 'visibility', v_case.visibility, 'updatedAt', v_case.updated_at);
end
$$;

create function public.v3a_review_case_card(p_case_id uuid, p_decision text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_id uuid;
  v_case public.case_card%rowtype;
  v_visibility text;
begin
  select u.id into v_admin_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'super_admin' and u.status = 'active'
  limit 1;
  if v_admin_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_ADMIN_REQUIRED';
  end if;
  if p_decision not in ('approve', 'return') then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_INVALID_REVIEW_DECISION';
  end if;
  v_visibility := case when p_decision = 'approve' then 'shared' else 'returned' end;

  update public.case_card c
  set visibility = v_visibility,
      hq_review_comment = nullif(btrim(p_comment), ''),
      hq_reviewed_by = v_admin_id,
      hq_reviewed_at = now()
  where c.id = p_case_id and c.visibility = 'submitted'
  returning * into v_case;
  if v_case.id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CASE_NOT_REVIEWABLE';
  end if;
  return jsonb_build_object('id', v_case.id, 'visibility', v_case.visibility, 'reviewedAt', v_case.hq_reviewed_at);
end
$$;

create function public.v3a_delete_case_card(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_advisor_id uuid;
  v_deleted_id uuid;
begin
  select u.id into v_advisor_id
  from public.users u
  where u.auth_user_id = auth.uid() and u.role = 'advisor' and u.status = 'active'
  limit 1;
  if v_advisor_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_FORBIDDEN';
  end if;

  delete from public.case_card c
  where c.id = p_case_id and c.advisor_user_id = v_advisor_id and c.visibility in ('private', 'returned')
  returning c.id into v_deleted_id;
  if v_deleted_id is null then
    raise exception using errcode = 'P0001', message = 'WORKBENCH_V4_CASE_NOT_DELETABLE';
  end if;
  return jsonb_build_object('id', v_deleted_id, 'deleted', true);
end
$$;

revoke all on function public.v3a_create_growth_record(uuid,text,text[],text,text[],text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_create_coaching_session(uuid,text,text,text,jsonb,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_create_case_card(uuid,text,text,text[],text,text[],jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_update_case_card(uuid,text,text,text[],text[],jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_submit_case_card(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_review_case_card(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.v3a_delete_case_card(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.v3a_create_growth_record(uuid,text,text[],text,text[],text,text,text) to authenticated;
grant execute on function public.v3a_create_coaching_session(uuid,text,text,text,jsonb,text,text,text) to authenticated;
grant execute on function public.v3a_create_case_card(uuid,text,text,text[],text,text[],jsonb) to authenticated;
grant execute on function public.v3a_update_case_card(uuid,text,text,text[],text[],jsonb) to authenticated;
grant execute on function public.v3a_submit_case_card(uuid) to authenticated;
grant execute on function public.v3a_review_case_card(uuid,text,text) to authenticated;
grant execute on function public.v3a_delete_case_card(uuid) to authenticated;

do $$
declare
  v_table text;
  v_function text;
begin
  foreach v_table in array array['growth_records', 'coaching_sessions', 'service_stage_log', 'case_card'] loop
    if not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
       or has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       or has_table_privilege('service_role', format('public.%I', v_table), 'SELECT') then
      raise exception 'MIGRATION_033_POSTFLIGHT_TABLE_PRIVILEGE_FAILED:%', v_table;
    end if;
  end loop;

  foreach v_function in array array[
    'public.v3a_create_growth_record(uuid,text,text[],text,text[],text,text,text)',
    'public.v3a_create_coaching_session(uuid,text,text,text,jsonb,text,text,text)',
    'public.v3a_create_case_card(uuid,text,text,text[],text,text[],jsonb)',
    'public.v3a_update_case_card(uuid,text,text,text[],text[],jsonb)',
    'public.v3a_submit_case_card(uuid)',
    'public.v3a_review_case_card(uuid,text,text)',
    'public.v3a_delete_case_card(uuid)'
  ] loop
    if not has_function_privilege('authenticated', v_function, 'EXECUTE')
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'MIGRATION_033_POSTFLIGHT_RPC_PRIVILEGE_FAILED:%', v_function;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename in (
    'growth_records', 'coaching_sessions', 'service_stage_log', 'case_card'
  )) <> 4 then
    raise exception 'MIGRATION_033_POSTFLIGHT_RLS_POLICY_FAILED';
  end if;
end
$$;

commit;
