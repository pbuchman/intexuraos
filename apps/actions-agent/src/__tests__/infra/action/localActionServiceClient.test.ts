import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createLocalActionServiceClient } from '../../../infra/action/localActionServiceClient.js';
import type { ActionRepository, UpdateStatusIfResult } from '../../../domain/ports/actionRepository.js';
import type { Action } from '../../../domain/models/action.js';

describe('localActionServiceClient', () => {
  let mockRepository: ActionRepository;
  let existingAction: Action;

  beforeEach(() => {
    existingAction = {
      id: 'action-123',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'research',
      confidence: 0.9,
      title: 'Test action',
      status: 'pending',
      payload: { query: 'test' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    mockRepository = {
      getById: vi.fn().mockResolvedValue(existingAction),
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      listByUserId: vi.fn().mockResolvedValue([]),
      listByStatus: vi.fn().mockResolvedValue([]),
      updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'updated' } as UpdateStatusIfResult),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getAction', () => {
    it('returns action successfully', async () => {
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.getAction('action-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(existingAction);
      }
      expect(mockRepository.getById).toHaveBeenCalledWith('action-123');
    });

    it('returns null when action not found', async () => {
      (mockRepository.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.getAction('nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when repository throws', async () => {
      (mockRepository.getById as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database error')
      );
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.getAction('action-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to get action');
      }
    });
  });

  describe('updateActionStatus', () => {
    it('updates action status successfully', async () => {
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.updateActionStatus('action-123', 'awaiting_approval');

      expect(result.ok).toBe(true);
      expect(mockRepository.getById).toHaveBeenCalledWith('action-123');
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'action-123',
          status: 'awaiting_approval',
        })
      );
    });

    it('returns error when action not found', async () => {
      (mockRepository.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.updateActionStatus('nonexistent', 'completed');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Action not found');
      }
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('returns error when repository throws', async () => {
      (mockRepository.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database error')
      );
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.updateActionStatus('action-123', 'completed');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to update action status');
      }
    });
  });

  describe('updateAction', () => {
    it('updates action with status and payload', async () => {
      const client = createLocalActionServiceClient(mockRepository);
      const newPayload = { result: 'done', sources: ['source1'] };

      const result = await client.updateAction('action-123', {
        status: 'completed',
        payload: newPayload,
      });

      expect(result.ok).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'action-123',
          status: 'completed',
          payload: newPayload,
        })
      );
    });

    it('preserves existing payload when not provided', async () => {
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.updateAction('action-123', { status: 'processing' });

      expect(result.ok).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'action-123',
          status: 'processing',
          payload: existingAction.payload,
        })
      );
    });

    it('returns error when action not found', async () => {
      (mockRepository.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.updateAction('nonexistent', { status: 'completed' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Action not found');
      }
    });

    it('returns error when repository throws', async () => {
      (mockRepository.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database error')
      );
      const client = createLocalActionServiceClient(mockRepository);

      const result = await client.updateAction('action-123', { status: 'completed' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to update action');
      }
    });
  });
});
