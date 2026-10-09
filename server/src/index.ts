import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MigrationRequiredError } from './errors.js';
import { MemoryRepo } from './repo/memory.js';
import type { Repo } from './repo/repo.js';
import { SupabaseRepo } from './repo/supabase.js';

const config = loadConfig();

let repo: Repo;
if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
  repo = new SupabaseRepo(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  console.log('[storage] Supabase');
} else {
  repo = new MemoryRepo(config.DATA_FILE);
  console.warn(`[storage] SUPABASE_URL 미설정 → 로컬 파일(${config.DATA_FILE})로 동작합니다. 팀 공유 서버에서는 Supabase를 설정하세요.`);
}

const { app, cache } = await buildApp({ repo, config, logger: true });
cache.startPolling();

setInterval(() => {
  repo.pruneLogs(config.LOG_RETENTION_DAYS, config.LOG_MAX_PER_PROJECT).catch((e) => console.error('[prune]', e.message));
}, 10 * 60_000).unref();

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
console.log(`Dummy API ready → http://localhost:${config.PORT}/__admin/`);

// Supabase 사용 시 시작 점검(서버 기동은 막지 않음): 마이그레이션 적용 여부와 연결 상태를 안내한다
if (repo instanceof SupabaseRepo) {
  repo.listPresets().catch((e: Error) => {
    if (e instanceof MigrationRequiredError) console.warn(`[storage] ${e.message}`);
    else
      console.warn(
        `[storage] Supabase 연결 확인 실패: ${e.message}\n  가능한 원인: URL/키 오류, 네트워크 문제, 또는 무료 플랜 프로젝트의 자동 일시정지(장기간 접속이 없을 때). 대시보드에서 프로젝트를 Restore한 뒤 서버를 재시작하세요.`,
      );
  });
}
