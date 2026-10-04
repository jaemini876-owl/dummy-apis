import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 3100;
// 서버를 .env가 없는 별도 작업 디렉터리에서 실행해, 실수로 실제 Supabase에 붙지 않도록 한다.
const runDir = resolve('e2e/.run');
mkdirSync(runDir, { recursive: true });

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `node ${resolve('server/dist/index.js')}`,
    cwd: runDir,
    env: { PORT: String(PORT), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', DATA_FILE: resolve(runDir, 'db.json') },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
