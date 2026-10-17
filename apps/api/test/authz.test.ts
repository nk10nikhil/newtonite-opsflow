import { describe, expect, it } from 'vitest';
import { canAssign, canClaim, canComment, canCreate, canEdit, canRead, canTransition } from '../src/authz/policies.js';

describe('team role policies', () => {
  it('keeps viewers read-only', () => {
    expect(canRead('viewer')).toBe(true);
    expect(canCreate('viewer')).toBe(false);
    expect(canComment('viewer')).toBe(false);
    expect(canClaim('viewer')).toBe(false);
    expect(canAssign('viewer')).toBe(false);
  });

  it('lets members edit work they own and limits reassignment to admins', () => {
    expect(canEdit({ role: 'member', userId: 'u1', assigneeId: 'u1' })).toBe(true);
    expect(canEdit({ role: 'member', userId: 'u1', assigneeId: 'u2' })).toBe(false);
    expect(canEdit({ role: 'admin', userId: 'u1', assigneeId: 'u2' })).toBe(true);
    expect(canAssign('member')).toBe(false);
    expect(canAssign('admin')).toBe(true);
  });

  it('allows only the assignee or team admin to resolve an in-progress item', () => {
    expect(canTransition({ role: 'member', userId: 'u1', assigneeId: 'u1' }, 'in_progress', 'resolved')).toBe(true);
    expect(canTransition({ role: 'member', userId: 'u1', assigneeId: 'u2' }, 'in_progress', 'resolved')).toBe(false);
    expect(canTransition({ role: 'viewer', userId: 'u1', assigneeId: 'u1' }, 'in_progress', 'resolved')).toBe(false);
    expect(canTransition({ role: 'admin', userId: 'u1', assigneeId: 'u2' }, 'in_progress', 'resolved')).toBe(true);
  });

  it('reserves reopening a closed item for team admins', () => {
    expect(canTransition({ role: 'member', userId: 'u1', assigneeId: 'u1' }, 'closed', 'open')).toBe(false);
    expect(canTransition({ role: 'admin', userId: 'u1', assigneeId: null }, 'closed', 'open')).toBe(true);
  });
});
