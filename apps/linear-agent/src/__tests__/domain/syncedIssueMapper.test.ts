/**
 * Tests for syncedIssueMapper.ts
 */
import { describe, expect, it } from 'vitest';
import type { SyncedLinearIssue } from '../../domain/models.js';
import { syncedToLinearIssue } from '../../domain/syncedIssueMapper.js';

describe('syncedToLinearIssue', () => {
  const baseSynced: SyncedLinearIssue = {
    id: 'issue-123',
    identifier: 'ENG-123',
    title: 'Test Issue',
    description: 'Test description',
    state: 'In Progress',
    stateType: 'started',
    priority: 2,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/issue/ENG-123',
    userId: 'user-456',
    parentId: null,
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-16T00:00:00Z',
    syncedAt: '2025-01-16T12:00:00Z',
    teamId: 'team-789',
  };

  it('maps all fields correctly when all fields are populated', () => {
    const synced: SyncedLinearIssue = {
      ...baseSynced,
      assigneeId: 'user-999',
      assigneeName: 'John Doe',
      labels: [
        { id: 'label-1', name: 'bug', color: '#ff0000' },
        { id: 'label-2', name: 'frontend', color: '#00ff00' },
      ],
    };

    const result = syncedToLinearIssue(synced);

    expect(result.id).toBe('issue-123');
    expect(result.identifier).toBe('ENG-123');
    expect(result.title).toBe('Test Issue');
    expect(result.description).toBe('Test description');
    expect(result.priority).toBe(2);
    expect(result.state).toEqual({
      id: '',
      name: 'In Progress',
      type: 'started',
    });
    expect(result.assignee).toEqual({ id: 'user-999', name: 'John Doe' });
    expect(result.url).toBe('https://linear.app/issue/ENG-123');
    expect(result.createdAt).toBe('2025-01-15T00:00:00Z');
    expect(result.updatedAt).toBe('2025-01-16T00:00:00Z');
    expect(result.completedAt).toBeNull();
    expect(result.parentId).toBeNull();
    expect(result.childCount).toBe(0);
    expect(result.children).toEqual([]);
    expect(result.labels).toEqual([
      { id: 'label-1', name: 'bug', color: '#ff0000' },
      { id: 'label-2', name: 'frontend', color: '#00ff00' },
    ]);
  });

  it('maps with null assignee', () => {
    const synced: SyncedLinearIssue = {
      ...baseSynced,
      assigneeId: null,
      assigneeName: null,
    };

    const result = syncedToLinearIssue(synced);

    expect(result.assignee).toBeNull();
  });

  it('maps with null assigneeName but non-null assigneeId', () => {
    // This tests the v8 ignore branch where assigneeName could theoretically be null
    const synced: SyncedLinearIssue = {
      ...baseSynced,
      assigneeId: 'user-999',
      assigneeName: null, // Should not happen in practice but possible per type
    };

    const result = syncedToLinearIssue(synced);

    expect(result.assignee).toEqual({ id: 'user-999', name: '' });
  });
});
