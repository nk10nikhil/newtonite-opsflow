import { describe, expect, it } from 'vitest';
import { allowedTransitions, isLegalTransition } from '../src/modules/work-items/workflow.js';

describe('work item transition matrix', () => {
  it('allows only the documented transitions', () => {
    expect(allowedTransitions('open')).toEqual(['in_progress']);
    expect(isLegalTransition('in_progress', 'blocked')).toBe(true);
    expect(isLegalTransition('in_progress', 'resolved')).toBe(true);
    expect(isLegalTransition('resolved', 'closed')).toBe(true);
    expect(isLegalTransition('resolved', 'in_progress')).toBe(true);
    expect(isLegalTransition('closed', 'open')).toBe(true);
  });

  it('rejects skipped and backwards transitions', () => {
    expect(isLegalTransition('open', 'resolved')).toBe(false);
    expect(isLegalTransition('closed', 'in_progress')).toBe(false);
    expect(isLegalTransition('blocked', 'resolved')).toBe(false);
  });
});
