import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Prisma, PrismaClient, type WorkItemStatus } from '@prisma/client';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/crypto.js';
import { buildApp } from '../src/server.js';
import { processNextOutboxEvent, type OutboxHandler } from '../src/outbox/worker.js';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });
const testDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const enabled = Boolean(testDatabaseUrl);
const testDb = new PrismaClient({
  datasources: {
    db: {
      url:
        testDatabaseUrl ?? 'postgresql://opsdesk:opsdesk@localhost:5432/opsdesk_test?schema=public',
    },
  },
});
const runId = randomUUID().slice(0, 8);
const secret = 'integration-tests-session-secret-32-bytes-minimum';
const password = 'test-password-opsdesk';

const pgDescribe = describe.skipIf(!enabled);

pgDescribe('work item API and PostgreSQL transactions', () => {
  let app: ReturnType<typeof buildApp>;
  let teamA: string;
  let teamB: string;
  let adminId: string;
  let memberAId: string;
  let memberBId: string;
  let viewerId: string;
  let outsiderId: string;
  let admin: ReturnType<typeof supertest.agent>;
  let memberA: ReturnType<typeof supertest.agent>;
  let memberB: ReturnType<typeof supertest.agent>;
  let viewer: ReturnType<typeof supertest.agent>;
  let outsider: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    const migration = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        'prisma/schema.prisma',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        encoding: 'utf8',
      },
    );
    if (migration.status !== 0)
      throw new Error(`Prisma migration failed: ${migration.stderr || migration.stdout}`);
    await testDb.$connect();

    const [team1, team2] = await Promise.all([
      testDb.team.create({ data: { name: `Integration ${runId}`, slug: `integration-${runId}` } }),
      testDb.team.create({ data: { name: `Other ${runId}`, slug: `other-${runId}` } }),
    ]);
    teamA = team1.id;
    teamB = team2.id;
    const passwordHash = await hashPassword(password);
    const people = await Promise.all([
      testDb.user.create({
        data: { name: 'Test Admin', email: `admin-${runId}@test.local`, passwordHash },
      }),
      testDb.user.create({
        data: { name: 'Test Member One', email: `member-one-${runId}@test.local`, passwordHash },
      }),
      testDb.user.create({
        data: { name: 'Test Member Two', email: `member-two-${runId}@test.local`, passwordHash },
      }),
      testDb.user.create({
        data: { name: 'Test Viewer', email: `viewer-${runId}@test.local`, passwordHash },
      }),
      testDb.user.create({
        data: { name: 'Test Outsider', email: `outsider-${runId}@test.local`, passwordHash },
      }),
    ]);
    [adminId, memberAId, memberBId, viewerId, outsiderId] = people.map((user) => user.id);
    await testDb.teamMembership.createMany({
      data: [
        { userId: adminId, teamId: teamA, role: 'admin' },
        { userId: memberAId, teamId: teamA, role: 'member' },
        { userId: memberBId, teamId: teamA, role: 'member' },
        { userId: viewerId, teamId: teamA, role: 'viewer' },
        { userId: outsiderId, teamId: teamB, role: 'member' },
      ],
    });

    app = buildApp({
      db: testDb,
      config: { sessionSecret: secret, webOrigin: 'http://localhost:5173' },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const httpServer = app.server;
    const makeAgent = () => supertest.agent(httpServer);
    admin = makeAgent();
    memberA = makeAgent();
    memberB = makeAgent();
    viewer = makeAgent();
    outsider = makeAgent();
    const logins = await Promise.all([
      admin.post('/api/auth/login').send({ email: `admin-${runId}@test.local`, password }),
      memberA.post('/api/auth/login').send({ email: `member-one-${runId}@test.local`, password }),
      memberB.post('/api/auth/login').send({ email: `member-two-${runId}@test.local`, password }),
      viewer.post('/api/auth/login').send({ email: `viewer-${runId}@test.local`, password }),
      outsider.post('/api/auth/login').send({ email: `outsider-${runId}@test.local`, password }),
    ]);
    expect(logins.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    await testDb.$disconnect();
  });

  async function createItem(
    options: {
      teamId?: string;
      status?: WorkItemStatus;
      assigneeId?: string | null;
      title?: string;
      createdAt?: Date;
      updatedAt?: Date;
      version?: number;
    } = {},
  ) {
    return testDb.workItem.create({
      data: {
        teamId: options.teamId ?? teamA,
        title: options.title ?? `Integration item ${randomUUID()}`,
        description: 'Test fixture for integration behaviour',
        type: 'task',
        status: options.status ?? 'open',
        priority: 'normal',
        assigneeId: options.assigneeId ?? null,
        createdBy: adminId,
        ...(options.version ? { version: options.version } : {}),
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
      },
    });
  }

  it('allows exactly one of two simultaneous claims', async () => {
    const item = await createItem();
    const claim = (agent: ReturnType<typeof supertest.agent>, suffix: string) =>
      agent
        .post(`/api/work-items/${item.id}/claim`)
        .set('Idempotency-Key', `claim-${suffix}-${randomUUID()}`)
        .send({ expectedVersion: item.version });
    const responses = await Promise.all([claim(memberA, 'a'), claim(memberB, 'b')]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const current = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(current.assigneeId).toBeTruthy();
    expect(current.status).toBe('in_progress');
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe(
      'CONFLICT_CLAIM',
    );
  });

  it('rejects a stale patch with the latest item and leaves the row unchanged', async () => {
    const item = await createItem({
      title: `Original ${randomUUID()}`,
      status: 'in_progress',
      assigneeId: memberAId,
      version: 2,
    });
    const response = await memberA.patch(`/api/work-items/${item.id}`).send({
      expectedVersion: item.version - 1,
      title: 'Should not be saved',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT_VERSION');
    expect(response.body.error.details.current.version).toBe(item.version);
    const current = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(current.title).toBe(item.title);
    expect(current.version).toBe(item.version);
  });

  it('replays idempotent create, comment, and claim responses without duplicates', async () => {
    const title = `Idempotent ${randomUUID()}`;
    const createBody = {
      teamId: teamA,
      title,
      description: 'Replay fixture',
      type: 'task',
      priority: 'normal',
    };
    const createKey = `create-${randomUUID()}`;
    const firstCreate = await memberA
      .post('/api/work-items')
      .set('Idempotency-Key', createKey)
      .send(createBody);
    const replayCreate = await memberA
      .post('/api/work-items')
      .set('Idempotency-Key', createKey)
      .send(createBody);
    expect(firstCreate.status).toBe(201);
    expect(replayCreate.status).toBe(201);
    expect(replayCreate.body).toEqual(firstCreate.body);
    expect(replayCreate.headers['idempotent-replay']).toBe('true');
    const created = await testDb.workItem.findMany({ where: { title } });
    expect(created).toHaveLength(1);

    const commentKey = `comment-${randomUUID()}`;
    const commentBody = { body: 'One durable comment' };
    const firstComment = await memberA
      .post(`/api/work-items/${created[0]!.id}/comments`)
      .set('Idempotency-Key', commentKey)
      .send(commentBody);
    const replayComment = await memberA
      .post(`/api/work-items/${created[0]!.id}/comments`)
      .set('Idempotency-Key', commentKey)
      .send(commentBody);
    expect(replayComment.body).toEqual(firstComment.body);
    expect(await testDb.workItemComment.count({ where: { workItemId: created[0]!.id } })).toBe(1);

    const claimable = await createItem();
    const claimKey = `claim-${randomUUID()}`;
    const claimBody = { expectedVersion: claimable.version };
    const firstClaim = await memberA
      .post(`/api/work-items/${claimable.id}/claim`)
      .set('Idempotency-Key', claimKey)
      .send(claimBody);
    const replayClaim = await memberA
      .post(`/api/work-items/${claimable.id}/claim`)
      .set('Idempotency-Key', claimKey)
      .send(claimBody);
    expect(firstClaim.status).toBe(200);
    expect(replayClaim.body).toEqual(firstClaim.body);
    expect(
      await testDb.workItemEvent.count({
        where: { workItemId: claimable.id, type: 'work_item.assigned' },
      }),
    ).toBe(1);
  });

  it('denies viewer create, claim, and transition operations', async () => {
    const item = await createItem({ status: 'in_progress', assigneeId: memberAId });
    const createResponse = await viewer
      .post('/api/work-items')
      .set('Idempotency-Key', `viewer-create-${randomUUID()}`)
      .send({
        teamId: teamA,
        title: 'Forbidden',
        description: '',
        type: 'task',
        priority: 'normal',
      });
    const claimResponse = await viewer
      .post(`/api/work-items/${item.id}/claim`)
      .set('Idempotency-Key', `viewer-claim-${randomUUID()}`)
      .send({ expectedVersion: item.version });
    const transitionResponse = await viewer
      .post(`/api/work-items/${item.id}/transition`)
      .send({ expectedVersion: item.version, toStatus: 'blocked' });
    expect([createResponse.status, claimResponse.status, transitionResponse.status]).toEqual([
      403, 403, 403,
    ]);
  });

  it('returns 403 to a non-member on another team item', async () => {
    const item = await createItem({ teamId: teamB });
    const read = await memberA.get(`/api/work-items/${item.id}`);
    const update = await memberA
      .patch(`/api/work-items/${item.id}`)
      .send({ expectedVersion: item.version, title: 'Cross team edit' });
    expect(read.status).toBe(403);
    expect(update.status).toBe(403);
  });

  it('rejects an illegal closed-to-in-progress transition', async () => {
    const item = await createItem({ status: 'closed', assigneeId: memberAId });
    const response = await memberA
      .post(`/api/work-items/${item.id}/transition`)
      .send({ expectedVersion: item.version, toStatus: 'in_progress' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
    expect((await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'closed',
    );
  });

  it('retries outbox work transactionally, deduplicates notification rows, and exhausts failed events', async () => {
    const firstEvent = await testDb.outboxEvent.create({
      data: { type: 'test.retry', payload: { test: true } },
    });
    let clock = new Date(Date.now() + 60_000);
    const now = () => new Date(clock);
    const failFirstThenSucceed: OutboxHandler = async (tx, event) => {
      await tx.notification.upsert({
        where: { outboxEventId: event.id },
        update: {},
        create: {
          outboxEventId: event.id,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
        },
      });
      if (event.attempts === 1) throw new Error('temporary failure after notification insert');
    };
    expect(
      await processNextOutboxEvent(testDb, {
        handler: failFirstThenSucceed,
        now,
        maxAttempts: 3,
        eventType: 'test.retry',
      }),
    ).toBe(true);
    clock = new Date(clock.getTime() + 2_000);
    expect(
      await processNextOutboxEvent(testDb, {
        handler: failFirstThenSucceed,
        now,
        maxAttempts: 3,
        eventType: 'test.retry',
      }),
    ).toBe(true);
    expect(
      (await testDb.outboxEvent.findUniqueOrThrow({ where: { id: firstEvent.id } })).status,
    ).toBe('done');
    expect(await testDb.notification.count({ where: { outboxEventId: firstEvent.id } })).toBe(1);

    const failingEvent = await testDb.outboxEvent.create({
      data: { type: 'test.permanent-failure', payload: { test: true } },
    });
    const alwaysFails: OutboxHandler = async (tx, event) => {
      await tx.notification.upsert({
        where: { outboxEventId: event.id },
        update: {},
        create: {
          outboxEventId: event.id,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
        },
      });
      throw new Error('permanent failure');
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        await processNextOutboxEvent(testDb, {
          handler: alwaysFails,
          now,
          maxAttempts: 3,
          eventType: 'test.permanent-failure',
        }),
      ).toBe(true);
      clock = new Date(clock.getTime() + 10_000);
    }
    const failed = await testDb.outboxEvent.findUniqueOrThrow({ where: { id: failingEvent.id } });
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(3);
    expect(await testDb.notification.count({ where: { outboxEventId: failingEvent.id } })).toBe(0);
  });

  it('keeps cursor pages stable when new work is inserted between requests', async () => {
    const marker = `pagination-${runId}-${randomUUID()}`;
    const oldItems = [];
    for (let index = 0; index < 5; index += 1) {
      const timestamp = new Date(Date.now() - 60 * 60_000 + index * 1_000);
      oldItems.push(
        await createItem({
          title: `${marker} ${index}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }
    const first = await memberA
      .get('/api/work-items')
      .query({ teamId: teamA, q: marker, limit: 2 });
    expect(first.status).toBe(200);
    const insertedAt = new Date();
    await createItem({ title: `${marker} inserted`, createdAt: insertedAt, updatedAt: insertedAt });

    const ids = [...first.body.items.map((item: { id: string }) => item.id)];
    let cursor = first.body.nextCursor as string | null;
    while (cursor) {
      const page = await memberA
        .get('/api/work-items')
        .query({ teamId: teamA, q: marker, limit: 2, cursor });
      expect(page.status).toBe(200);
      ids.push(...page.body.items.map((item: { id: string }) => item.id));
      cursor = page.body.nextCursor;
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(oldItems.map((item) => item.id).sort());
  });
});
