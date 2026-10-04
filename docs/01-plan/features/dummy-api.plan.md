# Plan: Dummy API & 설정 웹사이트 (모바일 네이티브 앱 테스트용)

- 작성일: 2026-10-04 (v3: Supabase DB, 팀 공유 서버, 향후 유저 기반 확장 대비)
- 단계: PDCA – Plan
- 상태: Draft (사용자 검토 대기)

## 1. 배경 / 목적

모바일 네이티브 앱(iOS/Android) 개발 중 백엔드가 없거나 불안정할 때, **개발자가 원하는 URL path와 응답을 직접 등록**하면 앱이 그 path를 호출해 등록한 응답(기본 200 OK, 또는 지정한 상태 코드)을 받는 **Dummy API 서버**와, 등록·관리용 **설정 웹사이트**를 만든다.

### 해결하려는 문제
- 사전 정의된 샘플 API에 앱을 맞추지 않고, **실제 백엔드 명세 그대로의 path**(예: `/v2/orders/123/items`)를 등록해 앱 코드를 바꾸지 않고 테스트
- 성공 외에 4xx/5xx, 지연, 타임아웃, 빈 바디, 깨진 JSON 등 재현하기 어려운 상황을 응답별로 설정
- 재배포 없이 웹에서 즉시 응답 변경

## 2. 범위

### In Scope (MVP)

**A. Mock API 서버 (catch-all 동작)**
- 등록된 규칙에 매칭되는 모든 요청에 대해 설정된 응답을 반환. 미등록 요청은 404(설정 시 안내 JSON 포함)
- 매칭 기준: **HTTP method + path**
  - 정적 path: `/users/me`
  - 경로 파라미터: `/users/:id`, 와일드카드 `/files/*`
  - method는 GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS 및 ANY
  - (선택) 쿼리/헤더/바디 조건 매칭: 예) `?type=vip`일 때 다른 응답
- 응답 설정: **status code(기본 200)**, headers, body(JSON/text/빈 바디/base64 파일), content-type, 지연(ms 고정 또는 범위 랜덤)
- 한 규칙에 **응답 여러 개** 등록하고 선택 방식 지정: 고정 / 순차(1번째 200, 2번째 500...) / 가중치 랜덤 / 조건 매칭
- 응답 템플릿 변수: `{{params.id}}`, `{{query.page}}`, `{{body.email}}`, `{{now}}`, `{{uuid}}`, `{{faker.name}}`
- 장애 시뮬레이션: 연결 끊기, 타임아웃(응답 안 줌), 잘린 응답, 에러 주입 확률(%)
- 편의 내장 엔드포인트 (선택, 예약 prefix `/_/` 아래): `/_/status/:code`, `/_/delay/:ms` — 등록 없이 상태 코드/지연만 빠르게 테스트

**B. 설정 웹사이트 (Admin Console, `/__admin`)**
- 엔드포인트 규칙 목록/검색/생성/수정/삭제/복제/활성화 토글
- 규칙 편집기: method, path, 상태 코드 선택(드롭다운 + 직접 입력), 헤더, 바디 에디터(JSON 검증), 지연, 다중 응답/선택 방식
- **Try it**: 웹에서 바로 호출해 응답 확인, cURL 복사
- 요청 로그 뷰어(SSE 실시간): 어떤 규칙에 매칭됐는지, 미매칭 요청 표시 → "이 요청으로 규칙 만들기" 버튼
- **프로젝트(워크스페이스) 단위 관리**: 팀/앱별로 규칙·로그 분리, 규칙 Import/Export(JSON), 가능하면 OpenAPI/Postman import는 Phase 2
- 전역 설정: 베이스 prefix, 전역 지연/에러 주입, CORS, 미매칭 동작
- 연결 가이드: 베이스 URL, QR 코드(실기기), 에뮬레이터 주소 안내, iOS ATS / Android cleartext 설정 예시

**C. 팀 공유 서버 운영**
- 팀원 모두 같은 URL로 접속, 프로젝트별로 규칙 분리 (예: 앱A / 앱B / 환경별)
- 프로젝트마다 고유 베이스 URL: `https://<host>/m/<projectSlug>/<개발자 정의 path>`
- 현재는 **로그인 없음**(링크 아는 사람은 누구나 사용). 단, 데이터 모델은 유저 기반 확장을 전제로 설계 (아래 4장)
- Docker 이미지 + 호스팅 가이드

### Out of Scope (추후)
- 로그인/유저별 권한 (⇒ 설계는 대비, 구현은 다음 단계), 외부 공개 배포용 보안 강화
- GraphQL/WebSocket, OpenAPI 자동 생성, 클라우드 영구 저장

## 3. 기술 스택 제안

| 영역 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 24 + TypeScript | 설치됨 |
| 서버 | Fastify (catch-all 라우트 + 자체 매처) | 런타임 규칙 변경 시 라우트 재등록 불필요 |
| 저장소 | **Supabase (Postgres)** — 서버에서 service role key로 접근 (`@supabase/supabase-js`) | 팀 공유·영속, 마이그레이션/RLS/Auth/Realtime를 나중에 그대로 활용 |
| 관리 웹 | Vite + React, 서버가 정적 서빙 | 단일 포트·프로세스 |
| 실시간 로그 | SSE | 단순 |
| 실행/배포 | `npm start` + Dockerfile, 상시 구동 호스트(Render/Fly/Railway/사내 서버 등) | 팀 공유. 서버리스는 SSE·지연 시뮬레이션에 부적합하여 제외 |

## 4. 핵심 설계 포인트

- **catch-all 라우터**: 모든 요청을 받아 규칙 테이블에서 매칭. 우선순위: 구체적 path(정적 > 파라미터 > 와일드카드) → 조건 매칭 규칙 → 먼저 만든 순
- **예약 경로**: `/__admin/*`(관리 UI/API), `/_/*`(내장 유틸)만 예약. 그 외 모든 path는 개발자 소유
- **데이터 모델(초안, Supabase 테이블)**
  - `projects(id, slug unique, name, owner_id null, created_at)`
  - `rules(id, project_id, method, path_pattern, enabled, conditions jsonb, select_mode, created_by null, ...)`
  - `responses(id, rule_id, order, weight, status, headers jsonb, body, content_type, delay_ms, fault jsonb)`
  - `request_logs(id, project_id, rule_id null, method, path, query, req_headers, req_body, status, latency_ms, created_at)` — 보관 기간/최대 건수 정리 job
  - `project_members(project_id, user_id, role)` — **지금은 미사용, 스키마만 준비**
- **유저 기반 확장 대비**: 모든 테이블에 `project_id` 스코프, `owner_id/created_by` nullable 컬럼 선반영, 관리 API는 `getCurrentUser()` 미들웨어 한 곳을 통과(현재는 anonymous 반환) → 나중에 Supabase Auth + RLS(`project_members` 기반)로 교체. 모의 API 호출(`/m/*`)은 앱이 호출하므로 인증 없이 유지하되 프로젝트별 선택적 API 키 옵션 여지 확보
- **성능**: 요청마다 DB 조회 금지 → 프로젝트별 규칙을 **메모리 캐시**에 보관하고, 관리 API 쓰기 시 즉시 갱신 + Supabase Realtime(또는 짧은 주기 폴링)으로 다중 인스턴스 동기화. 로그는 배치 insert(비동기)로 응답 지연에 영향 없게 처리
- **실시간 로그**: DB insert 후 SSE push (Realtime 구독으로 대체 가능)
- **기본값**: 새 규칙의 status 200, `Content-Type: application/json`, body `{}`

## 5. 작업 분해 (Do 단계 예정)

1. 스캐폴딩 (TS, 스크립트, lint)
2. Supabase 프로젝트/스키마 마이그레이션 + 규칙 저장소 + 메모리 캐시 + path 매처(정적/파라미터/와일드카드) + 단위 테스트
3. catch-all 핸들러: 응답 선택(고정/순차/랜덤/조건), 지연·장애 주입, 템플릿 렌더링
4. 요청 로그 + SSE
5. 관리 API (`/__admin/api/rules` CRUD, import/export)
6. 관리 웹: 규칙 목록·편집기·Try it·로그·미매칭→규칙 생성
7. 내장 `/_/status`, `/_/delay`
8. 전역 설정, 연결 가이드(QR)
9. Dockerfile, 배포 가이드, README, 통합 테스트

## 6. 성공 기준 (Check 단계)

- [ ] 웹에서 `GET /v2/orders/:id`, 상태 200, JSON body 등록 → 앱/curl이 해당 URL 호출 시 그대로 수신 (**재시작 없이**)
- [ ] 같은 path에 method별 다른 응답, 404/401/500 등 임의 상태 코드 응답 가능
- [ ] 순차 응답(200→500→200) 및 지연/장애 주입이 설정대로 동작
- [ ] 경로 파라미터/쿼리 값이 응답 템플릿에 반영
- [ ] 미등록 요청이 로그에 보이고 한 번에 규칙으로 변환 가능
- [ ] 실기기·에뮬레이터·시뮬레이터에서 호출 성공
- [ ] 팀원 2명 이상이 같은 서버에서 서로 다른 프로젝트 규칙을 독립적으로 사용
- [ ] 규칙 변경이 재시작 없이 반영, 캐시 덕분에 매칭 오버헤드 수 ms 이내
- [ ] `.env`에 Supabase URL/key만 넣고 `npm install && npm start`(또는 `docker run`)로 기동
- [ ] 스키마에 `project_id`/`owner_id`가 갖춰져 있어 Auth 도입 시 데이터 마이그레이션 불필요

## 7. 리스크 / 가정

| 항목 | 내용 | 대응 |
|---|---|---|
| iOS ATS / Android cleartext | HTTP 차단 | 가이드 + 선택적 로컬 HTTPS |
| 방화벽/LAN | Windows 방화벽 포트 차단 | README 안내 |
| 관리 콘솔 무방비 | 같은 망 누구나 수정 가능 | 선택적 관리자 토큰 |
| path 충돌 | 앱 path가 예약 경로와 겹침 | 예약 prefix를 `/__admin`, `/_/`로 최소화, 변경 가능하게 설정화 |
| 인증 없는 공유 서버 | URL이 노출되면 누구나 규칙 수정 가능 | 사내망/VPN 또는 호스트 레벨 접근 제한 권장, 유저 기반은 다음 단계 |
| service role key 유출 | DB 전체 권한 | 서버 환경변수로만 보관, 웹/앱에 노출 금지 |
| 로그 무한 증가 | Supabase 용량(무료 플랜 500MB) | 보관 기간/건수 제한 + 정리 job, 바디 크기 상한 |
| Supabase 지연/장애 | 모의 API가 DB에 의존 | 메모리 캐시로 읽기 경로는 DB 독립 |
| 범위 확장 | 기능 욕심 | MVP 먼저, 조건 매칭·import는 후순위 가능 |

## 8. 결정 사항 (확정)

1. 스택: Node/TS + Fastify + React ✅
2. 조건 매칭 + 다중 응답: MVP 포함 ✅
3. 팀 공유 서버 (Docker 배포, 프로젝트별 분리) ✅
4. 인증: 지금은 없음, 향후 유저 기반 확장 대비 설계 ✅
5. DB: Supabase (Postgres) ✅

### 남은 확인 사항 (design 단계 전에 답 주시면 좋음)
- Supabase 프로젝트가 이미 있나요? (없으면 새로 생성 안내 + 마이그레이션 SQL 제공)
- 배포할 호스트가 정해져 있나요? (사내 서버 / Render / Fly 등)
- 프로젝트 URL 방식: path prefix(`/m/<slug>/...`, 기본) vs 서브도메인(`<slug>.host`)

## 9. 다음 단계

승인 후 `pdca design dummy-api` → 데이터 모델/API 명세/화면 설계 → Do 단계 구현.
