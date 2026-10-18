import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server.js';

const previous = {
  nodeEnv: process.env.NODE_ENV,
  sessionSecret: process.env.SESSION_SECRET,
  webOrigin: process.env.WEB_ORIGIN,
};

afterEach(() => {
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previous.sessionSecret;
  if (previous.webOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = previous.webOrigin;
});

describe('production configuration', () => {
  it('refuses to start with a default session secret', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SECRET;

    expect(() => buildApp()).toThrow(
      'SESSION_SECRET must be unique and contain at least 32 characters',
    );
  });

  it('requires a configured HTTPS web origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'unique-production-session-secret-with-more-than-32-chars';
    delete process.env.WEB_ORIGIN;

    expect(() => buildApp()).toThrow('WEB_ORIGIN must be set in production');
  });

  it('rejects the checked-in session secret placeholder in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'replace-this-with-at-least-32-random-characters';
    process.env.WEB_ORIGIN = 'https://opsdesk.example';

    expect(() => buildApp()).toThrow(
      'SESSION_SECRET must be unique and contain at least 32 characters',
    );
  });

  it('reports database readiness without returning internal errors', async () => {
    const db = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('private connection detail')),
    } as unknown as PrismaClient;
    const app = buildApp({
      db,
      config: { sessionSecret: 'integration-tests-session-secret-32-bytes-minimum' },
    });

    const live = await app.inject('/health');
    const response = await app.inject('/health/ready');
    await app.close();

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ ok: true });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false });
    expect(response.body).not.toContain('private connection detail');
  });
});
