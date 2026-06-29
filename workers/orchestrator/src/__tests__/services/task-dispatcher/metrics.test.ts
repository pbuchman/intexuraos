import { describe, it, expect, vi, beforeEach } from 'vitest';

// [INT-1470 coverage] Mock transcript-reader so prepareComplianceValidationInput
// tests can exercise the full input-build path (asOutcome/asUsedNotUsed/
// arrayOrStringToCsv/asString helpers) without a real worktree.
vi.mock('../../../services/transcript-reader.js', () => ({
  readSessionTranscript: vi.fn(),
}));

// [INT-1470 coverage] Also mock transcript-formatter so we don't need real
// session entries to build a transcript string.
vi.mock('../../../services/transcript-formatter.js', () => ({
  formatTranscript: vi.fn(() => 'formatted transcript'),
}));

import {
  collectTurnMetrics,
  executeComplianceValidation,
  prepareComplianceValidationInput,
} from '../../../services/task-dispatcher/metrics.js';
import type { Task, TaskResult } from '../../../types/task.js';
import type { ComplianceValidationInput } from '../../../services/agent-compliance-validator.js';
import type { OrchestratorConfig } from '../../../types/config.js';
import type { CompletionVerifierVerdict } from '../../../services/completion-verifier.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1',
    workerType: 'sonnet' as Task['workerType'],
    prompt: 'do work',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    webhookUrl: 'https://example.test/webhook/internal/webhooks/task-complete',
    webhookSecret: 'secret',
    status: 'running',
    worktreePath: '/tmp/wt',
    containerId: 'container-1',
    linearIssueLabels: [],
    startedAt: '2024-01-01T00:00:00.000Z',
    attemptCount: 1,
    maxAttempts: 3,
    verificationHistory: [],
    ...overrides,
  };
}

describe('collectTurnMetrics', () => {
  beforeEach(() => {
    mockLogger.error.mockReset();
  });

  it('is a no-op when no collector is configured', async () => {
    await collectTurnMetrics(undefined, mockLogger as never, makeTask(), 1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('invokes collectAndPublish with the canonical attempt payload', async () => {
    const collector = {
      collectAndPublish: vi.fn().mockResolvedValue(undefined),
    };
    const task = makeTask({ containerId: 'container-xyz' });
    await collectTurnMetrics(collector as never, mockLogger as never, task, 2);
    expect(collector.collectAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.taskId,
        containerId: 'container-xyz',
        attempt: 2,
        startedAt: task.startedAt,
        webhookUrl: task.webhookUrl,
        webhookSecret: task.webhookSecret,
      })
    );
  });

  it('swallows collector errors and logs them (non-fatal path)', async () => {
    const err = new Error('metrics backend down');
    const collector = {
      collectAndPublish: vi.fn().mockRejectedValue(err),
    };
    await collectTurnMetrics(collector as never, mockLogger as never, makeTask(), 1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', attempt: 1, error: err }),
      'Failed to collect turn metrics (non-fatal, task finalization continues)'
    );
  });
});

describe('prepareComplianceValidationInput', () => {
  const mockLogForwarder = {
    appendChunk: vi.fn(),
    appendRawChunk: vi.fn(),
    flush: vi.fn(),
    flushAndStop: vi.fn(),
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
    close: vi.fn(),
    getDroppedChunkCount: vi.fn().mockReturnValue(0),
  };

  const mockConfig = { secretsBasePath: '/tmp/secrets' } as OrchestratorConfig;
  const mockResult = { prUrl: 'https://github.com/owner/repo/pull/42' } as TaskResult;

  function makeExecutionVerdict(): CompletionVerifierVerdict {
    return {
      kind: 'parsed',
      data: {
        outcome: 'implemented',
        superpowers_subagent_driven_dev_used: true,
        superpowers_requesting_code_review_used: true,
        pr: 'https://github.com/owner/repo/pull/42',
        failure_reason: '',
        memory_ids_used: [],
        memory_ids_rejected: [],
        memory_usage_summary: '',
        summary: 'done',
      },
      missingRequired: [],
      telemetryMissing: [],
      warnings: [],
    };
  }

  beforeEach(() => {
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('returns undefined when the validator is not configured (guard clause)', async () => {
    const result = await prepareComplianceValidationInput(
      undefined,
      mockConfig,
      mockLogForwarder as never,
      mockLogger as never,
      makeTask({ agentType: 'execution' }),
      mockResult,
      makeExecutionVerdict()
    );
    expect(result).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('[INT-1470 coverage] coerces all agentClaims helper branches (array memory_ids, non-string outcome, non-true boolean)', async () => {
    // Exercise asString, arrayOrStringToCsv, asOutcome, asUsedNotUsed helpers.
    const validator = { validate: vi.fn() };
    vi.mocked(
      (await import('../../../services/transcript-reader.js')).readSessionTranscript
    ).mockResolvedValueOnce([{ role: 'assistant', content: 'anything' }] as never);
    const verdict: CompletionVerifierVerdict = {
      kind: 'parsed',
      data: {
        outcome: 'failed', // asOutcome: hits the 'failed' branch
        superpowers_subagent_driven_dev_used: false, // asUsedNotUsed: hits the 'not used' branch
        superpowers_requesting_code_review_used: '1', // asUsedNotUsed: hits the '1' → 'used' branch
        pr: 42, // asString: non-string input → returns ''
        failure_reason: 'because',
        memory_ids_used: ['mem_a', 'mem_b'], // arrayOrStringToCsv: array branch
        memory_ids_rejected: ['mem_c', 99], // arrayOrStringToCsv: non-string array member → String() coercion
        memory_usage_summary: null, // asString: null → ''
        summary: 'done',
      },
      missingRequired: [],
      telemetryMissing: [],
      warnings: [],
    };
    const result = await prepareComplianceValidationInput(
      validator as never,
      mockConfig,
      mockLogForwarder as never,
      mockLogger as never,
      makeTask({ agentType: 'execution' }),
      mockResult,
      verdict
    );
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.agentClaims.outcome).toBe('failed');
    expect(result.agentClaims.superpowers_subagent_driven_dev).toBe('not used');
    expect(result.agentClaims.superpowers_requesting_code_review).toBe('used');
    expect(result.agentClaims.gh_pr_url).toBe(''); // non-string coerced
    expect(result.agentClaims.memory_ids_used).toBe('mem_a,mem_b');
    expect(result.agentClaims.memory_ids_rejected).toBe('mem_c,99');
    expect(result.agentClaims.memory_usage_summary).toBe('');
  });

  it('[INT-1470 coverage] asOutcome defaults to implemented when value is unrecognized', async () => {
    // Exercise the default-return arm of asOutcome.
    const validator = { validate: vi.fn() };
    vi.mocked(
      (await import('../../../services/transcript-reader.js')).readSessionTranscript
    ).mockResolvedValueOnce([{ role: 'assistant', content: 'anything' }] as never);
    const verdict: CompletionVerifierVerdict = {
      kind: 'parsed',
      data: {
        outcome: 'something_unexpected',
        superpowers_subagent_driven_dev_used: true,
        superpowers_requesting_code_review_used: true,
        pr: 'https://github.com/owner/repo/pull/42',
        failure_reason: '',
        memory_ids_used: 'mem_a,mem_b', // arrayOrStringToCsv: string branch
        memory_ids_rejected: '',
        memory_usage_summary: '',
        summary: 'done',
      },
      missingRequired: [],
      telemetryMissing: [],
      warnings: [],
    };
    const result = await prepareComplianceValidationInput(
      validator as never,
      mockConfig,
      mockLogForwarder as never,
      mockLogger as never,
      makeTask({ agentType: 'execution' }),
      mockResult,
      verdict
    );
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.agentClaims.outcome).toBe('implemented'); // default
    expect(result.agentClaims.memory_ids_used).toBe('mem_a,mem_b'); // string passthrough
  });

  it('returns undefined when the verdict is kind=hard-error (guard clause)', async () => {
    const validator = { validate: vi.fn() };
    const verdict: CompletionVerifierVerdict = {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: 'nope',
    };
    const result = await prepareComplianceValidationInput(
      validator as never,
      mockConfig,
      mockLogForwarder as never,
      mockLogger as never,
      makeTask({ agentType: 'execution' }),
      mockResult,
      verdict
    );
    expect(result).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns undefined when the task agentType is not execution (guard clause)', async () => {
    const validator = { validate: vi.fn() };
    const result = await prepareComplianceValidationInput(
      validator as never,
      mockConfig,
      mockLogForwarder as never,
      mockLogger as never,
      makeTask({ agentType: 'planning' }),
      mockResult,
      makeExecutionVerdict()
    );
    expect(result).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns undefined when the PR number cannot be extracted (with warn log)', async () => {
    const validator = { validate: vi.fn() };
    const result = await prepareComplianceValidationInput(
      validator as never,
      mockConfig,
      mockLogForwarder as never,
      mockLogger as never,
      makeTask({ agentType: 'execution' }),
      { prUrl: 'not-a-real-url' } as TaskResult,
      makeExecutionVerdict()
    );
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', _skipSentry: true }),
      'Compliance validation skipped: no PR number'
    );
  });
});

describe('executeComplianceValidation', () => {
  const mockLogForwarder = {
    appendChunk: vi.fn(),
    appendRawChunk: vi.fn(),
    flush: vi.fn(),
    flushAndStop: vi.fn(),
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
    close: vi.fn(),
    getDroppedChunkCount: vi.fn().mockReturnValue(0),
  };

  function makeInput(): ComplianceValidationInput {
    return {
      taskId: 'task-1',
      prNumber: 42,
      repository: 'pbuchman/intexuraos',
      formattedTranscript: 'transcript',
      agentClaims: {
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pr/42',
        failure_reason: '',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        summary: 'done',
      },
      workerType: 'sonnet',
    } as ComplianceValidationInput;
  }

  beforeEach(() => {
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogForwarder.appendChunk.mockReset();
    mockLogForwarder.appendRawChunk.mockReset();
    mockLogForwarder.flush.mockReset();
    mockLogForwarder.flushAndStop.mockReset();
    mockLogForwarder.registerTask.mockReset();
    mockLogForwarder.unregisterTask.mockReset();
    mockLogForwarder.close.mockReset();
    mockLogForwarder.getDroppedChunkCount.mockReset();
    mockLogForwarder.getDroppedChunkCount.mockReturnValue(0);
  });

  it('skips the webhook when the task URL does not match the expected path', async () => {
    const task = makeTask({
      webhookUrl: 'https://example.test/not-the-expected-path',
    });
    const validator = {
      validate: vi.fn().mockResolvedValue({
        report: { summary: 'ok' },
        model: 'gemini',
        promptVersion: '1.0.0',
        costUsd: 0,
        transcriptTooLong: false,
      }),
    };
    const webhookClient = { send: vi.fn() };
    await executeComplianceValidation(
      validator as never,
      webhookClient as never,
      mockLogForwarder as never,
      mockLogger as never,
      task,
      makeInput()
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ webhookUrl: task.webhookUrl }),
      'Compliance report webhook URL does not contain expected path — skipping delivery'
    );
    expect(webhookClient.send).not.toHaveBeenCalled();
  });

  it('posts the compliance report when the task URL matches and the validator returns a result', async () => {
    const task = makeTask({
      webhookUrl: 'https://example.test/internal/webhooks/task-complete',
    });
    const validator = {
      validate: vi.fn().mockResolvedValue({
        report: { summary: 'ok' },
        model: 'gemini',
        promptVersion: '1.0.0',
        costUsd: 0,
        transcriptTooLong: false,
      }),
    };
    const webhookClient = {
      send: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    await executeComplianceValidation(
      validator as never,
      webhookClient as never,
      mockLogForwarder as never,
      mockLogger as never,
      task,
      makeInput()
    );
    // flush all microtasks so the .then handler runs
    await Promise.resolve();
    await Promise.resolve();
    expect(webhookClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.test/internal/webhooks/compliance-report',
      })
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Compliance report webhook delivered'
    );
  });

  it('logs a warning when the webhook send returns ok:false', async () => {
    const task = makeTask({
      webhookUrl: 'https://example.test/internal/webhooks/task-complete',
    });
    const validator = {
      validate: vi.fn().mockResolvedValue({
        report: {},
        model: 'gemini',
        promptVersion: '1.0.0',
        costUsd: 0,
        transcriptTooLong: false,
      }),
    };
    const webhookClient = {
      send: vi.fn().mockResolvedValue({ ok: false, error: { message: '500 internal' } }),
    };
    await executeComplianceValidation(
      validator as never,
      webhookClient as never,
      mockLogForwarder as never,
      mockLogger as never,
      task,
      makeInput()
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: '500 internal' }),
      'Compliance report webhook delivery failed'
    );
  });

  it('swallows webhook send catch errors as warn logs', async () => {
    const task = makeTask({
      webhookUrl: 'https://example.test/internal/webhooks/task-complete',
    });
    const validator = {
      validate: vi.fn().mockResolvedValue({
        report: {},
        model: 'gemini',
        promptVersion: '1.0.0',
        costUsd: 0,
        transcriptTooLong: false,
      }),
    };
    const webhookClient = {
      send: vi.fn().mockRejectedValue(new Error('network down')),
    };
    await executeComplianceValidation(
      validator as never,
      webhookClient as never,
      mockLogForwarder as never,
      mockLogger as never,
      task,
      makeInput()
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'network down' }),
      'Compliance report webhook send error'
    );
  });

  it('logs a warn when the validator returns no result', async () => {
    const task = makeTask({
      webhookUrl: 'https://example.test/internal/webhooks/task-complete',
    });
    const validator = {
      validate: vi.fn().mockResolvedValue(null),
    };
    const webhookClient = { send: vi.fn() };
    await executeComplianceValidation(
      validator as never,
      webhookClient as never,
      mockLogForwarder as never,
      mockLogger as never,
      task,
      makeInput()
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Compliance validation completed without result'
    );
    expect(webhookClient.send).not.toHaveBeenCalled();
  });

  it('logs an error when the validator itself throws', async () => {
    const task = makeTask({
      webhookUrl: 'https://example.test/internal/webhooks/task-complete',
    });
    const validator = {
      validate: vi.fn().mockRejectedValue(new Error('validator explode')),
    };
    const webhookClient = { send: vi.fn() };
    await executeComplianceValidation(
      validator as never,
      webhookClient as never,
      mockLogForwarder as never,
      mockLogger as never,
      task,
      makeInput()
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'validator explode' }),
      'Compliance validation failed (non-fatal, task finalization continues)'
    );
  });
});
