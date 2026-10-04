# Dummy API

모바일 네이티브 앱 개발/QA용 **Dummy API 서버 + 설정 웹 콘솔**.
개발자가 원하는 **method + URL path**를 웹에서 등록하면, 앱이 그 path를 호출할 때 지정한 응답(기본 200 OK, 또는 임의 상태 코드/지연/장애)을 받습니다.

## 빠른 시작

```bash
npm install
cp .env.example .env      # Supabase 값 입력 (없으면 로컬 파일 data/db.json 사용)
npm run build
npm start                 # http://localhost:3000/__admin/
```

개발 모드: 터미널 2개 — `npm run dev`(서버, :3000) + `npm run dev:web`(Vite, :5173, API 프록시 포함).

## 사용 방법

1. 콘솔(`/__admin/`)에서 **프로젝트** 생성 (예: slug `shop-dev`)
2. **규칙** 탭 → 새 규칙: `GET /v2/orders/:id`, 상태 200, body `{"id":"{{params.id}}"}`
3. 앱의 베이스 URL을 `https://<서버>/m/shop-dev` 로 설정 → `GET /v2/orders/42` 호출 → `{"id":"42"}`
4. 등록 안 한 path를 호출하면 404 + **로그** 탭에 "미등록"으로 표시 → "이 요청으로 규칙 만들기"

| 기능 | 설명 |
|---|---|
| path 패턴 | `/users/me`, `/users/:id`, `/files/*` (정적 > 파라미터 > 와일드카드 우선) |
| 응답 선택 | 고정 / 순차(200→500→…) / 가중치 랜덤 / 조건별(query·header·body·path) |
| 지연·장애 | 지연 min~max ms, timeout, 연결 끊김, 응답 잘림, 깨진 JSON, 전역 에러 주입(%) |
| 템플릿 | `{{params.id}} {{query.x}} {{body.a.b}} {{headers.x}} {{now}} {{uuid}} {{random.int(1,9)}} {{faker.name}}` |
| 내장 유틸 | `/m/<slug>/_/status/503`, `/m/<slug>/_/delay/3000` |
| Import/Export | 규칙 JSON (version 1) |

## 환경 변수

| 이름 | 설명 |
|---|---|
| `PORT` | 기본 3000 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 설정 시 Supabase 사용. **service role key는 서버 환경변수로만 보관** |
| `DATA_FILE` | Supabase 미설정 시 로컬 JSON 경로 (기본 `data/db.json`, 로그는 저장 안 함) |
| `PUBLIC_BASE_URL` | 연결 가이드/QR에 표시할 외부 URL |
| `LOG_RETENTION_DAYS`, `LOG_MAX_PER_PROJECT` | 로그 정리 기준 (기본 7일 / 프로젝트당 5000건) |

## Supabase 설정

1. Supabase 프로젝트 생성
2. SQL Editor에서 `supabase/migrations/0001_init.sql`, 이어서 `0002_replace_rule_rpc.sql` 실행 (0002는 규칙 수정을 원자적으로 처리하는 `replace_rule` 함수. 미적용 시 서버가 경고 로그와 함께 비원자적 경로로 동작)
3. Project Settings → API 에서 URL과 `service_role` key를 `.env`에 입력

## 배포 (팀 공유 서버)

```bash
docker build -t dummy-api .
docker run -d -p 3000:3000 --env-file .env dummy-api
```

- 상시 구동 호스트 필요 (SSE, 장시간 지연/timeout 시뮬레이션). 리버스 프록시는 SSE 버퍼링 off, 타임아웃 ≥ 130s.
- **단일 인스턴스 권장**: 순차 응답 카운터와 SSE 구독이 인스턴스 로컬입니다. 규칙은 30초 주기로 DB와 재동기화됩니다.
- 현재 **로그인이 없습니다.** 사내망/VPN 등 호스트 레벨에서 접근을 제한하세요. 유저 기반 전환 지점은 `server/src/auth/currentUser.ts`.

## 보안 주의사항

이 서버는 **더미/테스트 환경 전용**입니다.

- **인증 없음:** 관리 콘솔과 관리 API(`/__admin`)는 URL을 아는 누구나 규칙을 수정·삭제할 수 있습니다. 사내망/VPN/리버스 프록시 인증 등 호스트 레벨에서 접근을 제한하세요.
- **요청 로그에 민감값 저장:** 요청 바디(최대 64KB)와 헤더가 그대로 로그(Supabase 포함)에 저장됩니다. **실제 토큰·비밀번호·개인정보를 이 서버로 보내지 마세요.**
- **timeout 장애 시뮬레이션:** `timeout` 응답은 최대 120초 동안 연결을 점유합니다. 외부에 노출된 서버에서는 반복 호출로 자원이 소모될 수 있으니 사내망에서만 운영하세요.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 환경변수로만 두고 저장소에 커밋하지 마세요 (`.env`는 `.gitignore`에 포함).

## 모바일 연결 팁

- iOS 시뮬레이터 `http://localhost:3000`, Android 에뮬레이터 `http://10.0.2.2:3000`, 실기기는 PC의 LAN IP (방화벽 포트 허용)
- HTTP 사용 시 iOS ATS / Android cleartext 예외 필요 — 콘솔의 **연결 가이드** 탭에 스니펫이 있습니다.

## 테스트

```bash
npm test     # Vitest: 매처/선택기/템플릿 단위 + Fastify 통합 테스트
```

## 구조

```
server/   Fastify + TypeScript (mock router, admin API, repo: Supabase | 파일)
web/      Vite + React 관리 콘솔
supabase/ migrations
docs/     PDCA 문서 (plan / design)
```
