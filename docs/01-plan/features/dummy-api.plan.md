# Plan: Dummy API & 설정 웹사이트 (모바일 네이티브 앱 테스트용)

- 작성일: 2026-10-04 (v3: Supabase DB, 팀 공유 서버, 향후 유저 기반 확장 대비)
- 변경일: 2026-10-09 (v4: 개인/팀용 운영 유지, 비용 0 운영 가이드, JSON Import/Export 보완)
- 단계: PDCA – Plan
- 상태: v4 변경안 (사용자 검토 대기). v3 구현은 완료되어 있으며, v4는 그 위의 **작은 보완**임

## 0. v4 변경 요약 (2026-10-09)

검토 과정에서 PUBLIC 배포 + Google 광고 수익화안(계정 없는 임시 세션 모델)을 검토했으나, **서버·도메인 비용 대비 수익이 불확실**하고 광고 승인용 콘텐츠 사이트·쿠키 동의·남용 방어 등 부담이 커서 **채택하지 않았다.** 개인/팀용 도구로 유지한다.

| 구분 | v3 (현재 구현) | v4 (변경) |
|---|---|---|
| 용도 | 팀 공유 서버 | **개인/팀용 유지** (PUBLIC·광고·수익화는 범위 제외) |
| 저장·구분 단위 | 프로젝트 slug (`/m/<slug>`), Supabase 또는 로컬 JSON | **변경 없음** |
| 운영 비용 | 호스트 미정 | **비용 0 운영 가이드** 추가 (PC/사무실 PC + 터널, 또는 무료 VM) |
| Import/Export | 규칙 전체를 JSON(version 1)으로 Export/Import **이미 구현** (headers·body 포함, 병합/교체) | **재사용성 보완** (선택 Export, Import 미리보기·오류 위치, 원자성 — D장) |

핵심 원칙: **headers·body를 포함한 규칙은 JSON 파일로 PC에 보관하고, 필요할 때 다시 불러온다.** 일회성 사용은 새 프로젝트를 만들어 Import한 뒤 삭제하는 흐름으로 대체한다.

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

**D. JSON Import/Export 보완 (v4)**

현황(구현됨): 프로젝트 단위로 규칙 전체(method, path, enabled, conditions, selectMode, 응답별 status/contentType/headers/body/bodyBase64/delay/weight/conditions/fault)를 `{ version: 1, rules: [...] }` JSON으로 Export, Import는 병합(같은 method+path 덮어쓰기) 또는 교체. 즉 **headers·body의 파일 보관·재사용은 이미 가능**하다. 아래는 사용성·안전성 보완이다.

1. ~~선택한 규칙만 Export~~: **생략** (자주 쓰는 응답 재사용은 아래 7번 프리셋이 담당)
2. **Import 미리보기·검증**: 반영 전에 신규/덮어쓰기/오류 건수를 보여주고, 오류는 규칙 번호·필드 단위로 표시. 병합/교체는 `confirm` 대신 명시적 선택 UI
3. **Import 원자성**: 현재 교체 모드는 기존 규칙을 먼저 삭제한 뒤 생성하므로 중간 실패 시 일부만 반영될 수 있음 → 전체 검증 통과 후 반영하고, 실패 시 기존 데이터가 보존되도록 개선 (방식은 Design에서 확정)
4. **포맷 호환**: version 1 유지(필드 추가는 하위 호환). `exportedAt`, 프로젝트명 등 메타는 선택 필드로 추가. 알 수 없는 필드의 처리 정책을 문서화
5. **보안 안내**: headers에 `Authorization` 토큰 등 민감 값이 있을 수 있으므로 Export 시 안내 문구 표시 (로그는 Export 대상 아님)
6. **일회성 사용**: 별도 세션 모델 없이, 새 프로젝트 생성 → Import → 사용 → 프로젝트 삭제 흐름으로 충족
7. **응답 프리셋 (headers·body 단독 저장, 확정)**: 자주 쓰는 응답 내용을 이름 붙여 저장하고 재사용
   - 프리셋 = `name` + `contentType` + `headers` + `body`(+ 필요 시 `bodyBase64`). 상태 코드·지연·장애·가중치·조건은 포함하지 않음(내용과 동작 분리)
   - 규칙 편집기에서 응답 작성 시 프리셋을 선택해 headers·body를 채우고, 현재 편집 중인 응답을 프리셋으로 저장 가능
   - 프리셋 목록 관리(추가/수정/삭제/이름 검색) 및 **별도 JSON 파일로 Import/Export** (`{ version: 1, presets: [...] }`, 규칙 파일과 분리)
   - 저장 범위는 **전역(모든 프로젝트 공유, 확정)**. 저장소(Supabase 테이블 추가 + 로컬 JSON 모드 대응), 이름 중복 정책은 Design에서 확정

**E. 비용 0 운영 가이드 (v4, 문서 작업)**
- **기본(확정)**: 같은 사무실 망/Wi-Fi 환경이므로 서버 PC의 내부 IP(`http://<PC IP>:3000`)로 접속. 비용·추가 도구 없음. 콘솔 연결 가이드의 주소 안내를 README에도 정리하고, Windows 방화벽에서 포트 허용 방법을 포함
- **부록(다른 장소에서 쓸 때만)**: 로컬/사무실 PC에서 실행 + 터널로 외부 접속: Tailscale Funnel(고정 `*.ts.net` HTTPS 주소, 도메인 불필요), Cloudflare Tunnel(빠른 모드는 무작위 주소, 이름 지정 모드는 본인 도메인 필요)
- 24시간 구동이 필요하면 무료 클라우드 VM(예: Oracle Cloud Always Free) 사용 가능. 슬립하는 무료 PaaS는 SSE·지연 시뮬레이션과 맞지 않음
- 인터넷에 노출되는 경우 `ADMIN_PASSWORD` 설정 필수, `/m/*`는 항상 공개이므로 민감한 응답은 넣지 말 것
- Cloudflare 프록시는 긴 응답 대기(130초+ timeout 시뮬레이션)를 끊을 수 있음 → 해당 기능은 Tailscale 또는 프록시 미경유 구성에서 사용
- 서비스별 무료 조건은 수시로 바뀌므로 가이드에 "가입 전 현재 약관 확인" 명시

### Out of Scope (추후)
- 로그인/유저별 권한 (⇒ 설계는 대비, 구현은 다음 단계), 외부 공개 배포용 보안 강화
- **PUBLIC 배포, Google 광고 수익화, 계정 없는 임시 세션 모델** (v4 검토 후 제외. 다시 검토하려면 서버·도메인 비용, 광고 승인용 콘텐츠 사이트, 쿠키 동의, 남용 방어를 별도 Plan으로 다룰 것)
- GraphQL/WebSocket, OpenAPI 자동 생성, 클라우드 영구 저장

## 3. 기술 스택 제안

| 영역 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 24 + TypeScript | 설치됨 |
| 서버 | Fastify (catch-all 라우트 + 자체 매처) | 런타임 규칙 변경 시 라우트 재등록 불필요 |
| 저장소 | **Supabase (Postgres)** — 서버에서 service role key로 접근 (`@supabase/supabase-js`). 미설정 시 로컬 JSON(`data/db.json`) 사용 (v4: 변경 없음, 비용 0 운영은 로컬 JSON 모드 가능) | 팀 공유·영속, 마이그레이션/RLS/Auth/Realtime를 나중에 그대로 활용 |
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

### v4 설계 영향 (Design 단계에서 구체화)
- **변경 범위**: 관리 API의 `/projects/:pid/export`·`/import`(`server/src/admin/routes.ts`), `importSchema`(`schemas.ts`), 웹의 `RulesTab.tsx`(Export/Import UI)에 국한. 프로젝트 모델, 저장소, 인증, 캐시는 **변경 없음**
- **선택 Export**: 규칙 id 목록을 받는 export 변형(쿼리 또는 POST)과 목록 체크박스 UI
- **Import 2단계화**: 검증·미리보기(dry-run)와 반영을 분리. 검증은 기존 `importSchema` + `ruleInputSchema`를 재사용하되 오류에 규칙 인덱스·필드 경로를 포함
- **원자성**: Supabase 모드에서는 규칙 교체용 RPC(`replace_rule`)가 이미 있으므로 이를 확장하거나 사전 검증 + 실패 시 보상(재생성)으로 처리할지 Design에서 결정. 로컬 JSON 모드(`repo/memory.ts`)도 동일 동작 보장
- **포맷**: version 1 유지, 선택 메타 필드 추가. `z.object` 기본 동작(알 수 없는 필드 무시)을 명시적 정책으로 문서화

## 5. 작업 분해 (Do 단계 예정)

> v3 작업 1~9는 구현 완료. v4 추가 작업은 5-1 참조.

1. 스캐폴딩 (TS, 스크립트, lint)
2. Supabase 프로젝트/스키마 마이그레이션 + 규칙 저장소 + 메모리 캐시 + path 매처(정적/파라미터/와일드카드) + 단위 테스트
3. catch-all 핸들러: 응답 선택(고정/순차/랜덤/조건), 지연·장애 주입, 템플릿 렌더링
4. 요청 로그 + SSE
5. 관리 API (`/__admin/api/rules` CRUD, import/export)
6. 관리 웹: 규칙 목록·편집기·Try it·로그·미매칭→규칙 생성
7. 내장 `/_/status`, `/_/delay`
8. 전역 설정, 연결 가이드(QR)
9. Dockerfile, 배포 가이드, README, 통합 테스트

### 5-1. v4 추가 작업
1. 응답 프리셋(전역): 저장소·API(CRUD), 규칙 편집기에서 프리셋 선택/현재 응답을 프리셋으로 저장, 프리셋 관리 UI, 프리셋 JSON Import/Export (Supabase 마이그레이션 추가 + 로컬 JSON 모드 대응)
2. Import 검증·미리보기(dry-run): 신규/덮어쓰기/오류 건수, 규칙·필드 단위 오류 표시, 병합/교체 선택 UI 개선
3. Import 원자성 개선 (교체 모드 중간 실패 시 기존 데이터 보존), Supabase·로컬 JSON 양쪽 모드
4. Export 메타 필드(`exportedAt` 등) 추가 및 민감 헤더 안내 문구
5. 테스트: Export → Import 왕복(round-trip), v1 파일 호환, 잘못된 파일 거부 시 데이터 불변, 선택 Export, E2E 갱신
6. 문서: README에 비용 0 운영 가이드(Tailscale Funnel / Cloudflare Tunnel / 무료 VM)와 Import/Export 사용법 추가

## 6. 성공 기준 (Check 단계)

### v4 성공 기준
- [ ] 규칙을 Export한 JSON을 다른(새) 프로젝트에 Import하면 method/path/status/headers/body/지연/장애/다중 응답/조건이 동일하게 복원 (round-trip 테스트)
- [ ] 프리셋을 만들어 두면 어떤 프로젝트의 규칙 편집기에서든 선택해 headers·body를 채울 수 있음 (전역)
- [ ] 편집 중인 응답을 프리셋으로 저장하고, 프리셋 JSON을 Export한 뒤 다른 서버/환경에 Import하면 동일하게 복원됨
- [ ] 기존 version 1 파일을 그대로 Import 가능
- [ ] 잘못된 파일은 어느 규칙의 어느 필드가 문제인지 알려주며 거부되고, **기존 규칙은 변경되지 않음** (병합·교체 모두)
- [ ] 교체 Import 중 오류가 나도 기존 규칙이 사라지지 않음 (Supabase·로컬 JSON 모드 모두)
- [ ] README 가이드대로 같은 Wi-Fi의 실기기에서 `http://<PC IP>:3000/m/<slug>/...` 호출 성공 (방화벽 포트 허용 포함)

### v3 성공 기준

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
| (v4) Export 파일의 민감 값 | headers에 토큰 등이 포함된 JSON을 공유/커밋할 수 있음 | Export 시 안내 문구, README에 저장소 커밋 주의 명시 |
| (v4) Import 부분 반영 | 교체 모드 중간 실패 시 규칙 일부 소실 | 사전 검증 + 원자적 반영 (D장 3번) |
| (v4) 터널로 인터넷 노출 | 콘솔·`/m/*`가 외부에 노출됨 | `ADMIN_PASSWORD` 필수, 민감 응답 금지, 사용하지 않을 때 터널 종료 |
| (v4) 무료 서비스 조건 변경 | 터널/무료 VM의 정책·한도가 바뀔 수 있음 | 가이드에 "현재 약관 확인" 명시, 대안(다른 터널) 병기 |

## 8. 결정 사항 (확정)

1. 스택: Node/TS + Fastify + React ✅
2. 조건 매칭 + 다중 응답: MVP 포함 ✅
3. 팀 공유 서버 (Docker 배포, 프로젝트별 분리) ✅
4. 인증: 지금은 없음, 향후 유저 기반 확장 대비 설계 ✅
5. DB: Supabase (Postgres) ✅

### v4 확정 사항 (2026-10-09)
6. 용도: 개인/팀용 유지. PUBLIC 배포·Google 광고·계정 없는 임시 세션 모델은 제외 ✅
7. Import/Export 범위: 규칙 전체(headers·body 포함) JSON — 이미 구현됨, v4는 보완만 ✅
8. 비용 0 운영: 같은 사무실 망/Wi-Fi에서 내부 IP로 접속 (터널은 부록) ✅
9. 응답 headers·body 프리셋: 전역, 별도 JSON Import/Export ✅ / 선택 Export는 생략 ✅
10. 저장소: **Supabase 무료 플랜**(팀 10명 내외). 로컬 JSON 모드는 테스트·개발·폴백용으로 유지. 일시정지·백업 없음에 대비해 JSON Export를 백업 수단으로 안내 ✅

### 남은 확인 사항 (Design 단계 전에 답 주시면 좋음)
- ~~응답 headers·body 프리셋~~ → **필요함 (확정, D-7)**
- ~~선택 Export~~ → **생략 (프리셋이 대체, D-1 제외)**
- ~~사용 환경~~ → **같은 사무실 망/Wi-Fi (확정)**: 내부 IP 접속이 기본이므로 터널 가이드(E장)는 "다른 장소에서 쓸 때"용 부록으로 간략히
- ~~프리셋 범위~~ → **전역 (확정)**

(Design 전 추가 확인 사항 없음)

## 9. 다음 단계

v4 승인 후 `pdca design dummy-api` → Import 검증·원자성 방식, 선택 Export API, 포맷 정책 설계 → Do 단계 구현. 변경 범위가 작아 Design 문서는 기존 문서에 v4 절을 추가하는 정도로 충분하다.
