import type { Prisma } from '@prisma/client';

export async function enqueueOutbox(
  tx: Prisma.TransactionClient,
  type: string,
  payload: Prisma.InputJsonValue,
): Promise<void> {
  await tx.outboxEvent.create({ data: { type, payload } });
}

export async function recordWorkItemEvent(
  tx: Prisma.TransactionClient,
  input: { workItemId: string; actorId: string | null; type: string; payload: Prisma.InputJsonValue },
): Promise<void> {
  await tx.workItemEvent.create({ data: input });
}
