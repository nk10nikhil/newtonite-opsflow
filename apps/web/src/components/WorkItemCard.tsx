import type { WorkItem } from '../api/client';

const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

export function WorkItemCard({ item, onOpen }: { item: WorkItem; onOpen: (id: string) => void }) {
  return (
    <article className="work-card">
      <a className="work-card-main" href={`/work-items/${item.id}`} onClick={(event) => { event.preventDefault(); onOpen(item.id); }}>
        <div className="work-card-heading">
          <h3>{item.title}</h3>
          <span className={`priority priority-${item.priority}`}>{titleCase(item.priority)}</span>
        </div>
        <p className="work-card-description">{item.description || 'No description provided.'}</p>
        <div className="work-card-meta">
          <span>{item.team?.name ?? 'Team'}</span>
          <span>{titleCase(item.type)}</span>
          <span>Updated {new Date(item.updatedAt).toLocaleString()}</span>
        </div>
      </a>
      <div className="work-card-side">
        <span className={`status status-${item.status}`}>{titleCase(item.status)}</span>
        <span className="assignee-name">{item.assignee?.name ?? 'Unassigned'}</span>
        <small>v{item.version}</small>
      </div>
    </article>
  );
}
