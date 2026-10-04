import { networkInterfaces } from 'node:os';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { getCurrentUser } from '../auth/currentUser.js';
import type { RuleCache } from '../cache/ruleCache.js';
import type { Config } from '../config.js';
import { ConflictError } from '../errors.js';
import type { RequestLogger } from '../logs/logger.js';
import type { Repo } from '../repo/repo.js';
import { DEFAULT_SETTINGS, type Project, type Rule, type RuleInput } from '../types.js';
import { importSchema, projectCreateSchema, projectPatchSchema, ruleInputSchema } from './schemas.js';

interface Deps {
  repo: Repo;
  cache: RuleCache;
  logger: RequestLogger;
  config: Config;
}

const exportRule = (r: Rule) => ({
  name: r.name,
  method: r.method,
  path: r.pathPattern,
  enabled: r.enabled,
  selectMode: r.selectMode,
  conditions: r.conditions,
  responses: r.responses.map((x) => ({
    status: x.status,
    contentType: x.contentType,
    headers: x.headers,
    body: x.body,
    bodyBase64: x.bodyBase64,
    delayMs: [x.delayMinMs, x.delayMaxMs],
    weight: x.weight,
    conditions: x.conditions,
    fault: x.fault,
  })),
});

export function registerAdminRoutes(app: FastifyInstance, { repo, cache, logger, config }: Deps) {
  app.register(
    async (api) => {
      api.addHook('preHandler', async (req) => {
        (req as any).user = await getCurrentUser(req);
      });

      api.setErrorHandler((err: any, _req, reply) => {
        if (err instanceof ZodError)
          return reply.code(400).send({ error: 'validation_error', message: '입력값이 올바르지 않습니다', details: err.issues });
        if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message });
        if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
        api.log.error(err);
        return reply.code(500).send({ error: 'internal_error', message: err.message });
      });

      const notFound = (reply: FastifyReply, what = 'resource') => reply.code(404).send({ error: 'not_found', message: `${what} not found` });
      const project = (pid: string) => repo.getProject(pid);
      const ruleOf = async (pid: string, rid: string) => {
        const r = await repo.getRule(rid);
        return r && r.projectId === pid ? r : null;
      };
      const refresh = (p: Project) => cache.invalidate(p.slug);

      // ---- projects
      api.get('/projects', async () => repo.listProjects());
      api.post('/projects', async (req, reply) => {
        const body = projectCreateSchema.parse(req.body);
        const p = await repo.createProject({ slug: body.slug, name: body.name, settings: body.settings ?? DEFAULT_SETTINGS });
        cache.invalidate(p.slug);
        return reply.code(201).send(p);
      });
      api.get<{ Params: { pid: string } }>('/projects/:pid', async (req, reply) => (await project(req.params.pid)) ?? notFound(reply, 'project'));
      api.patch<{ Params: { pid: string } }>('/projects/:pid', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        const patch = projectPatchSchema.parse(req.body);
        const updated = await repo.updateProject(p.id, patch);
        refresh(p);
        return updated;
      });
      api.delete<{ Params: { pid: string } }>('/projects/:pid', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        await repo.deleteProject(p.id);
        refresh(p);
        return reply.code(204).send();
      });

      // ---- rules
      api.get<{ Params: { pid: string }; Querystring: { q?: string; method?: string } }>('/projects/:pid/rules', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        const q = req.query.q?.toLowerCase();
        return (await repo.listRules(p.id)).filter(
          (r) =>
            (!req.query.method || r.method === req.query.method) &&
            (!q || r.pathPattern.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q)),
        );
      });
      api.post<{ Params: { pid: string } }>('/projects/:pid/rules', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        const rule = await repo.createRule(p.id, ruleInputSchema.parse(req.body));
        refresh(p);
        return reply.code(201).send(rule);
      });
      api.get<{ Params: { pid: string; rid: string } }>('/projects/:pid/rules/:rid', async (req, reply) =>
        (await ruleOf(req.params.pid, req.params.rid)) ?? notFound(reply, 'rule'),
      );
      api.put<{ Params: { pid: string; rid: string } }>('/projects/:pid/rules/:rid', async (req, reply) => {
        const [p, old] = [await project(req.params.pid), await ruleOf(req.params.pid, req.params.rid)];
        if (!p || !old) return notFound(reply, 'rule');
        const rule = await repo.replaceRule(old.id, ruleInputSchema.parse(req.body));
        refresh(p);
        return rule;
      });
      api.delete<{ Params: { pid: string; rid: string } }>('/projects/:pid/rules/:rid', async (req, reply) => {
        const [p, old] = [await project(req.params.pid), await ruleOf(req.params.pid, req.params.rid)];
        if (!p || !old) return notFound(reply, 'rule');
        await repo.deleteRule(old.id);
        cache.counters.delete(old.id);
        refresh(p);
        return reply.code(204).send();
      });
      api.post<{ Params: { pid: string; rid: string } }>('/projects/:pid/rules/:rid/duplicate', async (req, reply) => {
        const [p, old] = [await project(req.params.pid), await ruleOf(req.params.pid, req.params.rid)];
        if (!p || !old) return notFound(reply, 'rule');
        const existing = new Set((await repo.listRules(p.id)).map((r) => `${r.method} ${r.pathPattern}`));
        let path = `${old.pathPattern.replace(/\/$/, '')}/copy`;
        for (let i = 2; existing.has(`${old.method} ${path}`); i++) path = `${old.pathPattern.replace(/\/$/, '')}/copy${i}`;
        const { id, projectId, createdAt, updatedAt, ...rest } = old;
        const input: RuleInput = { ...rest, name: `${old.name ?? old.pathPattern} (copy)`, pathPattern: path, responses: old.responses.map(({ id: _i, ...r }) => r) };
        const rule = await repo.createRule(p.id, input);
        refresh(p);
        return reply.code(201).send(rule);
      });
      api.patch<{ Params: { pid: string; rid: string }; Body: { enabled: boolean } }>('/projects/:pid/rules/:rid/enabled', async (req, reply) => {
        const [p, old] = [await project(req.params.pid), await ruleOf(req.params.pid, req.params.rid)];
        if (!p || !old) return notFound(reply, 'rule');
        const rule = await repo.patchRuleEnabled(old.id, Boolean((req.body as any)?.enabled));
        refresh(p);
        return rule;
      });
      api.post<{ Params: { pid: string; rid: string } }>('/projects/:pid/rules/:rid/reset-counter', async (req, reply) => {
        if (!(await ruleOf(req.params.pid, req.params.rid))) return notFound(reply, 'rule');
        cache.counters.delete(req.params.rid);
        return reply.code(204).send();
      });

      // ---- import / export
      api.get<{ Params: { pid: string } }>('/projects/:pid/export', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        return { version: 1, rules: (await repo.listRules(p.id)).map(exportRule) };
      });
      api.post<{ Params: { pid: string }; Querystring: { mode?: string } }>('/projects/:pid/import', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        const data = importSchema.parse(req.body);
        const inputs: RuleInput[] = data.rules.map((r) =>
          ruleInputSchema.parse({
            name: r.name ?? null,
            method: r.method,
            pathPattern: r.path,
            enabled: r.enabled,
            selectMode: r.selectMode,
            conditions: r.conditions,
            responses: (r.responses ?? []).map((x) => ({
              status: x.status,
              contentType: x.contentType,
              headers: x.headers,
              body: x.body,
              bodyBase64: x.bodyBase64,
              delayMinMs: x.delayMs?.[0],
              delayMaxMs: x.delayMs?.[1],
              weight: x.weight,
              conditions: x.conditions,
              fault: x.fault,
            })),
          }),
        );
        const existing = await repo.listRules(p.id);
        if (req.query.mode === 'replace') for (const r of existing) await repo.deleteRule(r.id);
        let created = 0;
        let updated = 0;
        for (const input of inputs) {
          const same = req.query.mode === 'replace' ? undefined : existing.find((e) => e.method === input.method && e.pathPattern === input.pathPattern);
          if (same) {
            await repo.replaceRule(same.id, input);
            updated++;
          } else {
            await repo.createRule(p.id, input);
            created++;
          }
        }
        refresh(p);
        return { created, updated };
      });

      // ---- logs
      api.get<{ Params: { pid: string }; Querystring: { limit?: string; before?: string; matched?: string } }>('/projects/:pid/logs', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        await logger.flush();
        return repo.listLogs(p.id, {
          limit: Math.min(Number(req.query.limit) || 100, 500),
          before: req.query.before,
          matched: req.query.matched === undefined ? undefined : req.query.matched === 'true',
        });
      });
      api.get<{ Params: { pid: string } }>('/projects/:pid/logs/stream', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        raw.write(': connected\n\n');
        const onLog = (e: unknown) => raw.write(`data: ${JSON.stringify(e)}\n\n`);
        logger.bus.on(p.id, onLog);
        const hb = setInterval(() => raw.write(': hb\n\n'), 15_000);
        req.raw.on('close', () => {
          clearInterval(hb);
          logger.bus.off(p.id, onLog);
        });
      });
      api.delete<{ Params: { pid: string } }>('/projects/:pid/logs', async (req, reply) => {
        const p = await project(req.params.pid);
        if (!p) return notFound(reply, 'project');
        await logger.flush();
        await repo.clearLogs(p.id);
        return reply.code(204).send();
      });
      api.post<{ Params: { pid: string; lid: string } }>('/projects/:pid/logs/:lid/to-rule', async (req, reply) => {
        const p = await project(req.params.pid);
        await logger.flush();
        const log = await repo.getLog(req.params.lid);
        if (!p || !log || log.projectId !== p.id) return notFound(reply, 'log');
        const input = ruleInputSchema.parse({
          name: `${log.method} ${log.path}`,
          method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(log.method) ? log.method : 'ANY',
          pathPattern: log.path.startsWith('/') ? log.path : `/${log.path}`,
          responses: [{ status: 200, body: '{}' }],
        });
        const rule = await repo.createRule(p.id, input);
        refresh(p);
        return reply.code(201).send(rule);
      });

      // ---- server info (연결 가이드/QR)
      api.get('/server-info', async (req) => {
        const ips = Object.values(networkInterfaces())
          .flat()
          .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
          .map((i) => i.address);
        return {
          version: '0.1.0',
          port: config.PORT,
          publicBaseUrl: config.PUBLIC_BASE_URL ?? null,
          requestOrigin: `${req.protocol}://${req.headers.host}`,
          lanIps: ips,
          storage: config.SUPABASE_URL ? 'supabase' : 'file',
        };
      });
    },
    { prefix: '/__admin/api' },
  );
}
