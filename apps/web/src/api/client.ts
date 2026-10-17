import type {
  ApiError,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemSummary,
} from '@opsdesk/contracts';

export type User = { id: string; name: string; email: string };
export type Membership = {
  role: 'admin' | 'member' | 'viewer';
  team: { id: string; name: string; slug: string };
};
export type Me = User & { memberships: Membership[] };
export type TeamMember = User & { role: 'admin' | 'member' | 'viewer' };
export type WorkItem = Omit<WorkItemSummary, 'team' | 'assignee'> & {
  team: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  creator?: { id: string; name: string };
};
export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: Pick<User, 'id' | 'name'>;
};
export type WorkItemEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: Pick<User, 'id' | 'name'> | null;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = body as ApiError | undefined;
    throw new ApiRequestError(
      error?.error?.message ?? 'The request could not be completed.',
      response.status,
      error?.error?.code ?? 'REQUEST_FAILED',
      error?.error?.details,
    );
  }
  return body as T;
}

export const login = (email: string, password: string) =>
  apiFetch<{ user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const logout = () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' });
export const fetchMe = () => apiFetch<Me>('/me');
export const fetchTeams = () =>
  apiFetch<{ teams: Array<{ id: string; name: string; slug: string; role: string }> }>('/teams');
export const fetchTeamMembers = (teamId: string) =>
  apiFetch<{ members: TeamMember[] }>(`/teams/${encodeURIComponent(teamId)}/members`);

export type WorkItemFilters = {
  teamId?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assigneeId?: string;
  unassigned?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
};

export async function fetchWorkItems(filters: WorkItemFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  }
  const query = params.toString();
  return apiFetch<{ items: WorkItem[]; nextCursor: string | null }>(
    `/work-items${query ? `?${query}` : ''}`,
  );
}

export const fetchWorkItem = (id: string) =>
  apiFetch<{
    item: WorkItem;
    comments: Comment[];
    events: WorkItemEvent[];
    nextEventCursor: string | null;
  }>(`/work-items/${encodeURIComponent(id)}`);

export const fetchWorkItemEvents = (id: string, cursor?: string) => {
  const query = new URLSearchParams({ limit: '30', ...(cursor ? { cursor } : {}) });
  return apiFetch<{ events: WorkItemEvent[]; nextCursor: string | null }>(
    `/work-items/${encodeURIComponent(id)}/events?${query}`,
  );
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function requestSignature(value: unknown): string {
  const input = canonical(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

export function mutationKey(scope: string, body: unknown): string {
  const keyName = `opsdesk:idempotency:${scope}:${requestSignature(body)}`;
  let id = sessionStorage.getItem(keyName);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(keyName, id);
  }
  return id;
}

export function clearMutationKey(scope: string, body: unknown): void {
  sessionStorage.removeItem(`opsdesk:idempotency:${scope}:${requestSignature(body)}`);
}

export function withIdempotency(scope: string, body: unknown): HeadersInit {
  return { 'Idempotency-Key': mutationKey(scope, body) };
}
