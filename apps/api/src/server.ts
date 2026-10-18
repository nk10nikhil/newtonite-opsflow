import dotenv from 'dotenv';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './db/client.js';
import { authenticateRequest, registerAuth } from './auth/session.js';
import { registerTeamRoutes } from './modules/teams/routes.js';
import { registerWorkItemRoutes } from './modules/work-items/routes.js';
import { errorHandler } from './lib/errors.js';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });

export type AppConfig = {
  webOrigin: string;
  sessionSecret: string;
  sessionTtlHours: number;
};

export function buildApp(options: { db?: PrismaClient; config?: Partial<AppConfig> } = {}) {
  const db = options.db ?? prisma;
  const config: AppConfig = {
    webOrigin:
      options.config?.webOrigin ??
      process.env.WEB_ORIGIN ??
      (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173'),
    sessionSecret:
      options.config?.sessionSecret ??
      process.env.SESSION_SECRET ??
      (process.env.NODE_ENV === 'production' ? '' : 'development-session-secret-at-least-32-chars'),
    sessionTtlHours: options.config?.sessionTtlHours ?? Number(process.env.SESSION_TTL_HOURS ?? 12),
  };
  if (
    config.sessionSecret.length < 32 ||
    (process.env.NODE_ENV === 'production' &&
      [
        'replace-this-with-at-least-32-random-characters',
        'development-session-secret-at-least-32-chars',
      ].includes(config.sessionSecret))
  )
    throw new Error('SESSION_SECRET must be unique and contain at least 32 characters');
  if (!config.webOrigin) throw new Error('WEB_ORIGIN must be set in production');
  if (process.env.NODE_ENV === 'production' && new URL(config.webOrigin).protocol !== 'https:') {
    throw new Error('WEB_ORIGIN must use HTTPS in production');
  }
  if (!Number.isFinite(config.sessionTtlHours) || config.sessionTtlHours < 1)
    throw new Error('SESSION_TTL_HOURS must be a positive number');

  const app = Fastify({ logger: process.env.NODE_ENV === 'development' });
  app.decorateRequest('user', null);
  app.register(cookie);
  app.register(cors, { origin: config.webOrigin, credentials: true });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  );
  app.addHook('preHandler', async (request) => {
    const path = request.url.split('?')[0];
    if (!path?.startsWith('/api/')) return;
    if (path === '/api/auth/login' || path === '/api/auth/logout') return;
    await authenticateRequest(request, db, config.sessionSecret);
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });
  registerAuth(app, db, {
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours,
  });
  registerTeamRoutes(app, db);
  registerWorkItemRoutes(app, db);
  return app;
}

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== 'test') {
  const app = buildApp();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`OpsDesk API listening on http://localhost:${port}`);
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
