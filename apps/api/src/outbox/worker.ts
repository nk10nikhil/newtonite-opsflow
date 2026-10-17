import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';
import { prisma } from '../db/client.js';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });

export type OutboxHandler = (tx: Prisma.TransactionClient, event: OutboxEvent) => Promise<void>;

export const persistNotification: OutboxHandler = async (tx, event) => {
  await tx.notification.upsert({
    where: { outboxEventId: event.id },
    update: {},
    create: {
      outboxEventId: event.id,
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
};

export async function processNextOutboxEvent(
  db: PrismaClient,
  options: {
    handler?: OutboxHandler;
    now?: () => Date;
    maxAttempts?: number;
    leaseMs?: number;
    eventType?: string;
  } = {},
): Promise<boolean> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const instant = now();
  const staleBefore = new Date(instant.getTime() - leaseMs);
  const typeFilter = options.eventType ? Prisma.sql`AND type = ${options.eventType}` : Prisma.empty;

  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM outbox_events
      WHERE ((status = 'pending' AND next_attempt_at <= ${instant})
         OR (status = 'processing' AND locked_at < ${staleBefore}))
      ${typeFilter}
      ORDER BY created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await tx.outboxEvent.update({
      where: { id: row.id },
      data: { status: 'processing', attempts: { increment: 1 }, lockedAt: instant },
    });
    return tx.outboxEvent.findUnique({ where: { id: row.id } });
  });

  if (!claimed) return false;
  try {
    await db.$transaction(async (tx) => {
      await (options.handler ?? persistNotification)(tx, claimed);
      await tx.outboxEvent.update({
        where: { id: claimed.id },
        data: { status: 'done', processedAt: now(), lockedAt: null, lastError: null },
      });
    });
    console.log(JSON.stringify({ event: 'outbox.processed', id: claimed.id, type: claimed.type }));
  } catch (error) {
    const attempts = claimed.attempts;
    const failed = attempts >= maxAttempts;
    const delayMs = Math.min(60 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown handler error';
    await db.outboxEvent.update({
      where: { id: claimed.id },
      data: {
        status: failed ? 'failed' : 'pending',
        nextAttemptAt: new Date(now().getTime() + delayMs),
        lockedAt: null,
        lastError: message,
      },
    });
    console.error(
      JSON.stringify({ event: 'outbox.failed', id: claimed.id, attempts, failed, error: message }),
    );
  }
  return true;
}

async function run() {
  const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 1000);
  console.log(`OpsDesk outbox worker polling every ${pollMs}ms`);
  while (true) {
    const found = await processNextOutboxEvent(prisma);
    if (!found) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

if (process.env.NODE_ENV !== 'test') {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
