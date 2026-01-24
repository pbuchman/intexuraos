import { describe, expect, it } from 'vitest';
import { mapStateToDashboardColumn, type IssueStateCategory } from '../../domain/models.js';

describe('mapStateToDashboardColumn', () => {
  it('maps backlog state to backlog column', () => {
    expect(mapStateToDashboardColumn('backlog', 'Backlog')).toBe('backlog');
  });

  it('maps unstarted state with Todo name to todo column', () => {
    expect(mapStateToDashboardColumn('unstarted', 'Todo')).toBe('todo');
  });

  it('maps unstarted state with Backlog name to backlog column', () => {
    expect(mapStateToDashboardColumn('unstarted', 'Backlog')).toBe('backlog');
  });

  it('maps unstarted state to todo column (default)', () => {
    expect(mapStateToDashboardColumn('unstarted', 'Some Unstarted')).toBe('todo');
  });

  it('maps started state to in_progress column', () => {
    expect(mapStateToDashboardColumn('started', 'In Progress')).toBe('in_progress');
  });

  it('maps started state with review name to in_review column', () => {
    expect(mapStateToDashboardColumn('started', 'In Review')).toBe('in_review');
    expect(mapStateToDashboardColumn('started', 'Code Review')).toBe('in_review');
    expect(mapStateToDashboardColumn('started', 'REVIEW')).toBe('in_review');
  });

  it('maps started state with test/qa name to to_test column', () => {
    expect(mapStateToDashboardColumn('started', 'To Test')).toBe('to_test');
    expect(mapStateToDashboardColumn('started', 'Testing')).toBe('to_test');
    expect(mapStateToDashboardColumn('started', 'QA')).toBe('to_test');
    expect(mapStateToDashboardColumn('started', 'Quality Assurance')).toBe('to_test');
  });

  it('maps completed state to done column', () => {
    expect(mapStateToDashboardColumn('completed', 'Done')).toBe('done');
  });

  it('maps cancelled state to done column', () => {
    expect(mapStateToDashboardColumn('cancelled', 'Cancelled')).toBe('done');
  });

  it('maps unknown state type to todo (default)', () => {
    const unknownType = 'unknown_state' as IssueStateCategory;
    expect(mapStateToDashboardColumn(unknownType, 'Some State')).toBe('todo');
  });
});
