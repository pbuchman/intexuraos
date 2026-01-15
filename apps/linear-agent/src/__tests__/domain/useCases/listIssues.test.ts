/**
 * Tests for listIssues use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LinearConnection, LinearIssue } from '../../../domain/models.js';
import {
  listIssues,
  type ListIssuesRequest,
} from '../../../domain/useCases/listIssues.js';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
} from '../../fakes.js';

describe('listIssues', () => {
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeLinearClient: FakeLinearApiClient;

  beforeEach(() => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeLinearClient = new FakeLinearApiClient();
  });

  afterEach(() => {
    fakeConnectionRepo.reset();
    fakeLinearClient.reset();
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
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    fakeConnectionRepo.seedConnection(connection);
  }

  function seedIssue(issue: LinearIssue): void {
    fakeLinearClient.seedIssue(issue);
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
        linearApiClient: fakeLinearClient,
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
        linearApiClient: fakeLinearClient,
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
        linearApiClient: fakeLinearClient,
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
        linearApiClient: fakeLinearClient,
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
        linearApiClient: fakeLinearClient,
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
          linearApiClient: fakeLinearClient,
          connectionRepository: fakeConnectionRepo,
        }
      );

      if (result.ok) {
        expect(result.value.issues.done).toHaveLength(1);
        expect(result.value.issues.archive).toHaveLength(0);
      }
    });
  });

  describe('error cases', () => {
    it('returns NOT_CONNECTED error when user has no connection', async () => {
      const result = await listIssues(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toContain('not connected');
      }
    });

    it('returns API error when Linear API fails', async () => {
      setupConnectedUser();
      fakeLinearClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'Rate limit exceeded',
      });

      const result = await listIssues(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('returns empty columns when no issues exist', async () => {
      const result = await listIssues(defaultRequest, {
        linearApiClient: fakeLinearClient,
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
});
