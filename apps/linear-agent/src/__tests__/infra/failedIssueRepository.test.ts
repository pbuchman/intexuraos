/**
 * Tests for Firestore failed issue repository.
 * Tests CRUD operations for failed Linear issues using in-memory Firestore fake.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createFailedIssue,
  listFailedIssuesByUser,
  deleteFailedIssue,
  createFailedIssueRepository,
} from '../../infra/firestore/failedIssueRepository.js';

function createTestInput(
  overrides: Partial<Parameters<typeof createFailedIssue>[0]> = {}
): Parameters<typeof createFailedIssue>[0] {
  return {
    userId: 'user-123',
    actionId: 'action-456',
    originalText: 'Create a task for testing',
    extractedTitle: 'Test Task',
    extractedPriority: 2,
    error: 'Linear API rate limit exceeded',
    reasoning: 'Could not create issue due to rate limiting',
    ...overrides,
  };
}

describe('FailedIssueRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('createFailedIssue', () => {
    it('creates a failed issue successfully', async () => {
      const input = createTestInput();

      const result = await createFailedIssue(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.actionId).toBe('action-456');
        expect(result.value.originalText).toBe('Create a task for testing');
        expect(result.value.extractedTitle).toBe('Test Task');
        expect(result.value.extractedPriority).toBe(2);
        expect(result.value.error).toBe('Linear API rate limit exceeded');
        expect(result.value.reasoning).toBe('Could not create issue due to rate limiting');
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('creates failed issue with null fields', async () => {
      const input = createTestInput({
        extractedTitle: null,
        extractedPriority: null,
        reasoning: null,
      });

      const result = await createFailedIssue(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.extractedTitle).toBeNull();
        expect(result.value.extractedPriority).toBeNull();
        expect(result.value.reasoning).toBeNull();
      }
    });

    it('generates unique ids for each failed issue', async () => {
      const result1 = await createFailedIssue(createTestInput({ actionId: 'action-1' }));
      const result2 = await createFailedIssue(createTestInput({ actionId: 'action-2' }));

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.id).not.toBe(result2.value.id);
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });

      const result = await createFailedIssue(createTestInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Connection failed');
      }
    });
  });

  describe('listFailedIssuesByUser', () => {
    it('returns empty array for user with no failed issues', async () => {
      const result = await listFailedIssuesByUser('nonexistent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns failed issues for specified user only', async () => {
      await createFailedIssue(createTestInput({ userId: 'user-A', actionId: 'a1' }));
      await createFailedIssue(createTestInput({ userId: 'user-B', actionId: 'b1' }));
      await createFailedIssue(createTestInput({ userId: 'user-A', actionId: 'a2' }));

      const resultA = await listFailedIssuesByUser('user-A');
      const resultB = await listFailedIssuesByUser('user-B');

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultB.value).toHaveLength(1);
        expect(resultA.value.every((fi) => fi.userId === 'user-A')).toBe(true);
        expect(resultB.value.every((fi) => fi.userId === 'user-B')).toBe(true);
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await listFailedIssuesByUser('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Query failed');
      }
    });
  });

  describe('deleteFailedIssue', () => {
    it('returns error for non-existent failed issue', async () => {
      const result = await deleteFailedIssue('nonexistent-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Failed issue not found');
      }
    });

    it('deletes existing failed issue', async () => {
      const createResult = await createFailedIssue(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await deleteFailedIssue(createResult.value.id);

      expect(deleteResult.ok).toBe(true);

      const listResult = await listFailedIssuesByUser('user-123');
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(0);
      }
    });

    it('does not affect other failed issues when deleting', async () => {
      const result1 = await createFailedIssue(createTestInput({ actionId: 'action-1' }));
      const result2 = await createFailedIssue(createTestInput({ actionId: 'action-2' }));
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      await deleteFailedIssue(result1.value.id);

      const listResult = await listFailedIssuesByUser('user-123');
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(1);
        expect(listResult.value[0]?.actionId).toBe('action-2');
      }
    });

    it('returns error when Firestore fails', async () => {
      const createResult = await createFailedIssue(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await deleteFailedIssue(createResult.value.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Delete failed');
      }
    });
  });

  describe('createFailedIssueRepository factory', () => {
    it('returns repository with all methods', () => {
      const repository = createFailedIssueRepository();

      expect(typeof repository.create).toBe('function');
      expect(typeof repository.listByUser).toBe('function');
      expect(typeof repository.delete).toBe('function');
    });

    it('factory methods work correctly', async () => {
      const repository = createFailedIssueRepository();

      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);

      const listResult = await repository.listByUser('user-123');
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(1);
      }
    });
  });
});
