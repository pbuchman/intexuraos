/**
 * Tests for linearIssueRepository.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, type FakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import {
  saveLinearIssue,
  findLinearIssueById,
  findLinearIssueByIdentifier,
  listLinearIssuesByUserId,
  deleteLinearIssueById,
  createLinearIssueRepository,
} from '../../infra/firestore/linearIssueRepository.js';
import type { SyncedLinearIssue } from '../../domain/index.js';
import { FakeLinearIssueRepository, createSyncedIssue } from '../fakes.js';

function createTestIssue(overrides: Partial<SyncedLinearIssue> = {}): SyncedLinearIssue {
  return {
    id: 'issue-uuid-1',
    identifier: 'INT-123',
    title: 'Test Issue',
    description: 'Test description',
    state: 'In Progress',
    stateType: 'started',
    priority: 2,
    assigneeId: 'user-1',
    assigneeName: 'Test User',
    labels: [{ id: 'bug', name: 'bug', color: '#ff0000' }, { id: 'frontend', name: 'frontend', color: '#00ff00' }],
    url: 'https://linear.app/team/issue/INT-123',
    userId: 'user-123',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    syncedAt: '2025-01-03T00:00:00.000Z',
    teamId: 'team-1',
      parentId: null,
    ...overrides,
  };
}

describe('linearIssueRepository', () => {
  let fakeFirestore: FakeFirestore;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveLinearIssue', () => {
    it('saves a new issue', async () => {
      const issue = createTestIssue();

      const result = await saveLinearIssue(issue);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('issue-uuid-1');
        expect(result.value.identifier).toBe('INT-123');
        expect(result.value.title).toBe('Test Issue');
      }
    });

    it('updates an existing issue', async () => {
      const issue = createTestIssue();
      await saveLinearIssue(issue);

      const updatedIssue = createTestIssue({
        title: 'Updated Title',
        syncedAt: '2025-01-04T00:00:00.000Z',
      });

      const result = await saveLinearIssue(updatedIssue);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated Title');
        expect(result.value.syncedAt).toBe('2025-01-04T00:00:00.000Z');
      }
    });

    it('does not overwrite issues from another user with same Linear issue ID', async () => {
      // Two users connected to the same Linear team see the same issue
      const userAIssue = createTestIssue({ userId: 'user-A' });
      const userBIssue = createTestIssue({ userId: 'user-B' });

      await saveLinearIssue(userAIssue);
      await saveLinearIssue(userBIssue);

      // Both users should have their own copy
      const userAResult = await listLinearIssuesByUserId('user-A');
      const userBResult = await listLinearIssuesByUserId('user-B');

      expect(userAResult.ok).toBe(true);
      expect(userBResult.ok).toBe(true);
      if (userAResult.ok && userBResult.ok) {
        expect(userAResult.value).toHaveLength(1);
        expect(userBResult.value).toHaveLength(1);
        expect(userAResult.value[0]?.userId).toBe('user-A');
        expect(userBResult.value[0]?.userId).toBe('user-B');
      }
    });
  });

  describe('findLinearIssueById', () => {
    it('finds existing issue by ID', async () => {
      const issue = createTestIssue();
      await saveLinearIssue(issue);

      const result = await findLinearIssueById('issue-uuid-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.identifier).toBe('INT-123');
      }
    });

    it('defaults teamId to empty string for legacy docs without it', async () => {
      fakeFirestore.seedCollection('linear_issues', [
        {
          id: 'legacy-issue',
          data: {
            id: 'legacy-issue',
            identifier: 'INT-LEGACY',
            title: 'Legacy Issue',
            description: null,
            state: 'Backlog',
            stateType: 'backlog',
            priority: 0,
            assigneeId: null,
            assigneeName: null,
            labels: [],
            url: 'https://linear.app/issue/INT-LEGACY',
            userId: 'user-123',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
            syncedAt: '2025-01-01T00:00:00.000Z',
          },
        },
      ]);

      const result = await findLinearIssueById('legacy-issue');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.teamId).toBe('');
      }
    });

    it('returns null for non-existent issue', async () => {
      const result = await findLinearIssueById('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('findLinearIssueByIdentifier', () => {
    it('finds issue by identifier without userId filter', async () => {
      const issue = createTestIssue();
      await saveLinearIssue(issue);

      const result = await findLinearIssueByIdentifier('INT-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('issue-uuid-1');
      }
    });

    it('finds issue by identifier with matching userId', async () => {
      const issue = createTestIssue();
      await saveLinearIssue(issue);

      const result = await findLinearIssueByIdentifier('INT-123', 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('issue-uuid-1');
      }
    });

    it('returns null when userId does not match', async () => {
      const issue = createTestIssue();
      await saveLinearIssue(issue);

      const result = await findLinearIssueByIdentifier('INT-123', 'other-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null for non-existent identifier', async () => {
      const result = await findLinearIssueByIdentifier('INT-999');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('listLinearIssuesByUserId', () => {
    it('lists all issues for a user', async () => {
      await saveLinearIssue(createTestIssue({ id: 'issue-1', identifier: 'INT-1', userId: 'user-A' }));
      await saveLinearIssue(createTestIssue({ id: 'issue-2', identifier: 'INT-2', userId: 'user-A' }));
      await saveLinearIssue(createTestIssue({ id: 'issue-3', identifier: 'INT-3', userId: 'user-B' }));

      const result = await listLinearIssuesByUserId('user-A');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.map((i) => i.identifier).sort()).toEqual(['INT-1', 'INT-2']);
      }
    });

    it('returns empty array when user has no issues', async () => {
      const result = await listLinearIssuesByUserId('user-without-issues');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('deleteLinearIssueById', () => {
    it('deletes existing issue using composite key', async () => {
      await saveLinearIssue(createTestIssue());

      const deleteResult = await deleteLinearIssueById('issue-uuid-1', 'user-123');
      expect(deleteResult.ok).toBe(true);

      const findResult = await findLinearIssueById('issue-uuid-1');
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toBeNull();
      }
    });

    it('does not delete issue when userId does not match', async () => {
      await saveLinearIssue(createTestIssue());

      // Attempt to delete with wrong userId — should not remove the doc
      const deleteResult = await deleteLinearIssueById('issue-uuid-1', 'wrong-user');
      expect(deleteResult.ok).toBe(true);

      // Issue should still exist
      const findResult = await findLinearIssueById('issue-uuid-1');
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).not.toBeNull();
      }
    });

    it('succeeds even for non-existent issue', async () => {
      const result = await deleteLinearIssueById('non-existent', 'user-123');
      expect(result.ok).toBe(true);
    });
  });

  describe('createLinearIssueRepository', () => {
    it('creates repository with all methods', () => {
      const repo = createLinearIssueRepository();

      expect(repo.save).toBeDefined();
      expect(repo.findById).toBeDefined();
      expect(repo.findByIdentifier).toBeDefined();
      expect(repo.listByUserId).toBeDefined();
      expect(repo.deleteById).toBeDefined();
    });
  });
});

/**
 * Tests for LinearIssueRepository.findUserIdsByIssueId behavior.
 * Uses the fake implementation to validate the contract.
 */
describe('LinearIssueRepository.findUserIdsByIssueId', () => {
  let repo: FakeLinearIssueRepository;

  beforeEach(() => {
    repo = new FakeLinearIssueRepository();
  });

  it('returns all userIds who have the issue synced', async () => {
    repo.seedIssue(createSyncedIssue({ id: 'issue-1', identifier: 'INT-1', userId: 'user-A' }));
    repo.seedIssue(createSyncedIssue({ id: 'issue-1', identifier: 'INT-1', userId: 'user-B' }));

    const result = await repo.findUserIdsByIssueId('issue-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value).toContain('user-A');
    expect(result.value).toContain('user-B');
  });

  it('returns empty array when no users have the issue', async () => {
    const result = await repo.findUserIdsByIssueId('nonexistent-issue');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('does not include users with different issues', async () => {
    repo.seedIssue(createSyncedIssue({ id: 'issue-1', identifier: 'INT-1', userId: 'user-A' }));
    repo.seedIssue(createSyncedIssue({ id: 'issue-2', identifier: 'INT-2', userId: 'user-B' }));

    const result = await repo.findUserIdsByIssueId('issue-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(['user-A']);
  });

  it('returns error when repository is in failure mode', async () => {
    repo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

    const result = await repo.findUserIdsByIssueId('issue-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
