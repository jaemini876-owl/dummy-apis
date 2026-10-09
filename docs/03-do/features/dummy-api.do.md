# Do: Dummy API & 설정 웹사이트

- 작성일: 2026-10-04
- 단계: PDCA – Do (구현 완료, Check 대기)

## 구현 결과
설계(`docs/02-design/features/dummy-api.design.md`)의 MVP 범위를 구현. 실행/배포 방법은 `README.md`.

## 설계 대비 변경점
| 항목 | 설계 | 구현 | 이유 |
|---|---|---|---|
| 저장소 | Supabase | Supabase **+ 로컬 파일 폴백** (`SUPABASE_URL` 미설정 시) | Supabase 키 없이도 즉시 실행/테스트 |
| 캐시 동기화 | Realtime + 폴링 | **30초 폴링만** | 단일 인스턴스 권장, Realtime은 후속 |
| 규칙 매칭 | 세그먼트 trie | 우선순위 정렬된 선형 스캔 | 프로젝트당 규칙 수백 개 수준에서 충분, 단순함 |
| `request_logs.id` | bigint identity | **uuid (앱 생성)** + `res_body` 컬럼 추가 | SSE와 DB 로그의 id 일치, 응답 상세 표시 |
| 상태 코드 범위 | 100–599 | API 검증은 **200–599** | Node가 1xx 최종 응답을 보낼 수 없음 |
| 바디 에디터 | Monaco | `<textarea>` | 번들/의존성 최소화, 후속 개선 후보 |
| 라우팅 | React Router | hash 라우팅 직접 구현 | 의존성 최소화, 정적 서빙 시 SPA fallback 불필요 |
| 규칙 갱신 | 트랜잭션 | rule update → responses 교체 (비원자적) | 필요 시 Supabase RPC로 교체 (코드에 NOTE) |

## 검증 상태
- Vitest 19개 통과 (매처/조건/선택기/템플릿 단위 + 런타임 등록·메서드 구분·우선순위·순차·조건별·지연·내장 status·비활성화·중복/검증 오류·로그→규칙·export/import 통합)
- 서버·웹 `npm run build` 성공
- 수동 스모크(파일 저장소): 관리 UI 서빙, 규칙 등록 후 즉시 호출, CORS preflight, fault(reset/truncate/invalid_json), SSE 수신 확인
- **미검증**: 실제 Supabase 연결(`SupabaseRepo`), 브라우저 UI 조작(수동/Playwright), 실기기 호출, `docker build`

## 다음 단계
`pdca check dummy-api` — 위 미검증 항목 확인 및 설계 대비 갭 분석.

---

# Do: v4 (2026-10-09)

- 단계: PDCA – Do (v4 구현 완료, Check 대기)
- 참조: Plan v4 (`docs/01-plan/features/dummy-api.plan.md`), Design 12장

## 구현 범위
| 항목 | 내용 | 주요 파일 |
|---|---|---|
| 전역 응답 프리셋 | content-type + headers + body(또는 bodyBase64) 저장. CRUD API, 규칙 편집기 "프리셋 불러오기 / 프리셋으로 저장", 관리 화면 `#/presets`, 프리셋 JSON Import/Export | `server/src/admin/routes.ts`, `schemas.ts`, `web/src/PresetsPage.tsx`, `PresetModals.tsx` |
| Import 검증·미리보기 | 파일 전체를 먼저 검증해 항목 번호·필드 경로 단위로 오류 수집, 파일 내 중복 검출, `dryRun=true` 미리보기, 오류 시 422 + 데이터 불변 | `server/src/admin/importing.ts`, `web/src/ImportModal.tsx` |
| Import 원자성 | `Repo.importRules` / `importPresets`. MemoryRepo는 사본 적용 후 한 번에 교체, Supabase는 RPC(`0004`) 트랜잭션 + 미적용 시 보상 방식 폴백 | `server/src/repo/*.ts`, `supabase/migrations/0003_*.sql`, `0004_*.sql` |
| 포맷 | version 1 유지, 규칙 export에 `kind`/`exportedAt`/`project` 메타 추가, 알 수 없는 필드 무시, `kind` 불일치 시 안내 | `schemas.ts`, `importing.ts` |
| 시작 점검 | Supabase 사용 시 마이그레이션 미적용·연결 실패(무료 플랜 일시정지 가능성) 안내 로그 | `server/src/index.ts` |
| 문서 | README: 프리셋, Import/Export, 마이그레이션 0003·0004, 무료 플랜 주의, 같은 망 접속(방화벽), 터널 부록 | `README.md` |

## 설계 대비 변경점
| 항목 | 설계 | 구현 | 이유 |
|---|---|---|---|
| 프리셋 선택 UI | 드롭다운(이름 검색) | **모달 목록 + 이름 검색** | 목록을 열 때만 조회(응답 카드마다 미리 조회하지 않음), 내용 미리보기 표시 |
| 내용 입력부 | `ResponseContentFields` 추출 | `ContentFields`로 추출, **Content-Type 입력도 포함**(격자에서 이동) | 프리셋 편집과 공유 |
| 모달 Esc | (미언급) | `Modal`에 스택 도입, **가장 위의 모달만** Esc로 닫힘 | 편집기 위에 프리셋 모달이 겹칠 때 편집기까지 같이 닫히는 문제 방지 |
| import 응답 | `{created, updated}` | `{created, updated, deleted}` | 교체 모드 삭제 건수 표시 |
| 파일 수준 오류 | 규칙/필드 단위 | 항목 번호 `0`을 파일 전체 수준 오류로 사용 | version/kind/배열 형식 오류 표현 |
| 구 `importSchema` | 단일 스키마 | `importEnvelopeSchema` + `importRuleItemSchema`로 분리 | 항목별 오류 수집 |

## 검증 상태
- 서버 타입체크, 서버·웹 `npm run build` 성공
- **Vitest 41개 통과** (기존 24 + v4 17): 프리셋 CRUD·이름 유일성·trim/길이·바이너리 2MB 한도, 프리셋/규칙 export→import round-trip(필드 동일), 병합/교체 건수, dryRun 불변, 잘못된 파일 422(항목·필드 경로)와 병합·교체 모두 데이터 불변, 파일 내 중복, 구 v1 파일·알 수 없는 필드, kind 불일치 안내, mode 오류 400, MemoryRepo 원자성(중복 입력 시 기존 데이터 보존), `presets` 키가 없는 기존 `db.json` 로드·영속화, `ADMIN_PASSWORD` 적용 시 프리셋/import API 401
- **Playwright E2E 8개 통과** (기존 5 + v4 3): 편집기에서 프리셋 저장 → 다른 프로젝트에서 불러와 적용 → 실제 호출 응답(헤더·바디) 확인 / 프리셋 Export→삭제→Import 복원 / 잘못된 규칙 파일 오류 표시·불변, 프리셋 파일 안내, 올바른 파일 가져오기
- 구현 중 테스트로 발견·수정: 프리셋 파일을 규칙 Import에 올리면 안내 대신 일반 오류가 나오던 문제

## 미검증 (Check 단계에서 확인 필요)
- **Supabase 경로 전체**: `0003_presets.sql`, `0004_import_rules_rpc.sql`의 SQL 실행, `SupabaseRepo`의 프리셋·`importRules`·`importPresets`, RPC 롤백 동작. 로컬에 Postgres가 없고 Docker 데몬이 꺼져 있어 실행하지 못했다 (MemoryRepo와 같은 `Repo` 인터페이스·동일 서버 로직으로 검증한 것이며 SQL 자체는 미실행).
  - 확인 체크리스트: ① 0001~0004를 순서대로 적용 ② 프리셋 생성·같은 이름(대소문자 다름) 409 ③ 규칙 Import 교체 중 일부러 충돌(예: 파일 내 중복은 서버가 먼저 막으므로 DB 제약 위반을 유도)시켜 롤백되는지 ④ 0004 미적용 상태에서 경고 로그와 폴백 동작 ⑤ 0003 미적용 상태에서 `migration_required` 응답과 시작 로그
- 중첩 모달 Esc 동작의 브라우저 수동 확인 (자동 테스트 없음)
- 같은 Wi-Fi 실기기에서 `http://<PC IP>:3000` 호출, 방화벽 규칙 명령 실행
- `docker build`

## 다음 단계
`pdca check dummy-api` — 위 미검증 항목 확인, Plan v4 성공 기준 대조, 갭 분석.
