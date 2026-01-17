/**
 * Tests for Firestore processed action repository.
 * Tests idempotency tracking for Linear issue creation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  getProcessedActionByActionId,
  createProcessedAction,
  createProcessedActionRepository,
} from '../../infra/firestore/processedActionRepository.js';

function createTestInput(
  overrides: Partial<Parameters<typeof createProcessedAction>[0]> = {}
): Parameters<typeof createProcessedAction>[0] {
  return {
    actionId: 'action-123',
    userId: 'user-456',
    issueId: 'issue-789',
    issueIdentifier: 'ENG-42',
    resourceUrl: 'https://linear.app/team/issue/ENG-42',
    ...overrides,
  };
}

describe('ProcessedActionRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getProcessedActionByActionId', () => {
    it('returns null for non-existent action', async () => {
      const result = await getProcessedActionByActionId('nonexistent-action');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns processed action for existing actionId', async () => {
      const createResult = await createProcessedAction(createTestInput());
      expect(createResult.ok).toBe(true);

      const result = await getProcessedActionByActionId('action-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.actionId).toBe('action-123');
        expect(result.value?.userId).toBe('user-456');
        expect(result.value?.issueId).toBe('issue-789');
        expect(result.value?.issueIdentifier).toBe('ENG-42');
        expect(result.value?.resourceUrl).toBe('https://linear.app/team/issue/ENG-42');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await getProcessedActionByActionId('action-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });
  });

  describe('createProcessedAction', () => {
    it('creates a processed action successfully', async () => {
      const input = createTestInput();

      const result = await createProcessedAction(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.actionId).toBe('action-123');
        expect(result.value.userId).toBe('user-456');
        expect(result.value.issueId).toBe('issue-789');
        expect(result.value.issueIdentifier).toBe('ENG-42');
        expect(result.value.resourceUrl).toBe('https://linear.app/team/issue/ENG-42');
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('uses actionId as document id', async () => {
      await createProcessedAction(createTestInput({ actionId: 'specific-action-id' }));

      const result = await getProcessedActionByActionId('specific-action-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.actionId).toBe('specific-action-id');
      }
    });

    it('overwrites existing action with same actionId', async () => {
      await createProcessedAction(createTestInput({ issueIdentifier: 'ENG-1' }));
      await createProcessedAction(createTestInput({ issueIdentifier: 'ENG-2' }));

      const result = await getProcessedActionByActionId('action-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.issueIdentifier).toBe('ENG-2');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await createProcessedAction(createTestInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Write failed');
      }
    });
  });

  describe('createProcessedActionRepository factory', () => {
    it('returns repository with all methods', () => {
      const repository = createProcessedActionRepository();

      expect(typeof repository.getByActionId).toBe('function');
      expect(typeof repository.create).toBe('function');
    });

    it('factory methods work correctly', async () => {
      const repository = createProcessedActionRepository();

      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);

      const getResult = await repository.getByActionId('action-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value?.actionId).toBe('action-123');
      }
    });
  });
});
