import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  apiFetch,
  clearMutationKey,
  fetchTeamMembers,
  fetchTeams,
  fetchWorkItems,
  type Me,
  type TeamMember,
  type WorkItem,
  type WorkItemFilters,
} from '../api/client';
import { withIdempotency } from '../api/client';
import { FilterBar } from '../components/FilterBar';
import { WorkItemCard } from '../components/WorkItemCard';

type TeamOption = { id: string; name: string; slug: string; role: string };
type ViewName = 'my-work' | 'unassigned-urgent' | 'recently-updated' | 'custom';

const viewLabel: Record<ViewName, string> = {
  'my-work': 'My work',
  'unassigned-urgent': 'Unassigned urgent',
  'recently-updated': 'Recently updated',
  custom: 'Filtered results',
};

function filtersFromParams(params: URLSearchParams, me: Me): WorkItemFilters {
  const view = (params.get('view') as ViewName | null) ?? 'recently-updated';
  return {
    teamId: params.get('teamId') || undefined,
    status: (params.get('status') as WorkItemFilters['status']) || undefined,
    priority:
      view === 'unassigned-urgent'
        ? 'urgent'
        : (params.get('priority') as WorkItemFilters['priority']) || undefined,
    assigneeId: view === 'my-work' ? me.id : params.get('assigneeId') || undefined,
    unassigned: view === 'unassigned-urgent' || params.get('unassigned') === 'true' || undefined,
    q: params.get('q') || undefined,
    limit: 25,
  };
}

export function Dashboard({
  me,
  onOpenItem,
  onLogout,
}: {
  me: Me;
  onOpenItem: (id: string) => void;
  onLogout: () => void;
}) {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [assignees, setAssignees] = useState<TeamMember[]>([]);
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));
  const [items, setItems] = useState<WorkItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState('');
  const [itemType, setItemType] = useState('customer_issue');
  const [priority, setPriority] = useState('normal');

  useEffect(() => {
    const onPopState = () => setParams(new URLSearchParams(window.location.search));
    window.addEventListener('popstate', onPopState);
    if (!params.get('view')) {
      const initial = new URLSearchParams(params);
      initial.set('view', 'recently-updated');
      history.replaceState(null, '', `${location.pathname}?${initial.toString()}`);
      setParams(initial);
    }
    fetchTeams()
      .then(({ teams: result }) => {
        setTeams(result);
        const firstWritable = result.find(
          (team) => team.role === 'admin' || team.role === 'member',
        );
        if (firstWritable) setTeamId(firstWritable.id);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not load teams.'),
      );
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectedTeamId = params.get('teamId') ?? '';
  useEffect(() => {
    if (!selectedTeamId) {
      setAssignees([{ id: me.id, name: me.name, email: me.email, role: 'member' }]);
      return;
    }
    let active = true;
    fetchTeamMembers(selectedTeamId)
      .then(({ members }) => {
        if (active) setAssignees(members);
      })
      .catch(() => {
        if (active) setAssignees([]);
      });
    return () => {
      active = false;
    };
  }, [selectedTeamId, me.id, me.name, me.email]);

  const filters = useMemo(() => filtersFromParams(params, me), [params, me]);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setItems([]);
    setNextCursor(null);
    fetchWorkItems(filters)
      .then((result) => {
        if (!current) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : 'Could not load work items.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filterKey, reload]);

  function updateParams(mutator: (next: URLSearchParams) => void, markCustom = true) {
    const next = new URLSearchParams(params);
    if (markCustom) {
      const currentView = params.get('view');
      if (currentView === 'unassigned-urgent') {
        next.set('unassigned', 'true');
        if (!next.has('priority')) next.set('priority', 'urgent');
      }
      if (currentView === 'my-work') next.set('assigneeId', me.id);
      next.set('view', 'custom');
    }
    mutator(next);
    next.delete('cursor');
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
    setParams(next);
  }

  function selectView(view: Exclude<ViewName, 'custom'>) {
    const next = new URLSearchParams();
    next.set('view', view);
    history.replaceState(null, '', `${location.pathname}?${next.toString()}`);
    setParams(next);
  }

  function selectAssignee(value: string) {
    updateParams((next) => {
      next.delete('assigneeId');
      next.delete('unassigned');
      if (value === '__unassigned__') next.set('unassigned', 'true');
      else if (value) next.set('assigneeId', value);
    });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await fetchWorkItems({ ...filters, cursor: nextCursor });
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more work items.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function createWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    const body = { teamId, title, description, type: itemType, priority };
    try {
      const result = await apiFetch<{ item: WorkItem }>('/work-items', {
        method: 'POST',
        headers: withIdempotency('create-work-item', body),
        body: JSON.stringify(body),
      });
      clearMutationKey('create-work-item', body);
      setCreateOpen(false);
      onOpenItem(result.item.id);
    } catch (cause) {
      setCreateError(
        cause instanceof Error
          ? cause.message
          : 'Could not create this work item. Retry to reuse the same request key.',
      );
    } finally {
      setCreating(false);
    }
  }

  const writableTeams = teams.filter((team) => team.role === 'member' || team.role === 'admin');
  const view = (params.get('view') as ViewName | null) ?? 'recently-updated';
  const filterValues = {
    teamId: params.get('teamId') ?? '',
    status: params.get('status') ?? '',
    priority: view === 'unassigned-urgent' ? 'urgent' : (params.get('priority') ?? ''),
    q: params.get('q') ?? '',
    assigneeId: view === 'my-work' ? me.id : (params.get('assigneeId') ?? ''),
    unassigned: view === 'unassigned-urgent' || params.get('unassigned') === 'true',
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          href="/"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            history.replaceState(null, '', '/');
            selectView('recently-updated');
          }}
        >
          <span className="brand-mark">O</span>
          <span>OpsFlow</span>
        </a>
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
      <main className="dashboard-layout">
        <aside className="sidebar" aria-label="Saved views">
          <p className="eyebrow">WORKSPACE</p>
          <h2>My queue</h2>
          <nav className="saved-views">
            {(['my-work', 'unassigned-urgent', 'recently-updated'] as const).map((value) => (
              <button
                key={value}
                className={view === value ? 'saved-view active' : 'saved-view'}
                onClick={() => selectView(value)}
              >
                <span className="view-icon">
                  {value === 'my-work' ? '◉' : value === 'unassigned-urgent' ? '!' : '↻'}
                </span>
                {viewLabel[value]}
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <strong>Shared work, clear ownership.</strong>
            <span>Updates are recorded in the item timeline.</span>
          </div>
        </aside>

        <section className="dashboard-content" aria-labelledby="dashboard-title">
          <div className="page-heading">
            <div>
              <p className="eyebrow">OPERATIONS WORKSPACE</p>
              <h1 id="dashboard-title">{viewLabel[view]}</h1>
              <p className="page-subtitle">Find the next action and keep every handoff visible.</p>
            </div>
            {writableTeams.length > 0 && (
              <button className="button button-primary" onClick={() => setCreateOpen(true)}>
                ＋ New work item
              </button>
            )}
          </div>

          <FilterBar
            teams={teams}
            assignees={assignees}
            values={filterValues}
            onChange={(key, value) =>
              updateParams((next) => (value ? next.set(key, value) : next.delete(key)))
            }
            onAssigneeChange={selectAssignee}
            onSearch={(value) =>
              updateParams((next) => (value ? next.set('q', value) : next.delete('q')))
            }
          />

          <div className="results-heading">
            <h2>
              Work items{' '}
              <span className="count-pill">
                {items.length}
                {nextCursor ? '+' : ''}
              </span>
            </h2>
            <span className="muted">Sorted by latest update</span>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              <span>{error}</span>
              <button
                className="button button-quiet"
                onClick={() => setReload((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-panel" role="status">
              <span className="spinner" />
              Loading work items…
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">⌕</span>
              <h3>No work items match this view</h3>
              <p>Try another filter or create a new item for your team.</p>
              {writableTeams.length > 0 && (
                <button className="button button-dark" onClick={() => setCreateOpen(true)}>
                  Create work item
                </button>
              )}
            </div>
          ) : (
            <div className="work-list" aria-live="polite">
              {items.map((item) => (
                <WorkItemCard key={item.id} item={item} onOpen={onOpenItem} />
              ))}
            </div>
          )}
          {!loading && nextCursor && (
            <div className="load-more-row">
              <button className="button button-secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      </main>

      {createOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreateOpen(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">NEW REQUEST</p>
                <h2 id="create-title">Create work item</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setCreateOpen(false)}
              >
                ×
              </button>
            </div>
            <form className="form-stack" onSubmit={createWorkItem}>
              <label>
                <span>Title</span>
                <input
                  required
                  maxLength={240}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                />
              </label>
              <label>
                <span>Why does this need attention?</span>
                <textarea
                  rows={4}
                  maxLength={10_000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="form-row">
                <label>
                  <span>Team</span>
                  <select
                    required
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                  >
                    {writableTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Type</span>
                  <select value={itemType} onChange={(event) => setItemType(event.target.value)}>
                    {[
                      'customer_issue',
                      'incident',
                      'payment_investigation',
                      'compliance_request',
                      'approval',
                      'task',
                    ].map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                    {['low', 'normal', 'high', 'urgent'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              {createError && (
                <p className="form-error" role="alert">
                  {createError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={creating || writableTeams.length === 0}
                >
                  {creating ? 'Creating…' : 'Create item'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
