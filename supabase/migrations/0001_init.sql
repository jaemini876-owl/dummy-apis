-- Dummy API schema. Apply via Supabase SQL editor or `supabase db push`.
create extension if not exists pgcrypto;

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  name        text not null,
  settings    jsonb not null default '{}'::jsonb,
  owner_id    uuid null,                            -- 향후 auth.users
  created_at  timestamptz not null default now()
);

create table if not exists project_members (        -- 지금은 미사용, 스키마만 준비
  project_id uuid references projects(id) on delete cascade,
  user_id    uuid not null,
  role       text not null check (role in ('owner','editor','viewer')),
  primary key (project_id, user_id)
);

create table if not exists rules (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  name         text,
  method       text not null check (method in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','ANY')),
  path_pattern text not null,
  enabled      boolean not null default true,
  select_mode  text not null default 'fixed' check (select_mode in ('fixed','sequential','weighted','conditional')),
  conditions   jsonb not null default '[]'::jsonb,
  created_by   uuid null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, method, path_pattern)
);
create index if not exists rules_project_idx on rules (project_id) where enabled;

create table if not exists responses (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid not null references rules(id) on delete cascade,
  position     int  not null default 0,
  weight       int  not null default 1,
  conditions   jsonb not null default '[]'::jsonb,
  status       int  not null default 200 check (status between 100 and 599),
  headers      jsonb not null default '{}'::jsonb,
  content_type text not null default 'application/json',
  body         text,
  body_base64  text,
  delay_min_ms int  not null default 0,
  delay_max_ms int  not null default 0,
  fault        text null check (fault in ('timeout','reset','truncate','invalid_json'))
);
create index if not exists responses_rule_idx on responses (rule_id, position);

create table if not exists request_logs (
  id          uuid primary key,                     -- 앱에서 생성(SSE와 동일 id 사용)
  project_id  uuid not null references projects(id) on delete cascade,
  rule_id     uuid null references rules(id) on delete set null,
  response_id uuid null,
  matched     boolean not null,
  method      text not null,
  path        text not null,
  query       jsonb,
  req_headers jsonb,
  req_body    text,
  status      int,
  res_body    text,
  latency_ms  int,
  created_at  timestamptz not null default now()
);
create index if not exists request_logs_project_idx on request_logs (project_id, created_at desc);

-- RLS: 현재는 서버(service role)만 접근. 향후 project_members 기반 정책을 추가한다.
alter table projects        enable row level security;
alter table project_members enable row level security;
alter table rules           enable row level security;
alter table responses       enable row level security;
alter table request_logs    enable row level security;
