# Design: Dummy API & 설정 웹사이트

- 작성일: 2026-10-04
- 단계: PDCA – Design
- 참조: `docs/01-plan/features/dummy-api.plan.md`
- 적용한 기본값: Supabase 신규 프로젝트, 호스트 미정(Docker 이미지로 이식 가능하게), URL 방식은 path prefix

## 1. 아키텍처

```
[Mobile App / curl]                      [Browser: Admin Console]
        │  /m/<slug>/<path>                    │  /__admin (SPA)
        ▼                                      ▼  /__admin/api/*
┌───────────────────────── Fastify (단일 프로세스, 단일 포트) ─────────────────────────┐
│  mock router (catch-all)        admin API              static (web/dist)            │
│   ├ resolveProject(slug)         ├ getCurrentUser()      SSE /__admin/api/logs/stream│
│   ├ matcher (rules cache)        ├ projects/rules CRUD                                │
│   ├ responseSelector             └ import/export, try-it                              │
│   ├ faultInjector / delay                                                             │
│   ├ templateRenderer                                                                  │
│   └ logger (async batch)                                                              │
│                         RuleCache (memory)  ◄── Realtime/poll sync                    │
└──────────────────────────────────┬───────────────────────────────────────────────────┘
                                   ▼
                        Supabase (Postgres) — service role
```

- 읽기 경로(모의 호출)는 **메모리 캐시만** 사용. DB 장애가 나도 캐시된 규칙으로 계속 응답.
- 쓰기(관리 API) → DB 저장 → 캐시 즉시 갱신 → 다른 인스턴스는 Supabase Realtime(`rules`, `responses` 변경 구독), 끊기면 30초 폴링 폴백.

### 디렉터리 구조
```
dummy-api/
├─ server/
│  ├─ src/
│  │  ├─ index.ts              # Fastify 부트스트랩
│  │  ├─ config.ts             # env 검증(zod)
│  │  ├─ db/supabase.ts        # 클라이언트
│  │  ├─ auth/currentUser.ts   # getCurrentUser() (현재 anonymous)
│  │  ├─ mock/
│  │  │  ├─ router.ts          # /m/:slug/* 핸들러
│  │  │  ├─ matcher.ts         # path/method/조건 매칭
│  │  │  ├─ selector.ts        # fixed/sequential/weighted
│  │  │  ├─ template.ts        # {{...}} 렌더링
│  │  │  ├─ fault.ts           # timeout/reset/truncate/invalid
│  │  │  └─ builtin.ts         # /_/status, /_/delay
│  │  ├─ cache/ruleCache.ts
│  │  ├─ logs/logger.ts, sse.ts
│  │  └─ admin/ (projects, rules, import-export, try)
│  └─ test/
├─ web/                        # Vite + React + TS
├─ supabase/migrations/0001_init.sql
├─ Dockerfile, .env.example, README.md
```

## 2. URL 규칙

| 용도 | URL |
|---|---|
| 모의 API | `ANY /m/<projectSlug>/<개발자 정의 path>?<query>` |
| 내장 유틸 | `GET /m/<slug>/_/status/:code`, `/_/delay/:ms` |
| 관리 UI | `/__admin` |
| 관리 API | `/__admin/api/*` |
| 헬스체크 | `GET /healthz` |

- 규칙의 `path_pattern`에는 `/m/<slug>`를 **포함하지 않음** (예: `/v2/orders/:id`). 앱은 베이스 URL을 `https://host/m/<slug>`로 설정하면 실제 백엔드와 동일한 path를 쓸 수 있음.
- 예약 prefix는 `__admin`, `healthz`, `m` 뿐. slug 예약어 검증 포함.

## 3. 데이터 모델 (Supabase / Postgres)

`supabase/migrations/0001_init.sql`

```sql
create extension if not exists pgcrypto;

create table projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  name        text not null,
  settings    jsonb not null default '{}'::jsonb,   -- 전역 지연/에러 주입/CORS/미매칭 동작
  owner_id    uuid null,                            -- 향후 auth.users
  created_at  timestamptz not null default now()
);

create table project_members (                      -- 지금은 미사용, 스키마만
  project_id uuid references projects(id) on delete cascade,
  user_id    uuid not null,
  role       text not null check (role in ('owner','editor','viewer')),
  primary key (project_id, user_id)
);

create table rules (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  name         text,
  method       text not null check (method in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','ANY')),
  path_pattern text not null,                       -- '/users/:id', '/files/*'
  enabled      boolean not null default true,
  select_mode  text not null default 'fixed' check (select_mode in ('fixed','sequential','weighted','conditional')),
  conditions   jsonb not null default '[]'::jsonb,  -- 규칙 레벨 공통 조건(선택)
  created_by   uuid null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, method, path_pattern)
);
create index on rules (project_id) where enabled;

create table responses (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid not null references rules(id) on delete cascade,
  position     int  not null default 0,             -- sequential 순서 / 표시 순서
  weight       int  not null default 1,             -- weighted
  conditions   jsonb not null default '[]'::jsonb,  -- conditional 모드에서 이 응답의 조건
  status       int  not null default 200 check (status between 100 and 599),
  headers      jsonb not null default '{}'::jsonb,
  content_type text not null default 'application/json',
  body         text,                                -- 템플릿 허용
  body_base64  text,                                -- 바이너리 응답(이미지 등), body와 택일
  delay_min_ms int  not null default 0,
  delay_max_ms int  not null default 0,
  fault        text null check (fault in ('timeout','reset','truncate','invalid_json'))
);
create index on responses (rule_id, position);

create table request_logs (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references projects(id) on delete cascade,
  rule_id     uuid null references rules(id) on delete set null,
  response_id uuid null,
  matched     boolean not null,
  method      text not null,
  path        text not null,
  query       jsonb,
  req_headers jsonb,
  req_body    text,                                 -- 최대 64KB truncate
  status      int,
  latency_ms  int,
  created_at  timestamptz not null default now()
);
create index on request_logs (project_id, created_at desc);

-- RLS: 지금은 서버(service role)만 접근. 향후 정책 추가 대비로 활성화만.
alter table projects        enable row level security;
alter table project_members enable row level security;
alter table rules           enable row level security;
alter table responses       enable row level security;
alter table request_logs    enable row level security;
```

- 로그 정리: 서버 내 주기 job(10분)이 프로젝트당 최근 5,000건·7일 초과분 삭제 (설정 가능).
- `updated_at` 트리거는 마이그레이션에 포함.

### Condition 스키마 (jsonb)
```json
{ "source": "query|header|body|path", "key": "type", "op": "eq|neq|contains|regex|exists", "value": "vip" }
```
- `body` source의 key는 JSON path(`user.email`). 배열 내 조건은 AND.
- 규칙 레벨 `conditions`: 모두 만족해야 규칙 매칭 대상. 응답 레벨 `conditions`: `select_mode=conditional`일 때 위에서부터 첫 번째 만족 응답 선택, 없으면 마지막 `conditions=[]` 응답(기본), 그것도 없으면 404 + 안내.

## 4. 매칭 / 응답 알고리즘

1. `/m/:slug/*` 수신 → slug로 프로젝트 조회(캐시). 없으면 404 `{"error":"project_not_found"}`.
2. 후보 규칙 = 프로젝트의 enabled 규칙 중 method 일치(또는 ANY) & path 매치 & 규칙 조건 만족.
3. **우선순위**: ① 구체성 점수 높은 순 — 정적 세그먼트 3점 / `:param` 2점 / `*` 1점을 세그먼트별 합산 후 사전식 비교 ② method 명시 > ANY ③ 규칙 조건 개수 많은 순 ④ created_at 오래된 순.
4. 매칭 없음 → 프로젝트 `settings.unmatched` (기본 404 JSON `{"error":"no_rule","method":..,"path":..}`) + 로그(`matched=false`).
5. 응답 선택 (`select_mode`)
   - `fixed`: position 최소 응답
   - `sequential`: 규칙별 카운터(메모리, 재시작 시 리셋; 관리 UI에서 "카운터 리셋"), 끝나면 마지막 유지 또는 순환(`settings.loop`)
   - `weighted`: weight 비례 랜덤
   - `conditional`: 3장 규칙
6. 전역 설정 적용: 프로젝트 `settings.errorRate`(%) 확률로 `settings.errorStatus`(기본 500) 응답으로 덮어쓰기, `settings.extraDelayMs` 가산.
7. 지연: `delay_min..max` 랜덤 sleep → fault 처리:
   - `timeout`: 응답 없이 소켓 유지(클라이언트 타임아웃까지, 최대 120s)
   - `reset`: 소켓 destroy
   - `truncate`: 헤더 + 본문 절반만 전송 후 종료
   - `invalid_json`: `Content-Type: application/json`으로 깨진 JSON 전송
8. 템플릿 렌더링(body, header 값): `{{params.x}} {{query.x}} {{body.a.b}} {{headers.x}} {{now}} {{timestamp}} {{uuid}} {{random.int(1,100)}} {{faker.name}} {{faker.email}}` (faker는 `@faker-js/faker`, 미정의 변수는 빈 문자열). 렌더 실패 시 원문 그대로 + 로그에 경고.
9. 응답 전송 후 로그를 큐에 push → 500ms/50건 배치 insert → SSE 브로드캐스트.
10. CORS: 프로젝트 설정 기반(기본 `*`), `OPTIONS` 프리플라이트는 규칙이 없으면 자동 204 응답.

성능 목표: 매칭+응답 오버헤드 p95 < 5ms (지연 설정 제외), 프로젝트당 규칙 1,000개 기준. 규칙은 프로젝트별로 세그먼트 trie로 컴파일해 캐시.

## 5. 관리 API (`/__admin/api`)

모든 라우트는 `getCurrentUser()` 미들웨어 통과 (현재 `{ id: null, anonymous: true }`). 응답은 JSON, 에러는 `{error, message, details?}`.

| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/projects` | 목록 / 생성(slug 검증) |
| GET/PATCH/DELETE | `/projects/:pid` | 조회 / 이름·설정 수정 / 삭제 |
| GET/POST | `/projects/:pid/rules` | 목록(검색 `q`, method 필터) / 생성(응답 포함) |
| GET/PUT/DELETE | `/projects/:pid/rules/:rid` | 규칙+응답 전체 조회 / 전체 교체 / 삭제 |
| POST | `/projects/:pid/rules/:rid/duplicate` | 복제 |
| PATCH | `/projects/:pid/rules/:rid/enabled` | 활성 토글 |
| POST | `/projects/:pid/rules/:rid/reset-counter` | sequential 카운터 리셋 |
| GET | `/projects/:pid/export` | 규칙 JSON export |
| POST | `/projects/:pid/import?mode=merge\|replace` | JSON import (검증 후 트랜잭션) |
| GET | `/projects/:pid/logs?limit&before&matched` | 로그 조회 |
| GET | `/projects/:pid/logs/stream` | SSE 실시간 로그 |
| DELETE | `/projects/:pid/logs` | 로그 비우기 |
| POST | `/projects/:pid/logs/:lid/to-rule` | 로그(특히 미매칭)에서 규칙 초안 생성 |
| GET | `/server-info` | LAN IP 목록, 베이스 URL 후보(QR용), 버전 |

- 규칙 생성/수정 시 검증: `path_pattern`은 `/`로 시작, 파라미터명 `[A-Za-z_][A-Za-z0-9_]*`, `*`는 마지막 세그먼트만; body가 `application/json`이면 템플릿 치환 전 JSON 문법 경고(차단 아님, 템플릿 때문에); 중복 `(method, path_pattern)` → 409.
- Try-it은 브라우저에서 `/m/<slug>/...`를 직접 fetch (서버 프록시 불필요).

### Rule JSON (import/export 포맷, `version: 1`)
```json
{
  "version": 1,
  "rules": [{
    "name": "주문 상세",
    "method": "GET",
    "path": "/v2/orders/:id",
    "selectMode": "sequential",
    "conditions": [],
    "responses": [
      { "status": 200, "contentType": "application/json",
        "body": "{\"id\":\"{{params.id}}\",\"status\":\"PAID\"}", "delayMs": [0, 0] },
      { "status": 500, "body": "{\"error\":\"boom\"}", "delayMs": [800, 1500] }
    ]
  }]
}
```

## 6. 관리 웹 화면 설계 (Vite + React + TS, React Router, TanStack Query)

| 화면 | 구성 |
|---|---|
| **프로젝트 목록** (`/__admin`) | 카드 목록, 새 프로젝트(이름→slug 자동 생성), 베이스 URL 복사 |
| **프로젝트 대시보드** (`/__admin/p/:slug`) | 상단 탭: 규칙 · 로그 · 설정 · 연결 가이드 |
| **규칙 탭** | 검색/method 필터 표(Method 배지, Path, 응답 수, 선택 모드, 활성 토글), 새 규칙, 복제/삭제, Import/Export |
| **규칙 편집기** (사이드 패널/페이지) | method·path 입력(파라미터 하이라이트, 실시간 매칭 테스트 입력창), 선택 모드, 조건 빌더, 응답 목록(드래그 정렬) — 각 응답: 상태 코드(자주 쓰는 코드 드롭다운+직접 입력, 의미 표시), 헤더 key-value, Content-Type, 바디 에디터(Monaco, JSON 검증·템플릿 변수 자동완성), 지연 min/max, 장애 선택. 하단 **Try it**(method/헤더/바디 입력 → 응답 상태·시간·바디 표시, cURL 복사) |
| **로그 탭** | 실시간 테이블(시간·method·path·매칭 규칙·status·ms), 미매칭만 필터, 행 클릭 시 요청/응답 상세, **"이 요청으로 규칙 만들기"**, 일시정지/비우기 |
| **설정 탭** | 전역 지연, 에러 주입 확률/상태 코드, sequential 순환 여부, 미매칭 동작, CORS, 로그 보관 정책, 프로젝트 삭제 |
| **연결 가이드 탭** | 베이스 URL(+LAN IP 후보)과 QR, 에뮬레이터 주소 안내(`10.0.2.2`), iOS ATS / Android `usesCleartextTraffic`·network security config 스니펫, Swift(URLSession)·Kotlin(OkHttp/Retrofit)·curl 예시 |

UX 규칙: 저장 시 즉시 반영 토스트, 미저장 변경 이탈 경고, 키보드 단축키(⌘/Ctrl+S 저장), 다크모드, 모바일 폭에서도 목록/로그 열람 가능.

## 7. 설정(env) / 배포

`.env.example`
```
PORT=3000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PUBLIC_BASE_URL=            # 공유 서버 외부 URL(가이드/QR 표기용), 미설정 시 요청 Host 사용
LOG_RETENTION_DAYS=7
LOG_MAX_PER_PROJECT=5000
```
- 멀티 스테이지 Dockerfile: web 빌드 → server 빌드 → `node dist/index.js`, `/healthz`로 헬스체크.
- 상시 구동 호스트 전제(SSE·장시간 지연/timeout 시뮬레이션). 리버스 프록시 사용 시 SSE용 버퍼링 off, 타임아웃 ≥ 130s 안내.
- 다중 인스턴스: 규칙은 Realtime으로 동기화되지만 sequential 카운터·SSE는 인스턴스 로컬 → MVP는 **단일 인스턴스 권장**(README에 명시).

## 8. 향후 유저 기반 전환 경로 (설계 훅)

1. `auth/currentUser.ts`가 Supabase JWT 검증으로 교체 (관리 API만 해당, `/m/*`는 제외).
2. `project_members`를 채우고 RLS 정책 추가 (`project_id in (select project_id from project_members where user_id = auth.uid())`), 서버 접근을 사용자 JWT 기반 클라이언트로 전환 가능.
3. 기존 데이터의 `owner_id`/`created_by`는 null → 초기 관리자 지정 스크립트로 일괄 할당.
4. 프로젝트별 모의 API 키(`X-Mock-Key`) 옵션은 `projects.settings.apiKey`로 추가 가능(스키마 변경 없음).

## 9. 테스트 계획

| 레벨 | 대상 | 도구 |
|---|---|---|
| 단위 | path 매처(우선순위·파라미터·와일드카드), 조건 평가, selector, 템플릿 렌더러 | Vitest |
| 통합 | Fastify inject + 로컬 Supabase(또는 DB 어댑터 mock): CRUD→즉시 반영, sequential, 지연/fault, 미매칭, 로그 기록, import/export | Vitest |
| E2E 스모크 | 관리 UI: 규칙 생성→Try it→로그 확인 | Playwright |
| 수동 | 실기기(iOS/Android) 호출, ATS/cleartext 설정 | 체크리스트(README) |

DB 접근은 `RuleRepository` 인터페이스 뒤에 두어 테스트에서 in-memory 구현으로 교체.

## 10. 구현 순서 (Do 단계 매핑)

1. 스캐폴딩 + config + Supabase 마이그레이션 적용
2. matcher/selector/template/fault 모듈 + 단위 테스트
3. RuleRepository(Supabase) + RuleCache + mock router
4. logger + SSE + 정리 job
5. 관리 API + import/export
6. 관리 웹 (프로젝트→규칙 편집기→Try it→로그→설정→가이드)
7. Dockerfile, README, 통합/E2E 테스트

## 11. 오픈 이슈 (구현 중 확정)

- 바이너리 응답 업로드 UI 한도(기본 2MB) 및 Supabase 저장 방식(컬럼 base64 vs Storage)
- 다중 인스턴스 지원 시 sequential 카운터 저장 위치(Redis/DB)
- Supabase Realtime 사용 가능 플랜/설정 확인 (불가 시 폴링만 사용)
