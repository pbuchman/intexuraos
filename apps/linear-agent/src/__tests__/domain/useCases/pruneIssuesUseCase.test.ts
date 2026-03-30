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
        getFullConnection: vi.fn().mockResolvedValue(
          ok({ userId: 'user-1', apiKey: 'key-1', teamId: 'team-1', teamName: 'Test', webhookSecret: null, connected: true, createdAt: '', updatedAt: '' })
        ),
      },
      issueRepo: {
        listByUserId: vi.fn(),
        deleteById: vi.fn().mockResolvedValue(ok(undefined)),
      },
      linearClient: {
        deleteIssue: vi.fn().mockResolvedValue(ok(undefined)),
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
    expect(deps.classifier.classifyCandidates).not.toHaveBeenCalled();
  });

  it('deletes candidates and cleans up Firestore when above threshold', async () => {
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
    expect(result.value.deleted).toBe(2);
    expect(result.value.totalActive).toBe(210);
    expect(result.value.remaining).toBe(208);
    expect(deps.linearClient.deleteIssue).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.deleteIssue).toHaveBeenCalledWith('key-1', 'id-0');
    expect(deps.issueRepo.deleteById).toHaveBeenCalledTimes(2);
  });

  it('continues deleting remaining candidates when one fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}`, userId: 'user-1' })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
      { id: 'id-1', identifier: 'INT-1', title: 'Task 1', score: 80, reason: 'Sub-issue', category: 'sub-issue' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));
    (deps.linearClient.deleteIssue as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Rate limited' }))
      .mockResolvedValueOnce(ok(undefined));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(result.value.failedDeletions).toHaveLength(1);
    expect(result.value.failedDeletions[0]?.identifier).toBe('INT-0');
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

  it('handles connection null after successful getFullConnection', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));
    (deps.connectionRepo.getFullConnection as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_CONNECTED');
  });

  it('returns error when getFullConnection fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));
    (deps.connectionRepo.getFullConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore unavailable' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('continues when local Firestore delete fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}`, userId: 'user-1' })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));
    (deps.issueRepo.deleteById as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore down' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-0', userId: 'user-1' }),
      'Failed to delete local Firestore copy (non-fatal)'
    );
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
