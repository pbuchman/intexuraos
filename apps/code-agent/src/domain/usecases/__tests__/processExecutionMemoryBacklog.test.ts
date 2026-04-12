import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { ExecutionMemory } from '../../models/executionMemory.js';
import type { ExecutionMemoryApplication } from '../../models/executionMemoryApplication.js';
import {
  __testables,
  sweepErroredApplications,
  pruneStaleMemories,
} from '../processExecutionMemoryBacklog.js';
import type { CodeTask } from '../../models/codeTask.js';

const { evaluateApplication, EVALUATION_SCHEMA_BLOCK } = __testables;

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createTimestamp(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

function makeMinimalTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = createTimestamp(new Date());
  return {
    id: 'task_abc',
    userId: 'user1',
    prompt: 'fix something',
    sanitizedPrompt: 'fix something',
    systemPromptHash: 'hash',
    workerType: 'sonnet',
    workerLocation: 'loc',
    repository: 'pbuchman/test',
    baseBranch: 'main',
    status: 'implemented',
    traceId: 'trace1',
    dedupKey: 'dedup1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CodeTask;
}

function makeMinimalMemory(overrides: Partial<ExecutionMemory> = {}): ExecutionMemory {
  const now = createTimestamp(new Date());
  return {
    id: 'mem_1',
    repository: 'pbuchman/test',
    sourceTaskId: 'task_old',
    memoryType: 'implementation_pattern',
    title: 'Test memory',
    appliesWhen: 'when testing',
    action: 'do this',
    avoid: 'avoid that',
    verification: 'check this',
    evidenceSummary: 'evidence',
    retrievalText: 'retrieval text',
    keywords: [],
    componentHints: [],
    embeddingModel: 'text-embedding-3-small',
    fingerprint: 'fp1',
    distillationVersion: 'v1',
    qualityScore: 0.8,
    distillationConfidence: 0.9,
    applicationCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Step 4: Indexed references in evaluator prompt
// ---------------------------------------------------------------------------

describe('evaluateApplication - indexed references', () => {
  it('builds evaluator prompt with [1], [2] indexed format instead of raw JSON', async () => {
    const generateFn = vi.fn().mockResolvedValue(ok({
      content: JSON.stringify({
        summary: 'Memories helped.',
        perMemory: [
          { memoryIndex: 1, outcome: 'positive', reason: 'Helped', confidence: 0.9 },
        ],
      }),
    }));

    const application: ExecutionMemoryApplication = {
      id: 'app_1',
      taskId: 'task_abc',
      repository: 'pbuchman/test',
      querySummary: 'summary',
      queryText: 'text',
      queryComponents: [],
      queryRiskFlags: [],
      retrievalVersion: 'v1',
      matchedMemories: [
        { memoryId: 'mem_1', vectorScore: 0.95, rerankScore: 0.9, title: 'Route coverage', memoryType: 'verification_pattern' },
        { memoryId: 'mem_2', vectorScore: 0.88, rerankScore: 0.85, title: 'Error handling', memoryType: 'pitfall_pattern' },
      ],
      status: 'matched',
      memoryIdsUsed: [],
      memoryIdsRejected: [],
      createdAt: createTimestamp(new Date()),
      updatedAt: createTimestamp(new Date()),
    };

    const updateAppFn = vi.fn().mockResolvedValue(ok(application));
    const findMemoryFn = vi.fn().mockResolvedValue(ok(makeMinimalMemory()));
    const updateMemoryFn = vi.fn().mockResolvedValue(ok(makeMinimalMemory()));

    const task = makeMinimalTask({
      executionMemoryContext: {
        status: 'matched',
        applicationId: 'app_1',
      },
      result: {
        summary: 'Fixed the bug',
        execution_memory_ids_used: 'mem_1',
        execution_memory_ids_rejected: '',
        execution_memory_usage_summary: 'Used memory',
      },
    });

    const deps = {
      logger: mockLogger,
      codeTaskRepo: { listPendingExecutionMemoryPostRun: vi.fn(), update: vi.fn() },
      logLineRepo: { listRecent: vi.fn() },
      turnMetricsRepo: { listByTask: vi.fn() },
      linearAgentClient: { getIssueContext: vi.fn() },
      executionMemoryRepo: {
        findById: findMemoryFn,
        update: updateMemoryFn,
        findByFingerprint: vi.fn(),
        findNearest: vi.fn(),
        create: vi.fn(),
      },
      executionMemoryApplicationRepo: {
        findById: vi.fn().mockResolvedValue(ok(application)),
        update: updateAppFn,
      },
      evaluatorClient: { generate: generateFn },
      limit: 10,
    };

    const logs = [{ text: 'log line 1' }];
    await evaluateApplication(task, logs, deps);

    // Verify the prompt uses [1] / [2] indexed format
    const promptArg = generateFn.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain('[1] Route coverage (type: verification_pattern)');
    expect(promptArg).toContain('[2] Error handling (type: pitfall_pattern)');
    // Ensure raw JSON is NOT present
    expect(promptArg).not.toContain('"memoryId"');
  });

  it('resolves valid memoryIndex to correct memory ID', async () => {
    const application: ExecutionMemoryApplication = {
      id: 'app_1',
      taskId: 'task_abc',
      repository: 'pbuchman/test',
      querySummary: 'summary',
      queryText: 'text',
      queryComponents: [],
      queryRiskFlags: [],
      retrievalVersion: 'v1',
      matchedMemories: [
        { memoryId: 'mem_aaa', vectorScore: 0.95, rerankScore: 0.9, title: 'Memory A', memoryType: 'implementation_pattern' },
        { memoryId: 'mem_bbb', vectorScore: 0.88, rerankScore: 0.85, title: 'Memory B', memoryType: 'pitfall_pattern' },
      ],
      status: 'matched',
      memoryIdsUsed: [],
      memoryIdsRejected: [],
      createdAt: createTimestamp(new Date()),
      updatedAt: createTimestamp(new Date()),
    };

    const generateFn = vi.fn().mockResolvedValue(ok({
      content: JSON.stringify({
        summary: 'Both helpful.',
        perMemory: [
          { memoryIndex: 2, outcome: 'positive', reason: 'Very helpful', confidence: 0.85 },
        ],
      }),
    }));

    const updateAppFn = vi.fn().mockResolvedValue(ok(application));
    const findMemoryFn = vi.fn().mockResolvedValue(ok(makeMinimalMemory({ id: 'mem_bbb' })));
    const updateMemoryFn = vi.fn().mockResolvedValue(ok(makeMinimalMemory({ id: 'mem_bbb' })));

    const task = makeMinimalTask({
      executionMemoryContext: { status: 'matched', applicationId: 'app_1' },
      result: { summary: 'Done', execution_memory_ids_used: '', execution_memory_ids_rejected: '', execution_memory_usage_summary: '' },
    });

    const deps = {
      logger: mockLogger,
      codeTaskRepo: { listPendingExecutionMemoryPostRun: vi.fn(), update: vi.fn() },
      logLineRepo: { listRecent: vi.fn() },
      turnMetricsRepo: { listByTask: vi.fn() },
      linearAgentClient: { getIssueContext: vi.fn() },
      executionMemoryRepo: {
        findById: findMemoryFn,
        update: updateMemoryFn,
        findByFingerprint: vi.fn(),
        findNearest: vi.fn(),
        create: vi.fn(),
      },
      executionMemoryApplicationRepo: {
        findById: vi.fn().mockResolvedValue(ok(application)),
        update: updateAppFn,
      },
      evaluatorClient: { generate: generateFn },
      limit: 10,
    };

    await evaluateApplication(task, [{ text: 'log' }], deps);

    // Verify memory repo was called with mem_bbb (index 2 -> mem_bbb)
    expect(findMemoryFn).toHaveBeenCalledWith('mem_bbb');
    // Verify perMemoryOutcome passed to update uses resolved IDs
    const updateCall = updateAppFn.mock.calls[0];
    const updateInput = updateCall?.[1] as { perMemoryOutcome: { memoryId: string }[] };
    expect(updateInput.perMemoryOutcome[0]?.memoryId).toBe('mem_bbb');
  });

  it('logs warning and skips when evaluator returns unknown memory index', async () => {
    const warnFn = vi.fn();
    const localLogger: Logger = { info: vi.fn(), warn: warnFn, error: vi.fn(), debug: vi.fn() };

    const application: ExecutionMemoryApplication = {
      id: 'app_1',
      taskId: 'task_abc',
      repository: 'pbuchman/test',
      querySummary: 'summary',
      queryText: 'text',
      queryComponents: [],
      queryRiskFlags: [],
      retrievalVersion: 'v1',
      matchedMemories: [
        { memoryId: 'mem_only', vectorScore: 0.95, rerankScore: 0.9, title: 'Only Memory', memoryType: 'implementation_pattern' },
      ],
      status: 'matched',
      memoryIdsUsed: [],
      memoryIdsRejected: [],
      createdAt: createTimestamp(new Date()),
      updatedAt: createTimestamp(new Date()),
    };

    const generateFn = vi.fn().mockResolvedValue(ok({
      content: JSON.stringify({
        summary: 'Tried to reference invalid index.',
        perMemory: [
          { memoryIndex: 99, outcome: 'positive', reason: 'Phantom memory', confidence: 0.5 },
        ],
      }),
    }));

    const updateAppFn = vi.fn().mockResolvedValue(ok(application));
    const findMemoryFn = vi.fn();
    const updateMemoryFn = vi.fn();

    const task = makeMinimalTask({
      executionMemoryContext: { status: 'matched', applicationId: 'app_1' },
      result: { summary: 'Done', execution_memory_ids_used: '', execution_memory_ids_rejected: '', execution_memory_usage_summary: '' },
    });

    const deps = {
      logger: localLogger,
      codeTaskRepo: { listPendingExecutionMemoryPostRun: vi.fn(), update: vi.fn() },
      logLineRepo: { listRecent: vi.fn() },
      turnMetricsRepo: { listByTask: vi.fn() },
      linearAgentClient: { getIssueContext: vi.fn() },
      executionMemoryRepo: {
        findById: findMemoryFn,
        update: updateMemoryFn,
        findByFingerprint: vi.fn(),
        findNearest: vi.fn(),
        create: vi.fn(),
      },
      executionMemoryApplicationRepo: {
        findById: vi.fn().mockResolvedValue(ok(application)),
        update: updateAppFn,
      },
      evaluatorClient: { generate: generateFn },
      limit: 10,
    };

    await evaluateApplication(task, [{ text: 'log' }], deps);

    // findById should NOT be called — unknown index gets skipped
    expect(findMemoryFn).not.toHaveBeenCalled();
    // Warning should be logged
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc', memoryIndex: 'unknown-index-99' }),
      'Evaluator returned outcome for unknown memory index, skipping',
    );
  });

  it('index mapping round-trips correctly for multiple memories', async () => {
    const memories = [
      { memoryId: 'mem_x', vectorScore: 0.95, rerankScore: 0.9, title: 'X', memoryType: 'implementation_pattern' as const },
      { memoryId: 'mem_y', vectorScore: 0.90, rerankScore: 0.85, title: 'Y', memoryType: 'verification_pattern' as const },
      { memoryId: 'mem_z', vectorScore: 0.88, rerankScore: 0.80, title: 'Z', memoryType: 'pitfall_pattern' as const },
    ];

    const application: ExecutionMemoryApplication = {
      id: 'app_1',
      taskId: 'task_abc',
      repository: 'pbuchman/test',
      querySummary: 'summary',
      queryText: 'text',
      queryComponents: [],
      queryRiskFlags: [],
      retrievalVersion: 'v1',
      matchedMemories: memories,
      status: 'matched',
      memoryIdsUsed: [],
      memoryIdsRejected: [],
      createdAt: createTimestamp(new Date()),
      updatedAt: createTimestamp(new Date()),
    };

    const generateFn = vi.fn().mockResolvedValue(ok({
      content: JSON.stringify({
        summary: 'All useful.',
        perMemory: [
          { memoryIndex: 1, outcome: 'positive', reason: 'X helped', confidence: 0.9 },
          { memoryIndex: 3, outcome: 'neutral', reason: 'Z was ok', confidence: 0.6 },
          { memoryIndex: 2, outcome: 'negative', reason: 'Y misleading', confidence: 0.7 },
        ],
      }),
    }));

    const updateAppFn = vi.fn().mockResolvedValue(ok(application));
    const findMemoryFn = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(ok(makeMinimalMemory({ id })))
    );
    const updateMemoryFn = vi.fn().mockResolvedValue(ok(makeMinimalMemory()));

    const task = makeMinimalTask({
      executionMemoryContext: { status: 'matched', applicationId: 'app_1' },
      result: { summary: 'Done', execution_memory_ids_used: '', execution_memory_ids_rejected: '', execution_memory_usage_summary: '' },
    });

    const deps = {
      logger: mockLogger,
      codeTaskRepo: { listPendingExecutionMemoryPostRun: vi.fn(), update: vi.fn() },
      logLineRepo: { listRecent: vi.fn() },
      turnMetricsRepo: { listByTask: vi.fn() },
      linearAgentClient: { getIssueContext: vi.fn() },
      executionMemoryRepo: {
        findById: findMemoryFn,
        update: updateMemoryFn,
        findByFingerprint: vi.fn(),
        findNearest: vi.fn(),
        create: vi.fn(),
      },
      executionMemoryApplicationRepo: {
        findById: vi.fn().mockResolvedValue(ok(application)),
        update: updateAppFn,
      },
      evaluatorClient: { generate: generateFn },
      limit: 10,
    };

    await evaluateApplication(task, [{ text: 'log' }], deps);

    // Verify findById calls received correctly resolved IDs
    const findCalls = findMemoryFn.mock.calls.map((c: unknown[]) => c[0]);
    expect(findCalls).toEqual(['mem_x', 'mem_z', 'mem_y']);

    // Verify perMemoryOutcome in the update call has all three resolved
    const appUpdate = updateAppFn.mock.calls[0]?.[1] as {
      perMemoryOutcome: { memoryId: string; outcome: string }[];
    };
    expect(appUpdate.perMemoryOutcome).toHaveLength(3);
    expect(appUpdate.perMemoryOutcome[0]?.memoryId).toBe('mem_x');
    expect(appUpdate.perMemoryOutcome[1]?.memoryId).toBe('mem_z');
    expect(appUpdate.perMemoryOutcome[2]?.memoryId).toBe('mem_y');
  });

  it('EVALUATION_SCHEMA_BLOCK uses memoryIndex instead of memoryId', () => {
    expect(EVALUATION_SCHEMA_BLOCK).toContain('memoryIndex');
    expect(EVALUATION_SCHEMA_BLOCK).not.toContain('memoryId');
  });
});

// ---------------------------------------------------------------------------
// Step 5: sweepErroredApplications
// ---------------------------------------------------------------------------

describe('sweepErroredApplications', () => {
  it('resets errored tasks older than 24h to pending', async () => {
    const oldTimestamp = Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000));
    const task = makeMinimalTask({
      id: 'task_old_error',
      executionMemoryPostRun: {
        status: 'error',
        attempts: 2,
        lastAttemptAt: oldTimestamp,
        generatedMemoryIds: [],
      },
    });

    const updateFn = vi.fn().mockResolvedValue(ok(task));
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(1);
      expect(result.value.skipped).toBe(0);
    }

    expect(updateFn).toHaveBeenCalledWith('task_old_error', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({ status: 'pending', attempts: 2 }),
    }));
  });

  it('skips tasks errored less than 24h ago', async () => {
    const recentTimestamp = Timestamp.fromDate(new Date(Date.now() - 1 * 60 * 60 * 1000)); // 1 hour ago
    const task = makeMinimalTask({
      id: 'task_recent_error',
      executionMemoryPostRun: {
        status: 'error',
        attempts: 1,
        lastAttemptAt: recentTimestamp,
        generatedMemoryIds: [],
      },
    });

    const updateFn = vi.fn();
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(0);
      expect(result.value.skipped).toBe(1);
    }
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('respects max retry cap of 6', async () => {
    const oldTimestamp = Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000));
    const task = makeMinimalTask({
      id: 'task_max_retries',
      executionMemoryPostRun: {
        status: 'error',
        attempts: 6,
        lastAttemptAt: oldTimestamp,
        generatedMemoryIds: [],
      },
    });

    const updateFn = vi.fn();
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(0);
      expect(result.value.skipped).toBe(1);
    }
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('returns error on repo failure', async () => {
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(
          err({ code: 'FIRESTORE_ERROR', message: 'Connection timeout' })
        ),
        update: vi.fn(),
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('Connection timeout');
    }
  });

  it('requeues task with no lastAttemptAt (undefined)', async () => {
    const task = makeMinimalTask({
      id: 'task_no_attempt',
      executionMemoryPostRun: {
        status: 'error',
        attempts: 1,
        generatedMemoryIds: ['mem_old'],
      },
    });

    const updateFn = vi.fn().mockResolvedValue(ok(task));
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(1);
    }
    expect(updateFn).toHaveBeenCalledWith('task_no_attempt', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'pending',
        attempts: 1,
        generatedMemoryIds: ['mem_old'],
      }),
    }));
  });

  it('requeues task with missing executionMemoryPostRun fields', async () => {
    // Tests ?? fallbacks for attempts, generatedMemoryIds, and lastAttemptAt
    const task = makeMinimalTask({
      id: 'task_bare',
      executionMemoryPostRun: {
        status: 'error',
        attempts: 0,
        generatedMemoryIds: [],
      },
    });

    const updateFn = vi.fn().mockResolvedValue(ok(task));
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(1);
    }
  });

  it('handles task with undefined executionMemoryPostRun (exercises ?? fallbacks)', async () => {
    // This task has no executionMemoryPostRun at all, triggering the ?? 0 and ?? [] branches
    const task = makeMinimalTask({
      id: 'task_no_postrun',
    });
    // Explicitly ensure executionMemoryPostRun is absent
    delete (task as unknown as Record<string, unknown>)['executionMemoryPostRun'];

    const updateFn = vi.fn().mockResolvedValue(ok(task));
    const result = await sweepErroredApplications({
      logger: mockLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(1);
      expect(result.value.skipped).toBe(0);
    }

    // Verify the fallback values: attempts = 0, generatedMemoryIds = []
    expect(updateFn).toHaveBeenCalledWith('task_no_postrun', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'pending',
        attempts: 0,
        generatedMemoryIds: [],
      }),
    }));
  });

  it('skips task when update fails', async () => {
    const oldTimestamp = Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000));
    const task = makeMinimalTask({
      id: 'task_update_fail',
      executionMemoryPostRun: {
        status: 'error',
        attempts: 2,
        lastAttemptAt: oldTimestamp,
        generatedMemoryIds: [],
      },
    });

    const warnFn = vi.fn();
    const localLogger: Logger = { info: vi.fn(), warn: warnFn, error: vi.fn(), debug: vi.fn() };
    const updateFn = vi.fn().mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'write conflict' })
    );

    const result = await sweepErroredApplications({
      logger: localLogger,
      codeTaskRepo: {
        listErroredExecutionMemoryPostRun: vi.fn().mockResolvedValue(ok([task])),
        update: updateFn,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requeued).toBe(0);
      expect(result.value.skipped).toBe(1);
    }
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_update_fail', error: 'write conflict' }),
      'Sweep: failed to requeue task',
    );
  });
});

// ---------------------------------------------------------------------------
// Step 7: pruneStaleMemories
// ---------------------------------------------------------------------------

describe('pruneStaleMemories', () => {
  it('archives memories with 0 applications older than 30 days', async () => {
    const oldMemory = makeMinimalMemory({
      id: 'mem_stale',
      applicationCount: 0,
      createdAt: createTimestamp(new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)),
    });

    const updateFn = vi.fn().mockResolvedValue(ok(makeMinimalMemory({ id: 'mem_stale', status: 'archived' })));
    const result = await pruneStaleMemories(
      {
        logger: mockLogger,
        executionMemoryRepo: {
          listStaleUnused: vi.fn().mockResolvedValue(ok([oldMemory])),
          update: updateFn,
        },
      },
      { maxAgeDays: 30 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(1);
      expect(result.value.skipped).toBe(0);
    }
    expect(updateFn).toHaveBeenCalledWith('mem_stale', { status: 'archived' });
  });

  it('dry run returns counts without modifying data', async () => {
    const oldMemory = makeMinimalMemory({
      id: 'mem_stale2',
      applicationCount: 0,
      createdAt: createTimestamp(new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)),
    });

    const updateFn = vi.fn();
    const result = await pruneStaleMemories(
      {
        logger: mockLogger,
        executionMemoryRepo: {
          listStaleUnused: vi.fn().mockResolvedValue(ok([oldMemory])),
          update: updateFn,
        },
      },
      { maxAgeDays: 30, dryRun: true },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(1);
      expect(result.value.skipped).toBe(0);
    }
    // update should NOT be called in dry run
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('handles repo failure gracefully', async () => {
    const result = await pruneStaleMemories(
      {
        logger: mockLogger,
        executionMemoryRepo: {
          listStaleUnused: vi.fn().mockResolvedValue(
            err({ code: 'FIRESTORE_ERROR', message: 'DB error' })
          ),
          update: vi.fn(),
        },
      },
      {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('DB error');
    }
  });

  it('counts skipped when individual memory update fails', async () => {
    const staleMemories = [
      makeMinimalMemory({ id: 'mem_fail' }),
      makeMinimalMemory({ id: 'mem_ok' }),
    ];

    const updateFn = vi.fn()
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }))
      .mockResolvedValueOnce(ok(makeMinimalMemory({ id: 'mem_ok', status: 'archived' })));

    const result = await pruneStaleMemories(
      {
        logger: mockLogger,
        executionMemoryRepo: {
          listStaleUnused: vi.fn().mockResolvedValue(ok(staleMemories)),
          update: updateFn,
        },
      },
      {},
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(1);
      expect(result.value.skipped).toBe(1);
    }
  });
});
