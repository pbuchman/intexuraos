import { describe, expect, it } from 'vitest';
import { CreateTaskRequestSchema } from '../types/schemas.js';

describe('CreateTaskRequestSchema', () => {
  const callbackRequest = {
    taskId: 'task_00000000-0000-0000-0000-0000000000f1',
    workerType: 'auto',
    prompt: 'Validate callback ownership',
    webhookSecret: 'secret',
  } as const;

  it.each(['file:///tmp/callback', 'ftp://example.com/callback', 'mailto:callback@example.com'])(
    'rejects non-HTTP callback URL %s before task creation',
    (webhookUrl) => {
      expect(CreateTaskRequestSchema.safeParse({ ...callbackRequest, webhookUrl }).success).toBe(
        false
      );
    }
  );

  it.each(['http://localhost:8080/callback', 'https://example.com/callback'])(
    'accepts HTTP(S) callback URL %s',
    (webhookUrl) => {
      expect(CreateTaskRequestSchema.safeParse({ ...callbackRequest, webhookUrl }).success).toBe(
        true
      );
    }
  );

  it('accepts Sentry agent tasks with issue context', () => {
    const result = CreateTaskRequestSchema.safeParse({
      taskId: 'task_00000000-0000-0000-0000-0000000000a4',
      workerType: 'codex-xhigh',
      prompt: 'Fix Sentry issue',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: ['sentry', 'code-task'],
      hasChildren: false,
      agentType: 'sentry',
      sentryIssue: {
        organizationSlug: 'intexura',
        projectSlug: 'code-agent',
        issueId: '123456',
        issueUrl: 'https://intexura.sentry.io/issues/123456/',
        title: 'TypeError: cannot read property',
        action: 'created',
        receivedAt: '2026-06-28T12:00:00.000Z',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.agentType).toBe('sentry');
    if (result.data.sentryIssue === undefined) {
      throw new Error('Expected parsed Sentry issue context');
    }
    expect(result.data.sentryIssue.issueUrl).toBe('https://intexura.sentry.io/issues/123456/');
  });

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
    'single_artifact_planning',
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

describe('CreateTaskRequestSchema — reviewTypes', () => {
  const baseRequest = {
    taskId: 'task_00000000-0000-0000-0000-0000000000c1',
    workerType: 'openrouter-free',
    prompt: 'Review PR documentation and code quality',
    webhookUrl: 'https://intexuraos.cloud/api/code/internal/task-hook',
    webhookSecret: 'sec',
    linearIssueLabels: [],
    hasChildren: false,
    agentType: 'review',
  } as const;

  it('accepts documentation review type from code-agent review dispatch', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      reviewTypes: ['documentation', 'architecture', 'code_quality'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewTypes).toEqual(['documentation', 'architecture', 'code_quality']);
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
