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
| 응답 프리셋 | Content-Type · Headers · Body를 이름 붙여 저장(전역, 모든 프로젝트 공유). 규칙 편집기의 **프리셋 불러오기 / 프리셋으로 저장** |
| Import/Export | 규칙(프로젝트별)과 프리셋(전역)을 각각 JSON 파일로 내보내고 가져오기 |

### 응답 프리셋

자주 쓰는 응답 내용(예: "401 토큰 만료", "빈 목록")을 저장해 두고 다른 규칙·프로젝트에서 재사용합니다.

- 규칙 편집기의 응답에서 **프리셋으로 저장** → 이름 입력. 같은 이름(대소문자 무시)이 있으면 덮어쓸지 묻습니다.
- 다른 규칙에서 **프리셋 불러오기** → 목록에서 **적용**. 현재 내용은 덮어씌워집니다.
- 적용하면 값이 응답으로 **복사**됩니다. 이후 프리셋을 고치거나 지워도 이미 만든 규칙은 바뀌지 않습니다.
- Status · 지연 · 장애 설정은 프리셋에 포함되지 않습니다 (내용만 저장).
- 관리는 콘솔 상단의 **응답 프리셋** 화면(`#/presets`)에서 합니다.

### Import / Export (JSON)

- **규칙**: 프로젝트의 **규칙** 탭 → Export / Import. **프리셋**: **응답 프리셋** 화면 → Export / Import. 두 파일은 `kind`(`rules` / `presets`)로 구분되며 서로 바꿔 올리면 안내가 나옵니다.
- Import는 먼저 **검증 미리보기**를 보여줍니다 (신규 · 덮어쓰기 · 삭제 건수). 문제가 있으면 항목 번호와 필드 위치가 표시되고, **아무것도 변경되지 않습니다.**
  - **병합**: 같은 method+path(프리셋은 이름)는 파일 내용으로 덮어쓰고 나머지는 유지
  - **교체**: 기존 항목을 모두 삭제하고 파일 내용으로 대체
- 형식은 `version: 1`이며 이전에 받은 파일도 그대로 가져올 수 있습니다. 알 수 없는 필드는 무시합니다.
- **Export 파일에는 Headers/Body가 그대로 들어갑니다.** 토큰 같은 민감한 값이 있다면 공유·커밋 전에 확인하세요. 요청 로그는 Export 대상이 아닙니다.
- **백업 용도로도 쓰세요.** Supabase 무료 플랜에는 자동 백업이 없으니 중요한 규칙·프리셋은 가끔 Export해 두는 것을 권장합니다.

## 환경 변수

| 이름 | 설명 |
|---|---|
| `PORT` | 기본 3000 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 설정 시 Supabase 사용. **service role key는 서버 환경변수로만 보관** |
| `DATA_FILE` | Supabase 미설정 시 로컬 JSON 경로 (기본 `data/db.json`, 로그는 저장 안 함) |
| `PUBLIC_BASE_URL` | 연결 가이드/QR에 표시할 외부 URL |
| `ADMIN_PASSWORD`, `ADMIN_USER` | 설정하면 관리 콘솔(`/__admin`, `/__admin/api`)에 HTTP Basic 인증 적용 (사용자 기본 `admin`). `/m/*`(앱 호출)와 `/healthz`는 항상 공개. **외부 공개 시 필수**, HTTPS와 함께 사용 |
| `LOG_RETENTION_DAYS`, `LOG_MAX_PER_PROJECT` | 로그 정리 기준 (기본 7일 / 프로젝트당 5000건) |

## Supabase 설정

1. Supabase 프로젝트 생성
2. SQL Editor에서 `supabase/migrations/`의 파일을 **번호 순서대로** 실행
   - `0001_init.sql`: 기본 테이블
   - `0002_replace_rule_rpc.sql`: 규칙 수정을 원자적으로 처리하는 `replace_rule` 함수 (미적용 시 서버가 경고 로그와 함께 비원자적 경로로 동작)
   - `0003_presets.sql`: 응답 프리셋 테이블 (**미적용이면 프리셋 기능이 `migration_required` 오류를 냅니다**)
   - `0004_import_rules_rpc.sql`: Import를 단일 트랜잭션으로 처리하는 `import_rules` / `import_presets` 함수 (미적용 시 경고 로그와 함께 중간 실패 시 복구를 시도하는 방식으로 동작하며, 완전한 원자성은 보장되지 않으므로 적용을 권장)
3. Project Settings → API 에서 URL과 `service_role` key를 `.env`에 입력

> **Supabase 무료 플랜 참고** (조건은 바뀔 수 있으니 가입 전 가격 페이지를 확인하세요): 일정 기간(약 1주일) 접속이 없으면 프로젝트가 자동 일시정지될 수 있습니다. 장기 휴무 뒤 서버가 DB에 연결하지 못하면 Supabase 대시보드에서 프로젝트를 **Restore**한 뒤 서버를 재시작하세요. 자동 백업이 없으므로 규칙·프리셋을 가끔 Export해 두세요.

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

- **관리 콘솔 인증은 `ADMIN_PASSWORD`를 설정해야 켜집니다.** 미설정이면 URL을 아는 누구나 규칙을 수정·삭제할 수 있으니 사내망/VPN 등으로 제한하세요. Basic 인증은 비밀번호가 평문(Base64)으로 오가므로 **반드시 HTTPS**로 노출하고 추측하기 어려운 비밀번호를 쓰세요. 단일 공유 계정이며 시도 횟수 제한은 없습니다.
- **`/m/*`는 인증이 없습니다.** slug를 아는 누구나 모의 API를 호출할 수 있고 그 호출이 로그에 남습니다 (프로젝트별 API 키는 미구현).
- **요청 로그에 민감값 저장:** 요청 바디(최대 64KB)와 헤더가 그대로 로그(Supabase 포함)에 저장됩니다. **실제 토큰·비밀번호·개인정보를 이 서버로 보내지 마세요.**
- **timeout 장애 시뮬레이션:** `timeout` 응답은 최대 120초 동안 연결을 점유합니다. 외부에 노출된 서버에서는 반복 호출로 자원이 소모될 수 있으니 사내망에서만 운영하세요.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 환경변수로만 두고 저장소에 커밋하지 마세요 (`.env`는 `.gitignore`에 포함).

## 모바일 연결 팁

- iOS 시뮬레이터 `http://localhost:3000`, Android 에뮬레이터 `http://10.0.2.2:3000`, 실기기는 PC의 LAN IP (방화벽 포트 허용)
- HTTP 사용 시 iOS ATS / Android cleartext 예외 필요 — 콘솔의 **연결 가이드** 탭에 스니펫이 있습니다.

## 같은 사무실 망/Wi-Fi의 다른 기기에서 접속하기

서버는 모든 네트워크 인터페이스(`0.0.0.0`)에서 대기하므로, 서버 PC의 내부 IP로 바로 접속할 수 있습니다. 비용·추가 도구가 필요 없습니다.

1. 서버 PC에서 IP 확인: `ipconfig` → 사용 중인 어댑터의 IPv4 주소 (예: `192.168.0.10`). 콘솔의 **연결 가이드** 탭에도 후보가 표시됩니다. WSL·Hyper-V·VPN·가상머신 어댑터의 주소(보통 `172.x`, `192.168.x`)가 함께 나올 수 있으니, 팀원과 **같은 대역**인 실제 이더넷/Wi-Fi 어댑터의 주소를 고르세요.
2. 앱의 베이스 URL을 `http://<PC IP>:3000/m/<slug>`로 설정, 팀원은 브라우저로 `http://<PC IP>:3000/__admin/` 접속
3. Windows 방화벽에서 포트 허용 (관리자 권한 PowerShell, 포트를 바꿨다면 `LocalPort`도 변경):
   ```powershell
   New-NetFirewallRule -DisplayName "dummy-api" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
4. 접속이 안 되면: 네트워크 프로필이 "공용"이면 차단될 수 있어 "개인"으로 바꿔 보세요. 게스트 Wi-Fi나 AP 격리가 켜진 망에서는 기기 간 통신이 막힙니다. 실기기는 서버 PC와 **같은 망**이어야 합니다.
5. 팀원이 쓰는 서버라면 `.env`에 `ADMIN_PASSWORD`를 설정하고, PC의 IP가 바뀌지 않도록 공유기에서 고정 IP(DHCP 예약)를 권장합니다.

<details>
<summary>다른 장소(재택·외부)에서 접속해야 할 때 (선택)</summary>

터널 도구로 내 PC를 인터넷 주소에 연결할 수 있습니다. 무료 조건은 바뀔 수 있으니 사용 전 각 서비스의 현재 약관을 확인하세요.

- **Tailscale Funnel**: 도메인 없이 고정 `*.ts.net` HTTPS 주소를 받습니다. 팀원은 Tailscale 설치 없이 URL로 접속합니다.
- **Cloudflare Tunnel**: 빠른 모드는 무작위 주소, 이름 지정 모드는 본인 도메인이 필요합니다. Cloudflare 프록시는 긴 응답 대기(130초+ timeout 시뮬레이션)를 끊을 수 있습니다.
- 인터넷에 노출되므로 **`ADMIN_PASSWORD` 필수**, `/m/*`는 항상 공개이니 민감한 응답은 넣지 마세요. 쓰지 않을 때는 터널을 닫으세요.

</details>

## 테스트

```bash
npm test     # Vitest: 매처/선택기/템플릿 단위 + Fastify 통합 테스트
npm run build && npm run test:e2e   # Playwright 스모크 (최초 1회 `npx playwright install chromium`)
```

E2E는 `.env`가 없는 별도 디렉터리에서 서버를 파일 저장소 모드(포트 3100)로 띄우므로 Supabase 데이터에 영향을 주지 않습니다.

## 구조

```
server/   Fastify + TypeScript (mock router, admin API, repo: Supabase | 파일)
web/      Vite + React 관리 콘솔
supabase/ migrations
docs/     PDCA 문서 (plan / design)
```
