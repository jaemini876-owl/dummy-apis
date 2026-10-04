import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

const digest = (s: string) => createHash('sha256').update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** 관리 콘솔(/__admin, /__admin/api)만 보호한다. /m/*, /healthz는 항상 열려 있다. */
export function registerAdminAuth(app: FastifyInstance, config: Config) {
  if (!config.ADMIN_PASSWORD) return;
  const { ADMIN_USER: user, ADMIN_PASSWORD: password } = config;

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path !== '/__admin' && !path.startsWith('/__admin/')) return;

    const m = /^Basic (.+)$/i.exec(req.headers.authorization ?? '');
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i >= 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), password)) return;
    }
    return reply
      .code(401)
      .header('WWW-Authenticate', 'Basic realm="Dummy API Console", charset="UTF-8"')
      .send({ error: 'unauthorized', message: '관리 콘솔 인증이 필요합니다.' });
  });
}
