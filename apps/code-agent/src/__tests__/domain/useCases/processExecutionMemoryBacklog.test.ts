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
    // recency = 1 (no lastAppliedAt yet)
    // qualityScore = 0.5*0.75 + 0.3*0.8 + 0.2*1 = 0.375 + 0.24 + 0.2 = 0.815
    expect(executionMemoryRepo.update).toHaveBeenCalledWith('mem-existing', expect.objectContaining({
      applicationCount: 2,
      positiveCount: 2,
      qualityScore: expect.closeTo(0.815, 3),
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
    ).rejects.toThrow('memory lookup failed');
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
        undefined
      )
    ).resolves.toBe('mem-existing');

    expect(executionMemoryRepo.update).toHaveBeenLastCalledWith('mem-existing', expect.objectContaining({
      status: 'suppressed',
      sourceTaskId: 'task-1',
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
        'INT-1098'
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
});
