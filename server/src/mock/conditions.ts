import type { Condition } from '../types.js';

export interface MatchContext {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** JSON 파싱된 바디 (아니면 null) */
  body: unknown;
  rawBody: string;
}

export function getByPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

function actual(c: Condition, ctx: MatchContext): string | undefined {
  let v: unknown;
  switch (c.source) {
    case 'query':
      v = ctx.query[c.key];
      break;
    case 'header':
      v = ctx.headers[c.key.toLowerCase()];
      break;
    case 'path':
      v = ctx.params[c.key];
      break;
    case 'body':
      v = getByPath(ctx.body, c.key);
      break;
  }
  if (v === undefined || v === null) return undefined;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function evalCondition(c: Condition, ctx: MatchContext): boolean {
  const a = actual(c, ctx);
  const expected = c.value ?? '';
  switch (c.op) {
    case 'exists':
      return a !== undefined;
    case 'eq':
      return a === expected;
    case 'neq':
      return a !== expected;
    case 'contains':
      return a !== undefined && a.includes(expected);
    case 'regex':
      try {
        return a !== undefined && new RegExp(expected).test(a);
      } catch {
        return false;
      }
  }
}

export const evalConditions = (cs: Condition[], ctx: MatchContext) => cs.every((c) => evalCondition(c, ctx));
