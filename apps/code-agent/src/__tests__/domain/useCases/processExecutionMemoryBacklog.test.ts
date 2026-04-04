import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { ExecutionMemory } from '../../../domain/models/executionMemory.js';
import {
  __testables as processExecutionMemoryBacklogTestables,
  processExecutionMemoryBacklog,
} from '../../../domain/usecases/processExecutionMemoryBacklog.js';

describe('processExecutionMemoryBacklog', () => {
  type TaskOverrides = Omit<Partial<CodeTask>, 'linearIssueId' | 'result' | 'executionMemoryPostRun'> & {
    linearIssueId?: string | undefined;
    result?: CodeTask['result'] | undefined;
    executionMemoryPostRun?: CodeTask['executionMemoryPostRun'] | undefined;
  };

  let logger: Logger;
  let codeTaskRepo: {
    listPendingExecutionMemoryPostRun: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let logLineRepo: {
    listRecent: ReturnType<typeof vi.fn>;
  };
  let turnMetricsRepo: {
    listByTask: ReturnType<typeof vi.fn>;
  };
  let linearAgentClient: {
    getIssueContext: ReturnType<typeof vi.fn>;
  };
  let executionMemoryRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findByFingerprint: ReturnType<typeof vi.fn>;
    findNearest: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let executionMemoryApplicationRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let evaluatorClient: {
    generate: ReturnType<typeof vi.fn>;
  };
  let distillerClient: {
    generate: ReturnType<typeof vi.fn>;
  };
  let embeddingClient: {
    embed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    codeTaskRepo = {
      listPendingExecutionMemoryPostRun: vi.fn(),
      update: vi.fn(),
    };

    logLineRepo = {
      listRecent: vi.fn().mockResolvedValue(ok([
        { sequence: 1, text: '[log] updated request logging', timestamp: Timestamp.now() },
        { sequence: 2, text: '[log] added app.inject coverage', timestamp: Timestamp.now() },
      ])),
    };

    turnMetricsRepo = {
      listByTask: vi.fn().mockResolvedValue(ok([
        {
          taskId: 'task-1',
          attempt: 1,
          timestamp: new Date().toISOString(),
          cpuTimeSeconds: 1,
          cpuCores: 2,
          peakMemoryMB: 512,
          wallTimeSeconds: 30,
          apiWaitSeconds: 5,
          toolExecSeconds: 12,
          backgroundWaitSeconds: 4,
          overheadSeconds: 9,
          totalInputTokens: 100,
          totalOutputTokens: 200,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
          apiCallCount: 3,
          cpuUtilizationPercent: 60,
          idlePercent: 10,
        },
      ])),
    };

    linearAgentClient = {
      getIssueContext: vi.fn().mockResolvedValue(ok({
        description: 'Issue details about request logging and route verification.',
        comments: [{ body: 'Please keep task detail serialization aligned.', createdAt: '2026-03-25T12:00:00.000Z' }],
      })),
    };

    executionMemoryRepo = {
      findById: vi.fn(),
      update: vi.fn(),
      findByFingerprint: vi.fn(),
      findNearest: vi.fn(),
      create: vi.fn(),
    };

    executionMemoryApplicationRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };

    evaluatorClient = {
      generate: vi.fn(),
    };

    distillerClient = {
      generate: vi.fn(),
    };

    embeddingClient = {
      embed: vi.fn(),
    };
  });

  function createTask(overrides: TaskOverrides = {}): CodeTask {
    const now = Timestamp.now();
    const {
      linearIssueId: overrideLinearIssueId,
      result: overrideResult,
      executionMemoryPostRun: overrideExecutionMemoryPostRun,
      ...restOverrides
    } = overrides;
    const task = {
      id: 'task-1',
      userId: 'user-1',
      traceId: 'trace-1',
      prompt: 'Fix callback route logging',
      sanitizedPrompt: 'Fix callback route logging',
      systemPromptHash: 'hash-1',
      workerType: 'auto',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'implemented',
      dedupKey: 'dedup-1',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      agentType: 'execution',
      linearIssueId: 'INT-1098',
      result: {
        summary: 'Added logging and route tests.',
        execution_outcome_label: 'implemented',
        execution_memory_ids_used: 'mem-existing',
        execution_memory_ids_rejected: '',
        execution_memory_usage_summary: 'Used the prior verification lesson for route coverage.',
      },
      executionMemoryContext: {
        status: 'matched',
        applicationId: 'app-1',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Callback route logging and verification work',
        matchedAt: now,
        matchedMemories: [
          {
            memoryId: 'mem-existing',
            title: 'Verify route serialization',
            memoryType: 'verification_pattern',
            score: 0.91,
            appliesWhen: 'Route schema changes',
            action: 'Add app.inject coverage',
            avoid: 'Do not skip serialization',
            verification: 'Check response shape',
          },
        ],
      },
      executionMemoryPostRun: {
        status: 'pending',
        attempts: 0,
        generatedMemoryIds: [],
      },
      ...restOverrides,
    } as CodeTask & {
      linearIssueId?: string;
      result?: CodeTask['result'];
      executionMemoryPostRun?: CodeTask['executionMemoryPostRun'];
    };

    if ('linearIssueId' in overrides) {
      if (overrideLinearIssueId === undefined) {
        delete task.linearIssueId;
      } else {
        task.linearIssueId = overrideLinearIssueId;
      }
    }

    if ('result' in overrides) {
      if (overrideResult === undefined) {
        delete task.result;
      } else {
        task.result = overrideResult;
      }
    }

    if ('executionMemoryPostRun' in overrides) {
      if (overrideExecutionMemoryPostRun === undefined) {
        delete task.executionMemoryPostRun;
      } else {
        task.executionMemoryPostRun = overrideExecutionMemoryPostRun;
      }
    }

    return task;
  }

  function createMemory(overrides: Partial<ExecutionMemory> = {}): ExecutionMemory {
    const now = Timestamp.now();
    return {
      id: 'mem-existing',
      repository: 'pbuchman/intexuraos',
      sourceTaskId: 'task-source',
      memoryType: 'verification_pattern',
      title: 'Verify route serialization',
      appliesWhen: 'Route schema changes',
      action: 'Add app.inject coverage',
      avoid: 'Do not skip serialization',
      verification: 'Check response shape',
      evidenceSummary: 'Previous route bug required stronger verification.',
      retrievalText: 'route schema app inject serialization',
      keywords: ['route', 'schema'],
      labelHints: ['backend'],
      componentHints: ['route', 'verification'],
      embeddingModel: 'text-embedding-3-small',
      fingerprint: 'fp-existing',
      distillationVersion: 'execution-memory-distiller@1.0.0',
      qualityScore: 0.8,
      distillationConfidence: 0.8,
      applicationCount: 1,
      positiveCount: 1,
      negativeCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function createApplicationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'app-1',
      taskId: 'task-1',
      repository: 'pbuchman/intexuraos',
      querySummary: 'Callback route logging and verification work',
      queryText: 'callback route logging verification',
      queryComponents: ['route', 'logging'],
      queryRiskFlags: [],
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      matchedMemories: [
        {
          memoryId: 'mem-existing',
          vectorScore: 0.93,
          rerankScore: 0.91,
          title: 'Verify route serialization',
          memoryType: 'verification_pattern',
        },
      ],
      status: 'matched',
      memoryIdsUsed: [],
      memoryIdsRejected: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides,
    };
  }

  it('evaluates matched memories, creates new distilled memories, and marks the task completed', async () => {
    const task = createTask();
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(ok([task]));
    codeTaskRepo.update.mockResolvedValue(ok(task));
    executionMemoryApplicationRepo.findById.mockResolvedValue(ok({
      id: 'app-1',
      taskId: 'task-1',
      repository: 'pbuchman/intexuraos',
      querySummary: 'Callback route logging and verification work',
      queryText: 'callback route logging verification',
      queryComponents: ['route', 'logging'],
      queryRiskFlags: [],
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      matchedMemories: [
        {
          memoryId: 'mem-existing',
          vectorScore: 0.93,
          rerankScore: 0.91,
          title: 'Verify route serialization',
          memoryType: 'verification_pattern',
        },
      ],
      status: 'matched',
      memoryIdsUsed: [],
      memoryIdsRejected: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));
    evaluatorClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        summary: 'The previous verification memory directly helped the fix.',
        perMemory: [
          {
            memoryId: 'mem-existing',
            outcome: 'positive',
            reason: 'The route coverage lesson was applied.',
            confidence: 0.84,
          },
        ],
      }),
    }));
    executionMemoryRepo.findById.mockResolvedValue(ok(createMemory({
      distillationConfidence: 0.8,
      qualityScore: 0.65,
      lastAppliedAt: Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    })));
    executionMemoryRepo.update.mockResolvedValue(ok(createMemory({
      applicationCount: 2,
      positiveCount: 2,
    })));
    distillerClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Route work produced a reusable lesson.',
        memories: [
          {
            memoryType: 'verification_pattern',
            title: 'Update route schema and task serialization together',
            appliesWhen: 'Fastify route outputs change',
            action: 'Update route schema, task serialization, and route coverage in the same patch',
            avoid: 'Do not fix the handler without updating serialization and tests',
            verification: 'Use app.inject and task detail assertions',
            evidenceSummary: 'The task required route, schema, and serialization updates together.',
            retrievalText: 'route schema task detail serialization app inject',
            keywords: ['route', 'serialization'],
            componentHints: ['route', 'serialization'],
            confidence: 0.78,
          },
        ],
      }),
    }));
    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
    executionMemoryRepo.findByFingerprint.mockResolvedValue(ok(null));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([]));
    executionMemoryRepo.create.mockResolvedValue(ok(createMemory({
      id: 'mem-new',
      title: 'Update route schema and task serialization together',
      fingerprint: 'fp-new',
      applicationCount: 0,
      positiveCount: 0,
      negativeCount: 0,
    })));
    executionMemoryApplicationRepo.update.mockResolvedValue(ok({
      id: 'app-1',
      taskId: 'task-1',
      repository: 'pbuchman/intexuraos',
      querySummary: 'Callback route logging and verification work',
      queryText: 'callback route logging verification',
      queryComponents: ['route', 'logging'],
      queryRiskFlags: [],
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      matchedMemories: [],
      status: 'matched',
      memoryIdsUsed: ['mem-existing'],
      memoryIdsRejected: [],
      evaluationSummary: 'The previous verification memory directly helped the fix.',
      perMemoryOutcome: [
        {
          memoryId: 'mem-existing',
          outcome: 'positive',
          reason: 'The route coverage lesson was applied.',
          confidence: 0.84,
        },
      ],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      completedAt: Timestamp.now(),
    }));

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      evaluatorClient: evaluatorClient as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(result.value).toEqual({
      claimed: 1,
      completed: 1,
      skipped: 0,
      errored: 0,
      taskIds: ['task-1'],
    });
    expect(executionMemoryApplicationRepo.update).toHaveBeenCalledWith('app-1', expect.objectContaining({
      memoryIdsUsed: ['mem-existing'],
      evaluationSummary: 'The previous verification memory directly helped the fix.',
    }));
    // applicationCount goes 1→2, positiveCount 1→2
    // effectiveness = (2+1)/(2+2) = 0.75
    // confidence = 0.8 (distillationConfidence, NOT qualityScore)
    // recency = max(0, min(1, 1 - 30/180)) ≈ 0.8333 (lastAppliedAt = 30 days ago)
    // qualityScore = 0.5*0.75 + 0.3*0.8 + 0.2*0.8333 ≈ 0.375 + 0.24 + 0.1667 ≈ 0.7817
    expect(executionMemoryRepo.update).toHaveBeenCalledWith('mem-existing', expect.objectContaining({
      applicationCount: 2,
      positiveCount: 2,
      qualityScore: expect.closeTo(0.7817, 1),
    }));
    expect(executionMemoryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceTaskId: 'task-1',
      repository: 'pbuchman/intexuraos',
      title: 'Update route schema and task serialization together',
    }));
    expect(codeTaskRepo.update).toHaveBeenLastCalledWith('task-1', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'completed',
        generatedMemoryIds: ['mem-new'],
        evaluationSummary: 'The previous verification memory directly helped the fix.',
      }),
    }));
  });

  it('skips tasks that were already completed without reusable work', async () => {
    const task = createTask({
      result: {
        summary: 'The requested route update was already present.',
        execution_outcome_label: 'already_completed',
      },
      executionMemoryContext: {
        status: 'none',
      },
    });
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(ok([task]));
    codeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      evaluatorClient: evaluatorClient as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(result.value).toEqual({
      claimed: 1,
      completed: 0,
      skipped: 1,
      errored: 0,
      taskIds: ['task-1'],
    });
    expect(codeTaskRepo.update).toHaveBeenLastCalledWith('task-1', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'skipped',
        skipReason: 'already_completed',
      }),
    }));
  });

  it('marks the task as error after the third processor failure', async () => {
    const task = createTask({
      executionMemoryContext: {
        status: 'none',
      },
      executionMemoryPostRun: {
        status: 'pending',
        attempts: 2,
        generatedMemoryIds: [],
      },
    });
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(ok([task]));
    codeTaskRepo.update.mockResolvedValue(ok(task));
    distillerClient.generate.mockResolvedValue(err({ code: 'API_ERROR', message: 'Gemini unavailable' }));

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      evaluatorClient: evaluatorClient as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(result.value).toEqual({
      claimed: 1,
      completed: 0,
      skipped: 0,
      errored: 1,
      taskIds: ['task-1'],
    });
    expect(codeTaskRepo.update).toHaveBeenLastCalledWith('task-1', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'error',
        attempts: 3,
        errorMessage: 'Gemini unavailable',
      }),
    }));
  });

  it('defaults missing post-run metadata when claiming and retrying backlog work', async () => {
    const task = createTask({
      linearIssueId: undefined,
      executionMemoryContext: {
        status: 'none',
      },
      executionMemoryPostRun: undefined,
    });
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(ok([task]));
    codeTaskRepo.update.mockResolvedValue(ok(task));
    distillerClient.generate.mockResolvedValue(err({ code: 'API_ERROR', message: 'distill failed' }));

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      distillerClient: distillerClient as never,
      limit: 10,
    });

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(codeTaskRepo.update).toHaveBeenNthCalledWith(1, 'task-1', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'processing',
        attempts: 1,
        generatedMemoryIds: [],
      }),
    }));
    expect(codeTaskRepo.update).toHaveBeenNthCalledWith(2, 'task-1', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'pending',
        attempts: 1,
        generatedMemoryIds: [],
        errorMessage: 'distill failed',
      }),
    }));
  });

  it('returns an internal error when pending backlog lookup fails', async () => {
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(
      err({ message: 'firestore unavailable' })
    );

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      evaluatorClient: evaluatorClient as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    expect(result).toEqual(err({
      code: 'internal_error',
      message: 'firestore unavailable',
    }));
  });

  it('covers evaluation fallbacks for missing applications, empty matches, and missing evaluator client', async () => {
    const summaryWithoutApplicationId =
      await processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask({
          executionMemoryContext: { status: 'none' },
          result: {
            summary: 'done',
            execution_memory_usage_summary: 'worker summary',
          },
        }),
        [],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          limit: 10,
        }
      );
    expect(summaryWithoutApplicationId).toBe('worker summary');

    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord({
      matchedMemories: [],
    })));
    executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord({
      matchedMemories: [],
      evaluationSummary: 'worker summary',
    })));

    const noMatchSummary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        result: {
          summary: 'done',
          execution_memory_ids_used: 'mem-existing',
          execution_memory_ids_rejected: 'mem-stale',
          execution_memory_usage_summary: 'worker summary',
        },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(noMatchSummary).toBe('worker summary');

    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
    executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord({
      evaluationSummary: 'worker summary',
    })));

    const evaluatorMissingSummary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        result: {
          summary: 'done',
          execution_memory_ids_used: 'mem-existing',
          execution_memory_ids_rejected: '',
          execution_memory_usage_summary: 'worker summary',
        },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(evaluatorMissingSummary).toBe('worker summary');
  });

  it('surfaces evaluation repository and model failures and suppresses memories on negative outcomes', async () => {
    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(err({ message: 'application lookup failed' }));

    await expect(
      processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask(),
        [],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('application lookup failed');

    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
    evaluatorClient.generate.mockResolvedValueOnce(err({ message: 'evaluation model failed' }));

    await expect(
      processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask({ result: undefined }),
        [{ text: 'log line' }],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('evaluation model failed');

    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
    executionMemoryApplicationRepo.update.mockResolvedValueOnce(ok(createApplicationRecord({
      evaluationSummary: 'negative summary',
      perMemoryOutcome: [
        {
          memoryId: 'mem-existing',
          outcome: 'negative',
          reason: 'The prior guidance did not apply.',
          confidence: 0.8,
        },
      ],
    })));
    evaluatorClient.generate.mockResolvedValueOnce(ok({
      content: JSON.stringify({
        summary: 'negative summary',
        perMemory: [
          {
            memoryId: 'mem-existing',
            outcome: 'negative',
            reason: 'The prior guidance did not apply.',
            confidence: 0.8,
          },
        ],
      }),
    }));
    executionMemoryRepo.findById.mockResolvedValueOnce(ok(createMemory({
      applicationCount: 3,
      positiveCount: 1,
      negativeCount: 1,
      qualityScore: 0.6,
    })));
    executionMemoryRepo.update.mockResolvedValueOnce(ok(createMemory({
      applicationCount: 4,
      positiveCount: 1,
      negativeCount: 2,
      status: 'suppressed',
      qualityScore: 0.45,
    })));

    await expect(
      processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask({ result: undefined }),
        [{ text: 'log line' }],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          limit: 10,
        }
      )
    ).resolves.toBe('negative summary');
    expect(executionMemoryRepo.update).toHaveBeenLastCalledWith('mem-existing', expect.objectContaining({
      applicationCount: 4,
      positiveCount: 1,
      negativeCount: 2,
      status: 'suppressed',
    }));

    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
    executionMemoryApplicationRepo.update.mockResolvedValueOnce(ok(createApplicationRecord({
      evaluationSummary: 'negative summary',
      perMemoryOutcome: [
        {
          memoryId: 'mem-existing',
          outcome: 'negative',
          reason: 'The prior guidance did not apply.',
          confidence: 0.8,
        },
      ],
    })));
    evaluatorClient.generate.mockResolvedValueOnce(ok({
      content: JSON.stringify({
        summary: 'negative summary',
        perMemory: [
          {
            memoryId: 'mem-existing',
            outcome: 'negative',
            reason: 'The prior guidance did not apply.',
            confidence: 0.8,
          },
        ],
      }),
    }));
    executionMemoryRepo.findById.mockResolvedValueOnce(err({ message: 'memory lookup failed' }));

    const updateCallsBefore = executionMemoryRepo.update.mock.calls.length;

    await expect(
      processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask({ result: undefined }),
        [{ text: 'log line' }],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          limit: 10,
        }
      )
    ).resolves.toBe('negative summary');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 'mem-existing', error: 'memory lookup failed' }),
      'Failed to load memory for evaluation outcome, skipping'
    );
    expect(executionMemoryRepo.update.mock.calls.length).toBe(updateCallsBefore);
  });

  it('skips evaluator outcomes for unknown memory IDs with a warning', async () => {
    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
    executionMemoryApplicationRepo.update.mockResolvedValueOnce(ok(createApplicationRecord()));
    evaluatorClient.generate.mockResolvedValueOnce(ok({
      content: JSON.stringify({
        summary: 'hallucinated evaluation',
        perMemory: [
          {
            memoryId: 'hallucinated-id',
            outcome: 'positive',
            reason: 'Seems good.',
            confidence: 0.9,
          },
          {
            memoryId: 'mem-existing',
            outcome: 'neutral',
            reason: 'Applied but no clear impact.',
            confidence: 0.7,
          },
        ],
      }),
    }));
    executionMemoryRepo.findById.mockResolvedValueOnce(ok(createMemory()));
    executionMemoryRepo.update.mockResolvedValueOnce(ok(createMemory()));

    const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask(),
      [{ text: 'log line' }],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        evaluatorClient: evaluatorClient as never,
        limit: 10,
      }
    );
    expect(summary).toBe('hallucinated evaluation');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 'hallucinated-id' }),
      'Evaluator returned outcome for unknown memory ID, skipping'
    );
    expect(executionMemoryRepo.findById).toHaveBeenCalledTimes(1);
    expect(executionMemoryRepo.findById).toHaveBeenCalledWith('mem-existing');
  });

  it('skips backlog task when claim update fails', async () => {
    const task = createTask();
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(ok([task]));
    codeTaskRepo.update.mockResolvedValue(err({ message: 'concurrent claim conflict' }));

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claimed).toBe(1);
      expect(result.value.errored).toBe(1);
      expect(result.value.completed).toBe(0);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.id, error: 'concurrent claim conflict' }),
      'Failed to claim execution memory backlog task, skipping'
    );
  });

  it('throws from evaluation and distillation helpers when the model output is invalid', async () => {
    executionMemoryApplicationRepo.findById.mockResolvedValue(ok(createApplicationRecord()));
    evaluatorClient.generate.mockResolvedValue(ok({ content: 'missing json' }));

    await expect(
      processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask(),
        [{ text: 'log line' }],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('Response did not contain JSON');

    distillerClient.generate.mockResolvedValue(ok({ content: 'missing json' }));

    await expect(
      processExecutionMemoryBacklogTestables.distillTask(
        createTask({ result: undefined }),
        [{ text: 'log line' }],
        [],
        { description: null, comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('Response did not contain JSON');
  });

  it('skips distillation for infra-only failures or when no distiller is configured', async () => {
    await expect(
      processExecutionMemoryBacklogTestables.distillTask(
        createTask({
          status: 'failed',
          error: { code: 'dispatch_failed', message: 'worker unavailable' },
        }),
        [],
        [],
        { description: null, comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      )
    ).resolves.toEqual({
      decision: 'skip',
      skipReason: 'infra_only',
      evidenceSummary: 'Infrastructure-only failure; not reusable.',
      memories: [],
    });

    await expect(
      processExecutionMemoryBacklogTestables.distillTask(
        createTask(),
        [],
        [],
        { description: null, comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          limit: 10,
        }
      )
    ).resolves.toEqual({
      decision: 'skip',
      skipReason: 'insufficient_signal',
      evidenceSummary: 'No distiller configured.',
      memories: [],
    });
  });

  it('updates existing memories, suppresses low-quality ones, and surfaces repository update failures', async () => {
    executionMemoryRepo.update.mockResolvedValueOnce(ok(createMemory({
      applicationCount: 3,
      positiveCount: 1,
      negativeCount: 2,
      status: 'suppressed',
    })));

    await expect(
      processExecutionMemoryBacklogTestables.updateExistingMemory(
        'mem-existing',
        3,
        1,
        2,
        0.1,
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          limit: 10,
        },
        {
          memoryType: 'verification_pattern',
          title: 'Updated memory',
          appliesWhen: 'routes change',
          action: 'update tests',
          avoid: 'skip tests',
          verification: 'run route tests',
          evidenceSummary: 'evidence',
          retrievalText: 'route tests',
          keywords: [],
          labelHints: [],
          componentHints: [],
          confidence: 0.1,
        },
        'fp-123',
        [0.1, 0.2],
        'task-1',
        undefined,
        'execution',
        'execution-memory-distiller@2.0.0'
      )
    ).resolves.toBe('mem-existing');

    expect(executionMemoryRepo.update).toHaveBeenLastCalledWith('mem-existing', expect.objectContaining({
      status: 'suppressed',
      sourceTaskId: 'task-1',
      sourceAgentType: 'execution',
      qualityScore: expect.any(Number),
    }));

    executionMemoryRepo.update.mockResolvedValueOnce(err({ message: 'update failed' }));

    await expect(
      processExecutionMemoryBacklogTestables.updateExistingMemory(
        'mem-existing',
        1,
        1,
        0,
        0.9,
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          limit: 10,
        },
        {
          memoryType: 'verification_pattern',
          title: 'Updated memory',
          appliesWhen: 'routes change',
          action: 'update tests',
          avoid: 'skip tests',
          verification: 'run route tests',
          evidenceSummary: 'evidence',
          retrievalText: 'route tests',
          keywords: [],
          labelHints: [],
          componentHints: [],
          confidence: 0.9,
        },
        'fp-123',
        [0.1, 0.2],
        'task-1',
        'INT-1098',
        'execution',
        'execution-memory-distiller@2.0.0'
      )
    ).rejects.toThrow('update failed');
  });

  it('covers exact-match and near-duplicate merge paths in processOneTask', async () => {
    const distillation = ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Route work produced reusable lessons.',
        memories: [
          {
            memoryType: 'verification_pattern',
            title: 'Exact match memory',
            appliesWhen: 'route changes',
            action: 'add tests',
            avoid: 'skip tests',
            verification: 'run route tests',
            evidenceSummary: 'evidence',
            retrievalText: 'exact memory',
            keywords: [],
            labelHints: [],
            componentHints: [],
            confidence: 0.7,
          },
          {
            memoryType: 'verification_pattern',
            title: 'Near duplicate memory',
            appliesWhen: 'serialization changes',
            action: 'verify response',
            avoid: 'skip serialization tests',
            verification: 'use app.inject',
            evidenceSummary: 'evidence',
            retrievalText: 'near duplicate memory',
            keywords: [],
            labelHints: [],
            componentHints: [],
            confidence: 0.8,
          },
        ],
      }),
    });
    distillerClient.generate.mockResolvedValue(distillation);
    embeddingClient.embed
      .mockResolvedValueOnce(ok([0.1, 0.2]))
      .mockResolvedValueOnce(ok([0.3, 0.4]));
    executionMemoryRepo.findByFingerprint
      .mockResolvedValueOnce(ok(createMemory({ id: 'mem-exact' })))
      .mockResolvedValueOnce(ok(null));
    executionMemoryRepo.findNearest.mockResolvedValueOnce(ok([
      {
        ...createMemory({ id: 'mem-near', applicationCount: 4, positiveCount: 3 }),
        vectorScore: 0.96,
      },
    ]));
    executionMemoryRepo.update.mockResolvedValue(ok(createMemory()));

    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).resolves.toEqual({
      status: 'completed',
      generatedMemoryIds: ['mem-exact', 'mem-near'],
      evaluationSummary: 'Used the prior verification lesson for route coverage.',
    });

    expect(executionMemoryRepo.update).toHaveBeenCalledWith('mem-exact', expect.objectContaining({
      title: 'Exact match memory',
      sourceTaskId: 'task-1',
    }));
    expect(executionMemoryRepo.update).toHaveBeenCalledWith('mem-near', expect.objectContaining({
      title: 'Near duplicate memory',
      sourceTaskId: 'task-1',
    }));
    expect(executionMemoryRepo.create).not.toHaveBeenCalled();
  });

  it('covers skip branches and dependency failures inside processOneTask', async () => {
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          linearIssueId: undefined,
          executionMemoryContext: { status: 'none' },
          result: {
            summary: 'already present',
            execution_outcome_label: 'already_completed',
            execution_memory_usage_summary: 'worker summary',
          },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          limit: 10,
        }
      )
    ).resolves.toEqual({
      status: 'skipped',
      generatedMemoryIds: [],
      evaluationSummary: 'worker summary',
      skipReason: 'already_completed',
    });

    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          linearIssueId: undefined,
          status: 'failed',
          error: { code: 'dispatch_failed', message: 'worker unavailable' },
          executionMemoryContext: { status: 'none' },
          result: {
            summary: 'failed',
            execution_memory_usage_summary: 'worker summary',
          },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          limit: 10,
        }
      )
    ).resolves.toEqual({
      status: 'skipped',
      generatedMemoryIds: [],
      evaluationSummary: 'worker summary',
      skipReason: 'infra_only',
    });

    turnMetricsRepo.listByTask.mockResolvedValueOnce(err({ message: 'metrics failed' }));
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('metrics failed');

    linearAgentClient.getIssueContext.mockResolvedValueOnce(err({ message: 'linear lookup failed' }));
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('linear lookup failed');

    distillerClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Route work produced a reusable lesson.',
        memories: [
          {
            memoryType: 'verification_pattern',
            title: 'New memory',
            appliesWhen: 'route changes',
            action: 'add tests',
            avoid: 'skip tests',
            verification: 'run route tests',
            evidenceSummary: 'evidence',
            retrievalText: 'new memory',
            keywords: [],
            labelHints: [],
            componentHints: [],
            confidence: 0.7,
          },
        ],
      }),
    }));

    embeddingClient.embed.mockResolvedValueOnce(err({ message: 'embedding failed' }));
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          linearIssueId: undefined,
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('embedding failed');

    embeddingClient.embed.mockResolvedValueOnce(ok([0.1, 0.2]));
    executionMemoryRepo.findByFingerprint.mockResolvedValueOnce(err({ message: 'fingerprint lookup failed' }));
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          linearIssueId: undefined,
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('fingerprint lookup failed');

    embeddingClient.embed.mockResolvedValueOnce(ok([0.1, 0.2]));
    executionMemoryRepo.findByFingerprint.mockResolvedValueOnce(ok(null));
    executionMemoryRepo.findNearest.mockResolvedValueOnce(err({ message: 'nearest lookup failed' }));
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          linearIssueId: undefined,
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('nearest lookup failed');
  });

  it('surfaces processing failures for missing embeddings, log lookup failures, and first-attempt create errors', async () => {
    distillerClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Route work produced a reusable lesson.',
        memories: [
          {
            memoryType: 'verification_pattern',
            title: 'New memory',
            appliesWhen: 'route changes',
            action: 'add tests',
            avoid: 'skip tests',
            verification: 'run route tests',
            evidenceSummary: 'evidence',
            retrievalText: 'new memory',
            keywords: [],
            labelHints: [],
            componentHints: [],
            confidence: 0.7,
          },
        ],
      }),
    }));

    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('Execution memory embedding client is not configured');

    logLineRepo.listRecent.mockResolvedValueOnce(err({ message: 'log fetch failed' }));
    await expect(
      processExecutionMemoryBacklogTestables.processOneTask(
        createTask({
          executionMemoryContext: { status: 'none' },
        }),
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 10,
        }
      )
    ).rejects.toThrow('log fetch failed');

    const task = createTask({
      executionMemoryContext: { status: 'none' },
      executionMemoryPostRun: {
        status: 'pending',
        attempts: 0,
        generatedMemoryIds: [],
      },
    });
    codeTaskRepo.listPendingExecutionMemoryPostRun.mockResolvedValue(ok([task]));
    codeTaskRepo.update.mockResolvedValue(ok(task));
    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2]));
    executionMemoryRepo.findByFingerprint.mockResolvedValue(ok(null));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([]));
    executionMemoryRepo.create.mockResolvedValue(err({ message: 'create failed' }));

    const result = await processExecutionMemoryBacklog({
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(codeTaskRepo.update).toHaveBeenLastCalledWith('task-1', expect.objectContaining({
      executionMemoryPostRun: expect.objectContaining({
        status: 'pending',
        attempts: 1,
        errorMessage: 'create failed',
      }),
    }));
  });

  it('computes recency decay from lastAppliedAt', () => {
    const ninetyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    const result = processExecutionMemoryBacklogTestables.computeQualityScore({
      applicationCount: 5,
      positiveCount: 3,
      confidence: 0.8,
      lastAppliedAt: ninetyDaysAgo,
    });
    // effectiveness = (3+1)/(5+2) ≈ 0.5714
    // recency = max(0, 1 - 90/180) = 0.5
    // qualityScore = 0.5*0.5714 + 0.3*0.8 + 0.2*0.5 = 0.2857 + 0.24 + 0.1 = 0.6257
    expect(result).toBeCloseTo(0.6257, 2);
  });

  it('defaults recency to 1 when lastAppliedAt is undefined', () => {
    const result = processExecutionMemoryBacklogTestables.computeQualityScore({
      applicationCount: 0,
      positiveCount: 0,
      confidence: 0.8,
    });
    // effectiveness = 1/2 = 0.5, recency = 1
    // 0.5*0.5 + 0.3*0.8 + 0.2*1 = 0.25 + 0.24 + 0.2 = 0.69
    expect(result).toBeCloseTo(0.69, 2);
  });

  describe('parseJsonObject', () => {
    it('extracts JSON from raw JSON string', () => {
      const input = '{"decision":"create","evidenceSummary":"test"}';
      const result = processExecutionMemoryBacklogTestables.parseJsonObject(input);
      expect(result).toEqual({ decision: 'create', evidenceSummary: 'test' });
    });

    it('extracts JSON from markdown code fences with json tag', () => {
      const input = '```json\n{"decision":"skip","evidenceSummary":"no signal"}\n```';
      const result = processExecutionMemoryBacklogTestables.parseJsonObject(input);
      expect(result).toEqual({ decision: 'skip', evidenceSummary: 'no signal' });
    });

    it('extracts JSON from plain markdown code fences', () => {
      const input = '```\n{"decision":"create","evidenceSummary":"found pattern"}\n```';
      const result = processExecutionMemoryBacklogTestables.parseJsonObject(input);
      expect(result).toEqual({ decision: 'create', evidenceSummary: 'found pattern' });
    });

    it('extracts JSON surrounded by extra text and code fences', () => {
      const input = 'Here is the result:\n```json\n{"decision":"create","evidenceSummary":"test"}\n```\nDone.';
      const result = processExecutionMemoryBacklogTestables.parseJsonObject(input);
      expect(result).toEqual({ decision: 'create', evidenceSummary: 'test' });
    });

    it('throws when response contains no JSON', () => {
      expect(() => processExecutionMemoryBacklogTestables.parseJsonObject('no json here')).toThrow(
        'Response did not contain JSON'
      );
    });
  });

  describe('DISTILLATION_VERSION', () => {
    it('is at major version 2 for schema-guided prompt', async () => {
      // Access via distillTask prompt — we verify the version string is exported
      // by checking it appears in the distiller prompt passed to the client
      const capturedPrompt: string[] = [];
      distillerClient.generate.mockImplementation((prompt: string) => {
        capturedPrompt.push(prompt);
        return Promise.resolve(ok({
          content: JSON.stringify({
            decision: 'skip',
            skipReason: 'no_reusable_lesson',
            evidenceSummary: 'Nothing reusable.',
            memories: [],
          }),
        }));
      });

      await processExecutionMemoryBacklogTestables.distillTask(
        createTask(),
        [{ text: 'log line' }],
        [],
        { description: null, comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      );
      const version = capturedPrompt[0] ?? '';
      expect(version).toContain('execution-memory-distiller@2.0.0');
    });
  });

  describe('distiller prompt schema guidance', () => {
    it('includes explicit JSON schema guidance in the prompt', async () => {
      const capturedPrompt: string[] = [];
      distillerClient.generate.mockImplementation((prompt: string) => {
        capturedPrompt.push(prompt);
        return Promise.resolve(ok({
          content: JSON.stringify({
            decision: 'skip',
            skipReason: 'no_reusable_lesson',
            evidenceSummary: 'Nothing reusable.',
            memories: [],
          }),
        }));
      });

      await processExecutionMemoryBacklogTestables.distillTask(
        createTask(),
        [{ text: 'log line' }],
        [],
        { description: 'Test issue', comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      );

      const prompt = capturedPrompt[0] ?? '';
      expect(prompt).toContain('"decision"');
      expect(prompt).toContain('"evidenceSummary"');
      expect(prompt).toContain('"memories"');
      expect(prompt).toContain('"memoryType"');
      expect(prompt).toContain('implementation_pattern');
      expect(prompt).toContain('verification_pattern');
      expect(prompt).toContain('pitfall_pattern');
      expect(prompt).toContain('"create"');
      expect(prompt).toContain('"skip"');
    });
  });

  describe('distiller retry on Zod parse failure', () => {
    it('retries with refinement prompt when first attempt fails Zod parse', async () => {
      const validResponse = JSON.stringify({
        decision: 'skip',
        skipReason: 'no_reusable_lesson',
        evidenceSummary: 'Nothing reusable.',
        memories: [],
      });

      let callCount = 0;
      distillerClient.generate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(ok({ content: '{"invalid": true}' }));
        }
        return Promise.resolve(ok({ content: validResponse }));
      });

      const result = await processExecutionMemoryBacklogTestables.distillTask(
        createTask(),
        [{ text: 'log line' }],
        [],
        { description: null, comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      );

      expect(callCount).toBe(2);
      expect(result.decision).toBe('skip');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Distiller response failed Zod parse, retrying with refinement prompt'
      );
    });

    it('throws when both first attempt and retry fail Zod parse', async () => {
      distillerClient.generate.mockResolvedValue(ok({ content: '{"invalid": true}' }));

      await expect(
        processExecutionMemoryBacklogTestables.distillTask(
          createTask(),
          [{ text: 'log line' }],
          [],
          { description: null, comments: [] },
          {
            logger,
            codeTaskRepo: codeTaskRepo as never,
            logLineRepo: logLineRepo as never,
            turnMetricsRepo: turnMetricsRepo as never,
            linearAgentClient: linearAgentClient as never,
            executionMemoryRepo: executionMemoryRepo as never,
            executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
            distillerClient: distillerClient as never,
            limit: 10,
          }
        )
      ).rejects.toThrow();

      expect(distillerClient.generate).toHaveBeenCalledTimes(2);
    });

    it('throws when retry generate call returns error result', async () => {
      let callCount = 0;
      distillerClient.generate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(ok({ content: '{"invalid": true}' }));
        }
        return Promise.resolve(err({ message: 'LLM quota exceeded', code: 'RATE_LIMIT' }));
      });

      await expect(
        processExecutionMemoryBacklogTestables.distillTask(
          createTask(),
          [{ text: 'log line' }],
          [],
          { description: null, comments: [] },
          {
            logger,
            codeTaskRepo: codeTaskRepo as never,
            logLineRepo: logLineRepo as never,
            turnMetricsRepo: turnMetricsRepo as never,
            linearAgentClient: linearAgentClient as never,
            executionMemoryRepo: executionMemoryRepo as never,
            executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
            distillerClient: distillerClient as never,
            limit: 10,
          }
        )
      ).rejects.toThrow('LLM quota exceeded');

      expect(callCount).toBe(2);
    });

    it('includes refinement instructions in retry prompt', async () => {
      const capturedPrompts: string[] = [];
      const validResponse = JSON.stringify({
        decision: 'skip',
        skipReason: 'no_reusable_lesson',
        evidenceSummary: 'Nothing reusable.',
        memories: [],
      });

      let callCount = 0;
      distillerClient.generate.mockImplementation((prompt: string) => {
        capturedPrompts.push(prompt);
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(ok({ content: '{"invalid": true}' }));
        }
        return Promise.resolve(ok({ content: validResponse }));
      });

      await processExecutionMemoryBacklogTestables.distillTask(
        createTask(),
        [{ text: 'log line' }],
        [],
        { description: null, comments: [] },
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          distillerClient: distillerClient as never,
          limit: 10,
        }
      );

      const retryPrompt = capturedPrompts[1] ?? '';
      expect(retryPrompt).toContain('Fix the JSON schema violation and return valid JSON');
      expect(retryPrompt).toContain('Your previous response was invalid JSON');
    });
  });

  it('uses planning distillation version and sourceAgentType when creating memories for planning tasks', async () => {
    const task = createTask({
      agentType: 'planning',
      status: 'planned',
      result: {
        summary: 'planned the issue',
        planning_outcome_label: 'planned',
        planning_is_complex: '1',
        planning_subtask_urls: 'url1,url2',
      },
      executionMemoryContext: { status: 'none' },
    });
    distillerClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Planning produced reusable decomposition.',
        memories: [
          {
            memoryType: 'decomposition_pattern',
            title: 'Split by service boundary',
            appliesWhen: 'Multi-service issues',
            action: 'Decompose into per-service subtasks',
            avoid: 'Mixing services in one subtask',
            verification: 'Check each subtask touches only one service',
            evidenceSummary: 'evidence',
            retrievalText: 'service boundary decomposition',
            keywords: ['planning'],
            labelHints: [],
            componentHints: [],
            confidence: 0.8,
          },
        ],
      }),
    }));
    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2]));
    executionMemoryRepo.findByFingerprint.mockResolvedValue(ok(null));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([]));
    executionMemoryRepo.create.mockResolvedValue(ok(createMemory({ id: 'mem-plan' })));

    const result = await processExecutionMemoryBacklogTestables.processOneTask(task, {
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    expect(result.status).toBe('completed');
    expect(result.generatedMemoryIds).toEqual(['mem-plan']);
    expect(executionMemoryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceAgentType: 'planning',
      distillationVersion: 'planning-memory-distiller@1.0.0',
      memoryType: 'decomposition_pattern',
    }));
  });

  it('uses review distillation version and sourceAgentType when creating memories for review tasks', async () => {
    const task = createTask({
      agentType: 'review',
      status: 'reviewed',
      result: {
        summary: 'review found issues',
        review_types: 'code_quality',
        review_comments_posted: '3',
        needs_remediation: '1',
        review_body: 'Found error handling issues.',
        review_inline_comments: 'Line 10: missing null check',
      },
      executionMemoryContext: { status: 'none' },
    });
    distillerClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Review produced reusable pitfall.',
        memories: [
          {
            memoryType: 'review_finding',
            title: 'Always check null returns',
            appliesWhen: 'Working with Firestore queries',
            action: 'Check for null/undefined before accessing properties',
            avoid: 'Assuming data is always present',
            verification: 'Verify null guards in code review',
            evidenceSummary: 'evidence',
            retrievalText: 'null check firestore query',
            keywords: ['null-check'],
            labelHints: [],
            componentHints: [],
            confidence: 0.75,
          },
        ],
      }),
    }));
    embeddingClient.embed.mockResolvedValue(ok([0.3, 0.4]));
    executionMemoryRepo.findByFingerprint.mockResolvedValue(ok(null));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([]));
    executionMemoryRepo.create.mockResolvedValue(ok(createMemory({ id: 'mem-rev' })));

    const result = await processExecutionMemoryBacklogTestables.processOneTask(task, {
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    expect(result.status).toBe('completed');
    expect(result.generatedMemoryIds).toEqual(['mem-rev']);
    expect(executionMemoryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceAgentType: 'review',
      distillationVersion: 'review-memory-distiller@1.0.0',
      memoryType: 'review_finding',
    }));
  });

  it('passes sourceAgentType through to updateExistingMemory on exact match for planning tasks', async () => {
    const task = createTask({
      agentType: 'planning',
      status: 'planned',
      result: {
        summary: 'planned',
        planning_outcome_label: 'planned',
      },
      executionMemoryContext: { status: 'none' },
    });
    distillerClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        decision: 'create',
        evidenceSummary: 'Planning update.',
        memories: [{
          memoryType: 'planning_decision',
          title: 'Simple issues need no subtasks',
          appliesWhen: 'Single-service issues',
          action: 'Classify as simple',
          avoid: 'Over-decomposition',
          verification: 'Check subtask count is 0',
          evidenceSummary: 'evidence',
          retrievalText: 'simple issue classification',
          keywords: [],
          labelHints: [],
          componentHints: [],
          confidence: 0.9,
        }],
      }),
    }));
    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2]));
    executionMemoryRepo.findByFingerprint.mockResolvedValue(ok(createMemory({ id: 'mem-exact-plan' })));
    executionMemoryRepo.update.mockResolvedValue(ok(createMemory()));

    const result = await processExecutionMemoryBacklogTestables.processOneTask(task, {
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      distillerClient: distillerClient as never,
      embeddingClient: embeddingClient as never,
      limit: 10,
    });

    expect(result.generatedMemoryIds).toEqual(['mem-exact-plan']);
    expect(executionMemoryRepo.update).toHaveBeenCalledWith('mem-exact-plan', expect.objectContaining({
      sourceAgentType: 'planning',
      distillationVersion: 'planning-memory-distiller@1.0.0',
    }));
  });

  it('skips planning tasks with unclear outcome via shouldSkipDistillation in processOneTask', async () => {
    const task = createTask({
      agentType: 'planning',
      status: 'planned',
      result: {
        summary: 'unclear',
        planning_outcome_label: 'unclear',
      },
      executionMemoryContext: { status: 'none' },
    });

    const result = await processExecutionMemoryBacklogTestables.processOneTask(task, {
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      limit: 10,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      generatedMemoryIds: [],
      skipReason: 'planning_unclear',
    }));
  });

  describe('shouldSkipDistillation', () => {
    it('returns skip with already_completed for execution tasks with that outcome', () => {
      const task = createTask({
        result: { summary: 'done', execution_outcome_label: 'already_completed' },
      });
      expect(processExecutionMemoryBacklogTestables.shouldSkipDistillation(task)).toEqual({
        skip: true,
        reason: 'already_completed',
      });
    });

    it('returns skip with planning_unclear for planning tasks with unclear outcome', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: { summary: 'unclear', planning_outcome_label: 'unclear' },
      });
      expect(processExecutionMemoryBacklogTestables.shouldSkipDistillation(task)).toEqual({
        skip: true,
        reason: 'planning_unclear',
      });
    });

    it('does not skip planning tasks with planned outcome', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: { summary: 'done', planning_outcome_label: 'planned' },
      });
      expect(processExecutionMemoryBacklogTestables.shouldSkipDistillation(task)).toEqual({
        skip: false,
      });
    });

    it('does not skip review tasks regardless of status', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: { summary: 'done', needs_remediation: '1' },
      });
      expect(processExecutionMemoryBacklogTestables.shouldSkipDistillation(task)).toEqual({
        skip: false,
      });
    });

    it('does not skip execution tasks with implemented outcome', () => {
      const task = createTask({
        result: { summary: 'done', execution_outcome_label: 'implemented' },
      });
      expect(processExecutionMemoryBacklogTestables.shouldSkipDistillation(task)).toEqual({
        skip: false,
      });
    });
  });

  describe('DistillationSchema extended types', () => {
    it('accepts decomposition_pattern, planning_decision, and review_finding as memory types', () => {
      const newTypes = ['decomposition_pattern', 'planning_decision', 'review_finding'] as const;
      for (const memoryType of newTypes) {
        const input = {
          decision: 'create' as const,
          evidenceSummary: 'test evidence',
          memories: [{
            memoryType,
            title: 'Test',
            appliesWhen: 'always',
            action: 'do something',
            avoid: 'avoid something',
            verification: 'verify something',
            evidenceSummary: 'evidence',
            retrievalText: 'retrieval text',
            keywords: [],
            labelHints: [],
            componentHints: [],
            confidence: 0.8,
          }],
        };
        // Should not throw
        expect(() => processExecutionMemoryBacklogTestables.parseJsonObject(JSON.stringify(input))).not.toThrow();
      }
    });

    it('accepts planning_unclear as a valid skipReason', () => {
      const input = {
        decision: 'skip' as const,
        skipReason: 'planning_unclear',
        evidenceSummary: 'unclear planning',
        memories: [],
      };
      expect(() => processExecutionMemoryBacklogTestables.parseJsonObject(JSON.stringify(input))).not.toThrow();
    });
  });

  describe('buildDistillationPrompt router', () => {
    it('routes planning agent type to planning-memory-distiller@1.0.0', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: { summary: 'planned', planning_outcome_label: 'planned', planning_is_complex: '1', planning_subtask_urls: 'url1,url2' },
      });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        task, [{ text: 'log' }], [], { description: 'issue', comments: [] }
      );
      expect(prompt).toContain('planning-memory-distiller@1.0.0');
    });

    it('routes review agent type to review-memory-distiller@1.0.0', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: { summary: 'reviewed', review_types: 'code_quality', review_comments_posted: '3', needs_remediation: '0' },
      });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        task, [{ text: 'log' }], [], { description: 'issue', comments: [] }
      );
      expect(prompt).toContain('review-memory-distiller@1.0.0');
    });

    it('routes execution and undefined agent type to execution-memory-distiller@2.0.0', () => {
      const executionTask = createTask({ agentType: 'execution' });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        executionTask, [{ text: 'log' }], [], { description: null, comments: [] }
      );
      expect(prompt).toContain('execution-memory-distiller@2.0.0');

      const undefinedTask = createTask({ agentType: undefined } as never);
      const prompt2 = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        undefinedTask, [{ text: 'log' }], [], { description: null, comments: [] }
      );
      expect(prompt2).toContain('execution-memory-distiller@2.0.0');
    });
  });

  describe('planning distillation prompt content', () => {
    it('includes planning-specific fields in the prompt', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: {
          summary: 'planned the thing',
          planning_outcome_label: 'planned',
          planning_is_complex: '1',
          planning_subtask_urls: 'url1,url2,url3',
          planning_superpowers_writing_plans_used: '1',
          planning_pr_url: 'https://github.com/pr/1',
        },
      });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        task, [{ text: 'log line' }], [{ metric: 1 }], { description: 'Linear issue', comments: [{ body: 'comment', createdAt: '2026-01-01' }] }
      );
      expect(prompt).toContain('Planning outcome:');
      expect(prompt).toContain('Complexity classification:');
      expect(prompt).toContain('COMPLEX');
      expect(prompt).toContain('Subtask count: 3');
      expect(prompt).toContain('Used writing-plans skill:');
      expect(prompt).toContain('Planning PR URL:');
      expect(prompt).toContain('planning memory distiller');
      expect(prompt).toContain('DECOMPOSITION PATTERNS');
      expect(prompt).toContain('decomposition_pattern');
      expect(prompt).toContain('planning_decision');
    });

    it('uses fallback values when planning result fields are missing', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: { summary: 'done' },
      });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        task, [{ text: 'log line' }], [], { description: null, comments: [] }
      );
      expect(prompt).toContain('Planning outcome: ');
      expect(prompt).toContain('SIMPLE_OR_PLAN_DOC');
      expect(prompt).toContain('Subtask count: 0');
      expect(prompt).toContain('Used writing-plans skill: ');
      expect(prompt).toContain('Planning PR URL: ');
    });
  });

  describe('review distillation prompt content', () => {
    it('includes review-specific fields in the prompt', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: {
          summary: 'reviewed',
          review_types: 'code_quality,security',
          review_comments_posted: '5',
          needs_remediation: '1',
          review_body: 'Found issues with error handling.',
          review_inline_comments: 'Line 42: Missing null check',
        },
      });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        task, [{ text: 'log line' }], [], { description: 'Linear issue', comments: [] }
      );
      expect(prompt).toContain('Review body:');
      expect(prompt).toContain('Found issues with error handling.');
      expect(prompt).toContain('Inline comments:');
      expect(prompt).toContain('Line 42: Missing null check');
      expect(prompt).toContain('review memory distiller');
      expect(prompt).toContain('REVIEW FINDINGS');
      expect(prompt).toContain('review_finding');
    });

    it('uses fallback values when review result fields are missing', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: { summary: 'reviewed' },
      });
      const prompt = processExecutionMemoryBacklogTestables.buildDistillationPrompt(
        task, [{ text: 'log line' }], [], { description: null, comments: [] }
      );
      expect(prompt).toContain('Review types: ');
      expect(prompt).toContain('Comments posted: ');
      expect(prompt).toContain('Needs remediation: ');
      expect(prompt).toContain('CI status: ');
    });
  });

  it('returns undefined evaluationSummary when execution task has no usage summary and no applicationId', async () => {
    const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        executionMemoryContext: { status: 'none' },
        result: { summary: 'done' },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(summary).toBeUndefined();
  });

  it('returns undefined evaluationSummary when empty matches and no self-report summary', async () => {
    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord({
      matchedMemories: [],
    })));
    executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord({
      matchedMemories: [],
    })));

    const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        result: { summary: 'done' },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(summary).toBeUndefined();
  });

  it('returns undefined evaluationSummary when evaluator missing and no self-report summary', async () => {
    executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
    executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord()));

    const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        result: { summary: 'done' },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(summary).toBeUndefined();
  });

  it('uses buildEvaluationContext for planning tasks in evaluateApplication', async () => {
    const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        agentType: 'planning',
        status: 'planned',
        executionMemoryContext: { status: 'none' },
        result: { summary: 'done', planning_outcome_label: 'planned' },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(summary).toBe('Planning completed successfully');
  });

  it('uses buildEvaluationContext for review tasks in evaluateApplication', async () => {
    const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask({
        agentType: 'review',
        status: 'reviewed',
        executionMemoryContext: { status: 'none' },
        result: { summary: 'done', needs_remediation: '1', review_comments_posted: '3' },
      }),
      [],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        limit: 10,
      }
    );
    expect(summary).toBe('Review found issues requiring remediation (3 comments)');
  });

  describe('buildEvaluationContext', () => {
    it('returns execution fields for execution tasks with all fields', () => {
      const task = createTask({
        result: {
          summary: 'done',
          execution_memory_ids_used: 'mem-1,mem-2',
          execution_memory_ids_rejected: 'mem-3',
          execution_memory_usage_summary: 'Used both memories.',
        },
      });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: 'mem-1,mem-2',
        selfReportRejected: 'mem-3',
        selfReportSummary: 'Used both memories.',
      });
    });

    it('returns empty strings for execution tasks with missing fields', () => {
      const task = createTask({ result: { summary: 'done' } });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: '',
      });
    });

    it('returns success summary for planning tasks with planned outcome', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: { summary: 'done', planning_outcome_label: 'planned' },
      });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: 'Planning completed successfully',
      });
    });

    it('returns unclear summary for planning tasks with unclear outcome', () => {
      const task = createTask({
        agentType: 'planning',
        status: 'planned',
        result: { summary: 'unclear', planning_outcome_label: 'unclear' },
      });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: 'Planning outcome was unclear',
      });
    });

    it('returns remediation summary for review tasks with needs_remediation', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: { summary: 'done', needs_remediation: '1', review_comments_posted: '5' },
      });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: 'Review found issues requiring remediation (5 comments)',
      });
    });

    it('defaults comment count to 0 when review_comments_posted is missing', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: { summary: 'done', needs_remediation: '1' },
      });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: 'Review found issues requiring remediation (0 comments)',
      });
    });

    it('returns no remediation summary for review tasks without remediation', () => {
      const task = createTask({
        agentType: 'review',
        status: 'reviewed',
        result: { summary: 'done', needs_remediation: '0' },
      });
      expect(processExecutionMemoryBacklogTestables.buildEvaluationContext(task)).toEqual({
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: 'Review completed with no remediation needed',
      });
    });
  });

  describe('evaluation schema repair', () => {
    it('retries evaluation when first LLM response fails schema validation', async () => {
      const invalidResponse = '{"perMemory":[]}'; // missing required "summary"
      const validResponse = JSON.stringify({
        summary: 'Memory was applied successfully.',
        perMemory: [
          { memoryId: 'mem-existing', outcome: 'positive', reason: 'Guided the approach.', confidence: 0.9 },
        ],
      });

      evaluatorClient.generate
        .mockResolvedValueOnce(ok({ content: invalidResponse }))
        .mockResolvedValueOnce(ok({ content: validResponse }));

      executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
      executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord({ evaluationSummary: 'Memory was applied successfully.' })));

      executionMemoryRepo.findById.mockResolvedValueOnce(ok(createMemory()));
      executionMemoryRepo.update.mockResolvedValueOnce(ok(undefined));

      const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask(),
        [{ text: 'log line' }],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 5,
        },
      );

      expect(summary).toBe('Memory was applied successfully.');
      expect(evaluatorClient.generate).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        'Evaluator response failed Zod parse, retrying with refinement prompt',
      );
    });

    it('throws when evaluation repair also fails schema validation', async () => {
      const invalidResponse = '{"perMemory":[]}'; // missing "summary" both times

      evaluatorClient.generate
        .mockResolvedValueOnce(ok({ content: invalidResponse }))
        .mockResolvedValueOnce(ok({ content: invalidResponse }));

      executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));

      await expect(
        processExecutionMemoryBacklogTestables.evaluateApplication(
          createTask(),
          [{ text: 'log line' }],
          {
            logger,
            codeTaskRepo: codeTaskRepo as never,
            logLineRepo: logLineRepo as never,
            turnMetricsRepo: turnMetricsRepo as never,
            linearAgentClient: linearAgentClient as never,
            executionMemoryRepo: executionMemoryRepo as never,
            executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
            evaluatorClient: evaluatorClient as never,
            distillerClient: distillerClient as never,
            embeddingClient: embeddingClient as never,
            limit: 5,
          },
        ),
      ).rejects.toThrow(/Required/);

      expect(evaluatorClient.generate).toHaveBeenCalledTimes(2);
    });

    it('throws when evaluation retry generate call returns error result', async () => {
      const invalidResponse = '{"perMemory":[]}'; // missing "summary"

      evaluatorClient.generate
        .mockResolvedValueOnce(ok({ content: invalidResponse }))
        .mockResolvedValueOnce(err({ message: 'LLM service unavailable' }));

      executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));

      await expect(
        processExecutionMemoryBacklogTestables.evaluateApplication(
          createTask(),
          [{ text: 'log line' }],
          {
            logger,
            codeTaskRepo: codeTaskRepo as never,
            logLineRepo: logLineRepo as never,
            turnMetricsRepo: turnMetricsRepo as never,
            linearAgentClient: linearAgentClient as never,
            executionMemoryRepo: executionMemoryRepo as never,
            executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
            evaluatorClient: evaluatorClient as never,
            distillerClient: distillerClient as never,
            embeddingClient: embeddingClient as never,
            limit: 5,
          },
        ),
      ).rejects.toThrow('LLM service unavailable');

      expect(evaluatorClient.generate).toHaveBeenCalledTimes(2);
    });

    it('includes EVALUATION_SCHEMA_BLOCK in evaluation prompt', async () => {
      executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
      evaluatorClient.generate.mockResolvedValueOnce(ok({
        content: JSON.stringify({
          summary: 'Test summary.',
          perMemory: [{ memoryId: 'mem-existing', outcome: 'positive', reason: 'Applied.', confidence: 0.9 }],
        }),
      }));
      executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord()));
      executionMemoryRepo.findById.mockResolvedValueOnce(ok(createMemory()));
      executionMemoryRepo.update.mockResolvedValueOnce(ok(undefined));

      await processExecutionMemoryBacklogTestables.evaluateApplication(
        createTask(),
        [{ text: 'log line' }],
        {
          logger,
          codeTaskRepo: codeTaskRepo as never,
          logLineRepo: logLineRepo as never,
          turnMetricsRepo: turnMetricsRepo as never,
          linearAgentClient: linearAgentClient as never,
          executionMemoryRepo: executionMemoryRepo as never,
          executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
          evaluatorClient: evaluatorClient as never,
          distillerClient: distillerClient as never,
          embeddingClient: embeddingClient as never,
          limit: 5,
        },
      );

      const prompt = evaluatorClient.generate.mock.calls[0]?.[0] as string;
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"perMemory"');
      expect(prompt).toContain('Return JSON only. Use this exact schema:');
    });
  });
});
