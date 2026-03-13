import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { getFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreGitHubEventLogEntryRepository } from '../../../infra/firestore/gitHubEventLogEntryRepository.js';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('createFirestoreGitHubEventLogEntryRepository', () => {
  it('creates a pending event log row', async () => {
    const mockDocRef = {
      set: vi.fn().mockResolvedValue(undefined),
    };

    const mockCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubEventLogEntryRepository({ logger: mockLogger });
    const result = await repo.createPending({
      id: 'audit-1',
      githubEventName: 'pull_request',
      eventType: 'pull_request',
      action: 'opened',
      repository: 'intexuraos/test-repo',
      pullRequestNumber: 42,
      authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
      updatedAt: new Date('2026-03-12T10:00:00.000Z'),
      decisionState: 'pending',
      decisionOutcome: null,
      rowVersion: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('audit-1');
      expect(result.value.decisionState).toBe('pending');
      expect(result.value.decisionOutcome).toBeNull();
    }
  });

  it('returns FIRESTORE_ERROR when complete cannot find the updated entry', async () => {
    const mockDocRef = {
      update: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ exists: false }),
    };
    const mockCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubEventLogEntryRepository({ logger: mockLogger });
    const result = await repo.complete({
      id: 'audit-missing',
      decisionId: 'ed_audit-missing',
      decisionState: 'completed',
      decisionOutcome: 'skip',
      updatedAt: new Date('2026-03-12T10:10:00.000Z'),
      rowVersion: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIRESTORE_ERROR');
      expect(result.error.message).toBe('Missing GitHub event log entry: audit-missing');
    }
  });

  it('lists recent entries with a valid cursor and emits nextCursor from the last returned row', async () => {
    interface QueryChain {
      startAfter: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
    }

    const startAfter = vi.fn();
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'entry-1',
          data: (): Record<string, unknown> => ({
            githubEventName: 'pull_request',
            eventType: 'pull_request',
            action: 'opened',
            repository: 'intexuraos/test-repo',
            pullRequestNumber: 42,
            authPassedAt: new Date('2026-03-12T10:03:00.000Z'),
            updatedAt: new Date('2026-03-12T10:03:00.000Z'),
            decisionState: 'completed',
            decisionOutcome: 'dispatch',
            decisionId: 'ed_entry-1',
            rowVersion: 2,
          }),
        },
        {
          id: 'entry-2',
          data: (): Record<string, unknown> => ({
            githubEventName: 'issue_comment',
            eventType: 'issue_comment',
            action: 'created',
            repository: 'intexuraos/test-repo',
            pullRequestNumber: 43,
            authPassedAt: { toDate: () => new Date('2026-03-12T10:02:00.000Z') },
            updatedAt: { toDate: () => new Date('2026-03-12T10:02:30.000Z') },
            decisionState: 'pending',
            decisionOutcome: null,
            decisionId: null,
            rowVersion: 1,
          }),
        },
        {
          id: 'entry-3',
          data: (): Record<string, unknown> => ({
            githubEventName: 'unknown',
            eventType: 'unknown',
            action: null,
            repository: null,
            pullRequestNumber: null,
            authPassedAt: '2026-03-12T10:01:00.000Z',
            updatedAt: '2026-03-12T10:01:30.000Z',
            decisionState: 'completed',
            decisionOutcome: 'skip',
            decisionId: 'ed_entry-3',
            rowVersion: 2,
          }),
        },
      ],
    });

    const query: QueryChain = {
      startAfter: vi.fn().mockImplementation((value: Date): QueryChain => {
        startAfter(value);
        return query;
      }),
      limit: vi.fn().mockReturnValue({ get }),
    };
    const mockCollection = {
      orderBy: vi.fn().mockReturnValue(query),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubEventLogEntryRepository({ logger: mockLogger });
    const result = await repo.listRecent({
      limit: 2,
      cursor: '2026-03-12T10:05:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries).toHaveLength(2);
      expect(result.value.entries.map((entry) => entry.id)).toEqual(['entry-1', 'entry-2']);
      expect(result.value.entries[1]?.authPassedAt.toISOString()).toBe('2026-03-12T10:02:00.000Z');
      expect(result.value.entries[1]?.updatedAt.toISOString()).toBe('2026-03-12T10:02:30.000Z');
      expect(result.value.nextCursor).toBe('2026-03-12T10:02:00.000Z');
    }

    expect(startAfter).toHaveBeenCalledWith(new Date('2026-03-12T10:05:00.000Z'));
  });

  it('lists recent entries without startAfter or nextCursor when the cursor is invalid or there is no extra row', async () => {
    const query = {
      startAfter: vi.fn(),
      limit: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [
              {
                id: 'entry-1',
                data: (): Record<string, unknown> => ({
                githubEventName: 'pull_request_review',
                eventType: 'pull_request_review',
                action: 'submitted',
                repository: 'intexuraos/test-repo',
                pullRequestNumber: 44,
                authPassedAt: new Date('2026-03-12T10:04:00.000Z'),
                updatedAt: new Date('2026-03-12T10:04:30.000Z'),
                decisionState: 'completed',
                decisionOutcome: 'request_review',
                decisionId: 'ed_entry-1',
                rowVersion: 2,
              }),
            },
          ],
        }),
      }),
    };
    const mockCollection = {
      orderBy: vi.fn().mockReturnValue(query),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubEventLogEntryRepository({ logger: mockLogger });
    const result = await repo.listRecent({
      limit: 2,
      cursor: 'not-a-date',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries).toHaveLength(1);
      expect(result.value.nextCursor).toBeUndefined();
    }
    expect(query.startAfter).not.toHaveBeenCalled();
  });

  it('finds rows by ids, skips missing docs, and normalizes Firestore date shapes', async () => {
    const snapshotById = new Map<string, {
      exists: boolean;
      id: string;
      data?: () => Record<string, unknown>;
    }>([
      ['entry-date', {
        exists: true,
        id: 'entry-date',
        data: (): Record<string, unknown> => ({
          githubEventName: 'pull_request',
          eventType: 'pull_request',
          action: 'opened',
          repository: 'intexuraos/test-repo',
          pullRequestNumber: 42,
          authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
          updatedAt: new Date('2026-03-12T10:00:10.000Z'),
          decisionState: 'completed',
          decisionOutcome: 'dispatch',
          decisionId: 'ed_entry-date',
          rowVersion: 2,
        }),
      }],
      ['entry-missing', {
        exists: false,
        id: 'entry-missing',
      }],
      ['entry-ts', {
        exists: true,
        id: 'entry-ts',
        data: (): Record<string, unknown> => ({
          githubEventName: 'issue_comment',
          eventType: 'issue_comment',
          action: 'created',
          repository: 'intexuraos/test-repo',
          pullRequestNumber: 43,
          authPassedAt: { toDate: () => new Date('2026-03-12T10:01:00.000Z') },
          updatedAt: { toDate: () => new Date('2026-03-12T10:01:30.000Z') },
          decisionState: 'pending',
          decisionOutcome: null,
          decisionId: null,
          rowVersion: 1,
        }),
      }],
      ['entry-string', {
        exists: true,
        id: 'entry-string',
        data: (): Record<string, unknown> => ({
          githubEventName: 'unknown',
          eventType: 'unknown',
          action: null,
          repository: null,
          pullRequestNumber: null,
          authPassedAt: '2026-03-12T10:02:00.000Z',
          updatedAt: '2026-03-12T10:02:30.000Z',
          decisionState: 'completed',
          decisionOutcome: 'skip',
          decisionId: 'ed_entry-string',
          rowVersion: 2,
        }),
      }],
    ]);

    const mockCollection = {
      doc: vi.fn().mockImplementation((id: string): { get: ReturnType<typeof vi.fn> } => ({
        get: vi.fn().mockResolvedValue(snapshotById.get(id)),
      })),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubEventLogEntryRepository({ logger: mockLogger });
    const result = await repo.findByIds(['entry-date', 'entry-missing', 'entry-ts', 'entry-string']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value.map((entry) => entry.id)).toEqual(['entry-date', 'entry-ts', 'entry-string']);
      expect(result.value.map((entry) => entry.authPassedAt.toISOString())).toEqual([
        '2026-03-12T10:00:00.000Z',
        '2026-03-12T10:01:00.000Z',
        '2026-03-12T10:02:00.000Z',
      ]);
    }
  });
});
