import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';

const { createLlmClientMock } = vi.hoisted(() => ({
  createLlmClientMock: vi.fn(),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: createLlmClientMock,
}));

const {
  OrchestratorCompletionVerifier,
  PLANNING_SCHEMA,
  EXECUTION_SCHEMA,
  PULL_REQUEST_SCHEMA,
  buildPlanningPrompt,
  buildExecutionPrompt,
  buildPullRequestPrompt,
  getLast50Lines,
} = await import('../completion-verifier.js');

const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerDebug = vi.fn();

const logger: Logger = {
  info: loggerInfo as Logger['info'],
  warn: loggerWarn as Logger['warn'],
  error: loggerError as Logger['error'],
  debug: loggerDebug as Logger['debug'],
};

const defaultConfig = {
  model: LlmModels.Gemini25Flash,
  geminiApiKey: 'gemini-key',
  auditLogPath: '/tmp/orchestrator-llm-audit.test.log',
} as const;

function createVerifier(
  overrides: Partial<{ model: string; geminiApiKey: string; auditLogPath: string }> = {}
): InstanceType<typeof OrchestratorCompletionVerifier> {
  return new OrchestratorCompletionVerifier(logger, { ...defaultConfig, ...overrides });
}

const generateMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  createLlmClientMock.mockReturnValue({ generate: generateMock });
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

describe('PLANNING_SCHEMA', () => {
  it('accepts valid planning data', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_task_url: 'https://linear.app/intexuraos/issue/INT-100',
      summary: 'Planned the task.',
      clarification_message: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts unclear outcome with clarification message', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'unclear',
      superpowers_writing_plans: 'not used',
      linear_task_url: '',
      summary: 'Could not plan.',
      clarification_message: 'Need more info.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid outcome', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'done',
      superpowers_writing_plans: 'used',
      linear_task_url: '',
      summary: 'x',
      clarification_message: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = PLANNING_SCHEMA.safeParse({ outcome: 'planned' });
    expect(result.success).toBe(false);
  });
});

describe('EXECUTION_SCHEMA', () => {
  it('accepts valid execution data', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      superpowers_executing_plans: 'used',
      superpowers_requesting_code_review: 'not used',
      gh_pr_url: 'https://github.com/org/repo/pull/1',
      summary: 'Implemented the feature.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid enum value', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      superpowers_executing_plans: 'maybe',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: '',
      summary: 'x',
    });
    expect(result.success).toBe(false);
  });
});

describe('PULL_REQUEST_SCHEMA', () => {
  it('accepts valid pull request data', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid comments_replied value', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: '',
      comments_replied: 'maybe',
      summary: 'x',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt', () => {
  it('includes transcript and planning-specific fields', () => {
    const prompt = buildPlanningPrompt('line1\nline2');
    expect(prompt).toContain('Planning Agent');
    expect(prompt).toContain('outcome');
    expect(prompt).toContain('superpowers_writing_plans');
    expect(prompt).toContain('linear_task_url');
    expect(prompt).toContain('clarification_message');
    expect(prompt).toContain('line1\nline2');
  });
});

describe('buildExecutionPrompt', () => {
  it('includes transcript and execution-specific fields', () => {
    const prompt = buildExecutionPrompt('exec-log');
    expect(prompt).toContain('Execution Agent');
    expect(prompt).toContain('superpowers_executing_plans');
    expect(prompt).toContain('superpowers_requesting_code_review');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('exec-log');
  });
});

describe('buildPullRequestPrompt', () => {
  it('includes transcript and pull-request-specific fields', () => {
    const prompt = buildPullRequestPrompt('pr-log');
    expect(prompt).toContain('Pull Request Agent');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('comments_replied');
    expect(prompt).toContain('pr-log');
  });
});

// ---------------------------------------------------------------------------
// getLast50Lines
// ---------------------------------------------------------------------------

describe('getLast50Lines', () => {
  it('returns last 50 lines from raw logs', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i + 1)}`);
    const result = getLast50Lines(lines.join('\n'));
    const resultLines = result.split('\n');
    expect(resultLines).toHaveLength(50);
    expect(resultLines[0]).toBe('line-51');
    expect(resultLines[49]).toBe('line-100');
  });

  it('returns all lines when fewer than 50', () => {
    const result = getLast50Lines('a\nb\nc');
    expect(result).toBe('a\nb\nc');
  });

  it('returns empty string for empty input', () => {
    const result = getLast50Lines('');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// OrchestratorCompletionVerifier — constructor
// ---------------------------------------------------------------------------

describe('OrchestratorCompletionVerifier', () => {
  describe('constructor validation', () => {
    it('throws when model is not gemini-2.5-flash', () => {
      expect(() => createVerifier({ model: 'gpt-4' })).toThrow(
        'Completion verifier must use model gemini-2.5-flash'
      );
    });

    it('throws when geminiApiKey is empty', () => {
      expect(() => createVerifier({ geminiApiKey: '' })).toThrow(
        'INTEXURAOS_GEMINI_APP_API_KEY is required'
      );
    });

    it('throws when auditLogPath is empty', () => {
      expect(() => createVerifier({ auditLogPath: '' })).toThrow(
        'Completion verifier auditLogPath is required'
      );
    });
  });

  describe('describe', () => {
    it('returns enabled with gemini provider and model', () => {
      const verifier = createVerifier();
      expect(verifier.describe()).toEqual({
        enabled: true,
        provider: 'gemini',
        model: LlmModels.Gemini25Flash,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — planning agent
  // ---------------------------------------------------------------------------

  describe('verify — planning agent', () => {
    const validPlanningResponse = JSON.stringify({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_task_url: 'https://linear.app/intexuraos/issue/INT-100',
      summary: 'The agent planned successfully.',
      clarification_message: '',
    });

    it('returns passed with agentData on valid response', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPlanningResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-1',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'some logs',
      });
      expect(result.passed).toBe(true);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields).toEqual([]);
      expect(result.agentData).toEqual({
        agentType: 'planning',
        outcome: 'planned',
        superpowers_writing_plans: 'used',
        linear_task_url: 'https://linear.app/intexuraos/issue/INT-100',
        summary: 'The agent planned successfully.',
        clarification_message: '',
      });
    });

    it('returns passed for unclear outcome', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'unclear',
            superpowers_writing_plans: 'not used',
            linear_task_url: '',
            summary: 'Could not plan.',
            clarification_message: 'Need info about auth approach.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-1',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'logs',
      });
      expect(result.passed).toBe(true);
      expect(result.agentData?.agentType).toBe('planning');
    });
  });

  // ---------------------------------------------------------------------------
  // verify — execution agent
  // ---------------------------------------------------------------------------

  describe('verify — execution agent', () => {
    const validExecutionResponse = JSON.stringify({
      superpowers_executing_plans: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: 'https://github.com/org/repo/pull/901',
      summary: 'Implemented the feature.',
    });

    it('returns passed with execution agentData', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validExecutionResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-2',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: 'exec logs',
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'execution',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/901',
        summary: 'Implemented the feature.',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — pull_request agent
  // ---------------------------------------------------------------------------

  describe('verify — pull_request agent', () => {
    const validPRResponse = JSON.stringify({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      summary: 'Addressed review comments.',
    });

    it('returns passed with pull_request agentData', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPRResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-3',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'pull_request',
        rawLogs: 'pr logs',
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'pull_request',
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        comments_replied: 'yes',
        summary: 'Addressed review comments.',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — failure paths
  // ---------------------------------------------------------------------------

  describe('verify — Gemini failure', () => {
    it('returns verifierFailure when Gemini returns error', async () => {
      generateMock.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'rate limit' },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-fail',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'logs',
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.agentData).toBeUndefined();
    });
  });

  describe('verify — JSON parse failure', () => {
    it('returns verifierFailure when response is not valid JSON', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'not json at all',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-parse',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: 'logs',
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(true);
      expect(result.missingFields).toEqual([]);
    });
  });

  describe('verify — Zod validation failure', () => {
    it('returns missingFields when schema validation fails', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ gh_pr_url: 'https://github.com/org/repo/pull/1' }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-zod',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'pull_request',
        rawLogs: 'logs',
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
      expect(result.missingFields).toContain('comments_replied');
    });
  });

  describe('verify — JSON wrapped in markdown fences', () => {
    it('extracts JSON from surrounding text', async () => {
      const wrappedResponse = `Here is the result:\n${JSON.stringify({
        outcome: 'planned',
        superpowers_writing_plans: 'used',
        linear_task_url: 'https://linear.app/intexuraos/issue/INT-50',
        summary: 'Planned.',
        clarification_message: '',
      })}\nDone.`;
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: wrappedResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-wrapped',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'logs',
      });
      expect(result.passed).toBe(true);
      expect(result.agentData?.agentType).toBe('planning');
    });
  });
});
