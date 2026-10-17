import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireUser } from '../../auth/session.js';
import { canClaim, canComment, canCreate, canAssign, requireAllowed } from '../../authz/policies.js';
import { AppError } from '../../lib/errors.js';
import { decodeCursor, encodeCursor, pageLimit } from '../../lib/pagination.js';
import { requireIdempotencyKey, withIdempotency } from '../../lib/idempotency.js';
import { assignSchema, claimSchema, commentSchema, createWorkItemSchema, prioritySchema, statusSchema, transitionSchema, updateWorkItemSchema } from './schemas.js';
import { assignWorkItemTx, claimWorkItemTx, createCommentTx, createWorkItemTx, getItemAccess, getTeamRole, patchWorkItem, transitionWorkItem } from './service.js';
import { z } from 'zod';

const listQuerySchema = z.object({
  teamId: z.string().min(1).optional(),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  unassigned: z.coerce.boolean().optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', result.error.flatten());
  return result.data;
}

function idempotencyKey(reply: FastifyReply, value: string | string[] | undefined) {
  return requireIdempotencyKey(typeof value === 'string' ? value : undefined);
}

function mutationResponse(reply: FastifyReply, result: { status: number; body: unknown; replayed: boolean }) {
  if (result.replayed) reply.header('Idempotent-Replay', 'true');
  return reply.code(result.status).send(result.body);
}

function tupleCursorFilter(point: { at: string; id: string }): Prisma.WorkItemWhereInput {
  const at = new Date(point.at);
  return {
    OR: [
      { updatedAt: { lt: at } },
      { updatedAt: at, id: { lt: point.id } },
    ],
  };
}

function eventTupleCursorFilter(point: { at: string; id: string }): Prisma.WorkItemEventWhereInput {
  const at = new Date(point.at);
  return {
    OR: [
      { createdAt: { lt: at } },
      { createdAt: at, id: { lt: point.id } },
    ],
  };
}

export function registerWorkItemRoutes(app: FastifyInstance, db: PrismaClient) {
  app.post('/api/work-items', async (request, reply) => {
    const actor = requireUser(request);
    const body = parse(createWorkItemSchema, request.body);
    const role = await getTeamRole(db, actor.id, body.teamId);
    requireAllowed(canCreate(role), 'Your team role cannot create work items');
    const key = idempotencyKey(reply, request.headers['idempotency-key']);
    const result = await withIdempotency(db, {
      key,
      userId: actor.id,
      endpoint: 'POST /api/work-items',
      requestBody: body,
    }, async (tx) => ({
      status: 201,
      body: { item: await createWorkItemTx(tx, actor, body) },
    }));
    return mutationResponse(reply, result);
  });

  app.get('/api/work-items', async (request) => {
    const actor = requireUser(request);
    const query = parse(listQuerySchema, request.query);
    const memberships = await db.teamMembership.findMany({
      where: { userId: actor.id },
      select: { teamId: true },
    });
    const allowedTeamIds = memberships.map((membership) => membership.teamId);
    if (query.teamId && !allowedTeamIds.includes(query.teamId)) {
      const teamExists = await db.team.findUnique({ where: { id: query.teamId }, select: { id: true } });
      if (!teamExists) throw new AppError(404, 'NOT_FOUND', 'Team not found');
      throw new AppError(403, 'FORBIDDEN', 'You are not a member of this team');
    }
    const cursor = decodeCursor(query.cursor);
    const snapshot = cursor ? new Date(cursor.snapshot) : new Date(Date.now() - 1000);
    const teamIds = query.teamId ? [query.teamId] : allowedTeamIds;
    const where: Prisma.WorkItemWhereInput = {
      teamId: { in: teamIds },
      updatedAt: { lte: snapshot },
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.unassigned ? { assigneeId: null } : {}),
      ...(query.q ? { OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ] } : {}),
    };
    if (cursor) {
      const existingAnd = where.AND;
      where.AND = [...(Array.isArray(existingAnd) ? existingAnd : existingAnd ? [existingAnd] : []), tupleCursorFilter(cursor)];
    }
    const found = teamIds.length === 0 ? [] : await db.workItem.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        team: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
    const hasMore = found.length > query.limit;
    const items = hasMore ? found.slice(0, query.limit) : found;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ snapshot: snapshot.toISOString(), at: last.updatedAt.toISOString(), id: last.id }) : null,
    };
  });

  app.get<{ Params: { id: string } }>('/api/work-items/:id', async (request) => {
    const actor = requireUser(request);
    const { item } = await getItemAccess(db, actor.id, request.params.id);
    const [comments, events] = await Promise.all([
      db.workItemComment.findMany({
        where: { workItemId: item.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
        include: { author: { select: { id: true, name: true } } },
      }),
      db.workItemEvent.findMany({
        where: { workItemId: item.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
        include: { actor: { select: { id: true, name: true } } },
      }),
    ]);
    return { item, comments: comments.reverse(), events: events.reverse() };
  });

  app.get<{ Params: { id: string } }>('/api/work-items/:id/events', async (request) => {
    const actor = requireUser(request);
    const { item } = await getItemAccess(db, actor.id, request.params.id);
    const query = parse(z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }), request.query);
    const cursor = decodeCursor(query.cursor);
    const snapshot = cursor ? new Date(cursor.snapshot) : new Date(Date.now() - 1000);
    const where: Prisma.WorkItemEventWhereInput = { workItemId: item.id, createdAt: { lte: snapshot } };
    if (cursor) where.AND = [eventTupleCursorFilter(cursor)];
    const found = await db.workItemEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { actor: { select: { id: true, name: true } } },
    });
    const hasMore = found.length > query.limit;
    const events = hasMore ? found.slice(0, query.limit) : found;
    const last = events.at(-1);
    return {
      events,
      nextCursor: hasMore && last ? encodeCursor({ snapshot: snapshot.toISOString(), at: last.createdAt.toISOString(), id: last.id }) : null,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/work-items/:id', async (request) => {
    const actor = requireUser(request);
    const body = parse(updateWorkItemSchema, request.body);
    return { item: await patchWorkItem(db, actor, request.params.id, body) };
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/claim', async (request, reply) => {
    const actor = requireUser(request);
    const body = parse(claimSchema, request.body);
    const { role } = await getItemAccess(db, actor.id, request.params.id);
    requireAllowed(canClaim(role), 'Your team role cannot claim work items');
    const key = idempotencyKey(reply, request.headers['idempotency-key']);
    const result = await withIdempotency(db, {
      key,
      userId: actor.id,
      endpoint: `POST /api/work-items/${request.params.id}/claim`,
      requestBody: body,
    }, async (tx) => ({ body: { item: await claimWorkItemTx(tx, actor, request.params.id, body.expectedVersion) } }));
    return mutationResponse(reply, result);
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/assign', async (request, reply) => {
    const actor = requireUser(request);
    const body = parse(assignSchema, request.body);
    const { role } = await getItemAccess(db, actor.id, request.params.id);
    requireAllowed(canAssign(role), 'Only a team admin can assign work items');
    const key = idempotencyKey(reply, request.headers['idempotency-key']);
    const result = await withIdempotency(db, {
      key,
      userId: actor.id,
      endpoint: `POST /api/work-items/${request.params.id}/assign`,
      requestBody: body,
    }, async (tx) => ({ body: { item: await assignWorkItemTx(tx, actor, request.params.id, body) } }));
    return mutationResponse(reply, result);
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/transition', async (request) => {
    const actor = requireUser(request);
    const body = parse(transitionSchema, request.body);
    return { item: await transitionWorkItem(db, actor, request.params.id, body) };
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/comments', async (request, reply) => {
    const actor = requireUser(request);
    const body = parse(commentSchema, request.body);
    const { role } = await getItemAccess(db, actor.id, request.params.id);
    requireAllowed(canComment(role), 'Your team role cannot comment on work items');
    const key = idempotencyKey(reply, request.headers['idempotency-key']);
    const result = await withIdempotency(db, {
      key,
      userId: actor.id,
      endpoint: `POST /api/work-items/${request.params.id}/comments`,
      requestBody: body,
    }, async (tx) => ({ status: 201, body: { comment: await createCommentTx(tx, actor, request.params.id, body.body) } }));
    return mutationResponse(reply, result);
  });
}
