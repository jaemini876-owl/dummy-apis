import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePresetsImport, parseRulesImport } from '../src/admin/importing.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ConflictError } from '../src/errors.js';
import { MemoryRepo } from '../src/repo/memory.js';
import type { RuleInput } from '../src/types.js';

const A = '/__admin/api';
let app: Awaited<ReturnType<typeof buildApp>>['app'];
const send = (method: 'POST' | 'PUT' | 'DELETE' | 'GET', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined });
const newProject = async (slug: string) => (await send('POST', `${A}/projects`, { slug, name: slug })).json().id as string;
const listRules = async (pid: string) => (await send('GET', `${A}/projects/${pid}/rules`)).json() as any[];
const listPresets = async () => (await send('GET', `${A}/presets`)).json() as any[];

beforeAll(async () => {
  ({ app } = await buildApp({ repo: new MemoryRepo(), config: { ...loadConfig(), ADMIN_PASSWORD: undefined }, webDir: '/nonexistent' }));
});
afterAll(() => app.close());

const ruleFile = (rules: unknown[], extra: object = {}) => ({ version: 1, rules, ...extra });
const okRule = (path: string, body = '{}') => ({ method: 'GET', path, responses: [{ status: 200, body }] });

describe('presets (전역)', () => {
  const body = { name: '401 토큰 만료', contentType: 'application/json', headers: { 'WWW-Authenticate': 'Bearer' }, body: '{"error":"token_expired"}' };

  it('CRUD + 이름은 대소문자·공백 무시하고 유일', async () => {
    const created = await send('POST', `${A}/presets`, { ...body, name: '  Token Expired  ' });
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p.name).toBe('Token Expired'); // trim
    expect(p.bodyBase64).toBeNull();

    expect((await send('POST', `${A}/presets`, { ...body, name: 'token expired' })).statusCode).toBe(409);
    expect((await send('POST', `${A}/presets`, { ...body, name: '   ' })).statusCode).toBe(400);
    expect((await send('POST', `${A}/presets`, { ...body, name: 'x'.repeat(81) })).statusCode).toBe(400);

    const upd = await send('PUT', `${A}/presets/${p.id}`, { ...body, name: 'Token Expired', body: '{"v":2}' });
    expect(upd.json().body).toBe('{"v":2}');
    expect((await send('PUT', `${A}/presets/nope`, body)).statusCode).toBe(404);

    expect((await listPresets()).map((x) => x.name)).toContain('Token Expired');
    expect((await send('GET', `${A}/presets?q=EXPIRED`)).json()).toHaveLength(1);
    expect((await send('GET', `${A}/presets?q=zzz`)).json()).toHaveLength(0);

    expect((await send('DELETE', `${A}/presets/${p.id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `${A}/presets/${p.id}`)).statusCode).toBe(404);
  });

  it('바이너리 프리셋은 body를 비우고, 2MB 초과는 거부', async () => {
    const ok = await send('POST', `${A}/presets`, { name: 'png', contentType: 'image/png', bodyBase64: 'iVBORw0KGgo=', body: 'ignored' });
    expect(ok.json()).toMatchObject({ body: null, bodyBase64: 'iVBORw0KGgo=' });
    const big = 'A'.repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3) + 8);
    expect((await send('POST', `${A}/presets`, { name: 'big', bodyBase64: big })).statusCode).toBe(400);
    await send('DELETE', `${A}/presets/${ok.json().id}`);
  });

  it('프리셋 export → import round-trip (merge/replace, 덮어쓰기)', async () => {
    for (const n of ['A', 'B']) await send('POST', `${A}/presets`, { name: n, headers: { 'x-n': n }, body: `{"n":"${n}"}` });
    const exp = (await send('GET', `${A}/presets/export`)).json();
    expect(exp).toMatchObject({ version: 1, kind: 'presets' });
    expect(exp.exportedAt).toBeTruthy();
    expect(exp.presets.map((p: any) => p.name)).toEqual(['A', 'B']);

    // merge: 같은 이름(대소문자 무시)은 덮어쓰기
    const edited = { ...exp, presets: [{ ...exp.presets[0], name: 'a', body: '{"n":"edited"}' }, { name: 'C', body: '{}' }] };
    const merged = await send('POST', `${A}/presets/import?mode=merge`, edited);
    expect(merged.json()).toEqual({ created: 1, updated: 1, deleted: 0 });
    const after = await listPresets();
    expect(after.map((p) => p.name).sort()).toEqual(['B', 'C', 'a']);
    expect(after.find((p) => p.name === 'a').body).toBe('{"n":"edited"}');

    // replace: 파일 내용으로 대체
    const rep = await send('POST', `${A}/presets/import?mode=replace`, exp);
    expect(rep.json()).toEqual({ created: 2, updated: 0, deleted: 3 });
    expect((await listPresets()).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('잘못된 파일은 422 + 항목·필드 위치 안내, 기존 프리셋은 불변', async () => {
    const before = await listPresets();
    const bad = {
      version: 1,
      presets: [
        { name: 'ok', body: '{}' },
        { name: '', body: '{}' }, // #2 이름 없음
        { name: 'Dup', body: '{}' },
        { name: 'dup', body: '{}' }, // #4 이름 중복
        { name: 'h', headers: { a: 1 } }, // #5 headers 타입 오류
      ],
    };
    for (const mode of ['merge', 'replace']) {
      const res = await send('POST', `${A}/presets/import?mode=${mode}`, bad);
      expect(res.statusCode).toBe(422);
      const issues = res.json().issues as any[];
      expect(issues.map((i) => i.index).sort()).toEqual([2, 4, 5]);
      expect(issues.find((i) => i.index === 4)).toMatchObject({ path: 'name', label: 'dup' });
      expect(await listPresets()).toEqual(before);
    }
  });

  it('dryRun은 데이터를 바꾸지 않고 요약을 돌려준다', async () => {
    const before = await listPresets();
    const res = await send('POST', `${A}/presets/import?mode=replace&dryRun=true`, { version: 1, presets: [{ name: 'only' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mode: 'replace', summary: { create: 1, update: 0, delete: before.length }, issues: [] });
    expect(await listPresets()).toEqual(before);
  });

  it('규칙 파일을 프리셋 import에 올리면 안내하고, 반대도 마찬가지', async () => {
    const rulesFile = (await send('GET', `${A}/projects/${await newProject('kind-a')}/export`)).json();
    const r1 = await send('POST', `${A}/presets/import?dryRun=true`, rulesFile);
    expect(r1.json().ok).toBe(false);
    expect(r1.json().issues[0].message).toContain('규칙 파일');

    const presetsFile = (await send('GET', `${A}/presets/export`)).json();
    const r2 = await send('POST', `${A}/projects/${await newProject('kind-b')}/import?dryRun=true`, presetsFile);
    expect(r2.json().ok).toBe(false);
    expect(r2.json().issues[0].message).toContain('프리셋 파일');
  });

  it('mode가 잘못되면 400', async () => {
    expect((await send('POST', `${A}/presets/import?mode=wipe`, { version: 1, presets: [] })).statusCode).toBe(400);
  });
});

describe('규칙 import: 검증·미리보기·원자성', () => {
  it('export → 새 프로젝트 import round-trip: 모든 필드 동일 + 메타 포함', async () => {
    const src = await newProject('rt-src');
    await send('POST', `${A}/projects/${src}/rules`, {
      name: '주문', method: 'GET', pathPattern: '/v2/orders/:id', selectMode: 'conditional', enabled: false,
      conditions: [{ source: 'header', key: 'x-a', op: 'exists' }],
      responses: [
        { status: 200, contentType: 'application/json', headers: { 'x-t': '{{params.id}}' }, body: '{"id":"{{params.id}}"}', delayMinMs: 5, delayMaxMs: 9, weight: 3,
          conditions: [{ source: 'query', key: 'vip', op: 'eq', value: '1' }] },
        { status: 500, body: null, bodyBase64: 'AAEC', contentType: 'application/octet-stream', fault: 'truncate' },
      ],
    });
    const exp = (await send('GET', `${A}/projects/${src}/export`)).json();
    expect(exp).toMatchObject({ version: 1, kind: 'rules', project: { slug: 'rt-src' } });

    const dst = await newProject('rt-dst');
    expect((await send('POST', `${A}/projects/${dst}/import`, exp)).json()).toEqual({ created: 1, updated: 0, deleted: 0 });
    const strip = (rs: any[]) => rs.map(({ id, projectId, createdAt, updatedAt, responses, ...r }) => ({ ...r, responses: responses.map(({ id: _i, ...x }: any) => x) }));
    expect(strip(await listRules(dst))).toEqual(strip(await listRules(src)));
  });

  it('메타가 없는 기존 v1 파일과 알 수 없는 필드도 가져온다', async () => {
    const pid = await newProject('v1-old');
    const file = ruleFile([{ ...okRule('/legacy'), futureField: 123 }], { somethingNew: true });
    expect((await send('POST', `${A}/projects/${pid}/import`, file)).json().created).toBe(1);
    expect((await app.inject({ url: '/m/v1-old/legacy' })).statusCode).toBe(200);
  });

  it('병합은 같은 method+path를 덮어쓰고, dryRun 요약과 실제 결과가 일치', async () => {
    const pid = await newProject('merge-1');
    await send('POST', `${A}/projects/${pid}/import`, ruleFile([okRule('/a', '"old"'), okRule('/b')]));
    const file = ruleFile([okRule('/a', '"new"'), okRule('/c')]);
    const dry = (await send('POST', `${A}/projects/${pid}/import?dryRun=true`, file)).json();
    expect(dry).toMatchObject({ ok: true, summary: { create: 1, update: 1, delete: 0 } });
    expect(await listRules(pid)).toHaveLength(2); // dryRun은 불변
    const real = (await send('POST', `${A}/projects/${pid}/import`, file)).json();
    expect(real).toEqual({ created: 1, updated: 1, deleted: 0 });
    expect((await app.inject({ url: '/m/merge-1/a' })).body).toBe('"new"');
    expect(await listRules(pid)).toHaveLength(3);
  });

  it('교체는 기존 규칙을 대체', async () => {
    const pid = await newProject('replace-1');
    await send('POST', `${A}/projects/${pid}/import`, ruleFile([okRule('/x'), okRule('/y')]));
    const res = await send('POST', `${A}/projects/${pid}/import?mode=replace`, ruleFile([okRule('/z')]));
    expect(res.json()).toEqual({ created: 1, updated: 0, deleted: 2 });
    expect((await listRules(pid)).map((r) => r.pathPattern)).toEqual(['/z']);
    expect((await app.inject({ url: '/m/replace-1/x' })).statusCode).toBe(404);
  });

  it('잘못된 파일은 422 + 규칙 번호·필드 경로, 병합·교체 모두 기존 규칙 불변', async () => {
    const pid = await newProject('invalid-1');
    await send('POST', `${A}/projects/${pid}/import`, ruleFile([okRule('/keep', '"keep"')]));
    const before = await listRules(pid);
    const bad = ruleFile([
      okRule('/fine'),
      { method: 'GET', path: 'no-slash' }, // #2 path 오류
      { method: 'GET', path: '/s', responses: [{ status: 99 }] }, // #3 status 오류
      okRule('/fine'), // #4 파일 내 중복
      { method: 'GET' }, // #5 path 없음
    ]);
    for (const mode of ['merge', 'replace']) {
      const res = await send('POST', `${A}/projects/${pid}/import?mode=${mode}`, bad);
      expect(res.statusCode).toBe(422);
      const issues = res.json().issues as any[];
      expect([...new Set(issues.map((i) => i.index))].sort()).toEqual([2, 3, 4, 5]);
      expect(issues.find((i) => i.index === 3)).toMatchObject({ path: 'responses.0.status', label: 'GET /s' });
      expect(issues.find((i) => i.index === 4).message).toContain('#1');
      expect(await listRules(pid)).toEqual(before);
    }
    expect((await app.inject({ url: '/m/invalid-1/keep' })).body).toBe('"keep"');
  });

  it('형식이 틀린 파일(version, rules)은 파일 수준 오류', async () => {
    const pid = await newProject('invalid-2');
    const v = (await send('POST', `${A}/projects/${pid}/import?dryRun=true`, { version: 2, rules: [] })).json();
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({ index: 0, path: 'version' });
    const r = (await send('POST', `${A}/projects/${pid}/import?dryRun=true`, { version: 1 })).json();
    expect(r.issues[0]).toMatchObject({ index: 0, path: 'rules' });
    expect((await send('POST', `${A}/projects/${pid}/import?mode=x`, ruleFile([]))).statusCode).toBe(400);
  });

  it('파일 검증 함수: 항목별 오류 수집', () => {
    const { inputs, issues } = parseRulesImport(ruleFile([okRule('/ok'), 'not-an-object', { path: '/p', method: 'GET', enabled: 'yes' }]));
    expect(inputs).toHaveLength(1);
    expect(issues.map((i) => i.index)).toEqual([2, 3]);
    expect(parsePresetsImport({ version: 1, presets: [] })).toEqual({ inputs: [], issues: [] });
  });
});

describe('MemoryRepo 원자성 / 파일 호환', () => {
  const rule = (path: string): RuleInput => ({
    name: null, method: 'GET', pathPattern: path, enabled: true, selectMode: 'fixed', conditions: [],
    responses: [{ position: 0, weight: 1, conditions: [], status: 200, headers: {}, contentType: 'application/json', body: '{}', bodyBase64: null, delayMinMs: 0, delayMaxMs: 0, fault: null }],
  });

  it('입력에 중복이 있으면 ConflictError이고 기존 데이터는 그대로 (replace 포함)', async () => {
    const repo = new MemoryRepo();
    const p = await repo.createProject({ slug: 'p', name: 'p', settings: {} as any });
    await repo.createRule(p.id, rule('/keep'));
    for (const mode of ['merge', 'replace'] as const) {
      await expect(repo.importRules(p.id, [rule('/dup'), rule('/dup')], mode)).rejects.toBeInstanceOf(ConflictError);
      expect((await repo.listRules(p.id)).map((r) => r.pathPattern)).toEqual(['/keep']);
    }
    await repo.createPreset({ name: 'keep', contentType: 'text/plain', headers: {}, body: 'x', bodyBase64: null });
    const dup = { name: 'N', contentType: 'text/plain', headers: {}, body: null, bodyBase64: null };
    await expect(repo.importPresets([dup, { ...dup, name: 'n' }], 'replace')).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.listPresets()).map((x) => x.name)).toEqual(['keep']);
  });

  it('프리셋은 파일에 저장되고, presets 키가 없는 기존 db.json도 읽는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dummy-api-'));
    const file = join(dir, 'db.json');
    try {
      writeFileSync(file, JSON.stringify({ projects: [], rules: [] })); // v4 이전 형식
      const repo = new MemoryRepo(file);
      expect(await repo.listPresets()).toEqual([]);
      await repo.createPreset({ name: 'saved', contentType: 'text/plain', headers: { a: 'b' }, body: 'hi', bodyBase64: null });
      await new Promise((r) => setTimeout(r, 400)); // persist debounce(200ms)
      expect(JSON.parse(readFileSync(file, 'utf8')).presets).toHaveLength(1);
      expect((await new MemoryRepo(file).listPresets())[0]).toMatchObject({ name: 'saved', headers: { a: 'b' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('인증(ADMIN_PASSWORD) 적용', () => {
  it('프리셋·import API도 인증 없이는 401', async () => {
    const { app: secured } = await buildApp({ repo: new MemoryRepo(), config: { ...loadConfig(), ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw' }, webDir: '/nonexistent' });
    try {
      for (const [method, url] of [['GET', '/presets'], ['POST', '/presets'], ['GET', '/presets/export'], ['POST', '/presets/import'], ['DELETE', '/presets/x']] as const)
        expect((await secured.inject({ method, url: `${A}${url}` })).statusCode, `${method} ${url}`).toBe(401);
    } finally {
      await secured.close();
    }
  });
});
