-- AIPIWEN V3a Preview practitioner type note for "other".
--
-- Adds an authenticated registration RPC signature that accepts a required
-- note when practitioner_type = 'other'. Existing 7/8 argument callers remain
-- compatible, but "other" now requires the new note field.

begin;

create or replace function public.v3a_submit_pending_application(
  p_display_name text,
  p_city text,
  p_requested_role text,
  p_practitioner_type text,
  p_agreement_version text,
  p_accepted_rules boolean,
  p_invite_code text default null,
  p_application_identity text default null,
  p_practitioner_type_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_requested_role text := btrim(coalesce(p_requested_role, ''));
  v_practitioner_type text := btrim(coalesce(p_practitioner_type, ''));
  v_practitioner_type_note text :=
    nullif(btrim(coalesce(p_practitioner_type_note, '')), '');
  v_application_identity text :=
    nullif(btrim(coalesce(p_application_identity, '')), '');
  v_agreement_version text := btrim(coalesce(p_agreement_version, ''));
  v_invite_code text := upper(nullif(btrim(coalesce(p_invite_code, '')), ''));
  v_application_note text;
  v_result jsonb;
  v_user_id uuid;
  v_profile_id uuid;
  v_application_id uuid;
begin
  if v_practitioner_type not in (
    'independent',
    'organization',
    'education_family',
    'psychological_consulting',
    'child_growth_quality',
    'assessment_collection',
    'other'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE';
  end if;

  if v_practitioner_type = 'other' then
    if v_practitioner_type_note is null
      or char_length(v_practitioner_type_note) < 2
      or char_length(v_practitioner_type_note) > 80
      or v_practitioner_type_note ~ '[[:cntrl:]<>]' then
      raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE_NOTE';
    end if;
  elsif v_practitioner_type_note is not null then
    raise exception using errcode = '22023', message = 'INVALID_PRACTITIONER_TYPE_NOTE';
  end if;

  v_application_note := concat_ws(
    '; ',
    case v_application_identity
      when 'branch_company' then '申请身份：分公司'
      when 'service_center' then '申请身份：服务中心'
      when 'collection_center' then '申请身份：采集中心'
      when 'ordinary_advisor' then '申请身份：普通指导师'
      else null
    end,
    case when v_practitioner_type = 'other'
      then '从业类型补充：' || v_practitioner_type_note
      else null
    end,
    'V3a Phase C1-D authenticated registration RPC'
  );

  begin
    v_result := public.v3a_submit_pending_application(
      v_display_name,
      v_city,
      v_requested_role,
      v_practitioner_type,
      v_agreement_version,
      p_accepted_rules,
      v_invite_code,
      v_application_identity
    );
  exception
    when others then
      if sqlerrm = 'REGISTRATION_CONFLICT' then
        select users_row.id, profile.id, review.id
        into v_user_id, v_profile_id, v_application_id
        from public.users users_row
        join public.advisor_profiles profile on profile.user_id = users_row.id
        join public.application_reviews review on review.user_id = users_row.id
        where users_row.auth_user_id = auth.uid()
          and users_row.role = 'pending'
          and users_row.status = 'pending'
          and users_row.display_name = v_display_name
          and users_row.city = v_city
          and profile.role = v_requested_role
          and profile.status = 'pending'
          and profile.nickname = v_display_name
          and profile.city = v_city
          and profile.practitioner_type = v_practitioner_type
          and profile.agreement_version = v_agreement_version
          and review.role = v_requested_role
          and review.status = 'pending'
          and review.applied_nickname = v_display_name
          and review.applied_city = v_city
          and review.practitioner_type = v_practitioner_type
          and review.invite_code is not distinct from v_invite_code
          and review.application_note is not distinct from v_application_note
        limit 1;

        if found then
          return jsonb_build_object(
            'success', true,
            'already_exists', true,
            'data', jsonb_build_object(
              'user_id', v_user_id,
              'profile_id', v_profile_id,
              'application_id', v_application_id,
              'user_status', 'pending',
              'profile_status', 'pending',
              'application_status', 'pending',
              'requested_role', v_requested_role,
              'application_identity', v_application_identity,
              'practitioner_type_note', v_practitioner_type_note
            )
          );
        end if;
      end if;

      raise;
  end;

  v_user_id := nullif(v_result #>> '{data,user_id}', '')::uuid;
  v_profile_id := nullif(v_result #>> '{data,profile_id}', '')::uuid;
  v_application_id := nullif(v_result #>> '{data,application_id}', '')::uuid;

  if v_user_id is null or v_application_id is null then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_FAILED';
  end if;

  update public.application_reviews review
  set application_note = v_application_note
  where review.id = v_application_id
    and review.user_id = v_user_id
    and review.status = 'pending'
    and review.application_note is distinct from v_application_note;

  return jsonb_set(
    v_result,
    '{data,practitioner_type_note}',
    to_jsonb(v_practitioner_type_note),
    true
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'REGISTRATION_IDENTITY_CONFLICT';
  when others then
    if sqlerrm in (
      'UNAUTHENTICATED',
      'INVALID_DISPLAY_NAME',
      'INVALID_CITY',
      'INVALID_REQUESTED_ROLE',
      'INVALID_APPLICATION_IDENTITY',
      'INVALID_PRACTITIONER_TYPE',
      'INVALID_PRACTITIONER_TYPE_NOTE',
      'INVALID_AGREEMENT',
      'INVALID_INVITE_CODE',
      'AUTH_USER_NOT_FOUND',
      'AUTH_USER_UNAVAILABLE',
      'AUTH_PHONE_NOT_VERIFIED',
      'AUTH_PHONE_NOT_SUPPORTED',
      'AUTH_PHONE_CLAIM_MISMATCH',
      'AUTH_IDENTITY_NOT_VERIFIED',
      'IDENTITY_MAPPING_CONFLICT',
      'PARTIAL_REGISTRATION_STATE',
      'REGISTRATION_CONFLICT'
    ) then
      raise;
    end if;
    raise exception using errcode = 'P0001', message = 'REGISTRATION_FAILED';
end;
$$;

comment on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text, text
) is
  'Creates one pending users/profile/application set atomically from the current verified Supabase Auth identity; requires a bounded note when practitioner_type is other.';

create or replace function public.v3a_submit_pending_application(
  p_display_name text,
  p_city text,
  p_requested_role text,
  p_practitioner_type text,
  p_agreement_version text,
  p_accepted_rules boolean,
  p_invite_code text default null,
  p_application_identity text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
begin
  return public.v3a_submit_pending_application(
    p_display_name,
    p_city,
    p_requested_role,
    p_practitioner_type,
    p_agreement_version,
    p_accepted_rules,
    p_invite_code,
    p_application_identity,
    null
  );
end;
$$;

comment on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) is
  'Compatibility wrapper for the current V3a authenticated registration RPC.';

revoke all on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text, text
) to authenticated;

grant execute on function public.v3a_submit_pending_application(
  text, text, text, text, text, boolean, text, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
