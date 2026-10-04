import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RuleCache } from '../cache/ruleCache.js';
import type { RequestLogger } from '../logs/logger.js';
import type { ProjectSettings, ResponseDef } from '../types.js';
import type { MatchContext } from './conditions.js';
import { selectResponse } from './selector.js';
import { render } from './template.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const BODY_LOG_MAX = 64 * 1024;
const RES_LOG_MAX = 8 * 1024;
const NO_BODY = new Set([204, 205, 304]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const trunc = (s: string | null, n: number) => (s && s.length > n ? s.slice(0, n) + '…[truncated]' : s);

function tryJson(raw: string, contentType: string): unknown {
  if (!raw) return null;
  if (!/json/i.test(contentType) && !/^\s*[{[]/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applyCors(req: FastifyRequest, reply: FastifyReply, settings: ProjectSettings) {
  if (!settings.cors) return;
  reply.header('access-control-allow-origin', (req.headers.origin as string) || '*');
  reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
  reply.header('access-control-allow-headers', (req.headers['access-control-request-headers'] as string) || '*');
  reply.header('access-control-expose-headers', '*');
  reply.header('vary', 'Origin');
}

/** 소켓 제어가 필요한 fault. 응답을 직접 쓴다. */
async function runFault(req: FastifyRequest, reply: FastifyReply, def: ResponseDef, status: number, payload: Buffer) {
  const raw = reply.raw;
  const base = reply.getHeaders() as Record<string, string>;
  reply.hijack();
  const sock = req.raw.socket;
  if (def.fault === 'reset') {
    sock.destroy();
    return;
  }
  if (def.fault === 'timeout') {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 120_000);
      sock.once('close', () => {
        clearTimeout(t);
        resolve();
      });
    });
    sock.destroy();
    return;
  }
  // truncate: 선언한 길이보다 적게 보내고 연결을 끊는다.
  const full = payload.length ? payload : Buffer.from('{"truncated":true}');
  raw.writeHead(status, { ...base, 'content-type': def.contentType, 'content-length': full.length });
  raw.write(full.subarray(0, Math.max(1, Math.ceil(full.length / 2))));
  setTimeout(() => sock.destroy(), 10);
}

export function registerMockRoutes(app: FastifyInstance, deps: { cache: RuleCache; logger: RequestLogger }) {
  const { cache, logger } = deps;

  app.register(async (m) => {
    // 모의 API는 어떤 Content-Type이든 원문 그대로 받는다.
    m.removeAllContentTypeParsers();
    m.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      const started = Date.now();
      const slug = (req.params as { slug: string }).slug;
      const entry = await cache.get(slug);
      if (!entry) return reply.code(404).send({ error: 'project_not_found', slug });

      const { project } = entry;
      const settings = project.settings;
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.slice(`/m/${slug}`.length) || '/';
      const method = req.method.toUpperCase();

      const query: Record<string, string> = {};
      for (const [k, v] of url.searchParams) if (!(k in query)) query[k] = v;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const ctx: MatchContext = { params: {}, query, headers, body: tryJson(rawBody, headers['content-type'] ?? ''), rawBody };

      applyCors(req, reply, settings);

      const log = (p: { ruleId?: string | null; responseId?: string | null; matched: boolean; status: number | null; resBody?: string | null }) =>
        logger.push({
          id: randomUUID(),
          projectId: project.id,
          ruleId: p.ruleId ?? null,
          responseId: p.responseId ?? null,
          matched: p.matched,
          method,
          path,
          query,
          reqHeaders: headers,
          reqBody: trunc(rawBody || null, BODY_LOG_MAX),
          status: p.status,
          resBody: trunc(p.resBody ?? null, RES_LOG_MAX),
          latencyMs: Date.now() - started,
          createdAt: new Date().toISOString(),
        });

      // 내장 유틸: /_/status/:code, /_/delay/:ms
      let bm = /^\/_\/status\/(\d{3})\/?$/.exec(path);
      if (bm) {
        const code = Number(bm[1]);
        if (code >= 200 && code <= 599) {
          const body = NO_BODY.has(code) ? '' : JSON.stringify({ status: code });
          log({ matched: true, status: code, resBody: body });
          return reply.code(code).type('application/json').send(body);
        }
      }
      bm = /^\/_\/delay\/(\d{1,6})\/?$/.exec(path);
      if (bm) {
        const ms = Math.min(Number(bm[1]), 60_000);
        await sleep(ms);
        const body = JSON.stringify({ delayed: ms });
        log({ matched: true, status: 200, resBody: body });
        return reply.type('application/json').send(body);
      }

      const found = cache.find(entry, method, path, ctx);
      if (!found) {
        if (method === 'OPTIONS' && settings.cors) {
          log({ matched: false, status: 204 });
          return reply.code(204).send();
        }
        const body = JSON.stringify({ error: 'no_rule', method, path, hint: '관리 콘솔에서 이 method/path 규칙을 등록하세요.' });
        log({ matched: false, status: settings.unmatchedStatus, resBody: body });
        return reply.code(settings.unmatchedStatus).type('application/json').send(body);
      }

      const { cr, params } = found;
      ctx.params = params;
      let def = selectResponse(cr.rule, ctx, cache.counters, settings.loop);
      if (!def) {
        const body = JSON.stringify({ error: 'no_response', rule: cr.rule.id });
        log({ ruleId: cr.rule.id, matched: true, status: 404, resBody: body });
        return reply.code(404).type('application/json').send(body);
      }

      // 전역 에러 주입
      if (settings.errorRate > 0 && Math.random() * 100 < settings.errorRate) {
        def = {
          ...def,
          status: settings.errorStatus,
          contentType: 'application/json',
          headers: {},
          body: '{"error":"injected_error"}',
          bodyBase64: null,
          fault: null,
        };
      }

      const delay = def.delayMinMs + Math.random() * Math.max(0, def.delayMaxMs - def.delayMinMs) + settings.extraDelayMs;
      if (delay > 0) await sleep(Math.round(delay));

      const status = def.status;
      let payload: Buffer;
      let resText: string | null = null;
      if (def.fault === 'invalid_json') {
        resText = '{"broken": [1, 2,';
        payload = Buffer.from(resText);
      } else if (def.bodyBase64) {
        payload = Buffer.from(def.bodyBase64, 'base64');
      } else {
        resText = def.body ? render(def.body, ctx) : '';
        payload = Buffer.from(resText);
      }

      for (const [k, v] of Object.entries(def.headers)) reply.header(k, render(v, ctx));
      const contentType = def.fault === 'invalid_json' ? 'application/json' : def.contentType;
      reply.header('x-dummy-rule', cr.rule.id);

      const hard = def.fault === 'timeout' || def.fault === 'reset' || def.fault === 'truncate';
      log({
        ruleId: cr.rule.id,
        responseId: def.id ?? null,
        matched: true,
        status: def.fault === 'timeout' || def.fault === 'reset' ? null : status,
        resBody: resText ?? `[binary ${payload.length} bytes]`,
      });

      if (hard) return runFault(req, reply, { ...def, contentType }, status, payload);
      if (NO_BODY.has(status) || method === 'HEAD') return reply.code(status).type(contentType).send();
      return reply.code(status).type(contentType).send(payload);
    };

    for (const url of ['/m/:slug', '/m/:slug/*'])
      m.route({ method: [...METHODS], url, handler });
  });
}
