import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { hashToken, newSessionToken, verifyPassword } from './crypto.js';
import { AppError } from '../lib/errors.js';
import { z } from 'zod';

export const SESSION_COOKIE = 'opsdesk_session';

export async function authenticateRequest(request: FastifyRequest, db: PrismaClient, secret: string): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token, secret) },
    select: { expiresAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  if (!session || session.expiresAt <= new Date()) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired');
  }
  request.user = session.user;
}

export function requireUser(request: FastifyRequest) {
  if (!request.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  return request.user;
}

export function registerAuth(app: FastifyInstance, db: PrismaClient, config: { sessionSecret: string; sessionTtlHours: number }) {
  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid login request', body.error.flatten());
    const user = await db.user.findUnique({ where: { email: body.data.email.toLowerCase() } });
    if (!user || !await verifyPassword(body.data.password, user.passwordHash)) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect');
    }
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
    await db.session.create({ data: { tokenHash: hashToken(token, config.sessionSecret), userId: user.id, expiresAt } });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
      signed: false,
    });
    return reply.send({ user: { id: user.id, name: user.name, email: user.email } });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token, config.sessionSecret) } });
    reply.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'strict', httpOnly: true });
    return reply.send({ ok: true });
  });

  app.get('/api/me', async (request) => {
    const caller = requireUser(request);
    const user = await db.user.findUniqueOrThrow({
      where: { id: caller.id },
      select: {
        id: true,
        name: true,
        email: true,
        memberships: { select: { role: true, team: { select: { id: true, name: true, slug: true } } } },
      },
    });
    return user;
  });
}

const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) });
