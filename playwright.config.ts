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
  // 관리 콘솔 Basic 인증을 켠 상태로 전체 UI(fetch·SSE 포함)를 검증한다
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', httpCredentials: { username: 'admin', password: 'e2e-pass' } },
  webServer: {
    command: `node ${resolve('server/dist/index.js')}`,
    cwd: runDir,
    env: {
      PORT: String(PORT),
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      DATA_FILE: resolve(runDir, 'db.json'),
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'e2e-pass',
    },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
