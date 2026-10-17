import type { WorkItemStatus } from '@opsdesk/contracts';

const transitions: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  open: ['in_progress'],
  in_progress: ['blocked', 'resolved'],
  blocked: ['in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: ['open'],
};

export function isLegalTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return transitions[from].includes(to);
}

export function allowedTransitions(from: WorkItemStatus): readonly WorkItemStatus[] {
  return transitions[from];
}
