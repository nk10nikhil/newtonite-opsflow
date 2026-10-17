import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Membership, TeamMember } from '../api/client';
import type { WorkItemPriority, WorkItemStatus } from '@opsdesk/contracts';

type Props = {
  teams: Membership['team'][];
  assignees: TeamMember[];
  values: { teamId: string; status: string; priority: string; q: string; assigneeId: string; unassigned: boolean };
  onChange: (key: 'teamId' | 'status' | 'priority', value: string) => void;
  onAssigneeChange: (value: string) => void;
  onSearch: (value: string) => void;
};

export function FilterBar({ teams, assignees, values, onChange, onAssigneeChange, onSearch }: Props) {
  const [search, setSearch] = useState(values.q);
  useEffect(() => setSearch(values.q), [values.q]);
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(search);
  }

  return (
    <div className="filter-bar">
      <form className="search-form" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="work-search">Search work items</label>
        <input id="work-search" name="q" type="search" placeholder="Search title or description" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="button button-dark" type="submit">Search</button>
      </form>
      <label>
        <span>Team</span>
        <select value={values.teamId} onChange={(event) => onChange('teamId', event.target.value)}>
          <option value="">All my teams</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <label>
        <span>Status</span>
        <select value={values.status} onChange={(event) => onChange('status', event.target.value)}>
          <option value="">All statuses</option>
          {(['open', 'in_progress', 'blocked', 'resolved', 'closed'] as WorkItemStatus[]).map((value) => (
            <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Priority</span>
        <select value={values.priority} onChange={(event) => onChange('priority', event.target.value)}>
          <option value="">All priorities</option>
          {(['urgent', 'high', 'normal', 'low'] as WorkItemPriority[]).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Assignee</span>
        <select value={values.unassigned ? '__unassigned__' : values.assigneeId} onChange={(event) => onAssigneeChange(event.target.value)}>
          <option value="">All assignees</option>
          <option value="__unassigned__">Unassigned</option>
          {assignees.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role === 'viewer' ? ' · viewer' : ''}</option>)}
        </select>
      </label>
    </div>
  );
}
