-- v4: 전역 응답 프리셋 (content-type + headers + body). 프로젝트와 무관하게 모든 규칙 편집기에서 사용한다.
-- Supabase SQL editor 또는 `supabase db push`로 적용.
create table presets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  content_type text not null default 'application/json',
  headers      jsonb not null default '{}'::jsonb,
  body         text,
  body_base64  text,                                -- 바이너리 응답, body와 택일
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 이름은 대소문자·앞뒤 공백을 무시하고 유일
create unique index presets_name_uq on presets (lower(btrim(name)));

-- 서버(service role)만 접근. 다른 테이블과 동일한 방침.
alter table presets enable row level security;
