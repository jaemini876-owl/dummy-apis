import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { getByPath, type MatchContext } from './conditions.js';

const FAKERS: Record<string, () => string> = {
  name: () => faker.person.fullName(),
  email: () => faker.internet.email(),
  phone: () => faker.phone.number(),
  city: () => faker.location.city(),
  word: () => faker.lorem.word(),
  sentence: () => faker.lorem.sentence(),
  avatar: () => faker.image.avatar(),
  url: () => faker.internet.url(),
  uuid: () => faker.string.uuid(),
};

function resolve(expr: string, ctx: MatchContext): string {
  const e = expr.trim();
  if (e === 'now') return new Date().toISOString();
  if (e === 'timestamp') return String(Date.now());
  if (e === 'uuid') return randomUUID();
  let m = /^random\.int\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(e);
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
  }
  if (e.startsWith('faker.')) return FAKERS[e.slice(6)]?.() ?? '';
  const dot = e.indexOf('.');
  if (dot < 0) return '';
  const root = e.slice(0, dot);
  const rest = e.slice(dot + 1);
  let v: unknown;
  if (root === 'params') v = ctx.params[rest];
  else if (root === 'query') v = ctx.query[rest];
  else if (root === 'headers') v = ctx.headers[rest.toLowerCase()];
  else if (root === 'body') v = getByPath(ctx.body, rest);
  if (v === undefined || v === null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** {{expr}} 치환. 미정의 변수는 빈 문자열. */
export function render(template: string, ctx: MatchContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => resolve(expr, ctx));
}
