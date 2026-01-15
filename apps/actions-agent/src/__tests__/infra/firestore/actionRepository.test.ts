/**
 * Tests for Firestore action repository.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreActionRepository } from '../../../infra/firestore/actionRepository.js';
import type { ActionRepository } from '../../../domain/ports/actionRepository.js';
import type { Action } from '../../../domain/models/action.js';

function createTestAction(overrides: Partial<Action> = {}): Action {
  const now = new Date().toISOString();
  return {
    id: 'action-123',
    userId: 'user-123',
    commandId: 'command-123',
    type: 'research',
    confidence: 0.95,
    title: 'Test Action',
    status: 'pending',
    payload: { query: 'test query' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FirestoreActionRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ActionRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createFirestoreActionRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getById', () => {
    it('returns null for non-existent action', async () => {
      const result = await repository.getById('nonexistent');
      expect(result).toBeNull();
    });

    it('returns action for existing id', async () => {
      const action = createTestAction();
      await repository.save(action);

      const result = await repository.getById(action.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(action.id);
      expect(result?.userId).toBe('user-123');
      expect(result?.type).toBe('research');
      expect(result?.title).toBe('Test Action');
    });
  });

  describe('save', () => {
    it('saves new action', async () => {
      const action = createTestAction();

      await repository.save(action);

      const result = await repository.getById(action.id);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Action');
    });

    it('saves action with all fields', async () => {
      const action = createTestAction({
        type: 'todo',
        status: 'completed',
        confidence: 0.85,
        payload: { task: 'Complete this', priority: 'high' },
      });

      await repository.save(action);

      const result = await repository.getById(action.id);
      expect(result?.type).toBe('todo');
      expect(result?.status).toBe('completed');
      expect(result?.confidence).toBe(0.85);
      expect(result?.payload).toEqual({ task: 'Complete this', priority: 'high' });
    });
  });

  describe('update', () => {
    it('updates existing action', async () => {
      const action = createTestAction();
      await repository.save(action);

      const updated = { ...action, status: 'completed' as const, title: 'Updated Title' };
      await repository.update(updated);

      const result = await repository.getById(action.id);
      expect(result?.status).toBe('completed');
      expect(result?.title).toBe('Updated Title');
    });

    it('updates timestamp on update', async () => {
      const action = createTestAction();
      await repository.save(action);

      const originalUpdatedAt = action.updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 10));

      await repository.update({ ...action, status: 'processing' as const });

      const result = await repository.getById(action.id);
      expect(result?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('delete', () => {
    it('deletes existing action', async () => {
      const action = createTestAction();
      await repository.save(action);

      await repository.delete(action.id);

      const result = await repository.getById(action.id);
      expect(result).toBeNull();
    });

    it('succeeds for non-existent action', async () => {
      await expect(repository.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('listByUserId', () => {
    it('returns empty array for user with no actions', async () => {
      const result = await repository.listByUserId('user-no-actions');
      expect(result).toEqual([]);
    });

    it('returns actions for user', async () => {
      await repository.save(createTestAction({ id: 'action-1', userId: 'user-123' }));
      await repository.save(createTestAction({ id: 'action-2', userId: 'user-123' }));
      await repository.save(createTestAction({ id: 'action-3', userId: 'other-user' }));

      const result = await repository.listByUserId('user-123');

      expect(result).toHaveLength(2);
      expect(result.every((a) => a.userId === 'user-123')).toBe(true);
    });

    it('returns actions with correct types', async () => {
      await repository.save(
        createTestAction({
          id: 'action-1',
          type: 'research',
          status: 'pending',
        })
      );

      const result = await repository.listByUserId('user-123');

      expect(result[0]?.type).toBe('research');
      expect(result[0]?.status).toBe('pending');
    });

    it('filters by single status', async () => {
      await repository.save(
        createTestAction({ id: 'action-1', userId: 'user-123', status: 'pending' })
      );
      await repository.save(
        createTestAction({ id: 'action-2', userId: 'user-123', status: 'completed' })
      );
      await repository.save(
        createTestAction({ id: 'action-3', userId: 'user-123', status: 'failed' })
      );

      const result = await repository.listByUserId('user-123', { status: ['pending'] });

      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe('pending');
    });

    it('filters by multiple statuses', async () => {
      await repository.save(
        createTestAction({ id: 'action-1', userId: 'user-123', status: 'pending' })
      );
      await repository.save(
        createTestAction({ id: 'action-2', userId: 'user-123', status: 'completed' })
      );
      await repository.save(
        createTestAction({ id: 'action-3', userId: 'user-123', status: 'failed' })
      );

      const result = await repository.listByUserId('user-123', {
        status: ['pending', 'completed'],
      });

      expect(result).toHaveLength(2);
      expect(result.every((a) => a.status === 'pending' || a.status === 'completed')).toBe(true);
    });

    it('returns all actions when status filter is empty array', async () => {
      await repository.save(
        createTestAction({ id: 'action-1', userId: 'user-123', status: 'pending' })
      );
      await repository.save(
        createTestAction({ id: 'action-2', userId: 'user-123', status: 'completed' })
      );

      const result = await repository.listByUserId('user-123', { status: [] });

      expect(result).toHaveLength(2);
    });

    it('returns all actions when status filter is undefined', async () => {
      await repository.save(
        createTestAction({ id: 'action-1', userId: 'user-123', status: 'pending' })
      );
      await repository.save(
        createTestAction({ id: 'action-2', userId: 'user-123', status: 'completed' })
      );

      const result = await repository.listByUserId('user-123', { status: undefined });

      expect(result).toHaveLength(2);
    });
  });

  describe('listByStatus', () => {
    it('returns empty array when no actions with status', async () => {
      await repository.save(createTestAction({ id: 'action-1', status: 'completed' }));

      const result = await repository.listByStatus('pending');
      expect(result).toEqual([]);
    });

    it('returns actions with matching status', async () => {
      await repository.save(createTestAction({ id: 'action-1', status: 'pending' }));
      await repository.save(createTestAction({ id: 'action-2', status: 'pending' }));
      await repository.save(createTestAction({ id: 'action-3', status: 'completed' }));

      const result = await repository.listByStatus('pending');

      expect(result).toHaveLength(2);
      expect(result.every((a) => a.status === 'pending')).toBe(true);
    });

    it('respects limit parameter', async () => {
      await repository.save(createTestAction({ id: 'action-1', status: 'pending' }));
      await repository.save(createTestAction({ id: 'action-2', status: 'pending' }));
      await repository.save(createTestAction({ id: 'action-3', status: 'pending' }));

      const result = await repository.listByStatus('pending', 2);

      expect(result).toHaveLength(2);
    });
  });

  describe('updateStatusIf', () => {
    it('updates status when current status matches expected', async () => {
      const action = createTestAction({ status: 'pending' });
      await repository.save(action);

      const updated = await repository.updateStatusIf(action.id, 'awaiting_approval', 'pending');

      expect(updated).toBe(true);

      const result = await repository.getById(action.id);
      expect(result?.status).toBe('awaiting_approval');
    });

    it('returns false when current status does not match expected', async () => {
      const action = createTestAction({ status: 'completed' });
      await repository.save(action);

      const updated = await repository.updateStatusIf(action.id, 'awaiting_approval', 'pending');

      expect(updated).toBe(false);

      const result = await repository.getById(action.id);
      expect(result?.status).toBe('completed');
    });

    it('returns false for non-existent action', async () => {
      const updated = await repository.updateStatusIf('nonexistent', 'awaiting_approval', 'pending');

      expect(updated).toBe(false);
    });

    it('prevents race condition - only one concurrent update succeeds', async () => {
      const action = createTestAction({ status: 'pending' });
      await repository.save(action);

      const promises = [
        repository.updateStatusIf(action.id, 'awaiting_approval', 'pending'),
        repository.updateStatusIf(action.id, 'processing', 'pending'),
        repository.updateStatusIf(action.id, 'awaiting_approval', 'pending'),
      ];

      const results = await Promise.all(promises);

      const successCount = results.filter((r) => r === true).length;

      expect(successCount).toBe(1);

      const result = await repository.getById(action.id);
      expect(result?.status).not.toBe('pending');
    });

    it('updates updatedAt timestamp on successful update', async () => {
      const action = createTestAction({ status: 'pending' });
      await repository.save(action);

      const originalUpdatedAt = action.updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 10));

      await repository.updateStatusIf(action.id, 'awaiting_approval', 'pending');

      const result = await repository.getById(action.id);
      expect(result?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });
});
