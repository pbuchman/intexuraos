import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { LlmModels } from '@intexuraos/llm-contract';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { ExecutionMemoryMatch } from '../../../domain/models/executionMemory.js';
import {
  __testables as prepareExecutionMemoryContextTestables,
  prepareExecutionMemoryContext,
  toDispatchExecutionMemoryContext,
} from '../../../domain/usecases/prepareExecutionMemoryContext.js';

describe('prepareExecutionMemoryContext', () => {
  let logger: Logger;
  let linearAgentClient: {
    getIssueContext: ReturnType<typeof vi.fn>;
  };
  let queryClient: {
    generate: ReturnType<typeof vi.fn>;
  };
  let embeddingClient: {
    embed: ReturnType<typeof vi.fn>;
  };
  let executionMemoryRepo: {
    findNearest: ReturnType<typeof vi.fn>;
  };
  let executionMemoryApplicationRepo: {
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    linearAgentClient = {
      getIssueContext: vi.fn().mockResolvedValue(ok({
        description: 'Auth callback route is failing in production. Verify request logging.',
        comments: [
          { body: 'This regressed after env propagation cleanup.', createdAt: '2026-03-24T10:00:00.000Z' },
          { body: 'Please cover the Fastify route with app.inject().', createdAt: '2026-03-24T11:00:00.000Z' },
        ],
      })),
    };

    queryClient = {
      generate: vi.fn(),
    };

    embeddingClient = {
      embed: vi.fn(),
    };

    executionMemoryRepo = {
      findNearest: vi.fn(),
    };

    executionMemoryApplicationRepo = {
      create: vi.fn(),
    };
  });

  function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task-123',
      userId: 'user-123',
      traceId: 'trace-123',
      prompt: 'Fix the Auth0 callback route, restore request logging, and verify the API shape.',
      sanitizedPrompt: 'Fix the Auth0 callback route, restore request logging, and verify the API shape.',
      systemPromptHash: 'hash-123',
      workerType: 'auto',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'queued',
      dedupKey: 'dedup-123',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
      agentType: 'execution',
      linearIssueId: 'INT-1098',
      ...overrides,
    };
  }

  function createMatch(
    id: string,
    overrides: Partial<ExecutionMemoryMatch> = {}
  ): ExecutionMemoryMatch {
    const now = Timestamp.now();
    return {
      id,
      repository: 'pbuchman/intexuraos',
      sourceTaskId: 'task-source',
      memoryType: 'verification_pattern',
      title: `Memory ${id}`,
      appliesWhen: 'Fastify route handlers or callback flows are changing',
      action: 'Add route-level assertions and inspect request logging',
      avoid: 'Do not update only the handler without schema and serialization changes',
      verification: 'Cover the route with app.inject and check task-detail serialization',
      evidenceSummary: 'Prior regression fixed by adding route coverage and request logging',
      retrievalText: 'fastify route schema request logging app inject serialization',
      keywords: ['fastify', 'route', 'logging'],
      labelHints: ['bug', 'backend'],
      componentHints: ['route', 'logging', 'verification'],
      embeddingModel: 'text-embedding-3-small',
      fingerprint: `fp-${id}`,
      distillationVersion: 'execution-memory-distiller@1.0.0',
      qualityScore: 0.9,
      applicationCount: 3,
      positiveCount: 2,
      negativeCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      vectorScore: 0.91,
      ...overrides,
    };
  }

  it('returns matched context and persists an application record when memories survive reranking', async () => {
    queryClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        semanticQuery: 'Auth0 callback route logging and task-detail verification',
        components: ['auth', 'route', 'logging', 'verification'],
        riskFlags: ['env_propagation'],
        verificationGoals: ['cover callback route', 'verify task detail serialization'],
        labelHints: ['bug', 'backend'],
        summary: 'Auth callback route changes with logging and route verification work',
      }),
      usage: { model: LlmModels.Gemini25Flash },
    }));

    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([
      createMatch('mem-1', { vectorScore: 0.95, componentHints: ['route', 'logging', 'verification'] }),
      createMatch('mem-2', { memoryType: 'pitfall_pattern', vectorScore: 0.9, componentHints: ['route', 'auth'] }),
      createMatch('mem-3', { vectorScore: 0.5, qualityScore: 0.1, componentHints: ['docs'] }),
    ]));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-123' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend', 'bug'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: queryClient as never,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toMatchObject({
      status: 'matched',
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback route changes with logging and route verification work',
      matchedMemories: [
        expect.objectContaining({ memoryId: 'mem-1' }),
        expect.objectContaining({ memoryId: 'mem-2' }),
      ],
    });
    expect(result?.matchedAt).toBeInstanceOf(Timestamp);
    expect(executionMemoryApplicationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-123',
      repository: 'pbuchman/intexuraos',
      status: 'matched',
      querySummary: 'Auth callback route changes with logging and route verification work',
      queryComponents: ['auth', 'route', 'logging', 'verification'],
      matchedMemories: [
        expect.objectContaining({ memoryId: 'mem-1' }),
        expect.objectContaining({ memoryId: 'mem-2' }),
      ],
    }));
  });

  it('falls back to deterministic normalization and records no_match when no memory survives reranking', async () => {
    queryClient.generate.mockResolvedValue(err({ code: 'API_ERROR', message: 'gemini unavailable' }));
    embeddingClient.embed.mockResolvedValue(ok([0.4, 0.5, 0.6]));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([
      createMatch('mem-low', {
        vectorScore: 0.51,
        qualityScore: 0.2,
        componentHints: ['unrelated'],
        labelHints: ['frontend'],
      }),
    ]));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-no-match' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend', 'bug'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: queryClient as never,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'none',
      applicationId: 'app-no-match',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: expect.stringContaining('Fix the Auth0 callback route'),
    });
    expect(executionMemoryApplicationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'no_match',
      queryText: expect.stringContaining('Fix the Auth0 callback route'),
    }));
  });

  it('returns error context and records an error application when embedding is unavailable', async () => {
    queryClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        semanticQuery: 'Auth callback logging',
        components: ['auth', 'logging'],
        riskFlags: ['env'],
        verificationGoals: ['route coverage'],
        labelHints: ['bug'],
        summary: 'Auth callback logging work',
      }),
      usage: { model: LlmModels.Gemini25Flash },
    }));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-error' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: queryClient as never,
      embeddingClient: undefined,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'error',
      applicationId: 'app-error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback logging work',
      errorCode: 'embedding_unavailable',
      errorMessage: 'Execution memory embedding client is not configured',
    });
    expect(executionMemoryApplicationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      matchedMemories: [],
      queryText: 'Auth callback logging',
    }));
    expect(executionMemoryRepo.findNearest).not.toHaveBeenCalled();
  });

  it('returns an error immediately when the application repository is not configured', async () => {
    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: undefined,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: undefined,
    });

    expect(result).toEqual({
      status: 'error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: expect.stringContaining('Fix the Auth0 callback route'),
      errorCode: 'application_repo_unavailable',
      errorMessage: 'Execution memory application repository is not configured',
    });
  });

  it('returns error context when the memory repository is not configured', async () => {
    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-memory-repo' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: undefined,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: undefined,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'error',
      applicationId: 'app-memory-repo',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: expect.stringContaining('Fix the Auth0 callback route'),
      errorCode: 'memory_repo_unavailable',
      errorMessage: 'Execution memory repository is not configured',
    });
  });

  it('returns error context when embedding generation fails even if application persistence also fails', async () => {
    queryClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        semanticQuery: 'Auth callback logging',
        components: ['auth'],
        riskFlags: [],
        verificationGoals: [],
        labelHints: [],
        summary: 'Auth callback logging work',
      }),
      usage: { model: LlmModels.Gemini25Flash },
    }));
    embeddingClient.embed.mockResolvedValue(err({ message: 'embedding failed' }));
    executionMemoryApplicationRepo.create.mockResolvedValue(err({ message: 'firestore unavailable' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: queryClient as never,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback logging work',
      errorCode: 'embedding_failed',
      errorMessage: 'embedding failed',
    });
  });

  it('includes the application id when embedding generation fails after persistence succeeds', async () => {
    queryClient.generate.mockResolvedValue(ok({
      content: JSON.stringify({
        semanticQuery: 'Auth callback logging',
        components: ['auth'],
        riskFlags: [],
        verificationGoals: [],
        labelHints: [],
        summary: 'Auth callback logging work',
      }),
      usage: { model: LlmModels.Gemini25Flash },
    }));
    embeddingClient.embed.mockResolvedValue(err({ message: 'embedding failed' }));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-embedding-error' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: queryClient as never,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'error',
      applicationId: 'app-embedding-error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback logging work',
      errorCode: 'embedding_failed',
      errorMessage: 'embedding failed',
    });
  });

  it('returns error context when vector search fails', async () => {
    embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
    executionMemoryRepo.findNearest.mockResolvedValue(err({ message: 'vector search unavailable' }));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-vector-error' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: undefined,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'error',
      applicationId: 'app-vector-error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: expect.stringContaining('Fix the Auth0 callback route'),
      errorCode: 'vector_search_failed',
      errorMessage: 'vector search unavailable',
    });
  });

  it('falls back when the normalizer returns invalid JSON and when Linear context loading fails', async () => {
    linearAgentClient.getIssueContext.mockResolvedValue(err({ message: 'linear unavailable' }));
    queryClient.generate.mockResolvedValue(ok({ content: 'not json at all' }));
    embeddingClient.embed.mockResolvedValue(ok([0.4, 0.5, 0.6]));
    executionMemoryRepo.findNearest.mockResolvedValue(ok([
      createMatch('mem-low', {
        vectorScore: 0.6,
        componentHints: [],
        labelHints: [],
      }),
    ]));
    executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-invalid-json' }));

    const result = await prepareExecutionMemoryContext({
      task: createTask(),
      linearIssueLabels: ['backend'],
      logger,
      linearAgentClient: linearAgentClient as never,
      queryClient: queryClient as never,
      embeddingClient: embeddingClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
    });

    expect(result).toEqual({
      status: 'none',
      applicationId: 'app-invalid-json',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: expect.stringContaining('Fix the Auth0 callback route'),
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('guards dispatch context serialization and returns the matched context when all required fields exist', () => {
    expect(toDispatchExecutionMemoryContext(undefined)).toBeUndefined();
    expect(toDispatchExecutionMemoryContext({ status: 'none' })).toBeUndefined();
    expect(toDispatchExecutionMemoryContext({
      status: 'matched',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'summary',
      matchedMemories: [],
    })).toBeUndefined();

    expect(toDispatchExecutionMemoryContext({
      status: 'matched',
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'summary',
      matchedMemories: [
        {
          memoryId: 'mem-1',
          title: 'Route logging',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'When route handlers change',
          action: 'Add logging',
          avoid: 'Do not skip route tests',
          verification: 'Use app.inject',
        },
      ],
    })).toEqual({
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'summary',
      matchedMemories: [
        {
          memoryId: 'mem-1',
          title: 'Route logging',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'When route handlers change',
          action: 'Add logging',
          avoid: 'Do not skip route tests',
          verification: 'Use app.inject',
        },
      ],
    });
  });

  it('covers helper fallbacks, truncation, and reranking edge cases', async () => {
    const fallback = prepareExecutionMemoryContextTestables.buildFallbackNormalization(
      {
        prompt: '  Prompt fallback  ',
        sanitizedPrompt: '   ',
      },
      { description: null, comments: [] },
      [' Backend ', 'backend', '']
    );
    expect(fallback).toEqual({
      semanticQuery: 'Prompt fallback',
      components: [],
      riskFlags: [],
      verificationGoals: [],
      labelHints: ['backend'],
      summary: 'Prompt fallback',
    });

    const invalidNormalization = await prepareExecutionMemoryContextTestables.normalizeQuery({
      task: {
        prompt: 'Prompt fallback',
        sanitizedPrompt: 'Prompt fallback',
      },
      issueContext: { description: null, comments: [] },
      linearIssueLabels: ['backend'],
      logger,
      queryClient: {
        generate: vi.fn().mockResolvedValue(ok({ content: 'missing braces' })),
      } as never,
    });
    expect(invalidNormalization.semanticQuery).toContain('Prompt fallback');

    await expect(
      prepareExecutionMemoryContextTestables.getLinearContext(
        undefined,
        linearAgentClient as never,
        logger
      )
    ).resolves.toEqual({ description: null, comments: [] });

    const nullDescriptionContext = await prepareExecutionMemoryContextTestables.getLinearContext(
      'INT-1098',
      {
        getIssueContext: vi.fn().mockResolvedValue(ok({
          description: null,
          comments: [],
        })),
      },
      logger
    );
    expect(nullDescriptionContext).toEqual({ description: null, comments: [] });

    const context = await prepareExecutionMemoryContextTestables.getLinearContext(
      'INT-1098',
      {
        getIssueContext: vi.fn().mockResolvedValue(ok({
          description: 'x'.repeat(3000),
          comments: [
            { body: 'a'.repeat(900), createdAt: '2026-03-25T14:00:00.000Z' },
            { body: 'b'.repeat(900), createdAt: '2026-03-25T13:00:00.000Z' },
            { body: 'c'.repeat(900), createdAt: '2026-03-25T12:00:00.000Z' },
            { body: 'd'.repeat(900), createdAt: '2026-03-25T11:00:00.000Z' },
            { body: 'e'.repeat(900), createdAt: '2026-03-25T10:00:00.000Z' },
            { body: 'f'.repeat(900), createdAt: '2026-03-25T09:00:00.000Z' },
          ],
        })),
      },
      logger
    );
    expect(context.description).toHaveLength(2500);
    expect(context.comments).toHaveLength(3);
    expect(context.comments[0]).toHaveLength(800);

    const reranked = prepareExecutionMemoryContextTestables.rerankMemories(
      [
        createMatch('mem-1', { vectorScore: 0.9, componentHints: [], labelHints: [] }),
        createMatch('mem-2', { vectorScore: 0.7, componentHints: ['route'], labelHints: ['backend'] }),
      ],
      {
        semanticQuery: 'route verification',
        components: [],
        riskFlags: [],
        verificationGoals: [],
        labelHints: [],
        summary: 'summary',
      },
      []
    );
    expect(reranked[0]?.memory.id).toBe('mem-1');

    expect(prepareExecutionMemoryContextTestables.truncate('short', 10)).toBe('short');
    expect(prepareExecutionMemoryContextTestables.truncate('truncate-me', 5)).toBe('trunc');
  });
});
