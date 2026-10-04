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
