/**
 * Tests for useGitHubEventLog hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitHubEventLog } from '../useGitHubEventLog.js';

const mockGetAccessToken = vi.fn();
const mockGetGitHubEventLog = vi.fn();
const mockHydrateGitHubEventLogRows = vi.fn();
const mockInitializeFirebase = vi.fn();
const mockAuthenticateFirebase = vi.fn();
const mockIsFirebaseAuthenticated = vi.fn();
const mockGetFirestoreClient = vi.fn();
const mockCollection = vi.fn();
const mockQuery = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOnSnapshot = vi.fn();

interface SnapshotDoc<T> {
  id: string;
  data: () => T;
}

interface SnapshotChange<T> {
  type: 'added' | 'modified';
  doc: SnapshotDoc<T>;
}

interface SnapshotValue<T> {
  docChanges: () => SnapshotChange<T>[];
}

vi.mock('../../context/index.js', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: { sub: string };
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: true,
    user: { sub: 'user-123' },
  }),
}));

vi.mock('../../services/codeAgentApi.js', () => ({
  getGitHubEventLog: (...args: unknown[]): unknown => mockGetGitHubEventLog(...args),
  hydrateGitHubEventLogRows: (...args: unknown[]): unknown => mockHydrateGitHubEventLogRows(...args),
}));

vi.mock('../../services/firebase.js', () => ({
  getFirestoreClient: (): unknown => mockGetFirestoreClient(),
  authenticateFirebase: (...args: unknown[]): unknown => mockAuthenticateFirebase(...args),
  isFirebaseAuthenticated: (): boolean => mockIsFirebaseAuthenticated(),
  initializeFirebase: (): void => {
    mockInitializeFirebase();
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]): unknown => mockCollection(...args),
  query: (...args: unknown[]): unknown => mockQuery(...args),
  orderBy: (...args: unknown[]): unknown => mockOrderBy(...args),
  limit: (...args: unknown[]): unknown => mockLimit(...args),
  onSnapshot: (...args: unknown[]): unknown => mockOnSnapshot(...args),
}));

function createRow(
  id: string,
  overrides: Partial<ReturnType<typeof createRowBase>> = {},
): ReturnType<typeof createRowBase> {
  return {
    ...createRowBase(id),
    ...overrides,
  };
}

function createRowBase(id: string): {
  id: string;
  decisionId: string;
  normalizedEventId: string;
  deliveryId: string;
  githubEventName: string;
  eventType: 'pull_request';
  action: 'opened';
  repository: string;
  repositoryId: number;
  pullRequestNumber: number;
  pullRequestId: number;
  senderLogin: string;
  senderType: string;
  authPassedAt: string;
  updatedAt: string;
  decisionState: 'completed';
  decisionOutcome: 'request_review';
  decidedBy: 'github_agent';
  reason: string;
  dispatchAction: 'create_review_task';
  reviewTypes: readonly ['architecture'];
  taskId: string;
  workerType: string;
  decisionLatencyMs: number;
} {
  return {
    id,
    decisionId: `ed_${id}`,
    normalizedEventId: `normalized-${id}`,
    deliveryId: id,
    githubEventName: 'pull_request',
    eventType: 'pull_request' as const,
    action: 'opened',
    repository: 'intexuraos/test-repo',
    repositoryId: 101,
    pullRequestNumber: 42,
    pullRequestId: 4200,
    senderLogin: 'octocat',
    senderType: 'User',
    authPassedAt: '2026-03-12T10:00:00.000Z',
    updatedAt: '2026-03-12T10:00:00.000Z',
    decisionState: 'completed' as const,
    decisionOutcome: 'request_review' as const,
    decidedBy: 'github_agent' as const,
    reason: 'LLM request_review: architecture',
    dispatchAction: 'create_review_task' as const,
    reviewTypes: ['architecture'] as const,
    taskId: 'task-review-1',
    workerType: 'qwen3.5-plus',
    decisionLatencyMs: 500,
  };
}

describe('useGitHubEventLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockGetFirestoreClient.mockReturnValue({ name: 'db' });
    mockCollection.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'collection', args }));
    mockQuery.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'query', args }));
    mockOrderBy.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'orderBy', args }));
    mockLimit.mockImplementation((...args: unknown[]): { kind: string; args: unknown[] } => ({ kind: 'limit', args }));
    mockIsFirebaseAuthenticated.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates changed rows from Firestore previews without replacing untouched row objects', async () => {
    let snapshotHandler: ((snapshot: SnapshotValue<{
      githubEventName: string;
      eventType: string;
      action: string | null;
      repository: string | null;
      pullRequestNumber: number | null;
      authPassedAt: { toDate: () => Date };
      updatedAt: { toDate: () => Date };
      decisionState: 'pending' | 'completed';
      decisionOutcome: 'dispatch' | 'skip' | 'request_review' | null;
      rowVersion: number;
    }>) => void) | undefined;
    let resolveHydration: ((value: {
      rows: ReturnType<typeof createRow>[];
    }) => void) | undefined;

    mockGetGitHubEventLog.mockResolvedValue({
      rows: [createRow('delivery-1')],
      nextCursor: undefined,
    });
    mockHydrateGitHubEventLogRows.mockImplementation((): Promise<{ rows: ReturnType<typeof createRow>[] }> => new Promise((resolve) => {
      resolveHydration = resolve;
    }));
    mockOnSnapshot.mockImplementation((_query: unknown, onNext: typeof snapshotHandler) => {
      snapshotHandler = onNext;
      return vi.fn();
    });

    const { result } = renderHook(() => useGitHubEventLog());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const originalFirstRow = result.current.rows[0];
    expect(originalFirstRow?.id).toBe('delivery-1');

    await act(async () => {
      snapshotHandler?.({
        docChanges: () => [],
      });
    });

    await act(async () => {
      snapshotHandler?.({
        docChanges: () => [
          {
            type: 'added',
            doc: {
              id: 'delivery-2',
              data: (): {
                githubEventName: string;
                eventType: string;
                action: string | null;
                repository: string | null;
                pullRequestNumber: number | null;
                authPassedAt: { toDate: () => Date };
                updatedAt: { toDate: () => Date };
                decisionState: 'pending' | 'completed';
                decisionOutcome: 'dispatch' | 'skip' | 'request_review' | null;
                rowVersion: number;
              } => ({
                githubEventName: 'pull_request',
                eventType: 'pull_request',
                action: 'review_requested',
                repository: 'intexuraos/test-repo',
                pullRequestNumber: 77,
                authPassedAt: { toDate: (): Date => new Date('2026-03-12T11:00:00.000Z') },
                updatedAt: { toDate: (): Date => new Date('2026-03-12T11:00:00.000Z') },
                decisionState: 'pending',
                decisionOutcome: null,
                rowVersion: 1,
              }),
            },
          },
        ],
      });
    });

    expect(result.current.rows.some((row) => row.id === 'delivery-2' && row.isHydrating)).toBe(true);

    await waitFor(() => {
      expect(mockHydrateGitHubEventLogRows).toHaveBeenCalledWith('test-token', ['delivery-2']);
    });

    await act(async () => {
      resolveHydration?.({
        rows: [createRow('delivery-2', {
          decisionId: null,
          normalizedEventId: null,
          deliveryId: 'delivery-2',
          action: 'review_requested',
          pullRequestNumber: 77,
          decisionState: 'pending',
          decisionOutcome: null,
          decidedBy: null,
          reason: null,
          dispatchAction: null,
          reviewTypes: [],
          taskId: null,
          workerType: null,
          decisionLatencyMs: null,
        })],
      });
    });

    await waitFor(() => {
      const hydratedRow = result.current.rows.find((row) => row.id === 'delivery-2');
      expect(hydratedRow?.isHydrating).toBe(false);
      expect(hydratedRow?.action).toBe('review_requested');
    });

    expect(result.current.rows.find((row) => row.id === 'delivery-1')).toBe(originalFirstRow);
  });
});
