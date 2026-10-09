# Dummy API

모바일 앱 개발/QA용 Dummy API 서버(Fastify) + 설정 웹 콘솔(React/Vite). npm workspaces 모노레포(`server`, `web`).

## 패키지 관리
- **항상 `npm` 사용** (`package-lock.json`). 워크스페이스 명령은 `npm -w server ...` / `npm -w web ...`

## 개발 순서
1. 변경 작성
2. 서버 타입체크: `npx -w server tsc --noEmit` (web은 `npm -w web run build`가 타입체크 포함)
3. 테스트: `npm test` (server, vitest)
4. 빌드: `npm run build` (web → server 순)
5. UI/관리 콘솔 변경 시 E2E: `npm run test:e2e` (**먼저 `npm run build` 필요** — `server/dist`를 실행함)

## 실행
- 개발: `npm run dev`(서버 :3000) + `npm run dev:web`(Vite :5173, API 프록시)
- 운영: `npm run build && npm start` → `http://localhost:3000/__admin/`

## 프로젝트 구조
- `server/src/mock/` — 요청 매칭·응답 선택·템플릿·조건 (앱이 호출하는 `/m/<slug>/*`)
- `server/src/admin/` — 관리 콘솔 API (`/__admin/api`), zod 스키마는 `schemas.ts`
- `server/src/repo/` — 저장소 추상화: `supabase.ts` / `memory.ts`(로컬 JSON 파일)
- `server/src/auth/` — Basic 인증(`adminAuth.ts`), 유저 전환 지점(`currentUser.ts`)
- `server/src/cache/`, `logs/` — 규칙 캐시(30초 재동기화), 요청 로그
- `web/src/` — 콘솔 UI (탭별 컴포넌트: Rules/Logs/Settings/Guide)
- `supabase/migrations/` — DB 마이그레이션 (순번 파일 추가, 기존 파일 수정 금지)
- `e2e/` — Playwright (포트 3100, `e2e/.run`에서 .env 없이 실행)
- `docs/01-plan ~ 04-check/` — PDCA 문서 (기능별 `features/`)

## 코딩 컨벤션
- TypeScript strict, ESM (`"type": "module"`, 서버는 NodeNext → 상대 import에 `.js` 확장자)
- 입력 검증은 zod 스키마로
- 주석·문서는 한국어 (기존 코드 스타일에 맞춤)

## 주의 사항
- ❌ `.env`, `SUPABASE_SERVICE_ROLE_KEY` 커밋/출력 금지 (서버 환경변수 전용)
- ❌ 테스트가 실제 Supabase에 붙지 않게 할 것 (로컬 `.env`와 분리 유지)
- `/m/*`와 `/healthz`는 항상 공개, 관리 콘솔만 `ADMIN_PASSWORD`로 보호
- 단일 인스턴스 전제 (순차 응답 카운터·SSE 구독이 인스턴스 로컬)
