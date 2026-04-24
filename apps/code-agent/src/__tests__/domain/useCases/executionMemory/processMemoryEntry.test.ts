import { describe, it, expect, vi } from 'vitest';
import { ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { processMemoryEntry } from '../../../../domain/usecases/executionMemory/processMemoryEntry.js';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import type { ExecutionMemory } from '../../../../domain/models/executionMemory.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.now();
  return {
    id: 'task-1',
    userId: 'user-1',
    prompt: 'fix bug',
    sanitizedPrompt: 'fix bug',
    systemPromptHash: 'h',
    workerType: 'auto',
    workerLocation: 'loc',
    repository: 'pbuchman/test',
    baseBranch: 'main',
    status: 'implemented',
    traceId: 't',
    dedupKey: 'd',
    createdAt: now,
    updatedAt: now,
    agentType: 'execution',
    ...overrides,
  } as CodeTask;
}

function makeMemory(overrides: Partial<ExecutionMemory> = {}): ExecutionMemory {
  const now = Timestamp.now();
  return {
    id: 'mem-new',
    repository: 'pbuchman/test',
    sourceTaskId: 'task-1',
    memoryType: 'verification_pattern',
    title: 't',
    appliesWhen: 'when',
    action: 'do',
    avoid: 'avoid',
    verification: 'verify',
    evidenceSummary: 'evidence',
    retrievalText: 'retrieval',
    keywords: [],
    componentHints: [],
    embeddingModel: 'text-embedding-3-small',
    fingerprint: 'fp',
    distillationVersion: 'v1',
    qualityScore: 0.8,
    distillationConfidence: 0.8,
    applicationCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('processMemoryEntry', () => {
  it('returns completed with generated memory ids and evaluationSummary for a normal entry', async () => {
    const distillerGenerate = vi.fn()
      // First call: evaluation (no applicationId in task so evaluation is bypassed via self-report summary)
      // Second call: distillation
      .mockResolvedValueOnce(ok({
        content: JSON.stringify({
          decision: 'create',
          evidenceSummary: 'Learned reusable pattern',
          memories: [
            {
              memoryType: 'verification_pattern',
              title: 'Add serialization tests',
              appliesWhen: 'route handler changes',
              action: 'add inject test',
              avoid: 'skipping tests',
              verification: 'check response shape',
              evidenceSummary: 'evidence',
              retrievalText: 'route serialization test',
              keywords: ['route'],
              componentHints: ['code-agent'],
              confidence: 0.82,
            },
          ],
        }),
      }));

    const llmClient = { generate: distillerGenerate };
    const userServiceClient = { getLlmClient: vi.fn().mockResolvedValue(ok(llmClient)) };

    const embeddingClient = { embed: vi.fn().mockResolvedValue(ok([0.1, 0.2, 0.3])) };
    const executionMemoryRepo = {
      findById: vi.fn(),
      update: vi.fn(),
      findByFingerprint: vi.fn().mockResolvedValue(ok(null)),
      findNearest: vi.fn().mockResolvedValue(ok([])),
      create: vi.fn().mockResolvedValue(ok(makeMemory({ id: 'mem-new' }))),
    };

    const executionMemoryApplicationRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };

    const task = makeTask({
      result: {
        summary: 'bug fixed',
        execution_memory_usage_summary: 'helpful memory',
      },
      executionMemoryContext: { status: 'none' },
    });

    const result = await processMemoryEntry(task, {
      logger: mockLogger,
      logLineRepo: {
        listRecent: vi.fn().mockResolvedValue(ok([{ text: 'log line' }])),
      },
      turnMetricsRepo: {
        listByTask: vi.fn().mockResolvedValue(ok([])),
      },
      linearAgentClient: {
        getIssueContext: vi.fn().mockResolvedValue(ok({ description: null, comments: [] })),
      },
      executionMemoryRepo,
      executionMemoryApplicationRepo,
      userServiceClient,
      embeddingClient,
    });

    expect(result.status).toBe('completed');
    expect(result.generatedMemoryIds).toEqual(['mem-new']);
    expect(result.evaluationSummary).toBe('helpful memory');
    expect(executionMemoryRepo.create).toHaveBeenCalledTimes(1);
  });

  it('returns skipped with already_completed skipReason when task has execution_outcome_label already_completed', async () => {
    const distillerGenerate = vi.fn();
    const llmClient = { generate: distillerGenerate };
    const userServiceClient = { getLlmClient: vi.fn().mockResolvedValue(ok(llmClient)) };

    const task = makeTask({
      result: {
        summary: 'already present',
        execution_outcome_label: 'already_completed',
        execution_memory_usage_summary: 'worker summary',
      },
      executionMemoryContext: { status: 'none' },
    });

    const result = await processMemoryEntry(task, {
      logger: mockLogger,
      logLineRepo: {
        listRecent: vi.fn().mockResolvedValue(ok([])),
      },
      turnMetricsRepo: {
        listByTask: vi.fn().mockResolvedValue(ok([])),
      },
      linearAgentClient: {
        getIssueContext: vi.fn().mockResolvedValue(ok({ description: null, comments: [] })),
      },
      executionMemoryRepo: {
        findById: vi.fn(),
        update: vi.fn(),
        findByFingerprint: vi.fn(),
        findNearest: vi.fn(),
        create: vi.fn(),
      },
      executionMemoryApplicationRepo: {
        findById: vi.fn(),
        update: vi.fn(),
      },
      userServiceClient,
    });

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('already_completed');
    expect(result.generatedMemoryIds).toEqual([]);
    expect(result.evaluationSummary).toBe('worker summary');
    expect(distillerGenerate).not.toHaveBeenCalled();
  });
});
