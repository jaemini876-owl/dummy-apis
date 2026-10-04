-- R1: 규칙 갱신 + 응답 교체를 단일 트랜잭션(함수 1회 호출)으로 수행한다.
-- Supabase SQL editor 또는 `supabase db push`로 적용. 적용 전에는 서버가 비원자적 경로로 폴백한다.
create or replace function replace_rule(p_rule_id uuid, p_rule jsonb, p_responses jsonb)
returns boolean
language plpgsql
as $$
begin
  update rules set
    name         = p_rule->>'name',
    method       = p_rule->>'method',
    path_pattern = p_rule->>'path_pattern',
    enabled      = (p_rule->>'enabled')::boolean,
    select_mode  = p_rule->>'select_mode',
    conditions   = coalesce(p_rule->'conditions', '[]'::jsonb),
    updated_at   = now()
  where id = p_rule_id;

  if not found then
    return false;
  end if;

  delete from responses where rule_id = p_rule_id;

  insert into responses
    (rule_id, position, weight, conditions, status, headers, content_type, body, body_base64, delay_min_ms, delay_max_ms, fault)
  select
    p_rule_id, x.position, x.weight, x.conditions, x.status, x.headers, x.content_type, x.body, x.body_base64, x.delay_min_ms, x.delay_max_ms, x.fault
  from jsonb_to_recordset(p_responses) as x(
    position int, weight int, conditions jsonb, status int, headers jsonb, content_type text,
    body text, body_base64 text, delay_min_ms int, delay_max_ms int, fault text
  );

  return true;
end;
$$;

-- service role(서버)만 호출 가능. anon/authenticated가 PostgREST로 호출하지 못하게 막는다.
revoke execute on function replace_rule(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function replace_rule(uuid, jsonb, jsonb) to service_role;
