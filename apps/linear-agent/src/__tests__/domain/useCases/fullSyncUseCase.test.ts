/**
 * Tests for fullSyncUseCase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullSync, fullSyncAllUsers, type FullSyncDeps } from '../../../domain/useCases/fullSyncUseCase.js';
import { FakeLinearIssueRepository, FakeLinearConnectionRepository, FakeLinearApiClient } from '../../fakes.js';
import { createFakeLogger } from '../../testUtils.js';
import type { LinearIssue } from '../../../domain/index.js';
import type { Result } from '@intexuraos/common-core';
import { err } from '@intexuraos/common-core';
import type { LinearError } from '../../../domain/index.js';

function createTestApiIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'issue-uuid-1',
    identifier: 'INT-123',
    title: 'Test Issue',
    description: 'Test description',
    priority: 2,
    state: { id: 'state-1', name: 'In Progress', type: 'started' },
    url: 'https://linear.app/team/issue/INT-123',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

describe('fullSync', () => {
  let issueRepo: FakeLinearIssueRepository;
  let connectionRepo: FakeLinearConnectionRepository;
  let linearClient: FakeLinearApiClient;
  let deps: FullSyncDeps;
  const userId = 'user-123';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
    issueRepo = new FakeLinearIssueRepository();
    connectionRepo = new FakeLinearConnectionRepository();
    linearClient = new FakeLinearApiClient();
    deps = {
      issueRepo,
      connectionRepo,
      linearClient,
      logger: createFakeLogger(),
    };

    // Setup connected user
    connectionRepo.seedConnection({
      userId,
      apiKey: 'test-api-key',
      teamId: 'team-1',
      teamName: 'Engineering',
      connected: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  describe('successful sync', () => {
    it('syncs all issues from Linear API', async () => {
      linearClient.seedIssue(createTestApiIssue({ id: 'issue-1', identifier: 'INT-1' }));
      linearClient.seedIssue(createTestApiIssue({ id: 'issue-2', identifier: 'INT-2' }));

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(2);
        expect(result.value.created).toBe(2);
        expect(result.value.updated).toBe(0);
      }
      expect(issueRepo.count).toBe(2);
    });

    it('updates existing issues', async () => {
      // Pre-seed an existing issue
      issueRepo.seedIssue({
        id: 'issue-1',
        identifier: 'INT-1',
        title: 'Old Title',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/INT-1',
        userId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        syncedAt: '2025-01-01T00:00:00.000Z',
        teamId: 'team-1',
      });

      linearClient.seedIssue(createTestApiIssue({ id: 'issue-1', identifier: 'INT-1', title: 'New Title' }));

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.updated).toBe(1);
        expect(result.value.created).toBe(0);
      }
    });

    it('deletes issues not in Linear', async () => {
      // Pre-seed an issue that no longer exists in Linear
      issueRepo.seedIssue({
        id: 'deleted-issue',
        identifier: 'INT-999',
        title: 'Deleted Issue',
        description: null,
        state: 'Done',
        stateType: 'completed',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/INT-999',
        userId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        syncedAt: '2025-01-01T00:00:00.000Z',
        teamId: 'team-1',
      });

      linearClient.seedIssue(createTestApiIssue({ id: 'issue-1', identifier: 'INT-1' }));

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deleted).toBe(1);
        expect(result.value.total).toBe(1);
      }
      expect(issueRepo.count).toBe(1);

      const deletedIssue = await issueRepo.findById('deleted-issue');
      expect(deletedIssue.ok).toBe(true);
      if (deletedIssue.ok) {
        expect(deletedIssue.value).toBeNull();
      }
    });

    it('returns empty stats when no issues', async () => {
      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(0);
        expect(result.value.created).toBe(0);
      }
    });

    it('includes duration in stats', async () => {
      linearClient.seedIssue(createTestApiIssue());

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.value.syncedAt).toBeDefined();
      }
    });
  });

  describe('error handling', () => {
    it('returns NOT_CONNECTED when user has no connection', async () => {
      connectionRepo.reset(); // Remove all connections

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });

    it('returns error when API call fails', async () => {
      linearClient.setFailure(true, { code: 'API_ERROR', message: 'API unavailable' });

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns error when connection repo fails', async () => {
      connectionRepo.setGetFullConnectionFailure(true);

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(false);
    });

    it('returns error when listByUserId fails', async () => {
      issueRepo.setListByUserIdFailure(true);

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(false);
    });

    it('continues when save fails during upsert', async () => {
      linearClient.seedIssue(createTestApiIssue({ id: 'issue-1', identifier: 'INT-1' }));
      linearClient.seedIssue(createTestApiIssue({ id: 'issue-2', identifier: 'INT-2' }));
      issueRepo.setSaveFailure(true);

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // No issues should be created due to save failure, but total still counts API issues
        expect(result.value.created).toBe(0);
        expect(result.value.total).toBe(2);
      }
    });

    it('continues when delete fails', async () => {
      issueRepo.seedIssue({
        id: 'deleted-issue',
        identifier: 'INT-999',
        title: 'Deleted Issue',
        description: null,
        state: 'Done',
        stateType: 'completed',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/INT-999',
        userId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        syncedAt: '2025-01-01T00:00:00.000Z',
        teamId: 'team-1',
      });
      linearClient.seedIssue(createTestApiIssue({ id: 'issue-1', identifier: 'INT-1' }));
      issueRepo.setDeleteFailure(true);

      const result = await fullSync(userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // No issues deleted due to delete failure
        expect(result.value.deleted).toBe(0);
      }
    });
  });
});

describe('fullSyncAllUsers', () => {
  let issueRepo: FakeLinearIssueRepository;
  let connectionRepo: FakeLinearConnectionRepository;
  let linearClient: FakeLinearApiClient;
  let deps: FullSyncDeps & { getAllConnectedUserIds: () => Promise<Result<string[], LinearError>> };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
    issueRepo = new FakeLinearIssueRepository();
    connectionRepo = new FakeLinearConnectionRepository();
    linearClient = new FakeLinearApiClient();
    deps = {
      issueRepo,
      connectionRepo,
      linearClient,
      logger: createFakeLogger(),
      getAllConnectedUserIds: vi.fn().mockResolvedValue({ ok: true, value: ['user-1', 'user-2'] }),
    };

    // Setup connected users
    connectionRepo.seedConnection({
      userId: 'user-1',
      apiKey: 'test-api-key',
      teamId: 'team-1',
      teamName: 'Engineering',
      connected: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    connectionRepo.seedConnection({
      userId: 'user-2',
      apiKey: 'test-api-key',
      teamId: 'team-1',
      teamName: 'Engineering',
      connected: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('syncs all connected users', async () => {
    linearClient.seedIssue({
      id: 'issue-1',
      identifier: 'INT-1',
      title: 'Test Issue',
      description: 'Test description',
      priority: 2,
      state: { id: 'state-1', name: 'In Progress', type: 'started' },
      url: 'https://linear.app/team/issue/INT-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      completedAt: null,
    });
    linearClient.seedIssue({
      id: 'issue-2',
      identifier: 'INT-2',
      title: 'Test Issue 2',
      description: 'Test description 2',
      priority: 2,
      state: { id: 'state-1', name: 'In Progress', type: 'started' },
      url: 'https://linear.app/team/issue/INT-2',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      completedAt: null,
    });

    const result = await fullSyncAllUsers(deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userCount).toBe(2);
      expect(result.value.totalIssues).toBe(4); // 2 issues per user (same team returns same issues)
    }
  });

  it('returns error when getAllConnectedUserIds fails', async () => {
    deps.getAllConnectedUserIds = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'Failed to get users' },
    });

    const result = await fullSyncAllUsers(deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DATABASE_ERROR');
    }
  });

  it('continues on individual user sync failure', async () => {
    linearClient.seedIssue({
      id: 'issue-1',
      identifier: 'INT-1',
      title: 'Test Issue',
      description: 'Test description',
      priority: 2,
      state: { id: 'state-1', name: 'In Progress', type: 'started' },
      url: 'https://linear.app/team/issue/INT-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      completedAt: null,
    });
    linearClient.seedIssue({
      id: 'issue-2',
      identifier: 'INT-2',
      title: 'Test Issue 2',
      description: 'Test description 2',
      priority: 2,
      state: { id: 'state-1', name: 'In Progress', type: 'started' },
      url: 'https://linear.app/team/issue/INT-2',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      completedAt: null,
    });

    // Make first user fail by setting failure on getFullConnection
    // Need to create a spy that fails only for user-1
    const originalGetFullConnection = connectionRepo.getFullConnection.bind(connectionRepo);
    const getFullConnectionSpy = vi.spyOn(connectionRepo, 'getFullConnection').mockImplementation(async (userId) => {
      if (userId === 'user-1') {
        return err({ code: 'NOT_CONNECTED', message: 'User not connected' });
      }
      return originalGetFullConnection(userId);
    });

    const result = await fullSyncAllUsers(deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only user-2 should sync, getting 2 issues
      expect(result.value.totalIssues).toBe(2);
    }

    getFullConnectionSpy.mockRestore();
  });
});
