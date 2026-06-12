import { describe, expect, it } from 'vitest';
import { CreateTaskRequestSchema } from '../types/schemas.js';

describe('CreateTaskRequestSchema', () => {
  it('accepts executionMemoryContext for execution tasks', () => {
    const executionMemoryContext = {
      applicationId: 'app_123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Callback logging, route verification, and env propagation.',
      matchedMemories: [
        {
          memoryId: 'mem_142',
          title: 'Log incoming requests on callback routes',
          memoryType: 'pitfall_pattern',
          score: 0.94,
          appliesWhen: 'A callback route changes request handling.',
          action: 'Update request logging with the route change.',
          avoid: 'Do not copy stale branch names from memories.',
          verification: 'Add app.inject coverage for the route.',
        },
      ],
    };

    const result = CreateTaskRequestSchema.safeParse({
      taskId: 'task_00000000-0000-0000-0000-0000000000a1',
      workerType: 'auto',
      prompt: 'Fix callback logging and route coverage',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      agentType: 'execution',
      executionMemoryContext,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.executionMemoryContext).toEqual(executionMemoryContext);
  });

  it.each([
    'implementation_pattern',
    'verification_pattern',
    'pitfall_pattern',
    'decomposition_pattern',
    'planning_decision',
    'review_finding',
  ] as const)('accepts memoryType %s', (memoryType) => {
    const result = CreateTaskRequestSchema.safeParse({
      taskId: 'task_00000000-0000-0000-0000-0000000000a2',
      workerType: 'auto',
      prompt: 'Test memory type acceptance',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      agentType: 'execution',
      executionMemoryContext: {
        applicationId: 'app_123',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Test query',
        matchedMemories: [
          {
            memoryId: 'mem_test',
            title: 'Test memory',
            memoryType,
            score: 0.85,
            appliesWhen: 'When testing',
            action: 'Do something',
            avoid: 'Avoid nothing',
            verification: 'Check it works',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });
});

describe('CreateTaskRequestSchema — retriedFrom', () => {
  it('accepts retriedFrom and preserves it through parse', () => {
    const result = CreateTaskRequestSchema.safeParse({
      taskId: 'task_00000000-0000-0000-0000-0000000000a3',
      workerType: 'auto',
      prompt: 'p',
      webhookUrl: 'https://example.com/hook',
      webhookSecret: 'sec',
      linearIssueLabels: [],
      hasChildren: false,
      retriedFrom: 'task_original_abc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retriedFrom).toBe('task_original_abc');
    }
  });
});

describe('CreateTaskRequestSchema — timeoutHours (INT-1585)', () => {
  const baseRequest = {
    taskId: 'task_00000000-0000-0000-0000-0000000000b1',
    workerType: 'auto',
    prompt: 'p',
    webhookUrl: 'https://example.com/hook',
    webhookSecret: 'sec',
    linearIssueLabels: [],
    hasChildren: false,
  } as const;

  it('accepts integer timeoutHours within [1, 12]', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, timeoutHours: 8 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutHours).toBe(8);
    }
  });

  it('accepts the lower bound (1)', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, timeoutHours: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts the upper bound (12)', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, timeoutHours: 12 });
    expect(result.success).toBe(true);
  });

  it('rejects timeoutHours below MIN', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, timeoutHours: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects timeoutHours above MAX', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, timeoutHours: 13 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer timeoutHours', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, timeoutHours: 5.5 });
    expect(result.success).toBe(false);
  });

  it('treats absent timeoutHours as valid (backward compat)', () => {
    const result = CreateTaskRequestSchema.safeParse(baseRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutHours).toBeUndefined();
    }
  });
});
