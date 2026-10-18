import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { WorkItemStatus } from '@opsdesk/contracts';
import {
  ApiRequestError,
  apiFetch,
  clearMutationKey,
  fetchTeamMembers,
  fetchWorkItem,
  fetchWorkItemEvents,
  type Comment,
  type Me,
  type TeamMember,
  type WorkItem,
  type WorkItemEvent,
} from '../api/client';
import { withIdempotency } from '../api/client';
import { ConflictBanner } from '../components/ConflictBanner';

const transitions: Record<WorkItemStatus, WorkItemStatus[]> = {
  open: ['in_progress'],
  in_progress: ['blocked', 'resolved'],
  blocked: ['in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: ['open'],
};

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
const timestamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type TimelineEntry =
  | { kind: 'event'; id: string; at: string; event: WorkItemEvent }
  | { kind: 'comment'; id: string; at: string; comment: Comment };

function eventSummary(event: WorkItemEvent): string | null {
  const payload = event.payload ?? {};
  switch (event.type) {
    case 'work_item.created':
      return 'Created this work item';
    case 'work_item.assigned':
      return payload.action === 'claim'
        ? 'Claimed this item'
        : `Assigned to ${String(payload.assigneeName ?? 'a team member')}`;
    case 'work_item.status_changed':
      return `Moved from ${titleCase(String(payload.from ?? 'unknown'))} to ${titleCase(String(payload.to ?? 'unknown'))}`;
    case 'work_item.priority_changed':
      return `Changed priority from ${String(payload.fromPriority ?? '')} to ${String(payload.toPriority ?? '')}`;
    case 'work_item.updated':
      return `Updated ${Array.isArray(payload.changedFields) ? payload.changedFields.map(String).join(', ') : 'item details'}`;
    case 'work_item.comment_added':
      return null;
    default:
      return event.type.replaceAll('.', ' ');
  }
}

export function WorkItemDetail({
  id,
  me,
  onBack,
  onLogout,
}: {
  id: string;
  me: Me;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [item, setItem] = useState<WorkItem | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [nextEventCursor, setNextEventCursor] = useState<string | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [claimConflict, setClaimConflict] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftType, setDraftType] = useState('task');
  const [draftPriority, setDraftPriority] = useState('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [commentBody, setCommentBody] = useState('');

  const refresh = useCallback(async () => {
    setLoadError('');
    const result = await fetchWorkItem(id);
    setItem(result.item);
    setComments(result.comments);
    setEvents(result.events);
    setNextEventCursor(result.nextEventCursor);
    setDraftTitle(result.item.title);
    setDraftDescription(result.item.description);
    setDraftType(result.item.type);
    setDraftPriority(result.item.priority);
    setAssigneeId(result.item.assigneeId ?? '');
  }, [id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([fetchWorkItem(id)])
      .then(([result]) => {
        if (!active) return;
        setItem(result.item);
        setComments(result.comments);
        setEvents(result.events);
        setNextEventCursor(result.nextEventCursor);
        setDraftTitle(result.item.title);
        setDraftDescription(result.item.description);
        setDraftType(result.item.type);
        setDraftPriority(result.item.priority);
        setAssigneeId(result.item.assigneeId ?? '');
        const membership = me.memberships.find((entry) => entry.team.id === result.item.teamId);
        if (membership?.role === 'admin') {
          fetchTeamMembers(result.item.teamId).then(({ members: list }) => {
            if (active) setMembers(list);
          });
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setLoadError(cause instanceof Error ? cause.message : 'Could not load this work item.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, me]);

  const role = item
    ? me.memberships.find((membership) => membership.team.id === item.teamId)?.role
    : undefined;
  const admin = role === 'admin';
  const member = role === 'member';
  const owner = item?.assigneeId === me.id;
  const canEdit = admin || (member && owner);
  const canClaim = (admin || member) && item?.status === 'open' && item.assigneeId === null;
  const canAssign = admin;
  const dirty = Boolean(
    item &&
    (draftTitle !== item.title ||
      draftDescription !== item.description ||
      draftType !== item.type ||
      draftPriority !== item.priority),
  );

  const timeline = useMemo<TimelineEntry[]>(
    () =>
      [
        ...events
          .filter((event) => event.type !== 'work_item.comment_added')
          .map((event) => ({ kind: 'event' as const, id: event.id, at: event.createdAt, event })),
        ...comments.map((comment) => ({
          kind: 'comment' as const,
          id: comment.id,
          at: comment.createdAt,
          comment,
        })),
      ].sort((left, right) => left.at.localeCompare(right.at)),
    [events, comments],
  );

  async function runVersionedMutation(
    action: string,
    method: 'PATCH' | 'POST',
    path: string,
    body: Record<string, unknown>,
    optimisticItem?: WorkItem,
  ) {
    setBusy(action);
    setActionError('');
    if (optimisticItem) setItem(optimisticItem);
    let claimWasRefreshed = false;
    try {
      const result = await apiFetch<{ item: WorkItem }>(path, {
        method,
        headers: withIdempotency(`${id}:${action}`, body),
        body: JSON.stringify(body),
      });
      clearMutationKey(`${id}:${action}`, body);
      setItem(result.item);
      setDraftTitle(result.item.title);
      setDraftDescription(result.item.description);
      setDraftType(result.item.type);
      setDraftPriority(result.item.priority);
      setAssigneeId(result.item.assigneeId ?? '');
      await refreshTimeline().catch(() => undefined);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'CONFLICT_VERSION') {
        setConflict(true);
      } else if (cause instanceof ApiRequestError && cause.code === 'CONFLICT_CLAIM') {
        claimWasRefreshed = true;
        setClaimConflict(true);
        await refresh().catch(() => undefined);
      } else {
        setActionError(
          cause instanceof Error
            ? cause.message
            : 'The change could not be saved. Retry to reuse the same request key.',
        );
      }
      if (optimisticItem && item && !claimWasRefreshed) setItem(item);
    } finally {
      setBusy('');
    }
  }

  async function refreshTimeline() {
    const result = await fetchWorkItem(id);
    setItem(result.item);
    setComments(result.comments);
    setEvents(result.events);
    setNextEventCursor(result.nextEventCursor);
  }

  async function loadEarlierEvents() {
    if (!nextEventCursor) return;
    setLoadingEvents(true);
    try {
      const result = await fetchWorkItemEvents(id, nextEventCursor);
      setEvents((current) => [...result.events.reverse(), ...current]);
      setNextEventCursor(result.nextCursor);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not load earlier activity.');
    } finally {
      setLoadingEvents(false);
    }
  }

  async function loadLatest() {
    setConflict(false);
    setClaimConflict(false);
    setActionError('');
    setLoading(true);
    try {
      await refresh();
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load the latest item.');
    } finally {
      setLoading(false);
    }
  }

  async function claim() {
    if (!item) return;
    const body = { expectedVersion: item.version };
    await runVersionedMutation('claim', 'POST', `/work-items/${id}/claim`, body, {
      ...item,
      assigneeId: me.id,
      assignee: { id: me.id, name: me.name },
      status: 'in_progress',
      version: item.version + 1,
    });
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const body = {
      expectedVersion: item.version,
      title: draftTitle,
      description: draftDescription,
      type: draftType,
      priority: draftPriority,
    };
    await runVersionedMutation('edit', 'PATCH', `/work-items/${id}`, body);
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !assigneeId) return;
    const body = { assigneeId, expectedVersion: item.version };
    await runVersionedMutation('assign', 'POST', `/work-items/${id}/assign`, body);
  }

  async function transition(toStatus: WorkItemStatus) {
    if (!item) return;
    const body = { expectedVersion: item.version, toStatus };
    await runVersionedMutation(
      `transition-${toStatus}`,
      'POST',
      `/work-items/${id}/transition`,
      body,
    );
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !commentBody.trim()) return;
    const body = { body: commentBody.trim(), expectedVersion: item.version };
    const scope = `${id}:comment`;
    const optimistic: Comment = {
      id: `optimistic-${crypto.randomUUID()}`,
      body: body.body,
      createdAt: new Date().toISOString(),
      author: { id: me.id, name: me.name },
    };
    setComments((current) => [...current, optimistic]);
    setCommentBody('');
    setBusy('comment');
    setActionError('');
    try {
      const result = await apiFetch<{ comment: Comment }>(`/work-items/${id}/comments`, {
        method: 'POST',
        headers: withIdempotency(scope, body),
        body: JSON.stringify(body),
      });
      clearMutationKey(scope, body);
      setComments((current) =>
        current.map((comment) => (comment.id === optimistic.id ? result.comment : comment)),
      );
      await refreshTimeline();
    } catch (cause) {
      setComments((current) => current.filter((comment) => comment.id !== optimistic.id));
      setCommentBody(body.body);
      if (cause instanceof ApiRequestError && cause.code === 'CONFLICT_VERSION') setConflict(true);
      else
        setActionError(
          cause instanceof Error
            ? `${cause.message} Retry to reuse the same request key.`
            : 'Comment could not be added.',
        );
    } finally {
      setBusy('');
    }
  }

  if (loading && !item)
    return (
      <div className="center-panel" role="status">
        <span className="spinner" />
        Loading work item…
      </div>
    );
  if (!item)
    return (
      <div className="center-panel">
        <p className="form-error">{loadError || 'Work item could not be found.'}</p>
        <button className="button button-dark" onClick={onBack}>
          Back to work
        </button>
      </div>
    );

  const visibleTransitions = transitions[item.status].filter((target) => {
    if (item.status === 'open' && target === 'in_progress') return false;
    if (target === 'open' && item.status === 'closed') return admin;
    if (!admin && !(member && owner)) return false;
    return true;
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={onBack}>
          <span className="brand-mark">O</span>
          <span>OpsFlow</span>
        </button>
        <div className="topbar-right">
          <span className="user-chip">
            <span className="avatar">
              {me.name
                .split(' ')
                .map((part) => part[0])
                .slice(0, 2)
                .join('')}
            </span>
            {me.name}
          </span>
          <button className="button button-quiet" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="detail-layout">
        <div className="detail-topline">
          <button className="back-link" onClick={onBack}>
            ← Work queue
          </button>
          <span className="eyebrow">
            {item.team.name} / {item.id.slice(-8).toUpperCase()}
          </span>
        </div>
        {conflict && (
          <ConflictBanner
            message="The item version on screen is out of date. Load the latest version, review it, then re-apply your change."
            onLoadLatest={loadLatest}
          />
        )}
        {claimConflict && (
          <div className="inline-warning" role="alert">
            <span>Someone else claimed this work item. The latest version has been refreshed.</span>
            <button className="button button-quiet" onClick={() => setClaimConflict(false)}>
              Dismiss
            </button>
          </div>
        )}
        {actionError && (
          <div className="inline-error" role="alert">
            {actionError}
          </div>
        )}
        {loadError && (
          <div className="inline-error" role="alert">
            {loadError}
          </div>
        )}

        <section className="detail-header">
          <div className="detail-title-block">
            <div className="detail-badges">
              <span className={`status status-${item.status}`}>{titleCase(item.status)}</span>
              <span className={`priority priority-${item.priority}`}>
                {titleCase(item.priority)} priority
              </span>
            </div>
            <h1>{item.title}</h1>
            <p className="detail-description">{item.description || 'No description provided.'}</p>
            <div className="detail-meta">
              <span>{titleCase(item.type)}</span>
              <span>Version {item.version}</span>
              <span>Updated {timestamp(item.updatedAt)}</span>
              <span>Created {timestamp(item.createdAt)}</span>
            </div>
          </div>
          <div className="ownership-card">
            <p className="eyebrow">CURRENT OWNER</p>
            <div className="owner-line">
              <span className="avatar avatar-large">
                {item.assignee
                  ? item.assignee.name
                      .split(' ')
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join('')
                  : '—'}
              </span>
              <span>
                <strong>{item.assignee?.name ?? 'Unassigned'}</strong>
                <small>
                  {item.assignee ? 'Responsible for next action' : 'Waiting to be claimed'}
                </small>
              </span>
            </div>
            {canClaim && (
              <button
                className="button button-primary button-wide"
                disabled={busy === 'claim'}
                onClick={claim}
              >
                {busy === 'claim' ? 'Claiming…' : 'Claim this item'}
              </button>
            )}
            {canAssign && (
              <form className="assign-form" onSubmit={assign}>
                <label>
                  <span>Assign to</span>
                  <select
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                    required
                  >
                    <option value="">Choose a team member</option>
                    {members.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {person.id === me.id ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary button-wide"
                  disabled={!assigneeId || busy === 'assign'}
                >
                  {busy === 'assign' ? 'Assigning…' : 'Save assignment'}
                </button>
              </form>
            )}
          </div>
        </section>

        <section className="action-strip" aria-label="Workflow actions">
          {visibleTransitions.map((target) => (
            <button
              key={target}
              className="button button-secondary"
              disabled={busy.startsWith('transition')}
              onClick={() => transition(target)}
            >
              {target === 'in_progress'
                ? 'Resume work'
                : target === 'blocked'
                  ? 'Mark blocked'
                  : target === 'resolved'
                    ? 'Mark resolved'
                    : target === 'closed'
                      ? 'Close item'
                      : 'Reopen item'}
            </button>
          ))}
          <span className="action-hint">Changes are recorded in the activity history.</span>
        </section>

        <div className="detail-columns">
          <section className="detail-main-column">
            <section className="panel edit-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">WORK ITEM</p>
                  <h2>Details</h2>
                </div>
                {!canEdit && <span className="read-only-label">Read only</span>}
              </div>
              {canEdit ? (
                <form className="form-stack" onSubmit={saveItem}>
                  <label>
                    <span>Title</span>
                    <input
                      maxLength={240}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Description / next action</span>
                    <textarea
                      rows={4}
                      value={draftDescription}
                      onChange={(event) => setDraftDescription(event.target.value)}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      <span>Type</span>
                      <select
                        value={draftType}
                        onChange={(event) => setDraftType(event.target.value)}
                      >
                        {[
                          'customer_issue',
                          'incident',
                          'payment_investigation',
                          'compliance_request',
                          'approval',
                          'task',
                        ].map((type) => (
                          <option key={type} value={type}>
                            {titleCase(type)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Priority</span>
                      <select
                        value={draftPriority}
                        onChange={(event) => setDraftPriority(event.target.value)}
                      >
                        {['low', 'normal', 'high', 'urgent'].map((value) => (
                          <option key={value} value={value}>
                            {titleCase(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="form-actions">
                    <span className="muted">
                      Your changes will be saved against version {item.version}.
                    </span>
                    <button className="button button-primary" disabled={!dirty || busy === 'edit'}>
                      {busy === 'edit' ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="muted">Only the assignee and team admins can edit this item.</p>
              )}
            </section>

            <section className="panel timeline-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">COLLABORATION</p>
                  <h2>Activity history</h2>
                </div>
                <span className="count-pill">{timeline.length}</span>
              </div>
              {timeline.length === 0 ? (
                <p className="muted empty-timeline">No activity has been recorded yet.</p>
              ) : (
                <ol className="timeline">
                  {timeline.map((entry) =>
                    entry.kind === 'event' ? (
                      <li className="timeline-entry" key={`event-${entry.id}`}>
                        <span className="timeline-dot" />
                        <div className="timeline-copy">
                          <p>{eventSummary(entry.event) ?? 'Updated activity'}</p>
                          <small>
                            {entry.event.actor?.name ?? 'System'} · {timestamp(entry.at)}
                          </small>
                        </div>
                      </li>
                    ) : (
                      <li className="timeline-entry comment-entry" key={`comment-${entry.id}`}>
                        <span className="timeline-dot comment-dot" />
                        <div className="timeline-copy comment-copy">
                          <p>{entry.comment.body}</p>
                          <small>
                            {entry.comment.author.name} · {timestamp(entry.at)}
                          </small>
                        </div>
                      </li>
                    ),
                  )}
                </ol>
              )}
              {nextEventCursor && (
                <button
                  className="button button-secondary load-events-button"
                  disabled={loadingEvents}
                  onClick={loadEarlierEvents}
                >
                  {loadingEvents ? 'Loading…' : 'Load earlier activity'}
                </button>
              )}
            </section>

            <section className="panel comments-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">TEAM NOTES</p>
                  <h2>Comments</h2>
                </div>
                <span className="count-pill">{comments.length}</span>
              </div>
              {comments.length > 0 && (
                <ul className="comment-list">
                  {comments.map((comment) => (
                    <li key={comment.id}>
                      <div className="comment-meta">
                        <strong>{comment.author.name}</strong>
                        <time>{timestamp(comment.createdAt)}</time>
                      </div>
                      <p>{comment.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {member || admin ? (
                <form className="comment-form" onSubmit={addComment}>
                  <label className="sr-only" htmlFor="comment-body">
                    Add a comment
                  </label>
                  <textarea
                    id="comment-body"
                    rows={3}
                    maxLength={5000}
                    placeholder="Add context or a handoff note…"
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                  />
                  <div className="form-actions">
                    <span className="muted">Visible to members of {item.team.name}.</span>
                    <button
                      className="button button-dark"
                      disabled={!commentBody.trim() || busy === 'comment'}
                    >
                      {busy === 'comment' ? 'Adding…' : 'Add comment'}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="muted">Your team role is read-only.</p>
              )}
            </section>
          </section>
          <aside className="detail-side-column">
            <section className="panel next-step-card">
              <p className="eyebrow">NEXT ACTION</p>
              <h2>
                {item.status === 'closed'
                  ? 'Work is complete'
                  : item.status === 'resolved'
                    ? 'Ready for closure'
                    : item.status === 'blocked'
                      ? 'Needs an unblock'
                      : item.assignee
                        ? 'Move the work forward'
                        : 'Needs an owner'}
              </h2>
              <p>
                {item.status === 'closed'
                  ? 'This item has been closed.'
                  : item.status === 'resolved'
                    ? 'Review the outcome and close the item.'
                    : item.status === 'blocked'
                      ? 'Add a note about what is needed, then resume when ready.'
                      : item.assignee
                        ? 'Update progress and leave the next useful step for the team.'
                        : 'Claim the item or ask a team admin to assign it.'}
              </p>
              <div className="next-step-footer">
                <span>Created by</span>
                <strong>{item.creator?.name ?? 'Team member'}</strong>
              </div>
            </section>
            <section className="panel state-card">
              <p className="eyebrow">STATE</p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`status status-${item.status}`}>{titleCase(item.status)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>
                    <span className={`priority priority-${item.priority}`}>
                      {titleCase(item.priority)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Team</dt>
                  <dd>{item.team.name}</dd>
                </div>
                <div>
                  <dt>Item ID</dt>
                  <dd className="id-value">{item.id}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
