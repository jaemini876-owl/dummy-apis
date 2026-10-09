# Check: Dummy API & 설정 웹사이트

- 작성일: 2026-10-04
- 단계: PDCA – Check (설계 ↔ 구현 갭 분석)
- 기준: `docs/02-design/features/dummy-api.design.md`, Plan 6장 성공 기준

## 1. 검증 방법과 결과

| 방법 | 결과 |
|---|---|
| Vitest (단위 + Fastify 통합) | 19/19 통과 |
| `npm run build` (server tsc, web tsc+vite) | 성공 |
| 라이브 서버(파일 저장소) 엣지 케이스 17건 | 17/17 통과 — ANY 메서드, 와일드카드 `{{params.*}}`, base64 바이너리, 사용자 지정 Content-Length, 204 바디 제거, 2MB 응답, 끝 슬래시, 대소문자 구분, HEAD, 전역 에러 주입, 추가 지연, 잘못된 import/상태 코드/JSON 입력, 수정 즉시 반영, 프로젝트 삭제 후 404 |
| 이전 스모크 | fault(reset/truncate/invalid_json), CORS preflight, SSE, 관리 UI 정적 서빙 |
| **Supabase 실연결 (2026-10-05 재검증)** | ✅ 서버 `[storage] Supabase` 기동, 임시 프로젝트로 프로젝트 생성 → 규칙 생성(sequential) → 모의 호출(200→503) → 미매칭 404 → 규칙 PUT 교체 즉시 반영(201) → 활성 토글 → export → 로그 DB 기록(matched/미매칭) → 프로젝트 삭제 후 404. 임시 데이터는 모두 삭제함 (기존 `req-1950` 유지). 재재시작 후 영속성·RLS 정책 동작은 미확인 |
| 재실행 (2026-10-05) | Vitest 19/19, `npm run build` 성공 |
| **미검증** | 브라우저 UI 조작(렌더링·편집기·QR), 실기기/에뮬레이터 호출, `docker build`, 다중 인스턴스 |

## 2. Plan 성공 기준 점검

| 기준 | 상태 |
|---|---|
| 웹에서 등록한 `GET /v2/orders/:id`를 재시작 없이 호출 | ✅ 통합 테스트·라이브 확인 |
| 같은 path의 method별 응답, 임의 상태 코드 | ✅ |
| 순차 응답·지연·장애 주입 | ✅ |
| 경로 파라미터/쿼리/바디 템플릿 반영 | ✅ |
| 미등록 요청 로그 → 규칙 변환 | ✅ (API·UI 코드. UI 클릭 동작은 미검증) |
| 팀원 2명 이상 프로젝트 분리 사용 | ✅ 프로젝트별 규칙/로그/캐시 분리 (동시 사용자 부하 미검증) |
| 매칭 오버헤드 수 ms 이내 | △ 메모리 캐시 경로라 문제 없을 것으로 보이나 벤치마크 미실시 |
| `.env`만 넣고 기동 / `docker run` | ✅ 로컬·Supabase 기동, Docker 빌드/기동/헬스체크 (Docker + Supabase 조합은 미실시) |
| 실기기·에뮬레이터 호출 | △ Android 에뮬레이터(API 36, `10.0.2.2:3000`)에서 호출 확인 (2026-10-05): 200/404/503 응답 수신, 응답 바디·CORS 헤더 확인, 서버 로그에 에뮬레이터 요청 기록. 앱(OkHttp/Retrofit)·cleartext 설정·iOS·실기기는 미검증 |
| Auth 도입 시 마이그레이션 불필요한 스키마 | ✅ `project_id`/`owner_id`/`project_members` 준비, `getCurrentUser()` 단일 진입점 |

## 3. 설계 대비 갭

### 의도적 변경 (Do 문서 참조, 영향 낮음)
파일 저장소 폴백, 폴링만 사용(Realtime 미구현), 선형 스캔 매처, `request_logs.id` uuid + `res_body`, 상태 코드 200–599, textarea 에디터, hash 라우팅.

### 미구현 / 부분 구현
| # | 항목 (설계 위치) | 상태 | 영향 |
|---|---|---|---|
| G1 | 설정 탭의 로그 보관 정책 UI (6장) | 환경변수로만 설정 | 낮음 |
| G2 | 규칙 편집기의 path 실시간 매칭 테스트 입력창 (6장) | 없음 (Try it로 대체) | 낮음 |
| G3 | 미저장 변경 이탈 경고 (6장) | ✅ Act 구현 (2026-10-05): `RuleEditor`가 저장 시점 스냅샷과 비교해 변경 시 닫기(✕/닫기/Esc/바깥 클릭)에 confirm, 새로고침·탭 닫기에 `beforeunload` 경고. 빌드 + 브라우저 수동 확인 완료 (2026-10-05) | 낮음 |
| G4 | 응답 드래그 정렬 (6장) | ↑/↓ 버튼으로 대체 | 낮음 |
| G5 | 바이너리 응답 업로드 UI (11장 오픈 이슈) | ✅ Act 구현 (2026-10-05): 응답 카드에 파일 업로드(최대 2MB, 클라이언트·서버 양쪽 검증), 크기·이미지 미리보기, 제거 시 텍스트 바디로 전환. API 경유로 PNG 서빙(바이트 일치)·3MB 초과 400 확인. 브라우저 업로드 조작 수동 확인 완료 (2026-10-05). Try it은 바이너리를 텍스트로 표시 | 낮음 |
| G6 | JSON 바디 문법 경고 (5장) | 없음 | 낮음 |
| G7 | Playwright E2E, DB 포함 통합 테스트 (9장) | 부분 구현 (2026-10-05): `npm run test:e2e` — 프로젝트→규칙→Try it→로그 스모크, G3 닫기 경고, G5 바이너리 업로드·서빙 3건 통과 (파일 저장소 모드, 포트 3100). **DB(Supabase) 포함 통합 테스트는 없음** | 낮음 |
| G8 | 다중 인스턴스 시 Realtime 동기화, sequential 카운터 공유 | 폴링 30초, 카운터 로컬 | 단일 인스턴스 전제로 문서화됨 |
| G9 | `/m/<slug>` 선택적 API 키 | 미구현 (설계상 향후) | 낮음 |
| G10 | 규칙의 호출 URL 복사 (2026-10-05 추가 요청) | ✅ 구현 (2026-10-05): 규칙 목록 행과 편집기에 "URL 복사" 버튼 (`<베이스>/m/<slug><path>`, 베이스는 `PUBLIC_BASE_URL` > 현재 origin — 연결 가이드와 동일). path의 `:id`·`*`는 패턴 그대로 복사됨. Playwright E2E(목록·편집기 복사, 편집 중 path 반영) 통과 | 낮음 |

### Check 중 발견·수정한 결함
- **B1 (수정 완료)** `RuleEditor`: 응답 카드를 인덱스 key로 렌더링하여, 응답 ↑/↓ 이동·삭제 시 Headers 입력창의 내부 state가 다른 응답과 섞이고 이후 편집 시 엉뚱한 응답의 헤더를 덮어쓸 수 있었음 → 카드별 안정 key 도입 후 웹 재빌드.

### 알려진 위험 (미수정, 문서화 필요)
- **R1** 규칙 수정이 Supabase에서 비원자적 (rule update → responses delete → insert 사이 실패 시 응답이 비는 상태). → **Act 진행 (2026-10-05)**: `supabase/migrations/0002_replace_rule_rpc.sql`의 `replace_rule` RPC + `SupabaseRepo.replaceRule` 연동 완료. 마이그레이션 적용 전에는 경고 로그와 함께 기존 경로로 폴백. **마이그레이션 적용 후 검증 완료 (2026-10-05)**: RPC 성공/미존재(false)/제약 위반 시 전체 롤백(규칙·응답 모두 원복) 확인, 서버 경유 PUT 200·중복 409(기존 응답 유지)·폴백 경고 없음. anon 호출 차단은 SQL Editor의 `has_function_privilege`로 확인 (anon=false, authenticated=false, service_role=true, 2026-10-05). → **R1 해소**.
- **R2** 인증이 없어 URL을 아는 누구나 규칙 수정 가능 → **부분 해소 (2026-10-05)**: `ADMIN_PASSWORD` 설정 시 관리 콘솔·API에 Basic 인증 (`server/src/auth/adminAuth.ts`, 타이밍 안전 비교). Vitest 5건 + Playwright(인증 상태로 전체 UI 통과, 무인증 401·`/m/*`·`/healthz` 공개 확인). 한계: 단일 공유 계정, 시도 횟수 제한 없음, HTTPS 필수, `/m/*`는 무인증, 실제 브라우저의 로그인 창 동작은 미확인.
- **R3** `timeout` fault는 최대 120초 동안 소켓을 점유 — 악의적 반복 호출 시 자원 소모 (공유 서버에서는 사내망 한정으로 완화).
- **R4** 로그 요청 바디(64KB)/헤더에 토큰 등 민감값이 그대로 저장됨 — 더미 환경 전용으로 사용하고 실제 자격증명 사용 금지를 안내해야 함.

### 진행 메모 (2026-10-05)
- R2–R4 주의사항을 README "보안 주의사항"에 문서화함 (위험 자체는 유지).
- `docker build` 검증 완료 (Docker 29.8.1): 이미지 빌드(315MB), 컨테이너 기동, `/healthz`·`/__admin/` 200, 규칙 등록 후 모의 호출 정상. **결함 발견·수정(B2)**: HEALTHCHECK가 `localhost`(alpine에서 `::1`)로 접속해 연결 거부 → `127.0.0.1`로 변경, 재빌드 후 `healthy` 확인. 비root 전환 완료 (2026-10-05): `USER node` + `/app/data`만 쓰기 권한 부여, 컨테이너 기동·헬스체크·모의 호출·파일 저장소 쓰기 정상. 남은 참고: Supabase 연결로 컨테이너를 띄워 보는 확인은 미실시(`--env-file .env` 필요).

## 4. 종합
- 핵심 요구(개발자 정의 path로 등록 → 호출 시 200 또는 지정 상태 코드 응답, 팀 공유, Supabase, 유저 기반 확장 대비)는 **구현·검증됨**.
- 설계 항목 대비 구현률: 핵심 기능 100%, UI 편의 기능 약 80% (G1–G6).
- 출시 전 필수 확인: 브라우저 UI 수동 점검, 실기기 호출, Docker 빌드. (Supabase 실연결은 2026-10-05 검증 완료)

## 5. 권장 후속 (Act 단계 후보, 우선순위순)
1. `replaceRule`을 RPC 트랜잭션으로 교체 (R1) — Supabase 실연결 검증은 완료
2. 편집기 미저장 이탈 경고 (G3), 바이너리 응답 업로드 UI (G5)
3. Playwright 스모크 E2E (G7)
4. README에 R2–R4 주의사항 추가, 설정 탭에 로그 보관 정책 (G1)
5. 필요 시 Realtime 동기화 / API 키 (G8, G9)

---

# Check: v4 (2026-10-09)

- 단계: PDCA – Check (Plan v4 / Design 12장 ↔ 구현 `0ef53e9`)
- 기준: `docs/01-plan/features/dummy-api.plan.md` v4 성공 기준, `docs/02-design/features/dummy-api.design.md` 12장

## 1. 검증 방법과 결과

| 방법 | 결과 |
|---|---|
| 서버 `tsc --noEmit`, 서버·웹 `npm run build` | 성공 |
| Vitest | **41/41 통과** (v4 17건 포함: 프리셋 CRUD·유일성·한도, round-trip, 병합/교체, dryRun 불변, 422 + 항목·필드 경로, v1 호환, kind 불일치 안내, MemoryRepo 원자성, 구 `db.json` 호환, 인증 적용) |
| Playwright E2E | **9/9 통과** (기존 5 + v4 4: 프리셋 저장→타 프로젝트 적용→실제 호출, 겹친 모달 Esc, 프리셋 Export→삭제→Import, 잘못된 규칙 파일 오류 표시·불변·올바른 파일 가져오기) |
| **Supabase 실연결 (임시 프로젝트, 23/23 — 마이그레이션 적용 후)** | 스크립트로 앱을 Supabase 저장소에 연결해 실행. 1차(0003·0004 적용 전) 13/13 → 사용자가 0003·0004 적용 → 2차에서 결함 발견·수정(아래 B3) → `0004` 재적용 후 **23/23**. 임시 프로젝트·프리셋은 실행 후 모두 삭제(전체 프리셋 0개로 복원). 기존 데이터는 건드리지 않음. 2장 참조 |
| 같은 망 접속(로컬) | 임시 서버(파일 모드, 포트 3199)를 띄워 LAN IPv4 3개(`172.22.x`, `192.168.55.x`, `192.168.32.x`)로 `/healthz` 200, `/__admin/` 200, `/m/x/y` 404 확인 → `0.0.0.0` 바인딩 실증 |

## 2. Supabase 실연결 결과

| 단계 | 내용 | 결과 |
|---|---|---|
| 1차 (2026-10-09) | 0003·0004 **적용 전** | 13/13. 프리셋 API는 503 `migration_required`(의도한 오류 경로), 규칙 Import는 경고 로그와 함께 **보상 복구 폴백**으로 동작·복구 검증 |
| 사용자 작업 | SQL Editor에서 `0003`, `0004` 실행 | 성공 |
| 2차 | 0003·0004 적용 후 | 15/18 — 실패 3건 모두 "실패 유도" 항목. 원인 분석으로 **결함 B3** 발견 (아래) |
| 사용자 작업 | 수정한 `0004` 재실행 (`create or replace`) | 성공 |
| **3차 (최종)** | 보강한 스크립트로 재검증 | ✅ **23/23** |

최종 통과 항목 (모두 RPC 경로, 폴백 경고 없음)
- A·B: `presets` 테이블, `import_rules`/`import_presets` RPC 적용 확인
- C1–C2 규칙 export → 새 프로젝트 import round-trip (method/path/조건/다중 응답/지연/장애/바이너리 모두 동일), C4–C7 병합·교체와 건수
- **C8 쓰기 도중 실패 → 전체 롤백**: 첫 규칙은 정상, 두 번째 규칙이 CHECK 제약 위반 → 오류, 교체·병합 모두 기존 규칙 불변
- **C9 입력 중복 → `ConflictError`** + 불변 (MemoryRepo와 같은 계약)
- D1–D4 프리셋 생성, 대소문자만 다른 이름 409(유일 인덱스), 병합 import(덮어쓰기+신규), export 형식
- **D5·D5b·D6 프리셋 쓰기 도중 실패 / 입력 중복 / 교체 도중 실패 → 롤백**: 교체 모드에서 이미 실행된 전체 삭제까지 되돌아가 기존 프리셋 보존
- **D7 프리셋 교체 정상 경로(HTTP)**: 생성 1·삭제 2, 교체 후 프리셋은 파일 내용뿐 (B3 회귀 테스트)

### Check 중 발견·수정한 결함 (v4)
- **B3 (수정 완료, 재검증 통과)** `import_presets` 교체 모드가 Supabase에서 `DELETE requires a WHERE clause`(코드 21000)로 항상 실패. Supabase(PostgREST)가 WHERE 없는 DELETE를 막는 환경이라 `delete from presets;`가 거부됨. Vitest(MemoryRepo)로는 잡을 수 없고 실연결에서만 드러남. → `delete from presets where id is not null;`로 수정. 2차 실행에서 D6이 "통과"로 보인 것은 이 오류로 우연히 실패한 **오탐**이었음 (이후 스크립트를 "쓰기 도중 실패"를 의도적으로 유발하도록 보강해 오탐 제거).
- **B4 (수정 완료, 재검증 통과)** 입력에 같은 method+path(프리셋은 같은 이름)가 두 번 있으면 RPC는 오류 없이 뒤의 항목으로 덮어씀 — `Repo` 계약(`ConflictError`)·MemoryRepo와 불일치. → RPC가 쓰기 전에 중복을 검사해 `23505`(서버에서 409)로 거부. 서버는 평소 먼저 검증해 422로 막으므로 실사용 영향은 작았음.
- **검증 중 발생한 실DB 찌꺼기**: 2차 실행의 테스트가 접두사 없는 이름(`dupx`)의 프리셋 1개를 남김. 당시 프리셋 테이블은 비어 있었으므로 사용자 데이터가 아님을 확인하고 삭제함. 이후 스크립트는 모든 임시 데이터를 접두사로 식별해 정리하고 실행 끝에 잔여 개수를 출력함.

## 3. Plan v4 성공 기준 점검

| 기준 | 상태 |
|---|---|
| 규칙 Export → 새 프로젝트 Import 시 모든 필드 동일 (round-trip) | ✅ Vitest(파일 모드) + **Supabase RPC 경로 실연결** |
| 프리셋을 만들면 어느 프로젝트 편집기에서든 선택해 headers·body를 채움 (전역) | ✅ E2E(파일 모드) + Supabase 프리셋 테이블 실연결(생성·유일성·import) |
| 편집 중인 응답을 프리셋으로 저장, 프리셋 JSON Export → Import로 복원 | ✅ E2E·Vitest·Supabase 실연결(export 형식, 병합/교체 import) |
| 기존 version 1 파일 그대로 Import | ✅ Vitest |
| 잘못된 파일은 규칙·필드 위치를 알려주며 거부, 기존 규칙 불변 (병합·교체) | ✅ Vitest·E2E |
| 교체 Import 중 오류가 나도 기존 규칙 보존 (Supabase·로컬 JSON) | ✅ 로컬 JSON, ✅ Supabase **RPC 트랜잭션 롤백**(규칙·프리셋 모두)·보상 복구 폴백 양쪽 실연결 검증 |
| 같은 Wi-Fi 실기기에서 `http://<PC IP>:3000/m/<slug>/...` 호출 (방화벽 포함) | △ 서버가 LAN IP로 응답함은 확인. **다른 기기에서의 접속은 미검증.** 이 PC의 활성 네트워크는 "개인" 프로필이지만 방화벽이 켜져 있고 `node`/`dummy` 허용 인바운드 규칙이 확인되지 않았다 → README 3단계(방화벽 규칙 추가)가 필요할 가능성이 높다 |

## 4. 설계 대비 갭

| # | 항목 | 상태 | 영향 |
|---|---|---|---|
| G11 | Supabase 마이그레이션 0003·0004 | ✅ 해소: 적용 완료, 실연결 23/23 | — |
| G12 | 겹친 모달 Esc 자동 테스트 부재 | ✅ 해소: E2E 추가·통과 | — |
| G13 | 다른 기기에서의 접속 | **진행 중 (2026-10-09)**: 폰 접속 시도 → 실패. 원인 확인: 폰 IP `192.168.45.4`, PC `192.168.55.34`로 **서로 다른 망**이며 `tracert`상 PC→`192.168.55.1`→`192.168.75.1`→공인망으로 나가 사내에서 라우팅되지 않음(별개의 공유기). 서버 로직 문제 아님. PC 쪽도 당시 서버 미실행·방화벽 규칙 없음 상태였음. 해소 조건: 폰을 PC와 같은 공유기의 Wi-Fi(`192.168.55.x`)에 연결하고 서버 실행·방화벽 규칙 추가 후 `/healthz` 확인. README 4번에 점검 순서를 추가함 | 중간 |
| G14 | 폴백(보상) 경로는 실패 시 규칙 ID가 새로 발급됨 | RPC 경로(0004 적용됨)에서는 롤백이 id를 보존하므로 평상시에는 해당 없음. 0004 미적용 환경에서만 해당 | 낮음 |
| G15 | 프리셋 선택 UI가 설계(드롭다운)와 다른 모달 목록 | 의도적 변경 (Do 문서 기재) | 낮음 |
| G16 | 새 RPC의 `revoke/grant`(anon·authenticated 호출 차단) | ✅ 해소 (2026-10-09): 사용자가 SQL Editor에서 아래 쿼리를 실행해 기대값과 일치함을 확인 — `anon`·`authenticated`는 두 함수 모두 `false`, `service_role`은 `true` (사용자 보고 기준, 수치 화면 첨부는 없음) | — |

사용한 G16 확인 SQL (모두 `false`가 나와야 하고 `service_role`만 `true`):
```sql
select
  has_function_privilege('anon',          'import_rules(uuid,text,jsonb)', 'execute') as rules_anon,
  has_function_privilege('authenticated', 'import_rules(uuid,text,jsonb)', 'execute') as rules_auth,
  has_function_privilege('service_role',  'import_rules(uuid,text,jsonb)', 'execute') as rules_service,
  has_function_privilege('anon',          'import_presets(text,jsonb)',    'execute') as presets_anon,
  has_function_privilege('authenticated', 'import_presets(text,jsonb)',    'execute') as presets_auth,
  has_function_privilege('service_role',  'import_presets(text,jsonb)',    'execute') as presets_service;
```

## 5. 종합
- v4 요구는 **구현·검증됨**: Vitest 41, E2E 9, 빌드/타입체크, Supabase 실연결 23/23(RPC 롤백·프리셋 포함). 실연결 검증으로 단위 테스트가 못 잡는 결함(B3, B4)을 찾아 수정했다.
- 남은 확인: 방화벽 규칙을 추가하고 같은 Wi-Fi의 다른 기기에서 호출(G13). 새 RPC의 anon·authenticated 호출 차단(G16)은 확인 완료.

## 6. 권장 후속
1. 서버 PC 방화벽 규칙 추가 후 같은 Wi-Fi 실기기/에뮬레이터에서 `http://<PC IP>:3000/m/<slug>/...` 호출 (G13)
2. 위 확인 뒤 완료 처리 (Report 단계)
