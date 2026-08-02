begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.users (id, auth_user_id, role, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'advisor', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'advisor', 'active');

insert into public.advisor_clients (id, advisor_user_id, archived_at) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null);

insert into public.advisor_reports (id, advisor_client_id, status) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ready'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'generating'),
  ('99999999-9999-4999-8999-999999999999', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ready');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  v_steps jsonb;
  v_data jsonb;
  v_result jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'stepIndex', index,
    'title', '步骤',
    'why', jsonb_build_array('原因'),
    'say', jsonb_build_array('话术'),
    'ask', jsonb_build_array('问题'),
    'no', jsonb_build_array('边界'),
    'action', jsonb_build_array('行动'),
    'risk', jsonb_build_array('风险')
  ) order by index)
  into v_steps
  from generate_series(0, 7) as index;

  v_data := jsonb_build_object(
    'version', 1,
    'id', '12345678-1234-4123-8123-123456789012',
    'status', 'generated',
    'steps', v_steps
  );

  v_result := public.v3a_save_advisor_interpretation(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', v_data
  );
  if v_result ->> 'interpretationId' <> '12345678-1234-4123-8123-123456789012' then
    raise exception 'TEST_029_SAVE_RESULT_FAILED';
  end if;
  if not exists (
    select 1 from public.advisor_reports
    where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      and interpretation_data = v_data
  ) then
    raise exception 'TEST_029_SAVE_PERSISTENCE_FAILED';
  end if;

  begin
    perform public.v3a_save_advisor_interpretation(
      '99999999-9999-4999-8999-999999999999', v_data
    );
    raise exception 'TEST_029_CROSS_ADVISOR_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'REPORT_NOT_FOUND' then raise; end if;
  end;

  begin
    perform public.v3a_save_advisor_interpretation(
      'ffffffff-ffff-4fff-8fff-ffffffffffff', v_data
    );
    raise exception 'TEST_029_NON_READY_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'INTERPRETATION_REPORT_NOT_READY' then raise; end if;
  end;

  begin
    perform public.v3a_save_advisor_interpretation(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '{}'::jsonb
    );
    raise exception 'TEST_029_INVALID_DATA_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'INVALID_INTERPRETATION_DATA' then raise; end if;
  end;
end
$$;

do $$
begin
  if not has_function_privilege(
    'authenticated', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'service_role', 'public.v3a_save_advisor_interpretation(uuid,jsonb)', 'EXECUTE'
  ) then
    raise exception 'TEST_029_PRIVILEGES_FAILED';
  end if;
end
$$;

rollback;
