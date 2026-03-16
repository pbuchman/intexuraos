import { describe, it, expect } from 'vitest';
import { buildIssueTree } from '../../../domain/useCases/buildIssueTree.js';
import type { SyncedLinearIssue } from '../../../domain/models.js';

function makeSyncedIssue(overrides: Partial<SyncedLinearIssue> & { id: string }): SyncedLinearIssue {
  return {
    identifier: 'INT-1',
    title: 'Test',
    description: null,
    state: 'Backlog',
    stateType: 'backlog',
    priority: 0,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/test',
    userId: 'user-1',
    parentId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    syncedAt: '2025-01-01T00:00:00Z',
    teamId: 'team-1',
    ...overrides,
  };
}

describe('buildIssueTree', () => {
  it('returns null when root not found', () => {
    const issues = [makeSyncedIssue({ id: 'a' })];
    expect(buildIssueTree(issues, 'nonexistent')).toBeNull();
  });

  it('returns root with empty descendants when no children', () => {
    const issues = [makeSyncedIssue({ id: 'root' })];
    const result = buildIssueTree(issues, 'root');
    expect(result).not.toBeNull();
    expect(result?.root.id).toBe('root');
    expect(result?.descendants).toEqual([]);
  });

  it('includes direct children in descendants', () => {
    const issues = [
      makeSyncedIssue({ id: 'root' }),
      makeSyncedIssue({ id: 'child-1', parentId: 'root' }),
      makeSyncedIssue({ id: 'child-2', parentId: 'root' }),
    ];
    const result = buildIssueTree(issues, 'root');
    expect(result?.descendants).toHaveLength(2);
    const ids = result?.descendants.map((d) => d.id).sort();
    expect(ids).toEqual(['child-1', 'child-2']);
  });

  it('includes grandchildren in descendants', () => {
    const issues = [
      makeSyncedIssue({ id: 'root' }),
      makeSyncedIssue({ id: 'child', parentId: 'root' }),
      makeSyncedIssue({ id: 'grandchild', parentId: 'child' }),
    ];
    const result = buildIssueTree(issues, 'root');
    expect(result?.descendants).toHaveLength(2);
    const ids = result?.descendants.map((d) => d.id);
    expect(ids).toEqual(['child', 'grandchild']);
  });

  it('does not include unrelated issues', () => {
    const issues = [
      makeSyncedIssue({ id: 'root' }),
      makeSyncedIssue({ id: 'child', parentId: 'root' }),
      makeSyncedIssue({ id: 'unrelated', parentId: 'other-root' }),
    ];
    const result = buildIssueTree(issues, 'root');
    expect(result?.descendants).toHaveLength(1);
    const firstDescendant = result?.descendants[0];
    expect(firstDescendant?.id).toBe('child');
  });

  it('handles empty issue list', () => {
    expect(buildIssueTree([], 'root')).toBeNull();
  });
});
