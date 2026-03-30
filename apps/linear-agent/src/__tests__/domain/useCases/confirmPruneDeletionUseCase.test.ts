import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  confirmPruneDeletion,
  type ConfirmPruneDeletionDeps,
} from '../../../domain/useCases/confirmPruneDeletionUseCase.js';
import type { StoredPruneCandidate, SyncedLinearIssue } from '../../../domain/index.js';
import type { Logger } from 'pino';
import { ok, err } from '@intexuraos/common-core';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createTestCandidate(overrides: Partial<StoredPruneCandidate> = {}): StoredPruneCandidate {
  return {
    id: 'issue-id-1',
    identifier: 'INT-100',
    title: 'Test issue',
    score: 85,
    reason: 'Cancelled and stale',
    category: 'cancelled',
    classifiedAt: '2026-03-29T00:00:00.000Z',
    ...overrides,
  };
}

function createTestIssue(overrides: Partial<SyncedLinearIssue> = {}): SyncedLinearIssue {
  return {
    id: 'issue-id-1',
    identifier: 'INT-100',
    title: 'Test issue',
    description: 'Test description',
    state: 'Done',
    stateType: 'completed',
    priority: 0,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/test',
    userId: 'user-1',
    parentId: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    syncedAt: '2026-03-29T00:00:00.000Z',
    teamId: 'team-1',
    ...overrides,
  };
}

const FULL_CONNECTION = {
  userId: 'user-1',
  apiKey: 'key-1',
  teamId: 'team-1',
  teamName: 'Test',
  webhookSecret: null,
  connected: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('confirmPruneDeletion', () => {
  let deps: ConfirmPruneDeletionDeps;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    deps = {
      connectionRepo: {
        getAllConnectedUserIds: vi.fn().mockResolvedValue(ok(['user-1'])),
        getFullConnection: vi.fn().mockResolvedValue(ok(FULL_CONNECTION)),
      },
      issueRepo: {
        listByUserId: vi.fn().mockResolvedValue(ok([])),
        deleteById: vi.fn().mockResolvedValue(ok(undefined)),
      },
      linearClient: {
        deleteIssue: vi.fn().mockResolvedValue(ok(undefined)),
      },
      pruneCandidateRepo: {
        clearAll: vi.fn().mockResolvedValue(ok(undefined)),
        storeAll: vi.fn().mockResolvedValue(ok(undefined)),
        listAll: vi.fn().mockResolvedValue(ok([])),
      },
      logger,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty stats when no candidates', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(0);
    expect(result.value.failedDeletions).toEqual([]);
    expect(deps.linearClient.deleteIssue).not.toHaveBeenCalled();
  });

  it('deletes all candidates from Linear and clears Firestore', async () => {
    const candidates = [
      createTestCandidate({ id: 'id-1', identifier: 'INT-1' }),
      createTestCandidate({ id: 'id-2', identifier: 'INT-2' }),
    ];
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([
        createTestIssue({ id: 'id-1', identifier: 'INT-1', userId: 'user-1' }),
        createTestIssue({ id: 'id-2', identifier: 'INT-2', userId: 'user-1' }),
      ])
    );

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(2);
    expect(result.value.failedDeletions).toEqual([]);
    expect(deps.linearClient.deleteIssue).toHaveBeenCalledTimes(2);
    expect(deps.issueRepo.deleteById).toHaveBeenCalledTimes(2);
    expect(deps.pruneCandidateRepo.clearAll).toHaveBeenCalledTimes(1);
  });

  it('continues when one deletion fails', async () => {
    const candidates = [
      createTestCandidate({ id: 'id-1', identifier: 'INT-1' }),
      createTestCandidate({ id: 'id-2', identifier: 'INT-2' }),
    ];
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));
    (deps.linearClient.deleteIssue as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(err({ code: 'INTERNAL_ERROR', message: 'Linear API down' }))
      .mockResolvedValueOnce(ok(undefined));

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(result.value.failedDeletions).toHaveLength(1);
    expect(result.value.failedDeletions[0]?.identifier).toBe('INT-1');
    expect(result.value.failedDeletions[0]?.error).toBe('Linear API down');
  });

  it('returns error when listAll fails', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore down' })
    );

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns error when no connected users', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate()])
    );
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_CONNECTED');
    expect(result.error.message).toContain('No connected users');
  });

  it('returns error when getAllConnectedUserIds fails', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate()])
    );
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore connection failed' })
    );

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns error when getFullConnection returns null', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate()])
    );
    (deps.connectionRepo.getFullConnection as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_CONNECTED');
    expect(result.error.message).toContain('No connected user found');
  });

  it('returns error when getFullConnection fails', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate()])
    );
    (deps.connectionRepo.getFullConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore read failed' })
    );

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('cleans up local Firestore copies for multiple users', async () => {
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(['user-1', 'user-2'])
    );
    (deps.connectionRepo.getFullConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ ...FULL_CONNECTION, userId: 'user-1' })
    );
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate({ id: 'shared-id', identifier: 'INT-1' })])
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok([createTestIssue({ id: 'shared-id', userId: 'user-1' })]))
      .mockResolvedValueOnce(ok([createTestIssue({ id: 'shared-id', userId: 'user-2' })]));

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(deps.issueRepo.deleteById).toHaveBeenCalledTimes(2);
    expect(deps.issueRepo.deleteById).toHaveBeenCalledWith('shared-id', 'user-1');
    expect(deps.issueRepo.deleteById).toHaveBeenCalledWith('shared-id', 'user-2');
  });

  it('continues when local Firestore delete fails', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate({ id: 'id-1', identifier: 'INT-1' })])
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestIssue({ id: 'id-1', userId: 'user-1' })])
    );
    (deps.issueRepo.deleteById as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore write failed' })
    );

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(result.value.failedDeletions).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-1', userId: 'user-1' }),
      'Failed to delete local Firestore copy (non-fatal)'
    );
  });

  it('continues when clearAll fails after deletions', async () => {
    (deps.pruneCandidateRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([createTestCandidate({ id: 'id-1', identifier: 'INT-1' })])
    );
    (deps.pruneCandidateRepo.clearAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore write failed' })
    );

    const result = await confirmPruneDeletion(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(result.value.failedDeletions).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) }),
      expect.stringContaining('Failed to clear prune candidates collection')
    );
  });
});
