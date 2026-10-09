# Design: Dummy API & 설정 웹사이트

- 작성일: 2026-10-04
- 변경일: 2026-10-09 (v4: 12장 추가 — 응답 프리셋, Import 검증·원자성, 포맷 정책, 내부 IP 접속 가이드)
- 단계: PDCA – Design
- 참조: `docs/01-plan/features/dummy-api.plan.md` (v4)
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

---

# 12. v4 변경 설계 (2026-10-09)

Plan v4 대응. 1~11장(v3 구현)은 유지하고, 아래 항목만 추가·변경한다. 개인/팀용, 같은 사무실 망 사용을 전제로 한다.

| # | 항목 | 변경 대상 |
|---|---|---|
| 12.1 | 응답 프리셋 (전역) | 신규: `presets` 저장소·API·UI |
| 12.2 | Import 검증·미리보기·원자성 | `admin/routes.ts` import, `Repo.importRules`, `0004` RPC |
| 12.3 | Import/Export 포맷 정책 | `admin/schemas.ts`, export 응답 |
| 12.4 | 내부 IP 접속 가이드 | README, 서버 listen 설정 확인 |
| 12.5 | 테스트 계획 / 12.6 구현 순서 | |

변경하지 않는 것: 프로젝트 모델, 인증(`ADMIN_PASSWORD`), 규칙 캐시, mock 라우터, 로그.

## 12.1 응답 프리셋 (전역)

### 개념
- 프리셋 = 이름 붙은 `contentType + headers + body(또는 bodyBase64)`. **status·지연·장애·가중치·조건은 포함하지 않는다** (내용과 동작 분리).
- **전역**: 프로젝트와 무관하게 모든 프로젝트의 규칙 편집기에서 사용.
- **복사 의미(copy semantics)**: 프리셋을 응답에 적용하면 값이 응답으로 *복사*된다. 이후 프리셋을 수정·삭제해도 이미 만든 규칙에는 영향 없음(참조 아님). → 규칙 JSON 포맷·mock 라우터 변경 불필요.

### 타입 (`server/src/types.ts`)
```ts
export interface Preset {
  id: string;
  name: string;                       // 1~80자, 앞뒤 공백 제거, 대소문자 무시 유일
  contentType: string;
  headers: Record<string, string>;
  body: string | null;
  bodyBase64: string | null;          // body와 택일, 2MB 한도(responseSchema와 동일)
  createdAt: string;
  updatedAt: string;
}
export type PresetInput = Omit<Preset, 'id' | 'createdAt' | 'updatedAt'>;
```

### 저장소
**Supabase** — `supabase/migrations/0003_presets.sql`
```sql
create table presets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  content_type text not null default 'application/json',
  headers      jsonb not null default '{}'::jsonb,
  body         text,
  body_base64  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index presets_name_uq on presets (lower(btrim(name)));
alter table presets enable row level security;   -- 서버(service role)만 접근, 다른 테이블과 동일 방침
```
**로컬 JSON(`MemoryRepo`)** — 파일에 `{ projects, rules, presets }`로 저장. 기존 파일에 `presets`가 없으면 `[]`로 로드(`d.presets ?? []`) → **기존 `data/db.json` 호환**.

`Repo` 인터페이스 추가:
```ts
listPresets(): Promise<Preset[]>;                       // name 오름차순
getPreset(id: string): Promise<Preset | null>;
createPreset(input: PresetInput): Promise<Preset>;      // 이름 중복 시 ConflictError
updatePreset(id: string, input: PresetInput): Promise<Preset | null>;
deletePreset(id: string): Promise<boolean>;
importPresets(inputs: PresetInput[], mode: 'merge' | 'replace'): Promise<{ created: number; updated: number }>; // 원자적
```

### 관리 API (`/__admin/api`, 기존 인증 훅 적용)
| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/presets` | 목록(`q` 이름 검색) / 생성 (중복 이름 409) |
| PUT/DELETE | `/presets/:id` | 전체 교체 / 삭제 |
| GET | `/presets/export` | 프리셋 JSON 다운로드용 |
| POST | `/presets/import?mode=merge\|replace&dryRun=true\|false` | 12.2와 동일한 검증·미리보기·원자 반영 |

- 검증 스키마 `presetInputSchema`는 `responseSchema`의 `contentType`/`headers`/`bodyBase64` 제약을 재사용(2MB 한도 포함). `name`은 trim 후 1~80자.
- **병합 기준 = 이름(대소문자 무시)**: 같은 이름이면 덮어쓰기(규칙의 method+path 병합과 같은 철학). 교체 모드는 기존 프리셋 전부 삭제 후 파일 내용으로 대체.
- 파일 내 이름 중복은 검증 오류.

### 프리셋 파일 포맷
```json
{
  "version": 1,
  "kind": "presets",
  "exportedAt": "2026-10-09T10:00:00.000Z",
  "presets": [
    { "name": "401 토큰 만료", "contentType": "application/json",
      "headers": { "WWW-Authenticate": "Bearer" },
      "body": "{\"error\":\"token_expired\"}", "bodyBase64": null }
  ]
}
```
- `kind`로 규칙 파일과 구분. 규칙 Import에 프리셋 파일을 올리면 "프리셋 파일입니다. 프리셋 화면에서 가져오세요"로 안내(반대도 동일).

### 웹 UI
1. **규칙 편집기 `ResponseCard`** (`web/src/RuleEditor.tsx`): Content-Type/headers/body 영역 상단에
   - `프리셋 불러오기 ▾` 드롭다운(이름 검색): 선택 시 `contentType`, `headers`, `body`/`bodyBase64`를 덮어쓴다. 현재 내용이 비어 있지 않으면 `confirm`. 편집기 내부 `headersText` 상태도 함께 갱신.
   - `프리셋으로 저장` 버튼: 이름 입력(`prompt` 또는 소형 Modal) → 같은 이름이 있으면 "덮어쓸까요?" 확인 후 `PUT`, 없으면 `POST`.
2. **프리셋 관리 화면** (`web/src/PresetsPage.tsx`, 신규): 해시 라우트 `#/presets`. 표(이름, Content-Type, 헤더 수, 바디 미리보기 한 줄) + 검색, 편집(Modal), 삭제, `Import`/`Export` 버튼. 진입 링크는 프로젝트 목록 헤더와 프로젝트 화면 상단에 "프리셋" 추가. `App.tsx`의 `parseHash`에 `#/presets` 분기.
3. **공통 컴포넌트 추출**: `ResponseCard`의 Content-Type·headers·body(텍스트/바이너리) 입력부를 `ResponseContentFields`로 분리해 프리셋 편집 Modal과 공유(중복 방지).
4. `web/src/api.ts`에 `Preset` 타입과 `presets/createPreset/updatePreset/deletePreset/exportPresets/importPresets` 추가.

## 12.2 Import 검증·미리보기·원자성 (규칙/프리셋 공통)

### 현황의 문제 (코드 확인)
- `POST /projects/:pid/import`는 규칙을 하나씩 `createRule`/`replaceRule`로 반영 → **중간 실패 시 일부만 반영**.
- 교체 모드는 기존 규칙을 **먼저 삭제**한 뒤 생성 → 생성 실패 시 기존 규칙 소실.
- 파일 안에 같은 `(method, path)`가 두 번 있으면, 첫 번째 생성 후 두 번째에서 충돌 → 부분 반영.
- 검증 오류가 첫 번째 ZodError 하나로만 전달되어 어느 규칙의 어느 필드인지 알기 어려움.

### 서버 처리 흐름 (규칙 import)
```
1. 파싱·검증(전체)      importSchema → 규칙별 ruleInputSchema 변환
                         오류는 모아서 [{ index, name?, path:'responses.0.status', message }]
2. 파일 내 중복 검사     (method, pathPattern) 중복 → 오류에 포함
3. 계획 산출             기존 규칙과 비교해 create / update / (replace 모드) delete 건수
4. dryRun=true          → 200 { ok:true|false, summary:{create,update,delete}, errors }  (DB 변경 없음)
5. dryRun=false          오류 있으면 422 { error:'import_invalid', errors } (DB 변경 없음)
                         오류 없으면 repo.importRules(...)로 원자 반영 → 200 { created, updated, deleted }
6. 반영 후 cache refresh
```
- 검증 단계(1~3)는 dry-run과 실제 반영이 **동일 함수**를 사용 → 미리보기 결과와 실제 결과가 어긋나지 않음.

### 원자적 반영: `Repo.importRules(projectId, inputs, mode)`
- **MemoryRepo**: 현재 `this.rules` 사본에 삭제/교체/생성을 모두 적용해 유일성 검사를 통과하면 한 번에 교체하고 `persist()`. 실패하면 원본 불변.
- **SupabaseRepo**: 새 RPC `import_rules(p_project_id uuid, p_mode text, p_rules jsonb)` — `supabase/migrations/0004_import_rules_rpc.sql`. plpgsql 함수 1회 호출은 하나의 트랜잭션이므로, `replace` 모드의 삭제와 전체 삽입이 함께 커밋되거나 함께 롤백된다. `0002`와 동일하게 `revoke ... from public, anon, authenticated; grant ... to service_role`.
  - 프리셋도 같은 방식: `import_presets(p_mode text, p_presets jsonb)` (`0004`에 함께 포함).
- **RPC 미적용 시 폴백**(`replace_rule`과 같은 정책): 경고 로그 + 보상 방식. 반영 전에 `listRules` 스냅샷을 확보하고, 중간 실패 시 스냅샷으로 복구를 시도(완전한 원자성은 아님을 로그/README에 명시). 마이그레이션 적용을 권장.

### 웹 UI (Import 흐름 개선)
기존 `confirm` 방식(확인=교체/취소=병합)을 제거하고 **Import Modal**로 교체:
1. 파일 선택 → `JSON.parse` 실패 시 즉시 오류 표시(변경 없음)
2. 모드 라디오: `병합 (같은 method+path는 덮어쓰기)` / `교체 (기존 규칙 모두 삭제)` — 기본 병합, 교체 선택 시 경고색
3. `dryRun` 호출 결과 표시: "신규 N · 덮어쓰기 M · 삭제 K" + 오류 목록(`#3 GET /v2/orders: responses[0].status — ...`)
4. 오류가 있으면 `가져오기` 버튼 비활성. 없으면 활성 → 반영 → 토스트
5. 프리셋 Import도 같은 Modal 컴포넌트 재사용(대상/라벨만 다름)

## 12.3 포맷 정책 (version 1 유지)

- **규칙 파일**: `version: 1` 유지. 선택 메타 추가 — `kind: 'rules'`, `exportedAt`, `project: { slug, name }`. 기존 v1 파일(메타 없음)은 그대로 Import 가능.
- **알 수 없는 필드**: Import 시 **무시(strip)** — 신버전에서 필드가 늘어도 구버전 서버가 읽을 수 있게 하는 전방 호환. 단 필수·타입 오류는 거부. 이 정책을 README에 명시.
- **`version`**: 현재는 `1`만 허용(`z.literal(1)`). 호환이 깨지는 변경이 생길 때만 올린다. 지금 변경은 모두 추가 필드뿐이므로 올리지 않음.
- **Export 응답**에 `Content-Disposition` 파일명(`<slug>-rules.json`, `presets.json`)은 클라이언트에서 생성(기존 방식 유지).
- **민감 정보 안내**: Export 버튼 옆 안내 — "headers·body에 토큰 등이 있으면 파일에 포함됩니다. 공유·커밋 전에 확인하세요." 로그는 Export 대상이 아님.

## 12.4 내부 IP 접속 가이드 (같은 사무실 망/Wi-Fi)

- README에 "다른 기기에서 접속하기" 절 추가: ① 서버 PC IP 확인(`ipconfig`의 IPv4) ② 앱/브라우저 베이스 URL `http://<PC IP>:3000/m/<slug>` ③ Windows 방화벽 인바운드 규칙 허용(관리자 PowerShell: `New-NetFirewallRule -DisplayName "dummy-api" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`) ④ 네트워크 프로필이 "공용"이면 차단될 수 있으므로 "개인"으로 확인 ⑤ 에뮬레이터는 `10.0.2.2`, 실기기는 PC와 같은 Wi-Fi 필수(게스트 Wi-Fi·AP 격리 주의).
- **확인 완료**: 서버는 이미 `host: '0.0.0.0'`으로 listen 한다(`server/src/index.ts:32`). 코드 변경 불필요, 문서화만 하면 된다.
- 이미 있는 `GET /server-info`(LAN IP 후보)와 콘솔 연결 가이드 탭의 주소 안내는 그대로 사용.
- **부록**: 다른 장소에서 쓸 때만 Tailscale Funnel / Cloudflare Tunnel 사용. 외부 노출 시 `ADMIN_PASSWORD` 필수, Cloudflare 프록시는 긴 timeout 시뮬레이션(130초+)을 끊을 수 있음.

## 12.5 테스트 계획 (v4 추가분)

| 레벨 | 대상 | 시나리오 |
|---|---|---|
| 단위 | `presetInputSchema` | 이름 trim·길이, headers 타입, 2MB 초과 bodyBase64 거부, body/bodyBase64 택일 |
| 단위 | import 검증 | 오류를 규칙 번호·필드 경로로 수집, 파일 내 `(method,path)` 중복 검출, v1 메타 없는 파일 통과, 알 수 없는 필드 무시, `kind` 불일치 안내 |
| 통합 (Memory) | 규칙 import | **round-trip**: export → 새 프로젝트 import → 모든 필드 동일 / 병합·교체 건수 / **오류 파일 → 422 + 기존 규칙 불변** / 교체 중 충돌 유도 → 기존 규칙 보존 / `dryRun`은 DB 불변 |
| 통합 (Memory) | 프리셋 | CRUD, 대소문자 무시 이름 중복 409, export→import round-trip(병합·교체), `db.json`에 `presets` 없는 기존 파일 로드 |
| 통합 | 인증 | 프리셋/Import API가 `ADMIN_PASSWORD` 설정 시 401(기존 훅 적용 확인) |
| E2E (Playwright) | 콘솔 | 프리셋 저장 → 다른 프로젝트 규칙 편집기에서 불러오기 → 헤더·바디 채워짐 / 프리셋 Export → Import / 잘못된 규칙 파일 Import 시 오류 목록 표시, 규칙 불변 |
| 수동 | 내부 IP | 같은 Wi-Fi 실기기에서 `http://<PC IP>:3000/m/<slug>/...` 호출 (방화벽 허용 포함) |
| (옵션) | Supabase RPC | 로컬 Supabase 또는 테스트 프로젝트에서 `import_rules` 롤백 동작 확인 — 미준비 시 수동 체크리스트로 대체하고 check 문서에 기록 |

## 12.6 구현 순서 (Do 단계 매핑, Plan 5-1)

1. **타입·스키마**: `Preset`/`PresetInput`, `presetInputSchema`, import 검증 함수(오류 수집·중복 검출) 분리 + 단위 테스트
2. **Repo**: `MemoryRepo`에 presets·`importRules`·`importPresets` (파일 호환 포함) + 통합 테스트
3. **Supabase**: `0003_presets.sql`, `0004_import_rules_rpc.sql`, `SupabaseRepo` 구현·폴백, 마이그레이션 적용 안내 추가
4. **관리 API**: `/presets*`, import `dryRun`/422 응답, export 메타(`kind`, `exportedAt`, `project`)
5. **웹**: `ResponseContentFields` 추출 → 프리셋 불러오기/저장 → `PresetsPage` → Import Modal(규칙·프리셋 공용) → Export 안내 문구
6. **E2E 갱신**, README(Import/Export 사용법, 프리셋, 내부 IP 접속, 터널 부록), `.env.example` 변경 없음
7. check 문서에 v4 검증 결과 기록

## 12.7 저장소 방침 (확정): Supabase 무료 플랜

- 운영 저장소는 **Supabase 무료 플랜**. 팀 10명 내외 규모에서 용량은 충분하다(규칙·프리셋은 수 MB, 로그는 프로젝트당 5,000건·7일로 자동 정리). 무료 한도는 가입 전 현재 가격 페이지에서 재확인한다.
- `MemoryRepo`(로컬 JSON)는 **테스트·로컬 개발·Supabase 미설정 시 폴백** 용도로 유지한다. 두 구현은 `Repo` 인터페이스로 동일하게 동작해야 하며 v4 기능(프리셋, `importRules`)도 양쪽에 구현한다.
- **무료 플랜 운영 주의**
  - 장기간(약 1주일) 접속이 없으면 프로젝트가 자동 일시정지될 수 있음 → README에 "일시정지 시 대시보드에서 Restore 후 서버 재시작" 절차 기재, 장기 휴무 전에는 규칙·프리셋을 Export해 둘 것을 안내.
  - 자동 백업이 없다고 가정 → **JSON Export가 곧 백업 수단**. README에 "정기적으로 규칙·프리셋 Export" 권고.
  - 서버 시작 시 DB 연결 실패하면 원인(일시정지 가능성)을 로그에 안내 문구와 함께 출력.
- **Supabase 설정 절차(README)**: 프로젝트 생성 → SQL Editor에서 `0001_init.sql`, `0002_replace_rule_rpc.sql`, **`0003_presets.sql`, `0004_import_rules_rpc.sql`** 순서대로 실행 → `.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 입력. service role key는 서버 환경변수로만 보관(커밋 금지, 웹에 노출 금지).

## 12.8 오픈 이슈 / 리스크

- **Supabase 마이그레이션 수동 적용 필요**(`0003`, `0004`): 미적용 상태로 서버를 올리면 프리셋 API가 실패한다 → 시작 시 `presets` 테이블 접근 가능 여부를 점검해 경고 로그를 남기고, 프리셋 API는 명확한 오류 메시지(`migration_required`)를 반환한다.
- **RPC 폴백은 완전한 원자성이 아님**: 보상 복구 방식이므로 `0004` 적용을 README에서 필수 단계로 안내.
- **전역 프리셋 = 팀 공유 자원**: 한 사람이 프리셋을 수정·삭제하면 모두에게 보인다(기존 규칙에는 영향 없음, 복사 의미). 인증 없는 팀 도구의 기존 특성과 동일하며 별도 권한 모델은 도입하지 않는다.
- **프리셋 바디의 템플릿 변수**(`{{...}}`)는 적용 시 그대로 복사되고 요청 처리 시점에 렌더링된다(기존 동작과 동일).
