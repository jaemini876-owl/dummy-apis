import { describe, expect, it } from 'vitest';
import { evalCondition, type MatchContext } from '../src/mock/conditions.js';
import { compareScores, compilePath, matchPath, validatePattern } from '../src/mock/matcher.js';
import { selectResponse } from '../src/mock/selector.js';
import { render } from '../src/mock/template.js';
import type { ResponseDef, Rule } from '../src/types.js';

const ctx = (o: Partial<MatchContext> = {}): MatchContext => ({ params: {}, query: {}, headers: {}, body: null, rawBody: '', ...o });

describe('matcher', () => {
  it('matches static, param and wildcard paths', () => {
    expect(matchPath(compilePath('/users/me'), '/users/me/')).toEqual({});
    expect(matchPath(compilePath('/users/:id'), '/users/a%20b')).toEqual({ id: 'a b' });
    expect(matchPath(compilePath('/users/:id'), '/users')).toBeNull();
    expect(matchPath(compilePath('/files/*'), '/files/a/b.png')).toEqual({ '*': 'a/b.png' });
    expect(matchPath(compilePath('/files/*'), '/files')).toBeNull();
    expect(matchPath(compilePath('/a/b'), '/a/b/c')).toBeNull();
  });
  it('prefers more specific patterns', () => {
    const s = [compilePath('/users/:id').score, compilePath('/users/me').score, compilePath('/users/*').score];
    expect([...s].sort(compareScores)).toEqual([s[1], s[0], s[2]]);
  });
  it('validates patterns', () => {
    expect(validatePattern('/ok/:id/*')).toBeNull();
    expect(validatePattern('no-slash')).not.toBeNull();
    expect(validatePattern('/a/*/b')).not.toBeNull();
    expect(validatePattern('/a/:1x')).not.toBeNull();
  });
});

describe('conditions', () => {
  it('evaluates sources and ops', () => {
    const c = ctx({ query: { type: 'vip' }, headers: { 'x-env': 'dev' }, body: { user: { email: 'a@b.c' } } });
    expect(evalCondition({ source: 'query', key: 'type', op: 'eq', value: 'vip' }, c)).toBe(true);
    expect(evalCondition({ source: 'header', key: 'X-Env', op: 'neq', value: 'prod' }, c)).toBe(true);
    expect(evalCondition({ source: 'body', key: 'user.email', op: 'regex', value: '@b\\.c$' }, c)).toBe(true);
    expect(evalCondition({ source: 'query', key: 'nope', op: 'exists' }, c)).toBe(false);
  });
});

const resp = (o: Partial<ResponseDef>): ResponseDef => ({
  position: 0, weight: 1, conditions: [], status: 200, headers: {}, contentType: 'application/json',
  body: null, bodyBase64: null, delayMinMs: 0, delayMaxMs: 0, fault: null, ...o,
});
const rule = (selectMode: Rule['selectMode'], responses: ResponseDef[]): Rule => ({
  id: 'r1', projectId: 'p', name: null, method: 'GET', pathPattern: '/x', enabled: true, selectMode,
  conditions: [], responses, createdAt: '', updatedAt: '',
});

describe('selector', () => {
  it('sequential sticks to last unless loop', () => {
    const r = rule('sequential', [resp({ status: 200 }), resp({ status: 500 })]);
    const counters = new Map<string, number>();
    expect([1, 2, 3].map(() => selectResponse(r, ctx(), counters, false)!.status)).toEqual([200, 500, 500]);
    const c2 = new Map<string, number>();
    expect([1, 2, 3].map(() => selectResponse(r, ctx(), c2, true)!.status)).toEqual([200, 500, 200]);
  });
  it('weighted respects weights', () => {
    const r = rule('weighted', [resp({ status: 200, weight: 1 }), resp({ status: 500, weight: 3 })]);
    expect(selectResponse(r, ctx(), new Map(), false, () => 0.1)!.status).toBe(200);
    expect(selectResponse(r, ctx(), new Map(), false, () => 0.9)!.status).toBe(500);
  });
  it('conditional falls back to unconditioned response', () => {
    const r = rule('conditional', [
      resp({ status: 201, conditions: [{ source: 'query', key: 'type', op: 'eq', value: 'vip' }] }),
      resp({ status: 200 }),
    ]);
    expect(selectResponse(r, ctx({ query: { type: 'vip' } }), new Map(), false)!.status).toBe(201);
    expect(selectResponse(r, ctx(), new Map(), false)!.status).toBe(200);
  });
});

describe('template', () => {
  it('substitutes variables', () => {
    const c = ctx({ params: { id: '7' }, query: { page: '2' }, body: { a: { b: 'x' } }, headers: { 'x-k': 'v' } });
    expect(render('{{params.id}}-{{query.page}}-{{body.a.b}}-{{headers.X-K}}-{{nope.x}}', c)).toBe('7-2-x-v-');
    expect(render('{{uuid}}', c)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(render('{{random.int(5,5)}}', c))).toBe(5);
    expect(render('{{faker.email}}', c)).toContain('@');
  });
});
