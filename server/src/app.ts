import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerAdminRoutes } from './admin/routes.js';
import { RuleCache } from './cache/ruleCache.js';
import type { Config } from './config.js';
import { RequestLogger } from './logs/logger.js';
import { registerMockRoutes } from './mock/router.js';
import type { Repo } from './repo/repo.js';

export interface AppOptions {
  repo: Repo;
  config: Config;
  webDir?: string;
  logger?: boolean;
}

export async function buildApp({ repo, config, webDir, logger: log = false }: AppOptions) {
  const app = Fastify({ logger: log, bodyLimit: 10 * 1024 * 1024, exposeHeadRoutes: false });
  const cache = new RuleCache(repo);
  const logger = new RequestLogger(repo);

  app.get('/healthz', async () => ({ ok: true }));
  registerMockRoutes(app, { cache, logger });
  registerAdminRoutes(app, { repo, cache, logger, config });

  const dist = webDir ?? resolve(fileURLToPath(new URL('../../web/dist', import.meta.url)));
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/__admin/', decorateReply: false });
  }
  app.get('/', async (_req, reply) => reply.redirect('/__admin/'));
  app.get('/__admin', async (_req, reply) => reply.redirect('/__admin/'));

  app.addHook('onClose', async () => {
    cache.stop();
    await logger.stop();
  });

  return { app, cache, logger };
}
