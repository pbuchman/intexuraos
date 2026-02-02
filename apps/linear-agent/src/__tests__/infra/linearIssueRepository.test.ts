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
    labels: ['bug', 'frontend'],
    url: 'https://linear.app/team/issue/INT-123',
    userId: 'user-123',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    syncedAt: '2025-01-03T00:00:00.000Z',
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

    it('returns null for non-existent issue', async () => {
      const result = await findLinearIssueById('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('findLinearIssueByIdentifier', () => {
    it('finds issue by identifier', async () => {
      const issue = createTestIssue();
      await saveLinearIssue(issue);

      const result = await findLinearIssueByIdentifier('INT-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('issue-uuid-1');
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
    it('deletes existing issue', async () => {
      await saveLinearIssue(createTestIssue());

      const deleteResult = await deleteLinearIssueById('issue-uuid-1');
      expect(deleteResult.ok).toBe(true);

      const findResult = await findLinearIssueById('issue-uuid-1');
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toBeNull();
      }
    });

    it('succeeds even for non-existent issue', async () => {
      const result = await deleteLinearIssueById('non-existent');
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
