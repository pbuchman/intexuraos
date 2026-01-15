import { describe, expect, it } from 'vitest';
import { mapStateToDashboardColumn, type IssueStateCategory } from '../../domain/models.js';

describe('mapStateToDashboardColumn', () => {
  it('maps backlog state to backlog column', () => {
    expect(mapStateToDashboardColumn('backlog', 'Backlog')).toBe('backlog');
  });

  it('maps unstarted state to backlog column', () => {
    expect(mapStateToDashboardColumn('unstarted', 'Todo')).toBe('backlog');
  });

  it('maps started state to in_progress column', () => {
    expect(mapStateToDashboardColumn('started', 'In Progress')).toBe('in_progress');
  });

  it('maps started state with review name to in_review column', () => {
    expect(mapStateToDashboardColumn('started', 'In Review')).toBe('in_review');
    expect(mapStateToDashboardColumn('started', 'Code Review')).toBe('in_review');
    expect(mapStateToDashboardColumn('started', 'REVIEW')).toBe('in_review');
  });

  it('maps completed state to done column', () => {
    expect(mapStateToDashboardColumn('completed', 'Done')).toBe('done');
  });

  it('maps cancelled state to done column', () => {
    expect(mapStateToDashboardColumn('cancelled', 'Cancelled')).toBe('done');
  });

  it('maps unknown state type to backlog (default)', () => {
    const unknownType = 'unknown_state' as IssueStateCategory;
    expect(mapStateToDashboardColumn(unknownType, 'Some State')).toBe('backlog');
  });
});
