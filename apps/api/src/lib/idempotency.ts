import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from './errors.js';

export type MutationResponse = { status: number; body: unknown; replayed: boolean };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const hashRequest = (body: unknown) => createHash('sha256').update(stable(body)).digest('hex');

function fromStored(existing: { requestHash: string; responseStatus: number; responseBody: Prisma.JsonValue }, requestHash: string): MutationResponse {
  if (existing.requestHash !== requestHash) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used with a different request');
  }
  return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
}

export async function withIdempotency(
  db: PrismaClient,
  params: { key: string; userId: string; endpoint: string; requestBody: unknown },
  execute: (tx: Prisma.TransactionClient) => Promise<{ status?: number; body: unknown }>,
): Promise<MutationResponse> {
  const requestHash = hashRequest(params.requestBody);
  const findExisting = () => db.idempotencyKey.findUnique({
    where: { userId_key_endpoint: { userId: params.userId, key: params.key, endpoint: params.endpoint } },
  });

  const existing = await findExisting();
  if (existing) return fromStored(existing, requestHash);

  try {
    return await db.$transaction(async (tx) => {
      const inside = await tx.idempotencyKey.findUnique({
        where: { userId_key_endpoint: { userId: params.userId, key: params.key, endpoint: params.endpoint } },
      });
      if (inside) return fromStored(inside, requestHash);

      let result: { status?: number; body: unknown };
      try {
        result = await execute(tx);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        result = {
          status: error.statusCode,
          body: { error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } },
        };
      }
      const responseStatus = result.status ?? 200;
      await tx.idempotencyKey.create({
        data: {
          key: params.key,
          userId: params.userId,
          endpoint: params.endpoint,
          requestHash,
          responseStatus,
          responseBody: result.body as Prisma.InputJsonValue,
        },
      });
      return { status: responseStatus, body: result.body, replayed: false };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const raced = await findExisting();
    if (raced) return fromStored(raced, requestHash);
    throw error;
  }
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 8 || value.length > 200) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
  }
  return value;
}
