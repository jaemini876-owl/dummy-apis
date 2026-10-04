import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryRepo } from '../src/repo/memory.js';

type App = Awaited<ReturnType<typeof buildApp>>['app'];
const basic = (u: string, p: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` });

describe('admin auth (ADMIN_PASSWORD 설정)', () => {
  let app: App;
  beforeAll(async () => {
    ({ app } = await buildApp({
      repo: new MemoryRepo(),
      config: { ...loadConfig(), ADMIN_USER: 'admin', ADMIN_PASSWORD: 's3cret' },
      webDir: '/nonexistent',
    }));
  });
  afterAll(() => app.close());

  it('관리 API/콘솔은 인증 없이 401 + WWW-Authenticate', async () => {
    for (const url of ['/__admin/api/projects', '/__admin', '/__admin/', '/__admin/api/server-info?x=1']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/^Basic /);
    }
    expect((await app.inject({ method: 'POST', url: '/__admin/api/projects', payload: { slug: 'x1', name: 'x' } })).statusCode).toBe(401);
  });

  it('틀린 사용자/비밀번호는 401', async () => {
    for (const h of [basic('admin', 'wrong'), basic('root', 's3cret'), basic('admin', ''), { authorization: 'Basic !!!' }, { authorization: 'Bearer s3cret' }]) {
      expect((await app.inject({ method: 'GET', url: '/__admin/api/projects', headers: h })).statusCode).toBe(401);
    }
  });

  it('올바른 인증이면 통과', async () => {
    const ok = await app.inject({ method: 'GET', url: '/__admin/api/projects', headers: basic('admin', 's3cret') });
    expect(ok.statusCode).toBe(200);
  });

  it('/m/*, /healthz는 인증 없이 열려 있음', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const created = await app.inject({ method: 'POST', url: '/__admin/api/projects', headers: basic('admin', 's3cret'), payload: { slug: 'pub', name: 'pub' } });
    expect(created.statusCode).toBe(201);
    // 규칙이 없어도 인증 오류(401)가 아니라 모의 서버 응답(404 no_rule)이어야 한다
    const res = await app.inject({ method: 'GET', url: '/m/pub/anything' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no_rule');
  });
});

describe('admin auth (ADMIN_PASSWORD 미설정)', () => {
  it('인증 없이 접근 가능 (기존 동작 유지)', async () => {
    const { app } = await buildApp({ repo: new MemoryRepo(), config: { ...loadConfig(), ADMIN_PASSWORD: undefined }, webDir: '/nonexistent' });
    expect((await app.inject({ method: 'GET', url: '/__admin/api/projects' })).statusCode).toBe(200);
    await app.close();
  });
});
