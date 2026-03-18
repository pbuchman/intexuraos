/** @vitest-environment jsdom */

/**
 * Tests for useDispatchQueue hook.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDispatchQueue } from '../useDispatchQueue.js';

const mockGetAccessToken = vi.fn();
const mockUser = { sub: 'user-123' };
const mockGetDispatchQueue = vi.fn();
const mockInitializeFirebase = vi.fn();
const mockAuthenticateFirebase = vi.fn();
const mockIsFirebaseAuthenticated = vi.fn();
const mockGetFirestoreClient = vi.fn();
const mockCollection = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockOnSnapshot = vi.fn();
const mockLimit = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: typeof mockUser;
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: true,
    user: mockUser,
  }),
}));

vi.mock('../../services/codeAgentApi.js', () => ({
  getDispatchQueue: (...args: unknown[]): unknown => mockGetDispatchQueue(...args),
}));

vi.mock('../../services/firebase.js', () => ({
  getFirestoreClient: (): unknown => mockGetFirestoreClient(),
  authenticateFirebase: (...args: unknown[]): unknown => mockAuthenticateFirebase(...args),
  isFirebaseAuthenticated: (): boolean => mockIsFirebaseAuthenticated(),
  initializeFirebase: (): void => { mockInitializeFirebase(); },
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]): unknown => mockCollection(...args),
  limit: (...args: unknown[]): unknown => mockLimit(...args),
  onSnapshot: (...args: unknown[]): unknown => mockOnSnapshot(...args),
  orderBy: (...args: unknown[]): unknown => mockOrderBy(...args),
  query: (...args: unknown[]): unknown => mockQuery(...args),
  where: (...args: unknown[]): unknown => mockWhere(...args),
}));

describe('useDispatchQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockGetFirestoreClient.mockReturnValue({ name: 'db' });
    mockCollection.mockImplementation((...args: unknown[]) => ({ kind: 'collection', args }));
    mockQuery.mockImplementation((...args: unknown[]) => ({ kind: 'query', args }));
    mockWhere.mockImplementation((...args: unknown[]) => ({ kind: 'where', args }));
    mockOrderBy.mockImplementation((...args: unknown[]) => ({ kind: 'orderBy', args }));
    mockLimit.mockImplementation((...args: unknown[]) => ({ kind: 'limit', args }));
    mockIsFirebaseAuthenticated.mockReturnValue(true);
    mockOnSnapshot.mockReturnValue(vi.fn());
  });

  it('fetches queue data on mount and sets state', async () => {
    mockGetDispatchQueue.mockResolvedValue({
      tasks: [
        { id: 'task-1', prompt: 'Fix bug', workerType: 'opus', queuedAt: '2026-03-17T10:00:00Z', createdAt: '2026-03-17T09:55:00Z', position: 1 },
      ],
      totalQueued: 1,
      maxQueueSize: 10,
    });

    const { result } = renderHook(() => useDispatchQueue());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetDispatchQueue).toHaveBeenCalledWith('test-token');
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.totalQueued).toBe(1);
    expect(result.current.maxQueueSize).toBe(10);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    mockGetDispatchQueue.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDispatchQueue());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.tasks).toEqual([]);
  });

  it('sets up Firestore real-time listener', async () => {
    mockGetDispatchQueue.mockResolvedValue({
      tasks: [],
      totalQueued: 0,
      maxQueueSize: 10,
    });

    renderHook(() => useDispatchQueue());

    await waitFor(() => {
      expect(mockOnSnapshot).toHaveBeenCalled();
    });

    expect(mockQuery).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'queued');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-123');
    expect(mockOrderBy).toHaveBeenCalledWith('queuedAt', 'asc');
    expect(mockLimit).toHaveBeenCalledWith(100);
  });

  it('refetches via API when Firestore snapshot fires', async () => {
    mockGetDispatchQueue.mockResolvedValue({
      tasks: [],
      totalQueued: 0,
      maxQueueSize: 10,
    });

    let snapshotCallback: (() => void) | undefined;
    mockOnSnapshot.mockImplementation((_query: unknown, onNext: () => void): ReturnType<typeof vi.fn> => {
      snapshotCallback = onNext;
      return vi.fn();
    });

    renderHook(() => useDispatchQueue());

    await waitFor(() => {
      expect(mockGetDispatchQueue).toHaveBeenCalledTimes(1);
    });

    // First snapshot is skipped (initial snapshot, no refetch needed)
    snapshotCallback?.();

    // Simulate a subsequent Firestore snapshot event (actual change)
    mockGetDispatchQueue.mockResolvedValue({
      tasks: [{ id: 'task-2', prompt: 'New task', workerType: 'auto', queuedAt: '2026-03-17T11:00:00Z', createdAt: '2026-03-17T10:55:00Z', position: 1 }],
      totalQueued: 1,
      maxQueueSize: 10,
    });

    snapshotCallback?.();

    await waitFor(() => {
      expect(mockGetDispatchQueue).toHaveBeenCalledTimes(2);
    });
  });

  it('initializes Firebase when not authenticated', async () => {
    mockIsFirebaseAuthenticated.mockReturnValue(false);
    mockGetDispatchQueue.mockResolvedValue({
      tasks: [],
      totalQueued: 0,
      maxQueueSize: 10,
    });
    mockOnSnapshot.mockReturnValue(vi.fn());

    renderHook(() => useDispatchQueue());

    await waitFor(() => {
      expect(mockInitializeFirebase).toHaveBeenCalled();
    });
    expect(mockAuthenticateFirebase).toHaveBeenCalledWith('test-token');
  });
});
