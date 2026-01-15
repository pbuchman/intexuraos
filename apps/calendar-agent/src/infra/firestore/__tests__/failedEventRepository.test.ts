import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockCollection {
  doc: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

interface MockDb {
  collection: (name: string) => MockCollection;
}

const mockDocSet = vi.fn();
const mockDocDelete = vi.fn();
const mockDocGet = vi.fn();
const mockQueryGet = vi.fn();
const mockCollectionDoc = vi.fn(() => ({
  set: mockDocSet,
  delete: mockDocDelete,
  get: mockDocGet,
}));
const mockCollectionWhere = vi.fn();
const mockCollectionOrderBy = vi.fn();
const mockCollectionLimit = vi.fn();
const mockCollectionGet = vi.fn();
const mockCollection = vi.fn(() => ({
  doc: mockCollectionDoc,
  where: mockCollectionWhere,
  orderBy: mockCollectionOrderBy,
  limit: mockCollectionLimit,
  get: mockCollectionGet,
}));

const mockFirestore = {
  collection: mockCollection,
} as MockDb;

vi.mock('@intexuraos/infra-firestore', (): { getFirestore: () => typeof mockFirestore } => ({
  getFirestore: () => mockFirestore,
}));

describe('FirestoreFailedEventRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('create', () => {
    it('creates a failed event successfully', async () => {
      mockDocSet.mockResolvedValue(undefined);
      mockCollectionDoc.mockReturnValue({
        id: 'test-doc-id',
        set: mockDocSet,
        delete: mockDocDelete,
        get: mockDocGet,
      });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const input = {
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Meeting tomorrow at 2pm',
        summary: 'Meeting',
        start: '2026-01-16T14:00:00Z',
        end: '2026-01-16T15:00:00Z',
        location: 'Office',
        description: 'Team sync',
        error: 'Invalid time format',
        reasoning: 'Could not parse timezone',
      };

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('test-doc-id');
        expect(result.value.userId).toBe('user-123');
        expect(result.value.actionId).toBe('action-456');
        expect(result.value.originalText).toBe('Meeting tomorrow at 2pm');
        expect(result.value.summary).toBe('Meeting');
        expect(result.value.start).toBe('2026-01-16T14:00:00Z');
        expect(result.value.end).toBe('2026-01-16T15:00:00Z');
        expect(result.value.location).toBe('Office');
        expect(result.value.description).toBe('Team sync');
        expect(result.value.error).toBe('Invalid time format');
        expect(result.value.reasoning).toBe('Could not parse timezone');
        expect(result.value.createdAt).toEqual(new Date('2026-01-15T12:00:00Z'));
      }
      expect(mockCollection).toHaveBeenCalledWith('calendar_failed_events');
      expect(mockDocSet).toHaveBeenCalledWith({
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Meeting tomorrow at 2pm',
        summary: 'Meeting',
        start: '2026-01-16T14:00:00Z',
        end: '2026-01-16T15:00:00Z',
        location: 'Office',
        description: 'Team sync',
        error: 'Invalid time format',
        reasoning: 'Could not parse timezone',
        createdAt: '2026-01-15T12:00:00.000Z',
      });
    });

    it('creates a failed event with null optional fields', async () => {
      mockDocSet.mockResolvedValue(undefined);
      mockCollectionDoc.mockReturnValue({
        id: 'test-doc-id',
        set: mockDocSet,
        delete: mockDocDelete,
        get: mockDocGet,
      });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const input = {
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Unknown format',
        summary: 'Unknown',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Could not parse',
        reasoning: 'Invalid format',
      };

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.start).toBeNull();
        expect(result.value.end).toBeNull();
        expect(result.value.location).toBeNull();
        expect(result.value.description).toBeNull();
      }
      expect(mockDocSet).toHaveBeenCalledWith({
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Unknown format',
        summary: 'Unknown',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Could not parse',
        reasoning: 'Invalid format',
        createdAt: '2026-01-15T12:00:00.000Z',
      });
    });

    it('returns INTERNAL_ERROR when Firestore throws', async () => {
      mockCollectionDoc.mockReturnValue({
        id: 'test-doc-id',
        set: mockDocSet,
        delete: mockDocDelete,
        get: mockDocGet,
      });
      mockDocSet.mockRejectedValue(new Error('Firestore connection failed'));

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const input = {
        userId: 'user-123',
        actionId: 'action-456',
        originalText: 'Meeting',
        summary: 'Meeting',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Error',
        reasoning: 'Reasoning',
      };

      const result = await repository.create(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Firestore connection failed');
      }
    });
  });

  describe('list', () => {
    it('lists failed events with default limit', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          data: (): {
            userId: string;
            actionId: string;
            originalText: string;
            summary: string;
            start: string;
            end: string;
            location: string;
            description: null;
            error: string;
            reasoning: string;
            createdAt: string;
          } => ({
            userId: 'user-123',
            actionId: 'action-1',
            originalText: 'Meeting',
            summary: 'Meeting',
            start: '2026-01-16T14:00:00Z',
            end: '2026-01-16T15:00:00Z',
            location: 'Office',
            description: null,
            error: 'Error',
            reasoning: 'Reasoning',
            createdAt: '2026-01-15T10:00:00Z',
          }),
        },
        {
          id: 'doc-2',
          data: (): {
            userId: string;
            actionId: string;
            originalText: string;
            summary: string;
            start: string;
            end: string;
            location: string;
            description: string;
            error: string;
            reasoning: string;
            createdAt: string;
          } => ({
            userId: 'user-123',
            actionId: 'action-2',
            originalText: 'Lunch',
            summary: 'Lunch',
            start: '2026-01-16T12:00:00Z',
            end: '2026-01-16T13:00:00Z',
            location: 'Cafe',
            description: 'With team',
            error: 'Error',
            reasoning: 'Reasoning',
            createdAt: '2026-01-15T11:00:00Z',
          }),
        },
      ];

      mockQueryGet.mockResolvedValue({ docs: mockDocs });
      mockCollectionLimit.mockReturnValue({ get: mockQueryGet });
      mockCollectionOrderBy.mockReturnValue({ limit: mockCollectionLimit });
      mockCollectionWhere.mockReturnValue({ orderBy: mockCollectionOrderBy });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.list('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.id).toBe('doc-1');
        expect(result.value[0]?.userId).toBe('user-123');
        expect(result.value[0]?.summary).toBe('Meeting');
        expect(result.value[1]?.id).toBe('doc-2');
        expect(result.value[1]?.summary).toBe('Lunch');
      }
      expect(mockCollection).toHaveBeenCalledWith('calendar_failed_events');
      expect(mockCollectionWhere).toHaveBeenCalledWith('userId', '==', 'user-123');
      expect(mockCollectionOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
      expect(mockCollectionLimit).toHaveBeenCalledWith(10);
    });

    it('lists failed events with custom limit', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          data: (): {
            userId: string;
            actionId: string;
            originalText: string;
            summary: string;
            start: null;
            end: null;
            location: null;
            description: null;
            error: string;
            reasoning: string;
            createdAt: string;
          } => ({
            userId: 'user-123',
            actionId: 'action-1',
            originalText: 'Meeting',
            summary: 'Meeting',
            start: null,
            end: null,
            location: null,
            description: null,
            error: 'Error',
            reasoning: 'Reasoning',
            createdAt: '2026-01-15T10:00:00Z',
          }),
        },
      ];

      mockQueryGet.mockResolvedValue({ docs: mockDocs });
      mockCollectionLimit.mockReturnValue({ get: mockQueryGet });
      mockCollectionOrderBy.mockReturnValue({ limit: mockCollectionLimit });
      mockCollectionWhere.mockReturnValue({ orderBy: mockCollectionOrderBy });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.list('user-123', { limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
      expect(mockCollectionLimit).toHaveBeenCalledWith(5);
    });

    it('returns empty array when no failed events exist', async () => {
      mockQueryGet.mockResolvedValue({ docs: [] });
      mockCollectionLimit.mockReturnValue({ get: mockQueryGet });
      mockCollectionOrderBy.mockReturnValue({ limit: mockCollectionLimit });
      mockCollectionWhere.mockReturnValue({ orderBy: mockCollectionOrderBy });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.list('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns INTERNAL_ERROR when Firestore throws', async () => {
      mockCollectionWhere.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.list('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database connection failed');
      }
    });
  });

  describe('get', () => {
    it('returns null when document does not exist', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.get('non-existent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
      expect(mockCollection).toHaveBeenCalledWith('calendar_failed_events');
      expect(mockCollectionDoc).toHaveBeenCalledWith('non-existent-id');
    });

    it('returns failed event when document exists', async () => {
      const docData = {
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'Meeting tomorrow',
        summary: 'Meeting',
        start: '2026-01-16T14:00:00Z',
        end: '2026-01-16T15:00:00Z',
        location: 'Office',
        description: 'Team sync',
        error: 'Timezone missing',
        reasoning: 'Need explicit timezone',
        createdAt: '2026-01-15T10:00:00Z',
      };

      mockDocGet.mockResolvedValue({
        exists: true,
        id: 'doc-1',
        data: () => docData,
      });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.get('doc-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('doc-1');
        expect(result.value?.userId).toBe('user-123');
        expect(result.value?.summary).toBe('Meeting');
        expect(result.value?.start).toBe('2026-01-16T14:00:00Z');
        expect(result.value?.end).toBe('2026-01-16T15:00:00Z');
        expect(result.value?.location).toBe('Office');
        expect(result.value?.description).toBe('Team sync');
        expect(result.value?.error).toBe('Timezone missing');
        expect(result.value?.reasoning).toBe('Need explicit timezone');
        expect(result.value?.createdAt).toEqual(new Date('2026-01-15T10:00:00Z'));
      }
    });

    it('returns failed event with null optional fields', async () => {
      const docData = {
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'Unknown',
        summary: 'Unknown',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Could not parse',
        reasoning: 'Invalid format',
        createdAt: '2026-01-15T10:00:00Z',
      };

      mockDocGet.mockResolvedValue({
        exists: true,
        id: 'doc-1',
        data: () => docData,
      });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.get('doc-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.start).toBeNull();
        expect(result.value?.end).toBeNull();
        expect(result.value?.location).toBeNull();
        expect(result.value?.description).toBeNull();
      }
    });

    it('returns INTERNAL_ERROR when Firestore throws', async () => {
      mockDocGet.mockRejectedValue(new Error('Network error'));

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.get('doc-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Network error');
      }
    });
  });

  describe('delete', () => {
    it('deletes existing failed event', async () => {
      mockDocGet.mockResolvedValue({ exists: true });
      mockDocDelete.mockResolvedValue(undefined);

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.delete('doc-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
      expect(mockCollection).toHaveBeenCalledWith('calendar_failed_events');
      expect(mockCollectionDoc).toHaveBeenCalledWith('doc-1');
      expect(mockDocDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND when document does not exist', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.delete('non-existent-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Failed event not found');
      }
      expect(mockDocDelete).not.toHaveBeenCalled();
    });

    it('returns INTERNAL_ERROR when Firestore throws on get', async () => {
      mockDocGet.mockRejectedValue(new Error('Connection failed'));

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.delete('doc-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Connection failed');
      }
    });

    it('returns INTERNAL_ERROR when Firestore throws on delete', async () => {
      mockDocGet.mockResolvedValue({ exists: true });
      mockDocDelete.mockRejectedValue(new Error('Delete failed'));

      const { FirestoreFailedEventRepository } = await import('../failedEventRepository.js');
      const repository = new FirestoreFailedEventRepository();

      const result = await repository.delete('doc-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Delete failed');
      }
    });
  });

  describe('createFailedEventRepository', () => {
    it('creates a new repository instance', async () => {
      const { createFailedEventRepository, FirestoreFailedEventRepository } = await import(
        '../failedEventRepository.js'
      );

      const repository = createFailedEventRepository();

      expect(repository).toBeInstanceOf(FirestoreFailedEventRepository);
    });
  });
});
