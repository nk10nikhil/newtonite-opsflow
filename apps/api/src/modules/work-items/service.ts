import type { Prisma, PrismaClient, TeamRole, WorkItemStatus } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import {
  canAssign,
  canChangePriority,
  canClaim,
  canComment,
  canCreate,
  canEdit,
  canTransition,
  requireAllowed,
} from '../../authz/policies.js';
import { isLegalTransition } from './workflow.js';
import { enqueueOutbox, recordWorkItemEvent } from '../../outbox/producer.js';
import type { CreateWorkItemInput, UpdateWorkItemInput } from './schemas.js';

type Database = PrismaClient | Prisma.TransactionClient;
type Actor = { id: string; name?: string };

const itemRelations = {
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.WorkItemInclude;

export async function getItemAccess(db: Database, userId: string, workItemId: string) {
  const item = await db.workItem.findUnique({ where: { id: workItemId }, include: itemRelations });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Work item not found');
  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId: item.teamId } },
    select: { role: true },
  });
  if (!membership) throw new AppError(403, 'FORBIDDEN', 'You are not a member of this item’s team');
  return { item, role: membership.role };
}

export async function getTeamRole(db: Database, userId: string, teamId: string): Promise<TeamRole> {
  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { role: true },
  });
  if (membership) return membership.role;
  if (!(await db.team.findUnique({ where: { id: teamId }, select: { id: true } }))) {
    throw new AppError(404, 'NOT_FOUND', 'Team not found');
  }
  throw new AppError(403, 'FORBIDDEN', 'You are not a member of this team');
}

async function latestItem(db: Database, id: string) {
  return db.workItem.findUnique({ where: { id }, include: itemRelations });
}

function versionConflict(current: unknown) {
  throw new AppError(
    409,
    'CONFLICT_VERSION',
    'This work item changed. Load the latest version before saving.',
    { current },
  );
}

function claimConflict(current: unknown) {
  throw new AppError(409, 'CONFLICT_CLAIM', 'Someone else claimed this work item.', { current });
}

export async function createWorkItemTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: CreateWorkItemInput,
) {
  const role = await getTeamRole(tx, actor.id, input.teamId);
  requireAllowed(canCreate(role), 'Your team role cannot create work items');
  const item = await tx.workItem.create({
    data: {
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      createdBy: actor.id,
    },
    include: itemRelations,
  });
  await recordWorkItemEvent(tx, {
    workItemId: item.id,
    actorId: actor.id,
    type: 'work_item.created',
    payload: {
      title: item.title,
      teamId: item.teamId,
      status: item.status,
      priority: item.priority,
    },
  });
  await enqueueOutbox(tx, 'work_item.created', { workItemId: item.id, teamId: item.teamId });
  return item;
}

export async function patchWorkItemTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workItemId: string,
  input: UpdateWorkItemInput,
) {
  const { item, role } = await getItemAccess(tx, actor.id, workItemId);
  const fields = Object.keys(input).filter((key) => key !== 'expectedVersion');
  const onlyPriority = fields.length === 1 && fields[0] === 'priority';
  requireAllowed(
    onlyPriority
      ? canChangePriority({ role, userId: actor.id, assigneeId: item.assigneeId })
      : canEdit({ role, userId: actor.id, assigneeId: item.assigneeId }),
  );

  const data: Prisma.WorkItemUpdateManyMutationInput = {
    version: { increment: 1 },
    updatedAt: new Date(),
  };
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.type !== undefined) data.type = input.type;
  if (input.priority !== undefined) data.priority = input.priority;
  const update = await tx.workItem.updateMany({
    where: { id: workItemId, version: input.expectedVersion },
    data,
  });
  if (!update.count) versionConflict(await latestItem(tx, workItemId));

  const updated = await latestItem(tx, workItemId);
  if (!updated) throw new AppError(404, 'NOT_FOUND', 'Work item not found');
  await recordWorkItemEvent(tx, {
    workItemId,
    actorId: actor.id,
    type:
      input.priority !== undefined && input.priority !== item.priority
        ? 'work_item.priority_changed'
        : 'work_item.updated',
    payload: {
      changedFields: fields,
      ...(input.priority !== undefined
        ? { fromPriority: item.priority, toPriority: input.priority }
        : {}),
    },
  });
  if (input.priority !== undefined && input.priority !== item.priority) {
    await enqueueOutbox(tx, 'work_item.priority_changed', {
      workItemId,
      from: item.priority,
      to: input.priority,
    });
  }
  return updated;
}

export async function patchWorkItem(
  db: PrismaClient,
  actor: Actor,
  workItemId: string,
  input: UpdateWorkItemInput,
) {
  return db.$transaction((tx) => patchWorkItemTx(tx, actor, workItemId, input));
}

export async function claimWorkItemTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workItemId: string,
  expectedVersion?: number,
) {
  const { item, role } = await getItemAccess(tx, actor.id, workItemId);
  requireAllowed(canClaim(role), 'Your team role cannot claim work items');
  const version = expectedVersion ?? item.version;
  const update = await tx.workItem.updateMany({
    where: { id: workItemId, assigneeId: null, status: 'open', version },
    data: {
      assigneeId: actor.id,
      status: 'in_progress',
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  if (!update.count) {
    const current = await latestItem(tx, workItemId);
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Work item not found');
    if (current.assigneeId !== null) claimConflict(current);
    if (current.version !== version) versionConflict(current);
    throw new AppError(
      422,
      'INVALID_TRANSITION',
      'Only an open, unassigned work item can be claimed.',
      { current },
    );
  }
  const updated = await latestItem(tx, workItemId);
  if (!updated) throw new AppError(404, 'NOT_FOUND', 'Work item not found');
  await recordWorkItemEvent(tx, {
    workItemId,
    actorId: actor.id,
    type: 'work_item.assigned',
    payload: { fromAssigneeId: null, toAssigneeId: actor.id, action: 'claim' },
  });
  await recordWorkItemEvent(tx, {
    workItemId,
    actorId: actor.id,
    type: 'work_item.status_changed',
    payload: { from: 'open', to: 'in_progress' },
  });
  await enqueueOutbox(tx, 'work_item.assigned', { workItemId, assigneeId: actor.id });
  await enqueueOutbox(tx, 'work_item.status_changed', {
    workItemId,
    from: 'open',
    to: 'in_progress',
  });
  return updated;
}

export async function assignWorkItemTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workItemId: string,
  input: { assigneeId: string; expectedVersion: number },
) {
  const { item, role } = await getItemAccess(tx, actor.id, workItemId);
  requireAllowed(canAssign(role), 'Only a team admin can assign work items');
  const targetMembership = await tx.teamMembership.findUnique({
    where: { userId_teamId: { userId: input.assigneeId, teamId: item.teamId } },
    select: { user: { select: { id: true, name: true } } },
  });
  if (!targetMembership)
    throw new AppError(422, 'VALIDATION_ERROR', 'Assignee must belong to this team');

  const nextStatus: WorkItemStatus = item.status === 'open' ? 'in_progress' : item.status;
  const update = await tx.workItem.updateMany({
    where: { id: workItemId, version: input.expectedVersion },
    data: {
      assigneeId: input.assigneeId,
      status: nextStatus,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  if (!update.count) versionConflict(await latestItem(tx, workItemId));
  const updated = await latestItem(tx, workItemId);
  if (!updated) throw new AppError(404, 'NOT_FOUND', 'Work item not found');
  await recordWorkItemEvent(tx, {
    workItemId,
    actorId: actor.id,
    type: 'work_item.assigned',
    payload: {
      fromAssigneeId: item.assigneeId,
      toAssigneeId: input.assigneeId,
      assigneeName: targetMembership.user.name,
    },
  });
  await enqueueOutbox(tx, 'work_item.assigned', { workItemId, assigneeId: input.assigneeId });
  if (nextStatus !== item.status) {
    await recordWorkItemEvent(tx, {
      workItemId,
      actorId: actor.id,
      type: 'work_item.status_changed',
      payload: { from: item.status, to: nextStatus },
    });
    await enqueueOutbox(tx, 'work_item.status_changed', {
      workItemId,
      from: item.status,
      to: nextStatus,
    });
  }
  return updated;
}

export async function transitionWorkItemTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workItemId: string,
  input: { toStatus: WorkItemStatus; expectedVersion: number },
) {
  const { item, role } = await getItemAccess(tx, actor.id, workItemId);
  requireAllowed(
    canTransition(
      { role, userId: actor.id, assigneeId: item.assigneeId },
      item.status,
      input.toStatus,
    ),
  );
  if (item.status === 'open' && input.toStatus === 'in_progress') {
    throw new AppError(422, 'INVALID_TRANSITION', 'Claim or assign an open item to start work.', {
      from: item.status,
      to: input.toStatus,
    });
  }
  if (!isLegalTransition(item.status, input.toStatus)) {
    throw new AppError(
      422,
      'INVALID_TRANSITION',
      `Cannot transition from ${item.status} to ${input.toStatus}.`,
      { from: item.status, to: input.toStatus },
    );
  }
  const update = await tx.workItem.updateMany({
    where: { id: workItemId, version: input.expectedVersion },
    data: { status: input.toStatus, version: { increment: 1 }, updatedAt: new Date() },
  });
  if (!update.count) versionConflict(await latestItem(tx, workItemId));
  const updated = await latestItem(tx, workItemId);
  if (!updated) throw new AppError(404, 'NOT_FOUND', 'Work item not found');
  await recordWorkItemEvent(tx, {
    workItemId,
    actorId: actor.id,
    type: 'work_item.status_changed',
    payload: { from: item.status, to: input.toStatus },
  });
  await enqueueOutbox(tx, 'work_item.status_changed', {
    workItemId,
    from: item.status,
    to: input.toStatus,
  });
  return updated;
}

export async function transitionWorkItem(
  db: PrismaClient,
  actor: Actor,
  workItemId: string,
  input: { toStatus: WorkItemStatus; expectedVersion: number },
) {
  return db.$transaction((tx) => transitionWorkItemTx(tx, actor, workItemId, input));
}

export async function createCommentTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workItemId: string,
  body: string,
) {
  const { role } = await getItemAccess(tx, actor.id, workItemId);
  requireAllowed(canComment(role), 'Your team role cannot comment on work items');
  const comment = await tx.workItemComment.create({
    data: { workItemId, authorId: actor.id, body },
    include: { author: { select: { id: true, name: true } } },
  });
  await tx.workItem.update({ where: { id: workItemId }, data: { updatedAt: new Date() } });
  await recordWorkItemEvent(tx, {
    workItemId,
    actorId: actor.id,
    type: 'work_item.comment_added',
    payload: { commentId: comment.id },
  });
  return comment;
}
