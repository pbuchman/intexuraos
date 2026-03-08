/**
 * Tests for listIssues use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LinearConnection, LinearIssue, SyncedLinearIssue } from '../../../domain/models.js';
import {
  listIssues,
  type ListIssuesRequest,
} from '../../../domain/useCases/listIssues.js';
import {
  FakeLinearConnectionRepository,
  FakeLinearIssueRepository,
} from '../../fakes.js';

describe('listIssues', () => {
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeIssueRepo: FakeLinearIssueRepository;

  beforeEach(() => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeIssueRepo = new FakeLinearIssueRepository();
  });

  afterEach(() => {
    fakeConnectionRepo.reset();
    fakeIssueRepo.reset();
  });

  const defaultRequest: ListIssuesRequest = {
    userId: 'user-456',
  };

  function setupConnectedUser(): void {
    const connection: LinearConnection = {
      userId: 'user-456',
      apiKey: 'linear-api-key',
      teamId: 'team-789',
      teamName: 'Engineering',
      webhookSecret: null,
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    fakeConnectionRepo.seedConnection(connection);
  }

  /**
   * Convert LinearIssue test fixture to SyncedLinearIssue Firestore format
   */
  function toSyncedIssue(issue: LinearIssue, userId: string): SyncedLinearIssue {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state.name,
      stateType: issue.state.type,
      priority: issue.priority,
      assigneeId: null,
      assigneeName: null,
      labels: issue.labels,
      url: issue.url,
      userId,
      parentId: issue.parentId ?? null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      syncedAt: new Date().toISOString(),
      teamId: 'team-789',
    };
  }

  function seedIssue(issue: LinearIssue): void {
    const synced = toSyncedIssue(issue, 'user-456');
    fakeIssueRepo.seedIssue(synced);
  }

  function createIssue(overrides: Partial<LinearIssue>): LinearIssue {
    const now = new Date().toISOString();
    return {
      id: `issue-${Math.random()}`,
      identifier: `ENG-${Math.floor(Math.random() * 1000)}`,
      title: 'Test Issue',
      description: null,
      priority: 0,
      state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
      url: 'https://linear.app/issue/test',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      childCount: 0,
      children: [],
      labels: [],
      ...overrides,
    };
  }

  describe('successful grouping', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('groups issues by dashboard column', async () => {
      const today = new Date();

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Backlog Issue',
          state: { id: 's1', name: 'Backlog', type: 'backlog' },
          updatedAt: today.toISOString(),
        })
      );

      seedIssue(
        createIssue({
          id: 'issue-2',
          title: 'In Progress Issue',
          state: { id: 's2', name: 'In Progress', type: 'started' },
          updatedAt: today.toISOString(),
        })
      );

      seedIssue(
        createIssue({
          id: 'issue-3',
          title: 'In Review Issue',
          state: { id: 's3', name: 'In Review', type: 'started' },
          updatedAt: today.toISOString(),
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.teamName).toBe('Engineering');
        expect(result.value.issues.backlog).toHaveLength(1);
        expect(result.value.issues.backlog[0]?.title).toBe('Backlog Issue');
        expect(result.value.issues.in_progress).toHaveLength(1);
        expect(result.value.issues.in_progress[0]?.title).toBe('In Progress Issue');
        expect(result.value.issues.in_review).toHaveLength(1);
        expect(result.value.issues.in_review[0]?.title).toBe('In Review Issue');
      }
    });

    it('sorts each column by updatedAt descending', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Old Issue',
          state: { id: 's1', name: 'Backlog', type: 'backlog' },
          updatedAt: twoDaysAgo.toISOString(),
        })
      );

      seedIssue(
        createIssue({
          id: 'issue-2',
          title: 'New Issue',
          state: { id: 's2', name: 'Backlog', type: 'backlog' },
          updatedAt: today.toISOString(),
        })
      );

      seedIssue(
        createIssue({
          id: 'issue-3',
          title: 'Middle Issue',
          state: { id: 's3', name: 'Backlog', type: 'backlog' },
          updatedAt: yesterday.toISOString(),
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      if (result.ok) {
        expect(result.value.issues.backlog).toHaveLength(3);
        expect(result.value.issues.backlog[0]?.title).toBe('New Issue');
        expect(result.value.issues.backlog[1]?.title).toBe('Middle Issue');
        expect(result.value.issues.backlog[2]?.title).toBe('Old Issue');
      }
    });
  });

  describe('done column filtering', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('puts recent completed issues in done column', async () => {
      const today = new Date();

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Recently Completed',
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: today.toISOString(),
          updatedAt: today.toISOString(),
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      if (result.ok) {
        expect(result.value.issues.done).toHaveLength(1);
        expect(result.value.issues.done[0]?.title).toBe('Recently Completed');
        expect(result.value.issues.archive).toHaveLength(0);
      }
    });

    it('puts old completed issues in archive column', async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Old Completed',
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: tenDaysAgo.toISOString(),
          updatedAt: tenDaysAgo.toISOString(),
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      if (result.ok) {
        expect(result.value.issues.done).toHaveLength(0);
        expect(result.value.issues.archive).toHaveLength(1);
        expect(result.value.issues.archive[0]?.title).toBe('Old Completed');
      }
    });

    it('handles completed issues without completedAt timestamp', async () => {
      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Done without timestamp',
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: null,
          updatedAt: new Date().toISOString(),
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      if (result.ok) {
        expect(result.value.issues.done).toHaveLength(1);
        expect(result.value.issues.archive).toHaveLength(0);
      }
    });

    it('excludes archive when includeArchive=false', async () => {
      const today = new Date();
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(today.getDate() - 10);

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Recent Done',
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: today.toISOString(),
          updatedAt: today.toISOString(),
        })
      );

      seedIssue(
        createIssue({
          id: 'issue-2',
          title: 'Old Done',
          state: { id: 's2', name: 'Done', type: 'completed' },
          completedAt: tenDaysAgo.toISOString(),
          updatedAt: tenDaysAgo.toISOString(),
        })
      );

      const result = await listIssues(
        { userId: 'user-456', includeArchive: false },
        {
          issueRepository: fakeIssueRepo,
          connectionRepository: fakeConnectionRepo,
        }
      );

      if (result.ok) {
        expect(result.value.issues.done).toHaveLength(1);
        expect(result.value.issues.archive).toHaveLength(0);
      }
    });
  });

  describe('labels', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('includes labels in returned issues', async () => {
      const today = new Date();

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Issue with labels',
          state: { id: 's1', name: 'Todo', type: 'unstarted' },
          updatedAt: today.toISOString(),
          labels: [
            { id: 'label-1', name: 'bug', color: '#ff0000' },
            { id: 'label-2', name: 'frontend', color: '#00ff00' },
          ],
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issues.todo).toHaveLength(1);
        const issue = result.value.issues.todo[0];
        expect(issue?.labels).toEqual([
          { id: 'label-1', name: 'bug', color: '#ff0000' },
          { id: 'label-2', name: 'frontend', color: '#00ff00' },
        ]);
      }
    });

    it('handles issues with no labels', async () => {
      const today = new Date();

      seedIssue(
        createIssue({
          id: 'issue-1',
          title: 'Issue without labels',
          state: { id: 's1', name: 'Todo', type: 'unstarted' },
          updatedAt: today.toISOString(),
          labels: [],
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issues.todo).toHaveLength(1);
        expect(result.value.issues.todo[0]?.labels).toEqual([]);
      }
    });
  });

  describe('error cases', () => {
    it('returns error when connection repository fails', async () => {
      fakeConnectionRepo.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database error',
      });

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database error');
      }
    });

    it('returns NOT_CONNECTED error when user has no connection', async () => {
      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toContain('not connected');
      }
    });

    it('returns error when issue repository fails', async () => {
      setupConnectedUser();
      fakeIssueRepo.setListByUserIdFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database read error',
      });

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database read error');
      }
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('returns empty columns when no issues exist', async () => {
      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issues.backlog).toHaveLength(0);
        expect(result.value.issues.in_progress).toHaveLength(0);
        expect(result.value.issues.in_review).toHaveLength(0);
        expect(result.value.issues.done).toHaveLength(0);
        expect(result.value.issues.archive).toHaveLength(0);
      }
    });
  });

  describe('parent-child relationships', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('attaches children to parent issues', async () => {
      const today = new Date();

      // Create parent issue
      seedIssue(
        createIssue({
          id: 'parent-1',
          identifier: 'ENG-100',
          title: 'Parent Issue',
          state: { id: 's1', name: 'In Progress', type: 'started' },
          updatedAt: today.toISOString(),
          parentId: null,
        })
      );

      // Create child issues
      seedIssue(
        createIssue({
          id: 'child-1',
          identifier: 'ENG-101',
          title: 'Child Issue 1',
          state: { id: 's2', name: 'Todo', type: 'unstarted' },
          updatedAt: today.toISOString(),
          parentId: 'parent-1',
        })
      );

      seedIssue(
        createIssue({
          id: 'child-2',
          identifier: 'ENG-102',
          title: 'Child Issue 2',
          state: { id: 's3', name: 'Done', type: 'completed' },
          updatedAt: today.toISOString(),
          parentId: 'parent-1',
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Parent should be in in_progress column
        expect(result.value.issues.in_progress).toHaveLength(1);
        const parent = result.value.issues.in_progress[0];
        expect(parent?.id).toBe('parent-1');
        expect(parent?.childCount).toBe(2);
        expect(parent?.children).toHaveLength(2);
        expect(parent?.children[0]?.id).toBe('child-1');
        expect(parent?.children[1]?.id).toBe('child-2');

        // Children should appear in their respective state columns (alongside parents)
        expect(result.value.issues.todo).toHaveLength(1);
        expect(result.value.issues.todo[0]?.id).toBe('child-1');
        expect(result.value.issues.done).toHaveLength(1);
        expect(result.value.issues.done[0]?.id).toBe('child-2');
      }
    });

    it('handles children with missing parents', async () => {
      const today = new Date();

      // Create child with non-existent parent
      seedIssue(
        createIssue({
          id: 'orphan-1',
          identifier: 'ENG-200',
          title: 'Orphan Issue',
          state: { id: 's1', name: 'Backlog', type: 'backlog' },
          updatedAt: today.toISOString(),
          parentId: 'nonexistent-parent',
        })
      );

      const result = await listIssues(defaultRequest, {
        issueRepository: fakeIssueRepo,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Orphan (child with missing parent) should appear in its state column
        expect(result.value.issues.backlog).toHaveLength(1);
        expect(result.value.issues.backlog[0]?.id).toBe('orphan-1');
      }
    });

  });
});
