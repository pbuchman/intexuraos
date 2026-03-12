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
  REVIEW_SCHEMA,
  RESUME_SUMMARY_SCHEMA,
  buildPlanningPrompt,
  buildExecutionPrompt,
  buildPullRequestPrompt,
  buildReviewPrompt,
  buildResumeSummaryPrompt,
  getLast50Lines,
  getLast20Lines,
  detectFatalExitCode,
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
      linear_url: 'https://linear.app/intexuraos/issue/INT-100',
      is_complex: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'Planned the task.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts unclear outcome with clarification message', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'unclear',
      superpowers_writing_plans: 'not used',
      linear_url: '',
      is_complex: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'Could not plan.',
      unclear_clarification: 'Need more info.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts planned outcome with pr_url', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-631',
      is_complex: '1',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/950',
      summary: 'Planned and created PR.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts complex task with populated subtask_urls', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-631',
      is_complex: '1',
      subtask_urls:
        'https://linear.app/pbuchman/issue/INT-632/subtask-one,https://linear.app/pbuchman/issue/INT-633/subtask-two',
      pr_url: '',
      summary: 'Planned with subtasks.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtask_urls).toBe(
        'https://linear.app/pbuchman/issue/INT-632/subtask-one,https://linear.app/pbuchman/issue/INT-633/subtask-two'
      );
    }
  });

  it('accepts simple task with empty subtask_urls', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'not used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-640',
      is_complex: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'Simple task planned.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtask_urls).toBe('');
    }
  });

  it('rejects invalid outcome', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'done',
      superpowers_writing_plans: 'used',
      linear_url: '',
      is_complex: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'x',
      unclear_clarification: '',
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
      tracking_comment_id: '12345678',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid comments_replied value', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: '',
      comments_replied: 'maybe',
      tracking_comment_id: '12345678',
      summary: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty tracking_comment_id', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      tracking_comment_id: '',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tracking_comment_id', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(false);
  });
});

describe('REVIEW_SCHEMA', () => {
  it('accepts valid review data', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed the PR for code quality and security issues.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts review_comments_posted as numeric string', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '0',
      review_types: 'code_quality',
      summary: 'No issues found.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty review_comments_posted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '',
      review_types: 'code_quality',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric review_comments_posted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: 'three',
      review_types: 'code_quality',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty review_types', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '3',
      review_types: '',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only review_types', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '3',
      review_types: '   ',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
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
    expect(prompt).toContain('linear_url');
    expect(prompt).toContain('is_complex');
    expect(prompt).toContain('subtask_urls');
    expect(prompt).toContain('pr_url');
    expect(prompt).toContain('unclear_clarification');
    expect(prompt).toContain('line1\nline2');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildPlanningPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain('most recent output takes priority');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
    expect(prompt).toContain('Sample Linear URL format');
    expect(prompt).toContain('Sample PR URL format');
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

  it('includes shared preamble instructions', () => {
    const prompt = buildExecutionPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
  });
});

describe('buildPullRequestPrompt', () => {
  it('includes transcript and pull-request-specific fields', () => {
    const prompt = buildPullRequestPrompt('pr-log');
    expect(prompt).toContain('Pull Request Agent');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('comments_replied');
    expect(prompt).toContain('tracking_comment_id');
    expect(prompt).toContain('pr-log');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildPullRequestPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
  });
});

describe('buildReviewPrompt', () => {
  it('includes transcript and review-specific fields', () => {
    const prompt = buildReviewPrompt('review-log');
    expect(prompt).toContain('Review Agent');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('review_comments_posted');
    expect(prompt).toContain('review_types');
    expect(prompt).toContain('review-log');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildReviewPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
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
      linear_url: 'https://linear.app/intexuraos/issue/INT-100',
      is_complex: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'The agent planned successfully.',
      unclear_clarification: '',
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
        linear_url: 'https://linear.app/intexuraos/issue/INT-100',
        is_complex: '0',
        subtask_urls: '',
        pr_url: '',
        summary: 'The agent planned successfully.',
        unclear_clarification: '',
      });
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validPlanningResponse,
      });
    });

    it('returns passed for unclear outcome', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'unclear',
            superpowers_writing_plans: 'not used',
            linear_url: '',
            is_complex: '0',
            subtask_urls: '',
            pr_url: '',
            summary: 'Could not plan.',
            unclear_clarification: 'Need info about auth approach.',
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
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: expect.any(String),
      });
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
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validExecutionResponse,
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
      tracking_comment_id: '2345678',
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
        tracking_comment_id: '2345678',
        summary: 'Addressed review comments.',
      });
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validPRResponse,
      });
    });
  });

  describe('verify — review agent', () => {
    const validReviewResponse = JSON.stringify({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed and posted 3 comments.',
    });

    it('returns passed with review agentData (not pull_request)', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validReviewResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-4',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'review',
        rawLogs: 'review logs',
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'review',
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        review_comments_posted: '3',
        review_types: 'code_quality,security',
        summary: 'Reviewed and posted 3 comments.',
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
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: '',
      });
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
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: 'not json at all',
      });
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
      expect(result.missingFields).toContain('tracking_comment_id');
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: JSON.stringify({ gh_pr_url: 'https://github.com/org/repo/pull/1' }),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — transcript truncation in logger.info
  // ---------------------------------------------------------------------------

  describe('verify — transcript truncation in log output', () => {
    const validPlanningResponse = JSON.stringify({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/intexuraos/issue/INT-100',
      is_complex: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'Planned.',
      unclear_clarification: '',
    });

    it('truncates transcript to first and last line when >2 non-empty lines', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPlanningResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      await verifier.verify({
        taskId: 'task-trunc',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'first line\nsecond line\nthird line\nfourth line\nfifth line',
      });
      const infoCall = loggerInfo.mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && c[1] === 'Gemini completion verifier request'
      ) as [Record<string, unknown>, string] | undefined;
      expect(infoCall).toBeDefined();
      const logged = infoCall?.[0]?.['transcript'] as string;
      expect(logged).toContain('first line');
      expect(logged).toContain('fifth line');
      expect(logged).toContain('3 lines omitted');
      expect(logged).not.toContain('second line');
    });

    it('logs full transcript when <=2 non-empty lines', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPlanningResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      await verifier.verify({
        taskId: 'task-short',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'only one line',
      });
      const infoCall = loggerInfo.mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && c[1] === 'Gemini completion verifier request'
      ) as [Record<string, unknown>, string] | undefined;
      expect(infoCall).toBeDefined();
      const logged = infoCall?.[0]?.['transcript'] as string;
      expect(logged).toBe('only one line');
    });

    it('handles whitespace-only rawLogs with empty fallback', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPlanningResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      await verifier.verify({
        taskId: 'task-empty',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: '   \n  \n   ',
      });
      const infoCall = loggerInfo.mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && c[1] === 'Gemini completion verifier request'
      ) as [Record<string, unknown>, string] | undefined;
      expect(infoCall).toBeDefined();
      const logged = infoCall?.[0]?.['transcript'] as string;
      expect(logged).toBe('');
    });
  });

  describe('verify — JSON wrapped in markdown fences', () => {
    it('extracts JSON from surrounding text', async () => {
      const wrappedResponse = `Here is the result:\n${JSON.stringify({
        outcome: 'planned',
        superpowers_writing_plans: 'used',
        linear_url: 'https://linear.app/intexuraos/issue/INT-50',
        is_complex: '0',
        subtask_urls: '',
        pr_url: '',
        summary: 'Planned.',
        unclear_clarification: '',
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
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: wrappedResponse,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// detectFatalExitCode
// ---------------------------------------------------------------------------

describe('detectFatalExitCode', () => {
  it('returns 137 when logs contain SIGKILL exit code', () => {
    const logs =
      'some output\n[entrypoint] Claude attempt finished with exit code: 137\nfinal line';
    expect(detectFatalExitCode(logs)).toBe(137);
  });

  it('returns 139 when logs contain SIGSEGV exit code', () => {
    const logs = 'output\n[entrypoint] Claude attempt finished with exit code: 139';
    expect(detectFatalExitCode(logs)).toBe(139);
  });

  it('returns undefined for normal exit code 0', () => {
    const logs = '[entrypoint] Claude attempt finished with exit code: 0\ndone';
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });

  it('returns undefined for exit code 1 (normal failure)', () => {
    const logs = '[entrypoint] Claude attempt finished with exit code: 1';
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });

  it('returns undefined when no exit code pattern is present', () => {
    const logs = 'just some logs\nno exit code here';
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verify — fatal exit code pre-check
// ---------------------------------------------------------------------------

describe('verify — fatal exit code pre-check', () => {
  it.each([
    { exitCode: 137, signal: 'SIGKILL' },
    { exitCode: 139, signal: 'SIGSEGV' },
  ])(
    'returns passed=false for exit code $exitCode ($signal) without calling Gemini',
    async ({ exitCode }) => {
      const verifier = createVerifier();
      const taskId = `task-fatal-${String(exitCode)}`;
      const result = await verifier.verify({
        taskId,
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: `working...\n[entrypoint] Claude attempt finished with exit code: ${String(exitCode)}\n`,
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual([`fatal_exit_code_${String(exitCode)}`]);
      expect(result.verifierFailure).toBe(false);
      expect(result.agentData).toBeUndefined();
      expect(result.trace).toEqual({ transcript: expect.any(String), prompt: '', response: '' });
      expect(result.trace.transcript).toContain(`exit code: ${String(exitCode)}`);
      expect(generateMock).not.toHaveBeenCalled();
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, agentType: 'planning', exitCode }),
        'Fatal exit code detected — skipping Gemini verification'
      );
    }
  );

  it('proceeds to Gemini verification for normal exit code 0', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({
          outcome: 'planned',
          superpowers_writing_plans: 'used',
          linear_url: 'https://linear.app/intexuraos/issue/INT-100',
          is_complex: '0',
          subtask_urls: '',
          pr_url: '',
          summary: 'Planned.',
          unclear_clarification: '',
        }),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-ok',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'output\n[entrypoint] Claude attempt finished with exit code: 0\n',
    });
    expect(result.passed).toBe(true);
    expect(generateMock).toHaveBeenCalledOnce();
  });

  it('proceeds to Gemini verification for exit code 1 (normal failure)', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({
          superpowers_executing_plans: 'used',
          superpowers_requesting_code_review: 'not used',
          gh_pr_url: '',
          summary: 'Failed normally.',
        }),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-normal-fail',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'execution',
      rawLogs: 'output\n[entrypoint] Claude attempt finished with exit code: 1\n',
    });
    expect(result.passed).toBe(true);
    expect(generateMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// getLast20Lines
// ---------------------------------------------------------------------------

describe('getLast20Lines', () => {
  it('returns last 20 lines from raw logs', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${String(i + 1)}`);
    const result = getLast20Lines(lines.join('\n'));
    const resultLines = result.split('\n');
    expect(resultLines).toHaveLength(20);
    expect(resultLines[0]).toBe('line-31');
    expect(resultLines[19]).toBe('line-50');
  });

  it('returns all lines when fewer than 20', () => {
    const result = getLast20Lines('a\nb\nc');
    expect(result).toBe('a\nb\nc');
  });

  it('returns empty string for empty input', () => {
    const result = getLast20Lines('');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// RESUME_SUMMARY_SCHEMA
// ---------------------------------------------------------------------------

describe('RESUME_SUMMARY_SCHEMA', () => {
  it('accepts valid summary', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({ summary: 'Updated the auth flow.' });
    expect(result.success).toBe(true);
  });

  it('rejects missing summary field', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string summary', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({ summary: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildResumeSummaryPrompt
// ---------------------------------------------------------------------------

describe('buildResumeSummaryPrompt', () => {
  it('includes the transcript in the prompt', () => {
    const prompt = buildResumeSummaryPrompt('some log output');
    expect(prompt).toContain('some log output');
  });

  it('instructs Gemini to extract a summary field as JSON', () => {
    const prompt = buildResumeSummaryPrompt('log');
    expect(prompt).toContain('summary');
    expect(prompt).toContain('JSON');
  });

  it('mentions the last assistant messages as the source', () => {
    const prompt = buildResumeSummaryPrompt('log');
    expect(prompt).toContain('assistant');
  });
});

// ---------------------------------------------------------------------------
// extractResumeSummary
// ---------------------------------------------------------------------------

describe('OrchestratorCompletionVerifier.extractResumeSummary', () => {
  it('returns summary string on success', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ summary: 'Updated the auth flow and fixed the redirect.' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBe('Updated the auth flow and fixed the redirect.');
  });

  it('returns undefined when LLM generate fails', async () => {
    generateMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'GENERATION_FAILED', message: 'API error' },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBeUndefined();
  });

  it('returns undefined when JSON cannot be parsed', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: 'not json at all',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBeUndefined();
  });

  it('returns undefined when Zod validation fails (missing summary field)', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ wrong_field: 'value' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBeUndefined();
  });

  it('uses last 20 lines of logs as transcript', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${String(i + 1)}`);
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ summary: 'Done.' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    await verifier.extractResumeSummary('task-1', lines.join('\n'));

    const calledPrompt = generateMock.mock.calls[0]?.[0] as string;
    expect(calledPrompt).toContain('line-11');
    expect(calledPrompt).toContain('line-30');
    expect(calledPrompt).not.toContain('line-10');
  });
});
