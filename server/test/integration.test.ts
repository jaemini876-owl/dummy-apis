import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryRepo } from '../src/repo/memory.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let pid: string;
const A = '/__admin/api';

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

beforeAll(async () => {
  // 로컬 .env의 값(ADMIN_PASSWORD 등)에 테스트가 영향을 받지 않도록 인증은 끈다
  ({ app } = await buildApp({ repo: new MemoryRepo(), config: { ...loadConfig(), ADMIN_PASSWORD: undefined }, webDir: '/nonexistent' }));
  const res = await post(`${A}/projects`, { slug: 'demo', name: 'Demo' });
  expect(res.statusCode).toBe(201);
  pid = res.json().id;
});
afterAll(() => app.close());

describe('project admin', () => {
  it('rejects reserved/invalid slugs and duplicates', async () => {
    expect((await post(`${A}/projects`, { slug: 'm', name: 'x' })).statusCode).toBe(400);
    expect((await post(`${A}/projects`, { slug: 'Bad Slug', name: 'x' })).statusCode).toBe(400);
    expect((await post(`${A}/projects`, { slug: 'demo', name: 'x' })).statusCode).toBe(409);
  });
});

describe('mock API', () => {
  it('serves a rule registered at runtime with templating (no restart)', async () => {
    const miss = await app.inject({ url: '/m/demo/v2/orders/42' });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error).toBe('no_rule');

    const created = await post(`${A}/projects/${pid}/rules`, {
      method: 'GET',
      pathPattern: '/v2/orders/:id',
      responses: [{ status: 200, body: '{"id":"{{params.id}}","page":"{{query.page}}"}', headers: { 'x-trace': '{{params.id}}' } }],
    });
    expect(created.statusCode).toBe(201);

    const ok = await app.inject({ url: '/m/demo/v2/orders/42?page=3' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: '42', page: '3' });
    expect(ok.headers['x-trace']).toBe('42');
    expect(ok.headers['access-control-allow-origin']).toBe('*');
  });

  it('distinguishes methods and returns arbitrary status codes', async () => {
    await post(`${A}/projects/${pid}/rules`, { method: 'POST', pathPattern: '/v2/orders/:id', responses: [{ status: 401, body: '{"error":"unauthorized"}' }] });
    const r = await app.inject({ method: 'POST', url: '/m/demo/v2/orders/1', payload: { a: 1 } });
    expect(r.statusCode).toBe(401);
  });

  it('prefers static over param routes', async () => {
    await post(`${A}/projects/${pid}/rules`, { method: 'GET', pathPattern: '/users/me', responses: [{ body: '"me"' }] });
    await post(`${A}/projects/${pid}/rules`, { method: 'GET', pathPattern: '/users/:id', responses: [{ body: '"other"' }] });
    expect((await app.inject({ url: '/m/demo/users/me' })).body).toBe('"me"');
    expect((await app.inject({ url: '/m/demo/users/9' })).body).toBe('"other"');
  });

  it('plays sequential responses', async () => {
    await post(`${A}/projects/${pid}/rules`, {
      method: 'GET', pathPattern: '/flaky', selectMode: 'sequential',
      responses: [{ status: 200, body: '{}' }, { status: 500, body: '{}' }],
    });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ url: '/m/demo/flaky' })).statusCode);
    expect(codes).toEqual([200, 500, 500]);
  });

  it('applies delay and conditional selection by body', async () => {
    await post(`${A}/projects/${pid}/rules`, {
      method: 'POST', pathPattern: '/login', selectMode: 'conditional',
      responses: [
        { status: 200, body: '{"token":"t"}', conditions: [{ source: 'body', key: 'email', op: 'eq', value: 'ok@x.com' }], delayMinMs: 60, delayMaxMs: 60 },
        { status: 401, body: '{}' },
      ],
    });
    const t0 = Date.now();
    const ok = await app.inject({ method: 'POST', url: '/m/demo/login', payload: { email: 'ok@x.com' } });
    expect(ok.statusCode).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    expect((await app.inject({ method: 'POST', url: '/m/demo/login', payload: { email: 'no' } })).statusCode).toBe(401);
  });

  it('serves builtin status/delay and unknown project', async () => {
    expect((await app.inject({ url: '/m/demo/_/status/503' })).statusCode).toBe(503);
    expect((await app.inject({ url: '/m/demo/_/status/204' })).statusCode).toBe(204);
    expect((await app.inject({ url: '/m/nope/x' })).json().error).toBe('project_not_found');
  });

  it('disabling a rule takes effect immediately', async () => {
    const rules = (await app.inject({ url: `${A}/projects/${pid}/rules?q=flaky` })).json();
    await app.inject({ method: 'PATCH', url: `${A}/projects/${pid}/rules/${rules[0].id}/enabled`, payload: { enabled: false } });
    expect((await app.inject({ url: '/m/demo/flaky' })).statusCode).toBe(404);
  });

  it('rejects duplicate method+path and invalid patterns', async () => {
    expect((await post(`${A}/projects/${pid}/rules`, { method: 'GET', pathPattern: '/users/me' })).statusCode).toBe(409);
    expect((await post(`${A}/projects/${pid}/rules`, { method: 'GET', pathPattern: 'bad' })).statusCode).toBe(400);
  });
});

describe('logs, export/import', () => {
  it('records matched and unmatched requests and creates a rule from a log', async () => {
    await app.inject({ url: '/m/demo/not/registered?x=1' });
    const logs = (await app.inject({ url: `${A}/projects/${pid}/logs?matched=false` })).json();
    const l = logs.find((x: any) => x.path === '/not/registered');
    expect(l).toBeTruthy();
    expect(l.query).toEqual({ x: '1' });
    const made = await post(`${A}/projects/${pid}/logs/${l.id}/to-rule`, {});
    expect(made.statusCode).toBe(201);
    expect((await app.inject({ url: '/m/demo/not/registered' })).statusCode).toBe(200);
  });

  it('round-trips export → import(replace)', async () => {
    const exp = (await app.inject({ url: `${A}/projects/${pid}/export` })).json();
    expect(exp.version).toBe(1);
    const p2 = (await post(`${A}/projects`, { slug: 'copy', name: 'Copy' })).json();
    const imp = await post(`${A}/projects/${p2.id}/import?mode=replace`, exp);
    expect(imp.json().created).toBe(exp.rules.length);
    expect((await app.inject({ url: '/m/copy/users/me' })).body).toBe('"me"');
  });
});
