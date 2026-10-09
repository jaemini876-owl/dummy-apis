-- v4: 규칙/프리셋 일괄 가져오기를 단일 트랜잭션(함수 1회 호출)으로 수행한다.
-- 중간에 실패하면 전부 롤백되므로 replace 모드에서도 기존 데이터가 사라지지 않는다.
-- 적용 전에는 서버가 경고 로그와 함께 보상(복구 시도) 방식으로 폴백한다. 0003 적용 후 실행.

create or replace function import_rules(p_project_id uuid, p_mode text, p_rules jsonb)
returns jsonb
language plpgsql
as $$
declare
  r          jsonb;
  v_rule_id  uuid;
  v_existing uuid;
  v_created  int := 0;
  v_updated  int := 0;
  v_deleted  int := 0;
begin
  if p_mode not in ('merge', 'replace') then
    raise exception 'invalid import mode: %', p_mode;
  end if;

  if p_mode = 'replace' then
    delete from rules where project_id = p_project_id;
    get diagnostics v_deleted = row_count;
  end if;

  for r in select value from jsonb_array_elements(p_rules) loop
    select id into v_existing from rules
      where project_id = p_project_id and method = r->>'method' and path_pattern = r->>'path_pattern';

    if v_existing is not null then
      update rules set
        name        = r->>'name',
        enabled     = (r->>'enabled')::boolean,
        select_mode = r->>'select_mode',
        conditions  = coalesce(r->'conditions', '[]'::jsonb),
        updated_at  = now()
      where id = v_existing;
      delete from responses where rule_id = v_existing;
      v_rule_id := v_existing;
      v_updated := v_updated + 1;
    else
      insert into rules (project_id, name, method, path_pattern, enabled, select_mode, conditions)
      values (
        p_project_id, r->>'name', r->>'method', r->>'path_pattern',
        (r->>'enabled')::boolean, r->>'select_mode', coalesce(r->'conditions', '[]'::jsonb)
      )
      returning id into v_rule_id;
      v_created := v_created + 1;
    end if;

    insert into responses
      (rule_id, position, weight, conditions, status, headers, content_type, body, body_base64, delay_min_ms, delay_max_ms, fault)
    select
      v_rule_id, x.position, x.weight, x.conditions, x.status, x.headers, x.content_type, x.body, x.body_base64, x.delay_min_ms, x.delay_max_ms, x.fault
    from jsonb_to_recordset(coalesce(r->'responses', '[]'::jsonb)) as x(
      position int, weight int, conditions jsonb, status int, headers jsonb, content_type text,
      body text, body_base64 text, delay_min_ms int, delay_max_ms int, fault text
    );
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'deleted', v_deleted);
end;
$$;

create or replace function import_presets(p_mode text, p_presets jsonb)
returns jsonb
language plpgsql
as $$
declare
  p         jsonb;
  v_created int := 0;
  v_updated int := 0;
  v_deleted int := 0;
begin
  if p_mode not in ('merge', 'replace') then
    raise exception 'invalid import mode: %', p_mode;
  end if;

  if p_mode = 'replace' then
    delete from presets;
    get diagnostics v_deleted = row_count;
  end if;

  for p in select value from jsonb_array_elements(p_presets) loop
    update presets set
      name         = btrim(p->>'name'),
      content_type = p->>'content_type',
      headers      = coalesce(p->'headers', '{}'::jsonb),
      body         = p->>'body',
      body_base64  = p->>'body_base64',
      updated_at   = now()
    where lower(btrim(name)) = lower(btrim(p->>'name'));

    if found then
      v_updated := v_updated + 1;
    else
      insert into presets (name, content_type, headers, body, body_base64)
      values (btrim(p->>'name'), p->>'content_type', coalesce(p->'headers', '{}'::jsonb), p->>'body', p->>'body_base64');
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'deleted', v_deleted);
end;
$$;

-- service role(서버)만 호출 가능. anon/authenticated가 PostgREST로 호출하지 못하게 막는다.
revoke execute on function import_rules(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function import_rules(uuid, text, jsonb) to service_role;
revoke execute on function import_presets(text, jsonb) from public, anon, authenticated;
grant  execute on function import_presets(text, jsonb) to service_role;
