import { describe, it, expect } from 'vitest';
import { STATE_NAME_MAP, findStateId } from '../../domain/stateUtils.js';

describe('STATE_NAME_MAP', () => {
  it('contains all expected state keys', () => {
    expect(STATE_NAME_MAP).toEqual({
      backlog: 'Backlog',
      todo: 'Todo',
      in_progress: 'In Progress',
      in_review: 'In Review',
      qa: 'QA',
      done: 'Done',
    });
  });
});

describe('findStateId', () => {
  const states = [
    { id: 'state-1', name: 'Backlog', type: 'backlog' },
    { id: 'state-2', name: 'Todo', type: 'unstarted' },
    { id: 'state-3', name: 'In Progress', type: 'started' },
  ];

  it('finds state by exact name match', () => {
    expect(findStateId(states, 'Backlog')).toBe('state-1');
  });

  it('finds state by case-insensitive match', () => {
    expect(findStateId(states, 'backlog')).toBe('state-1');
    expect(findStateId(states, 'IN PROGRESS')).toBe('state-3');
  });

  it('returns null when no match found', () => {
    expect(findStateId(states, 'Nonexistent')).toBeNull();
  });

  it('returns null for empty states array', () => {
    expect(findStateId([], 'Backlog')).toBeNull();
  });
});
