/**
 * Tests for issueTreeBuilder.ts
 */
import { describe, expect, it } from 'vitest';
import type { SyncedLinearIssue } from '../../domain/models.js';
import { buildIssueHierarchy } from '../../domain/issueTreeBuilder.js';

function makeSynced(overrides: Partial<SyncedLinearIssue> = {}): SyncedLinearIssue {
  const id = overrides.id ?? `issue-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    identifier: `ENG-${id.slice(-3)}`,
    title: 'Test Issue',
    description: null,
    state: 'Backlog',
    stateType: 'backlog',
    priority: 0,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: `https://linear.app/${id}`,
    userId: 'user-456',
    parentId: null,
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
    syncedAt: '2025-01-15T00:00:00Z',
    teamId: 'team-789',
    ...overrides,
  };
}

describe('buildIssueHierarchy', () => {
  it('handles flat list (all top-level issues)', () => {
    const syncedIssues: SyncedLinearIssue[] = [
      makeSynced({ id: 'issue-1', title: 'Issue 1' }),
      makeSynced({ id: 'issue-2', title: 'Issue 2' }),
      makeSynced({ id: 'issue-3', title: 'Issue 3' }),
    ];

    const result = buildIssueHierarchy(syncedIssues);

    expect(result.topLevel).toHaveLength(3);
    expect(result.subtasks).toHaveLength(0);
    expect(result.all).toHaveLength(3);
    expect(result.topLevel[0]?.title).toBe('Issue 1');
    expect(result.topLevel[1]?.title).toBe('Issue 2');
    expect(result.topLevel[2]?.title).toBe('Issue 3');
  });

  it('builds parent-child relationships correctly', () => {
    const parent = makeSynced({ id: 'parent-1', title: 'Parent Issue', parentId: null });
    const child1 = makeSynced({
      id: 'child-1',
      title: 'Child 1',
      parentId: 'parent-1',
    });
    const child2 = makeSynced({
      id: 'child-2',
      title: 'Child 2',
      parentId: 'parent-1',
    });

    const syncedIssues: SyncedLinearIssue[] = [parent, child1, child2];

    const result = buildIssueHierarchy(syncedIssues);

    expect(result.topLevel).toHaveLength(1);
    expect(result.subtasks).toHaveLength(2);
    expect(result.all).toHaveLength(3);

    // Parent should have children attached
    const parentResult = result.topLevel[0];
    expect(parentResult?.id).toBe('parent-1');
    expect(parentResult?.childCount).toBe(2);
    expect(parentResult?.children).toHaveLength(2);
    expect(parentResult?.children[0]?.id).toBe('child-1');
    expect(parentResult?.children[1]?.id).toBe('child-2');
  });

  it('handles empty input', () => {
    const result = buildIssueHierarchy([]);

    expect(result.topLevel).toHaveLength(0);
    expect(result.subtasks).toHaveLength(0);
    expect(result.all).toHaveLength(0);
  });

  it('handles children with missing parents (orphans)', () => {
    const orphan = makeSynced({
      id: 'orphan-1',
      title: 'Orphan Issue',
      parentId: 'nonexistent-parent',
    });

    const result = buildIssueHierarchy([orphan]);

    // Orphan is treated as subtask since it has parentId !== null
    expect(result.topLevel).toHaveLength(0);
    expect(result.subtasks).toHaveLength(1);
    expect(result.all).toHaveLength(1);
    expect(result.subtasks[0]?.id).toBe('orphan-1');
  });

  it('handles mixed top-level and child issues', () => {
    const topLevel1 = makeSynced({ id: 'tl-1', title: 'Top Level 1', parentId: null });
    const topLevel2 = makeSynced({ id: 'tl-2', title: 'Top Level 2', parentId: null });
    const child1 = makeSynced({ id: 'c-1', title: 'Child 1', parentId: 'tl-1' });
    const child2 = makeSynced({ id: 'c-2', title: 'Child 2', parentId: 'tl-2' });

    const result = buildIssueHierarchy([topLevel1, topLevel2, child1, child2]);

    expect(result.topLevel).toHaveLength(2);
    expect(result.subtasks).toHaveLength(2);
    expect(result.all).toHaveLength(4);

    // Each parent should have its child attached
    expect(result.topLevel[0]?.children).toHaveLength(1);
    expect(result.topLevel[0]?.children[0]?.id).toBe('c-1');
    expect(result.topLevel[1]?.children).toHaveLength(1);
    expect(result.topLevel[1]?.children[0]?.id).toBe('c-2');
  });
});
