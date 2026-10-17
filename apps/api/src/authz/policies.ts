import type { TeamRole, WorkItemStatus } from '@opsdesk/contracts';
import { AppError } from '../lib/errors.js';

export type WorkItemAccess = {
  role: TeamRole;
  userId: string;
  assigneeId: string | null;
};

export function canRead(role: TeamRole | null | undefined): boolean {
  return role !== null && role !== undefined;
}

export function canCreate(role: TeamRole | null | undefined): boolean {
  return role === 'member' || role === 'admin';
}

export function canComment(role: TeamRole | null | undefined): boolean {
  return role === 'member' || role === 'admin';
}

export function canClaim(role: TeamRole | null | undefined): boolean {
  return role === 'member' || role === 'admin';
}

export function canEdit(access: WorkItemAccess): boolean {
  return (
    access.role === 'admin' || (access.role === 'member' && access.assigneeId === access.userId)
  );
}

export function canAssign(role: TeamRole): boolean {
  return role === 'admin';
}

export function canChangePriority(access: WorkItemAccess): boolean {
  return (
    access.role === 'admin' || (access.role === 'member' && access.assigneeId === access.userId)
  );
}

export function canTransition(
  access: WorkItemAccess,
  from: WorkItemStatus,
  to: WorkItemStatus,
): boolean {
  if (to === 'open' && from === 'closed') return access.role === 'admin';
  if (from === 'in_progress' && to === 'resolved') {
    return (
      access.role === 'admin' || (access.role === 'member' && access.assigneeId === access.userId)
    );
  }
  return (
    access.role === 'admin' || (access.role === 'member' && access.assigneeId === access.userId)
  );
}

export function requireAllowed(
  allowed: boolean,
  message = 'You do not have permission to perform this action',
): void {
  if (!allowed) throw new AppError(403, 'FORBIDDEN', message);
}
