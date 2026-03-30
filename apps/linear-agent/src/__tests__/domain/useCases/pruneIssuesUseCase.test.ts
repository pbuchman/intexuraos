import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pruneIssues, type PruneIssuesDeps } from '../../../domain/useCases/pruneIssuesUseCase.js';
import type { SyncedLinearIssue, PruneCandidate, PruneConfig } from '../../../domain/index.js';
import type { Logger } from 'pino';
import { ok, err } from '@intexuraos/common-core';

/** vi.fn()-based logger for tests that assert on logger calls */
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createTestIssue(overrides: Partial<SyncedLinearIssue>): SyncedLinearIssue {
  return {
    id: 'test-id',
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

const DEFAULT_CONFIG: PruneConfig = {
  activationThreshold: 200,
  targetDeletionCount: 30,
};

describe('pruneIssues', () => {
  let deps: PruneIssuesDeps;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    deps = {
      connectionRepo: {
        getAllConnectedUserIds: vi.fn().mockResolvedValue(ok(['user-1'])),
      },
      issueRepo: {
        listByUserId: vi.fn(),
      },
      pruneCandidateRepo: {
        clearAll: vi.fn().mockResolvedValue(ok(undefined)),
        storeAll: vi.fn().mockResolvedValue(ok(undefined)),
        listAll: vi.fn().mockResolvedValue(ok([])),
      },
      classifier: {
        classifyCandidates: vi.fn(),
      },
      logger,
      config: DEFAULT_CONFIG,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips pruning when total active issues are below threshold', async () => {
    const issues = Array.from({ length: 50 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(true);
    expect(result.value.skipReason).toContain('below threshold');
    expect(result.value.totalActive).toBe(50);
    expect(result.value.stored).toBe(0);
    expect(result.value.storedCandidates).toEqual([]);
    expect(deps.classifier.classifyCandidates).not.toHaveBeenCalled();
    expect(deps.pruneCandidateRepo.clearAll).not.toHaveBeenCalled();
    expect(deps.pruneCandidateRepo.storeAll).not.toHaveBeenCalled();
  });

  it('stores candidates in Firestore when above threshold', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}`, userId: 'user-1' })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
      { id: 'id-1', identifier: 'INT-1', title: 'Task 1', score: 80, reason: 'Sub-issue', category: 'sub-issue' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(false);
    expect(result.value.stored).toBe(2);
    expect(result.value.totalActive).toBe(210);
    expect(result.value.storedCandidates).toHaveLength(2);
    expect(result.value.storedCandidates[0]?.identifier).toBe('INT-0');
    expect(result.value.storedCandidates[1]?.identifier).toBe('INT-1');
    expect(deps.pruneCandidateRepo.clearAll).toHaveBeenCalledTimes(1);
    expect(deps.pruneCandidateRepo.storeAll).toHaveBeenCalledTimes(1);
    const storeAllArg = (deps.pruneCandidateRepo.storeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as unknown[];
    expect(storeAllArg).toHaveLength(2);
    expect((storeAllArg[0] as { identifier: string }).identifier).toBe('INT-0');
    expect((storeAllArg[0] as { classifiedAt: string }).classifiedAt).toBeDefined();
  });

  it('clears old candidates before storing new ones', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));

    const callOrder: string[] = [];
    (deps.pruneCandidateRepo.clearAll as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('clearAll');
      return ok(undefined);
    });
    (deps.pruneCandidateRepo.storeAll as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('storeAll');
      return ok(undefined);
    });

    await pruneIssues(deps);

    expect(callOrder).toEqual(['clearAll', 'storeAll']);
  });

  it('returns error when getting connected users fails', async () => {
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore down' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns error when classifier fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Gemini failed' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Gemini failed');
  });

  it('skips pruning when no connected users', async () => {
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(true);
    expect(result.value.skipReason).toBe('No connected users');
    expect(result.value.stored).toBe(0);
    expect(result.value.storedCandidates).toEqual([]);
  });

  it('continues when listByUserId fails for a user', async () => {
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(ok(['user-1', 'user-2']));
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(err({ code: 'INTERNAL_ERROR', message: 'Firestore down' }))
      .mockResolvedValueOnce(ok([createTestIssue({ id: 'id-1', identifier: 'INT-1' })]));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(true);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) }),
      'Failed to list issues for user, continuing'
    );
  });

  it('deduplicates issues across multiple users', async () => {
    const sharedIssue = createTestIssue({ id: 'shared-id', identifier: 'INT-100', userId: 'user-1' });
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(ok(['user-1', 'user-2']));
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok([sharedIssue]))
      .mockResolvedValueOnce(ok([createTestIssue({ id: 'shared-id', identifier: 'INT-100', userId: 'user-2' })]));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalActive).toBe(1);
  });

  it('returns error when clearAll fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));
    (deps.pruneCandidateRepo.clearAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore write failed' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(deps.pruneCandidateRepo.storeAll).not.toHaveBeenCalled();
  });

  it('returns error when storeAll fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));
    (deps.pruneCandidateRepo.storeAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore write failed' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(deps.pruneCandidateRepo.clearAll).toHaveBeenCalledTimes(1);
  });

  it('handles issue description null for optional chaining branches', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}`, description: null })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
  });
});
