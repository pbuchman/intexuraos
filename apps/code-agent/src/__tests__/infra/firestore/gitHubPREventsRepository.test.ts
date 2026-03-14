/**
 * Tests for Firestore GitHub PR events repository.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { CreateGitHubPREventInput, GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';

// Mock getFirestore BEFORE importing the repository
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const mockGetFirestore = vi.mocked(getFirestore);

// Mock logger
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

// Helper to create a valid event input
function createEventInput(
  overrides: Partial<CreateGitHubPREventInput> = {}
): CreateGitHubPREventInput {
  return {
    githubEventId: 12345678,
    deliveryId: null,
    repository: 'intexuraos/test-repo',
    repositoryId: 987654321,
    pullRequestNumber: 42,
    pullRequestId: 123456789,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'testuser',
    senderId: 12345,
    senderType: 'User',
    prAuthorLogin: null,
    title: 'Test PR',
    body: 'Test body',
    state: 'open',
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    payload: { action: 'opened' },
    ...overrides,
  };
}

// Helper to create a mock DocumentSnapshot
function createMockDocSnapshot(
  id: string,
  data: unknown
): { id: string; exists: boolean; data: () => unknown } {
  return {
    id,
    exists: true,
    data: () => data,
  };
}

// Helper to create a mock QuerySnapshot
function createMockQuerySnapshot(docs: unknown[]): { empty: boolean; docs: unknown[] } {
  return {
    empty: docs.length === 0,
    docs,
  };
}

describe('createFirestoreGitHubPREventsRepository', () => {
  describe('save()', () => {
    it('should save a new event successfully', async () => {
      const mockDocRef = {
        id: 'new-event-id',
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
        doc: vi.fn(() => mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const input = createEventInput();
      const result = await repository.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.githubEventId).toBe(12345678);
        expect(result.value.repository).toBe('intexuraos/test-repo');
        expect(result.value.pullRequestNumber).toBe(42);
        expect(result.value.eventType).toBe('pull_request');
        expect(result.value.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
        expect(mockDocRef.set).toHaveBeenCalled();
        expect(mockQuery.doc).toHaveBeenCalled();
      }
    });

    it('should return DUPLICATE_EVENT error for duplicate deliveryId (deduplication)', async () => {
      const existingData: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 12345678,
        deliveryId: 'abc-123',
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'existinguser',
        senderId: 99999,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Existing PR',
        body: 'Existing body',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        processedAt: new Date('2024-01-01T01:00:00Z'),
        payload: { action: 'opened' },
      };

      const existingDoc = createMockDocSnapshot('existing-id', existingData);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([existingDoc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const input = createEventInput({ deliveryId: 'abc-123' });
      const result = await repository.save(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DUPLICATE_EVENT');
        expect(result.error.message).toContain('abc-123');
      }
    });

    it('should skip deduplication when deliveryId is null', async () => {
      const mockDocRef = {
        id: 'new-event-id',
        set: vi.fn().mockResolvedValue(undefined),
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
        doc: vi.fn(() => mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const input = createEventInput({ deliveryId: null });
      const result = await repository.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deliveryId).toBeNull();
        expect(mockDocRef.set).toHaveBeenCalled();
      }
    });

    it('should handle Firestore errors gracefully', async () => {
      const mockDocRef = {
        id: 'new-event-id',
        set: vi.fn().mockRejectedValue(new Error('Firestore connection failed')),
      };

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Firestore connection failed')),
        doc: vi.fn(() => mockDocRef),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const input = createEventInput();
      const result = await repository.save(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(result.error.message).toContain('Firestore connection failed');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });

  describe('findByPullRequest()', () => {
    it('should return events for a specific pull request', async () => {
      const eventData1: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'First PR',
        body: 'First body',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        processedAt: new Date('2024-01-02T00:05:00Z'),
        payload: {},
      };

      const doc1 = createMockDocSnapshot('doc1', eventData1);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc1])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByPullRequest('intexuraos/test-repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        const firstEvent = result.value[0];
        if (firstEvent === undefined) {
          throw new Error('firstEvent is undefined');
        }
        expect(firstEvent.githubEventId).toBe(111);
        expect(mockQuery.where).toHaveBeenCalledWith('repository', '==', 'intexuraos/test-repo');
        expect(mockQuery.where).toHaveBeenCalledWith('pullRequestNumber', '==', 42);
        expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(mockQuery.limit).toHaveBeenCalledWith(100);
      }
    });

    it('should return empty array when no events found', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByPullRequest('intexuraos/unknown', 999);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle query errors', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByPullRequest('intexuraos/test-repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });

    it('should handle Firestore Timestamp objects for dates', async () => {
      const createdAtDate = new Date('2024-01-02T00:00:00Z');
      const processedAtDate = new Date('2024-01-02T00:05:00Z');
      const mergedAtDate = new Date('2024-01-03T00:00:00Z');

      const eventDataWithTimestamps = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'closed',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'PR with Timestamps',
        body: 'Body',
        state: 'closed',
        baseBranch: null,
        mergedAt: { toDate: (): Date => mergedAtDate },
        createdAt: { toDate: (): Date => createdAtDate },
        processedAt: { toDate: (): Date => processedAtDate },
        payload: {},
      };

      const doc = createMockDocSnapshot('doc1', eventDataWithTimestamps);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByPullRequest('intexuraos/test-repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const firstEvent = result.value[0];
        expect(firstEvent?.createdAt).toEqual(createdAtDate);
        expect(firstEvent?.processedAt).toEqual(processedAtDate);
        expect(firstEvent?.mergedAt).toEqual(mergedAtDate);
      }
    });
  });

  describe('findByRepository()', () => {
    it('should return events for a repository ordered by createdAt desc', async () => {
      const eventData1: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'PR 1',
        body: 'Body 1',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        processedAt: new Date('2024-01-02T00:05:00Z'),
        payload: {},
      };

      const doc1 = createMockDocSnapshot('doc1', eventData1);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc1])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByRepository('intexuraos/test-repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        const firstEvent = result.value[0];
        expect(firstEvent?.repository).toBe('intexuraos/test-repo');
        expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(mockQuery.limit).toHaveBeenCalledWith(50); // default limit
      }
    });

    it('should use custom limit when provided', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      await repository.findByRepository('intexuraos/test-repo', 25);

      expect(mockQuery.limit).toHaveBeenCalledWith(25);
    });

    it('should return empty array when no events found', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByRepository('intexuraos/unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle query errors', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByRepository('intexuraos/test-repo');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });

    it('should handle events with mergedAt date', async () => {
      const eventData: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'closed',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Merged PR',
        body: 'Body',
        state: 'closed',
        baseBranch: null,
        mergedAt: new Date('2024-01-02T00:00:00Z'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        processedAt: new Date('2024-01-02T00:05:00Z'),
        payload: {},
      };

      const doc = createMockDocSnapshot('doc1', eventData);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByRepository('intexuraos/test-repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const firstEvent = result.value[0];
        expect(firstEvent?.mergedAt).toEqual(new Date('2024-01-02T00:00:00Z'));
      }
    });

    it('should handle events with null mergedAt', async () => {
      const eventData: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Open PR',
        body: 'Body',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        processedAt: new Date('2024-01-01T00:05:00Z'),
        payload: {},
      };

      const doc = createMockDocSnapshot('doc1', eventData);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByRepository('intexuraos/test-repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const firstEvent = result.value[0];
        expect(firstEvent?.mergedAt).toBeNull();
      }
    });

    it('should handle Firestore Timestamp objects for dates', async () => {
      const mergedAtDate = new Date('2024-01-15T12:00:00Z');
      const createdAtDate = new Date('2024-01-01T00:00:00Z');
      const processedAtDate = new Date('2024-01-01T00:05:00Z');

      const eventDataWithTimestamps = {
        githubEventId: 98765,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'closed',
        senderLogin: 'testuser',
        senderId: 12345,
        senderType: 'User',
        title: 'Test PR',
        body: 'Test body',
        state: 'closed',
        baseBranch: null,
        mergedAt: { toDate: (): Date => mergedAtDate },
        createdAt: { toDate: (): Date => createdAtDate },
        processedAt: { toDate: (): Date => processedAtDate },
        payload: {},
      };

      const doc = createMockDocSnapshot('doc-with-timestamps', eventDataWithTimestamps);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findByRepository('intexuraos/test-repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const event = result.value[0];
        expect(event?.createdAt).toEqual(createdAtDate);
        expect(event?.processedAt).toEqual(processedAtDate);
        expect(event?.mergedAt).toEqual(mergedAtDate);
      }
    });
  });

  describe('findAll()', () => {
    it('should return all events ordered by createdAt desc', async () => {
      const eventData1: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/repo-a',
        repositoryId: 111111,
        pullRequestNumber: 1,
        pullRequestId: 100001,
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'PR 1',
        body: 'Body 1',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        processedAt: new Date('2024-01-02T00:05:00Z'),
        payload: {},
      };

      const eventData2: Omit<GitHubPREvent, 'id'> = {
        githubEventId: 222,
        deliveryId: null,
        repository: 'intexuraos/repo-b',
        repositoryId: 222222,
        pullRequestNumber: 2,
        pullRequestId: 100002,
        eventType: 'pull_request',
        action: 'closed',
        senderLogin: 'user2',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'PR 2',
        body: 'Body 2',
        state: 'closed',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        processedAt: new Date('2024-01-01T00:05:00Z'),
        payload: {},
      };

      const doc1 = createMockDocSnapshot('doc1', eventData1);
      const doc2 = createMockDocSnapshot('doc2', eventData2);

      const mockQuery = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc1, doc2])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.repository).toBe('intexuraos/repo-a');
        expect(result.value[1]?.repository).toBe('intexuraos/repo-b');
        expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(mockQuery.limit).toHaveBeenCalledWith(50);
      }
    });

    it('should use custom limit when provided', async () => {
      const mockQuery = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      await repository.findAll(25);

      expect(mockQuery.limit).toHaveBeenCalledWith(25);
    });

    it('should return empty array when no events found', async () => {
      const mockQuery = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle query errors', async () => {
      const mockQuery = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findAll();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });

    it('should handle Firestore Timestamp objects for dates', async () => {
      const createdAtDate = new Date('2024-01-02T00:00:00Z');
      const processedAtDate = new Date('2024-01-02T00:05:00Z');
      const mergedAtDate = new Date('2024-01-03T00:00:00Z');

      const eventDataWithTimestamps = {
        githubEventId: 111,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request',
        action: 'closed',
        senderLogin: 'user1',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'PR with Timestamps',
        body: 'Body',
        state: 'closed',
        baseBranch: null,
        mergedAt: { toDate: (): Date => mergedAtDate },
        createdAt: { toDate: (): Date => createdAtDate },
        processedAt: { toDate: (): Date => processedAtDate },
        payload: {},
      };

      const doc = createMockDocSnapshot('doc1', eventDataWithTimestamps);

      const mockQuery = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const firstEvent = result.value[0];
        expect(firstEvent?.createdAt).toEqual(createdAtDate);
        expect(firstEvent?.processedAt).toEqual(processedAtDate);
        expect(firstEvent?.mergedAt).toEqual(mergedAtDate);
      }
    });
  });

  describe('findReviewComments()', () => {
    it('should return comments matching the review ID', async () => {
      const matchingEvent = {
        githubEventId: 555,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request_review_comment',
        action: 'created',
        senderLogin: 'reviewer',
        senderId: 333,
        senderType: 'User',
        prAuthorLogin: null,
        title: null,
        body: 'Fix this line',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        processedAt: new Date('2024-01-02T00:05:00Z'),
        payload: {
          comment: {
            id: 100,
            pull_request_review_id: 9999,
            path: 'src/index.ts',
            line: 42,
            body: 'Fix this line',
            user: { login: 'reviewer' },
          },
        },
      };

      const doc = createMockDocSnapshot('doc1', matchingEvent);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findReviewComments('intexuraos/test-repo', 42, 9999);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.body).toBe('Fix this line');
        expect(mockQuery.where).toHaveBeenCalledWith('eventType', '==', 'pull_request_review_comment');
        expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
        expect(mockQuery.limit).toHaveBeenCalledWith(50);
      }
    });

    it('should filter out comments from different reviews', async () => {
      const matchingEvent = {
        githubEventId: 555,
        deliveryId: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 987654321,
        pullRequestNumber: 42,
        pullRequestId: 123456789,
        eventType: 'pull_request_review_comment',
        action: 'created',
        senderLogin: 'reviewer',
        senderId: 333,
        senderType: 'User',
        prAuthorLogin: null,
        title: null,
        body: 'Matching comment',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        processedAt: new Date('2024-01-02T00:05:00Z'),
        payload: {
          comment: { id: 100, pull_request_review_id: 9999, path: 'a.ts', line: 1, body: 'Matching', user: { login: 'reviewer' } },
        },
      };

      const nonMatchingEvent = {
        ...matchingEvent,
        githubEventId: 556,
        body: 'Different review comment',
        payload: {
          comment: { id: 101, pull_request_review_id: 8888, path: 'b.ts', line: 5, body: 'Different', user: { login: 'other' } },
        },
      };

      const doc1 = createMockDocSnapshot('doc1', matchingEvent);
      const doc2 = createMockDocSnapshot('doc2', nonMatchingEvent);

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([doc1, doc2])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findReviewComments('intexuraos/test-repo', 42, 9999);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.body).toBe('Matching comment');
      }
    });

    it('should return empty array when no comments match', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(createMockQuerySnapshot([])),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findReviewComments('intexuraos/test-repo', 42, 9999);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle Firestore errors', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      mockGetFirestore.mockReturnValue({
        collection: vi.fn(() => mockQuery),
      } as never);

      const repository = createFirestoreGitHubPREventsRepository({
        logger: mockLogger,
      });

      const result = await repository.findReviewComments('intexuraos/test-repo', 42, 9999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });
});
