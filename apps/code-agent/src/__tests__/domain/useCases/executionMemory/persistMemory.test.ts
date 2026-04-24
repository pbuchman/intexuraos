import { describe, it, expect, vi } from 'vitest';
import { ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { persistMemory } from '../../../../domain/usecases/executionMemory/persistMemory.js';
import type { DistilledMemory } from '../../../../domain/usecases/executionMemory/persistMemory.js';
import type { ExecutionMemory } from '../../../../domain/models/executionMemory.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeMemory(overrides: Partial<ExecutionMemory> = {}): ExecutionMemory {
  const now = Timestamp.now();
  return {
    id: 'mem-existing',
    repository: 'pbuchman/test',
    sourceTaskId: 'task-old',
    memoryType: 'verification_pattern',
    title: 'existing title',
    appliesWhen: 'when existing',
    action: 'do existing',
    avoid: 'avoid existing',
    verification: 'verify existing',
    evidenceSummary: 'existing evidence',
    retrievalText: 'existing retrieval',
    keywords: [],
    componentHints: [],
    embeddingModel: 'text-embedding-3-small',
    fingerprint: 'fp-existing',
    distillationVersion: 'v1',
    qualityScore: 0.5,
    distillationConfidence: 0.7,
    applicationCount: 1,
    positiveCount: 0,
    negativeCount: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDistilledMemory(overrides: Partial<DistilledMemory> = {}): DistilledMemory {
  return {
    memoryType: 'verification_pattern',
    title: 'New memory',
    appliesWhen: 'route handler changes',
    action: 'add inject test',
    avoid: 'skipping tests',
    verification: 'check response shape',
    evidenceSummary: 'evidence from this task',
    retrievalText: 'route serialization test',
    keywords: ['route'],
    componentHints: ['code-agent'],
    confidence: 0.8,
    ...overrides,
  };
}

describe('persistMemory', () => {
  it('creates a new memory when no fingerprint match and no near duplicate', async () => {
    const createFn = vi.fn().mockResolvedValue(ok(makeMemory({ id: 'mem-created' })));
    const embeddingClient = { embed: vi.fn().mockResolvedValue(ok([0.1, 0.2, 0.3])) };

    const executionMemoryRepo = {
      findByFingerprint: vi.fn().mockResolvedValue(ok(null)),
      findNearest: vi.fn().mockResolvedValue(ok([])),
      create: createFn,
      update: vi.fn(),
    };

    const memory = makeDistilledMemory();

    const resultId = await persistMemory(
      {
        repository: 'pbuchman/test',
        sourceTaskId: 'task-1',
        sourceLinearIssueId: 'INT-100',
        sourceAgentType: 'execution',
        distillationVersion: 'execution-memory-distiller@2.1.0',
        memory,
      },
      {
        logger: mockLogger,
        executionMemoryRepo,
        embeddingClient,
      },
    );

    expect(resultId).toBe('mem-created');
    expect(createFn).toHaveBeenCalledWith(expect.objectContaining({
      repository: 'pbuchman/test',
      sourceTaskId: 'task-1',
      sourceLinearIssueId: 'INT-100',
      sourceAgentType: 'execution',
      memoryType: 'verification_pattern',
      title: 'New memory',
      appliesWhen: 'route handler changes',
      action: 'add inject test',
      avoid: 'skipping tests',
      verification: 'check response shape',
      retrievalText: 'route serialization test',
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'text-embedding-3-small',
      distillationVersion: 'execution-memory-distiller@2.1.0',
      distillationConfidence: 0.8,
      applicationCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      status: 'active',
    }));
    expect(executionMemoryRepo.findByFingerprint).toHaveBeenCalledWith(
      'pbuchman/test',
      expect.any(String),
    );
  });

  it('throws when embedding client is missing', async () => {
    const executionMemoryRepo = {
      findByFingerprint: vi.fn(),
      findNearest: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    await expect(
      persistMemory(
        {
          repository: 'pbuchman/test',
          sourceTaskId: 'task-1',
          sourceLinearIssueId: undefined,
          sourceAgentType: 'execution',
          distillationVersion: 'execution-memory-distiller@2.1.0',
          memory: makeDistilledMemory(),
        },
        {
          logger: mockLogger,
          executionMemoryRepo,
        },
      ),
    ).rejects.toThrow('Execution memory embedding client is not configured');

    expect(executionMemoryRepo.findByFingerprint).not.toHaveBeenCalled();
  });

  it('updates an existing memory when an exact fingerprint match is found', async () => {
    const exactMatch = makeMemory({
      id: 'mem-exact',
      applicationCount: 3,
      positiveCount: 2,
      negativeCount: 0,
    });

    const updateFn = vi.fn().mockResolvedValue(ok(exactMatch));
    const createFn = vi.fn();
    const findNearestFn = vi.fn();
    const embeddingClient = { embed: vi.fn().mockResolvedValue(ok([0.4, 0.5, 0.6])) };

    const executionMemoryRepo = {
      findByFingerprint: vi.fn().mockResolvedValue(ok(exactMatch)),
      findNearest: findNearestFn,
      create: createFn,
      update: updateFn,
    };

    const resultId = await persistMemory(
      {
        repository: 'pbuchman/test',
        sourceTaskId: 'task-1',
        sourceLinearIssueId: undefined,
        sourceAgentType: 'execution',
        distillationVersion: 'execution-memory-distiller@2.1.0',
        memory: makeDistilledMemory({ title: 'Updated title' }),
      },
      {
        logger: mockLogger,
        executionMemoryRepo,
        embeddingClient,
      },
    );

    expect(resultId).toBe('mem-exact');
    expect(updateFn).toHaveBeenCalledWith('mem-exact', expect.objectContaining({
      title: 'Updated title',
      sourceTaskId: 'task-1',
      sourceAgentType: 'execution',
      applicationCount: 3,
      positiveCount: 2,
      negativeCount: 0,
    }));
    expect(createFn).not.toHaveBeenCalled();
    expect(findNearestFn).not.toHaveBeenCalled();
  });
});
