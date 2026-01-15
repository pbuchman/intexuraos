/**
 * Tests for FirestoreFailedEventRepository.
 * Uses mocked Firestore from @intexuraos/infra-firestore.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import {
  FirestoreFailedEventRepository,
  createFailedEventRepository,
} from '../../../infra/firestore/failedEventRepository.js';
import type { CreateFailedEventInput } from '../../../domain/models.js';

// Mock the Firestore module
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

const { getFirestore } = await import('@intexuraos/infra-firestore');

const mockDocSnapshot = {
  exists: true,
  id: 'test-id-123',
  data: vi.fn(),
};

interface MockQuery {
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

const mockQuery: MockQuery = {
  where: vi.fn(() => mockQuery),
  orderBy: vi.fn(() => mockQuery),
  limit: vi.fn(() => mockQuery),
  get: vi.fn(),
};

describe('FirestoreFailedEventRepository', () => {
  interface MockCollection {
    doc: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  }

  const mockDb = {
    collection: vi.fn((): MockCollection => ({
      doc: vi.fn(() => ({
        id: 'new-doc-id',
        set: vi.fn(),
        get: vi.fn(() => Promise.resolve(mockDocSnapshot)),
        delete: vi.fn(),
      })),
      where: vi.fn(() => mockQuery),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.collection.mockReset(); // Clear mockReturnValue replacements from previous tests
    mockQuery.where.mockReset().mockImplementation(() => mockQuery);
    mockQuery.orderBy.mockReset().mockImplementation(() => mockQuery);
    mockQuery.limit.mockReset().mockImplementation(() => mockQuery);
    mockQuery.get.mockReset().mockResolvedValue({ // Restore default implementation
      docs: [
        {
          id: 'event-1',
          data: (): Record<string, unknown> => ({
            userId: 'user-123',
            actionId: 'action-456',
            originalText: 'Meeting tomorrow',
            summary: 'Team sync',
            start: '2025-01-15T10:00:00Z',
            end: '2025-01-15T11:00:00Z',
            location: 'Room 1',
            description: 'Weekly sync',
            error: 'API error',
            reasoning: 'Event conflicts',
            createdAt: '2025-01-15T09:00:00Z',
          }),
        },
      ],
    });
    mockDocSnapshot.exists = true;
    mockDocSnapshot.data.mockReturnValue({
      userId: 'user-123',
      actionId: 'action-456',
      originalText: 'Meeting tomorrow',
      summary: 'Team sync',
      start: '2025-01-15T10:00:00Z',
      end: '2025-01-15T11:00:00Z',
      location: 'Room 1',
      description: 'Weekly sync',
      error: 'API error',
      reasoning: 'Event conflicts',
      createdAt: '2025-01-15T09:00:00Z',
    });
    mockQuery.get.mockResolvedValue({
      docs: [
        {
          id: 'event-1',
          data: (): Record<string, unknown> => ({
            userId: 'user-123',
            actionId: 'action-456',
            originalText: 'Meeting tomorrow',
            summary: 'Team sync',
            start: '2025-01-15T10:00:00Z',
            end: '2025-01-15T11:00:00Z',
            location: 'Room 1',
            description: 'Weekly sync',
            error: 'API error',
            reasoning: 'Event conflicts',
            createdAt: '2025-01-15T09:00:00Z',
          }),
        },
      ],
    });
    vi.mocked(getFirestore).mockReturnValue(mockDb as unknown as ReturnType<typeof getFirestore>);
  });

  describe('create', () => {
    it('creates a failed event successfully', async () => {
      const repository = new FirestoreFailedEventRepository();
      const mockSet = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ id: 'new-doc-id', set: mockSet })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const input: CreateFailedEventInput = {
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Meeting tomorrow',
        summary: 'Team sync',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        location: 'Room 1',
        description: 'Weekly sync',
        error: 'API error',
        reasoning: 'Event conflicts',
      };

      const result = await repository.create(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.id).toBe('new-doc-id');
        expect(result.value.userId).toBe('user-123');
        expect(result.value.actionId).toBe('action-456');
        expect(result.value.originalText).toBe('Meeting tomorrow');
        expect(result.value.summary).toBe('Team sync');
      }
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          actionId: 'action-456',
          originalText: 'Meeting tomorrow',
        })
      );
    });

    it('creates failed event with null optional fields', async () => {
      const repository = new FirestoreFailedEventRepository();
      const mockSet = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({ id: 'new-doc-id', set: mockSet })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const input: CreateFailedEventInput = {
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Quick meeting',
        summary: 'Chat',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Rate limited',
        reasoning: 'Too many requests',
      };

      const result = await repository.create(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.start).toBeNull();
        expect(result.value.end).toBeNull();
        expect(result.value.location).toBeNull();
        expect(result.value.description).toBeNull();
      }
    });

    it('returns error when Firestore throws', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockDb.collection.mockImplementation(() => {
        throw new Error('Firestore unavailable');
      });

      const input: CreateFailedEventInput = {
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Meeting',
        summary: 'Sync',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        location: null,
        description: null,
        error: 'API error',
        reasoning: 'Failed',
      };

      const result = await repository.create(input);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore unavailable');
      }

      // Note: beforeEach will reset mocks before next test
    });
  });

  describe('list', () => {
    it('lists failed events for a user', async () => {
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.list('user-123');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(1);
        const firstEvent = result.value[0];
        expect(firstEvent?.id).toBe('event-1');
        expect(firstEvent?.userId).toBe('user-123');
      }
    });

    it('respects custom limit filter', async () => {
      const repository = new FirestoreFailedEventRepository();

      await repository.list('user-123', { limit: 5 });

      expect(mockQuery.limit).toHaveBeenCalledWith(5);
    });

    it('uses default limit of 10 when no filter provided', async () => {
      const repository = new FirestoreFailedEventRepository();

      await repository.list('user-123');

      expect(mockQuery.limit).toHaveBeenCalledWith(10);
    });

    it('returns empty array when no events found', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockQuery.get.mockResolvedValue({ docs: [] });

      const result = await repository.list('user-123');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns error when query fails', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockQuery.get.mockRejectedValue(new Error('Query failed'));

      const result = await repository.list('user-123');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('orders by createdAt descending', async () => {
      const repository = new FirestoreFailedEventRepository();

      await repository.list('user-123');

      expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('filters by userId', async () => {
      const repository = new FirestoreFailedEventRepository();
      const whereMock = vi.fn(() => mockQuery);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          id: 'new-doc-id',
          set: vi.fn(),
          get: vi.fn(() => Promise.resolve(mockDocSnapshot)),
          delete: vi.fn(),
        })),
        where: whereMock,
      } as MockCollection);

      await repository.list('user-456');

      expect(whereMock).toHaveBeenCalledWith('userId', '==', 'user-456');
    });
  });

  describe('get', () => {
    it('returns failed event by id', async () => {
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.get('event-1');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('test-id-123');
        expect(result.value?.userId).toBe('user-123');
      }
    });

    it('returns null when event not found', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockDocSnapshot.exists = false;

      const result = await repository.get('non-existent-id');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when get fails', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          get: vi.fn().mockRejectedValue(new Error('Network error')),
        })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const result = await repository.get('event-1');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('delete', () => {
    it('deletes failed event successfully', async () => {
      const repository = new FirestoreFailedEventRepository();
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'event-1',
          }),
          delete: mockDelete,
        })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const result = await repository.delete('event-1');

      expect(isOk(result)).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND error when event does not exist', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ exists: false }),
        })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const result = await repository.delete('non-existent-id');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('not found');
      }
    });

    it('returns error when delete fails', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ exists: true }),
          delete: vi.fn().mockRejectedValue(new Error('Delete failed')),
        })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const result = await repository.delete('event-1');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Delete failed');
      }
    });

    it('returns error when get check fails', async () => {
      const repository = new FirestoreFailedEventRepository();
      mockDb.collection.mockReturnValue({
        doc: vi.fn(() => ({
          get: vi.fn().mockRejectedValue(new Error('Get failed')),
        })),
        where: vi.fn(() => mockQuery),
      } as MockCollection);

      const result = await repository.delete('event-1');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('createFailedEventRepository factory', () => {
    it('returns a new repository instance', () => {
      const repository = createFailedEventRepository();

      expect(repository).toBeInstanceOf(FirestoreFailedEventRepository);
    });
  });

  describe('date parsing', () => {
    it('correctly parses ISO date strings', async () => {
      const repository = new FirestoreFailedEventRepository();
      const isoDate = '2025-01-15T10:30:00.000Z';
      mockDocSnapshot.data.mockReturnValue({
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Meeting',
        summary: 'Sync',
        start: isoDate,
        end: null,
        location: null,
        description: null,
        error: 'Error',
        reasoning: 'Reason',
        createdAt: isoDate,
      });

      const result = await repository.get('event-1');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value?.createdAt).toBeInstanceOf(Date);
        expect(result.value?.createdAt.toISOString()).toBe(isoDate);
      }
    });
  });
});
