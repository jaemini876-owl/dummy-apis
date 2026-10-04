import { buildApp } from './app.js';
import { loadConfig } from './config.js';
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
