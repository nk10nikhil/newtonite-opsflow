import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './db/client.js';
import { authenticateRequest, registerAuth } from './auth/session.js';
import { registerTeamRoutes } from './modules/teams/routes.js';
import { registerWorkItemRoutes } from './modules/work-items/routes.js';
import { errorHandler } from './lib/errors.js';

export type AppConfig = {
  webOrigin: string;
  sessionSecret: string;
  sessionTtlHours: number;
};

export function buildApp(options: { db?: PrismaClient; config?: Partial<AppConfig> } = {}) {
  const db = options.db ?? prisma;
  const config: AppConfig = {
    webOrigin: options.config?.webOrigin ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    sessionSecret: options.config?.sessionSecret ?? process.env.SESSION_SECRET ?? 'development-session-secret-at-least-32-chars',
    sessionTtlHours: options.config?.sessionTtlHours ?? Number(process.env.SESSION_TTL_HOURS ?? 12),
  };
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  if (!Number.isFinite(config.sessionTtlHours) || config.sessionTtlHours < 1) throw new Error('SESSION_TTL_HOURS must be a positive number');

  const app = Fastify({ logger: process.env.NODE_ENV === 'development' });
  app.decorateRequest('user', null);
  app.register(cookie);
  app.register(cors, { origin: config.webOrigin, credentials: true });
  app.setErrorHandler(errorHandler);
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.url === '/api/auth/login' || request.url === '/api/auth/logout') return;
    await authenticateRequest(request, db, config.sessionSecret);
  });
  app.get('/health', async () => ({ ok: true }));
  registerAuth(app, db, { sessionSecret: config.sessionSecret, sessionTtlHours: config.sessionTtlHours });
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
