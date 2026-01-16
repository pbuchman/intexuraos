/**
 * Tests for ProcessedActionRepository.
 * Uses mocked Firestore from @intexuraos/infra-firestore.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import {
  getProcessedActionByActionId,
  createProcessedAction,
  createProcessedActionRepository,
} from '../../../infra/firestore/processedActionRepository.js';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

const { getFirestore } = await import('@intexuraos/infra-firestore');

const mockDocSnapshot = {
  exists: true,
  data: vi.fn(),
};

describe('ProcessedActionRepository', () => {
  const mockDb = {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn(),
        get: vi.fn(() => Promise.resolve(mockDocSnapshot)),
      })),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocSnapshot.exists = true;
    mockDocSnapshot.data.mockReturnValue({
      actionId: 'action-123',
      userId: 'user-456',
      eventId: 'event-789',
      resourceUrl: 'https://calendar.google.com/event/event-789',
      createdAt: '2025-01-15T10:00:00Z',
    });
    vi.mocked(getFirestore).mockReturnValue(mockDb as unknown as ReturnType<typeof getFirestore>);
  });

  describe('getProcessedActionByActionId', () => {
    it('returns processed action when found', async () => {
      const result = await getProcessedActionByActionId('action-123');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).not.toBeNull();
        expect(result.value?.actionId).toBe('action-123');
        expect(result.value?.userId).toBe('user-456');
        expect(result.value?.eventId).toBe('event-789');
        expect(result.value?.resourceUrl).toBe('https://calendar.google.com/event/event-789');
      }
    });

    it('returns null when action not found', async () => {
      mockDocSnapshot.exists = false;

      const result = await getProcessedActionByActionId('non-existent');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Firestore throws', async () => {
      mockDb.collection.mockImplementation(() => {
        throw new Error('Firestore unavailable');
      });

      const result = await getProcessedActionByActionId('action-123');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore unavailable');
      }
    });

    it('uses actionId as document ID for lookup', async () => {
      const mockDocFn = vi.fn(() => ({
        set: vi.fn(),
        get: vi.fn(() => Promise.resolve(mockDocSnapshot)),
      }));
      mockDb.collection.mockReturnValue({ doc: mockDocFn } as unknown as ReturnType<typeof mockDb.collection>);

      await getProcessedActionByActionId('specific-action-id');

      expect(mockDocFn).toHaveBeenCalledWith('specific-action-id');
    });
  });

  describe('createProcessedAction', () => {
    it('creates processed action successfully', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ set: mockSet, get: vi.fn() })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const input = {
        actionId: 'action-123',
        userId: 'user-456',
        eventId: 'event-789',
        resourceUrl: 'https://calendar.google.com/event/event-789',
      };

      const result = await createProcessedAction(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.actionId).toBe('action-123');
        expect(result.value.userId).toBe('user-456');
        expect(result.value.eventId).toBe('event-789');
        expect(result.value.resourceUrl).toBe('https://calendar.google.com/event/event-789');
        expect(result.value.createdAt).toBeDefined();
      }
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'action-123',
          userId: 'user-456',
          eventId: 'event-789',
          resourceUrl: 'https://calendar.google.com/event/event-789',
        })
      );
    });

    it('uses actionId as document ID', async () => {
      const mockDocFn = vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined), get: vi.fn() }));
      mockDb.collection.mockReturnValue({ doc: mockDocFn } as unknown as ReturnType<typeof mockDb.collection>);

      await createProcessedAction({
        actionId: 'my-action-id',
        userId: 'user-456',
        eventId: 'event-789',
        resourceUrl: 'https://calendar.google.com/event/event-789',
      });

      expect(mockDocFn).toHaveBeenCalledWith('my-action-id');
    });

    it('returns error when Firestore throws', async () => {
      mockDb.collection.mockImplementation(() => {
        throw new Error('Firestore write error');
      });

      const result = await createProcessedAction({
        actionId: 'action-123',
        userId: 'user-456',
        eventId: 'event-789',
        resourceUrl: 'https://calendar.google.com/event/event-789',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore write error');
      }
    });

    it('returns error when set fails', async () => {
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          set: vi.fn().mockRejectedValue(new Error('Set failed')),
          get: vi.fn(),
        })),
      } as unknown as ReturnType<typeof mockDb.collection>);

      const result = await createProcessedAction({
        actionId: 'action-123',
        userId: 'user-456',
        eventId: 'event-789',
        resourceUrl: 'https://calendar.google.com/event/event-789',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Set failed');
      }
    });
  });

  describe('createProcessedActionRepository factory', () => {
    it('returns repository with getByActionId method', () => {
      const repository = createProcessedActionRepository();

      expect(repository.getByActionId).toBeDefined();
      expect(typeof repository.getByActionId).toBe('function');
    });

    it('returns repository with create method', () => {
      const repository = createProcessedActionRepository();

      expect(repository.create).toBeDefined();
      expect(typeof repository.create).toBe('function');
    });
  });
});
