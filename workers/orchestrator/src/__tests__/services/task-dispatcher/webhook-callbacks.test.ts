import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendSetupFailureWebhook,
  buildResultFromVerification,
  enrichResultForResumedTask,
} from '../../../services/task-dispatcher/webhook-callbacks.js';
import type { Task, TaskResult } from '../../../types/task.js';
import type { CreateTaskRequest } from '../../../types/api.js';
import type { CompletionVerifierVerdict } from '../../../services/completion-verifier.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

function createMockWebhookClient(): { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue({ ok: true, value: undefined }) };
}

function makeRequest(overrides: Partial<CreateTaskRequest> = {}): CreateTaskRequest {
  return {
    taskId: 'task-1',
    workerType: 'sonnet' as CreateTaskRequest['workerType'],
    prompt: 'do work',
    webhookUrl: 'https://example.test/webhook/internal/webhooks/task-complete',
    webhookSecret: 'secret',
    linearIssueLabels: [],
    hasChildren: false,
    ...overrides,
  } as CreateTaskRequest;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1',
    workerType: 'sonnet' as Task['workerType'],
    prompt: 'do work',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    webhookUrl: 'https://example.test/webhook',
    webhookSecret: 'secret',
    status: 'running',
    worktreePath: '/tmp/wt',
    containerId: 'container-1',
    linearIssueLabels: [],
    startedAt: new Date(0).toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    verificationHistory: [],
    ...overrides,
  };
}

describe('sendSetupFailureWebhook', () => {
  beforeEach(() => {
    mockLogger.error.mockReset();
  });

  it('posts a failed webhook with SETUP_FAILED code and duration 0', async () => {
    const webhook = createMockWebhookClient();
    const request = makeRequest();
    await sendSetupFailureWebhook(
      webhook as never,
      mockLogger as never,
      request,
      'worktree create failed',
      new Error('EACCES')
    );
    expect(webhook.send).toHaveBeenCalledWith({
      url: request.webhookUrl,
      secret: request.webhookSecret,
      payload: {
        taskId: request.taskId,
        status: 'failed',
        error: {
          code: 'SETUP_FAILED',
          message: 'worktree create failed',
        },
        duration: 0,
      },
      taskId: request.taskId,
    });
  });

  it('logs but does not throw when the webhook rejects', async () => {
    const webhook = createMockWebhookClient();
    webhook.send.mockRejectedValueOnce(new Error('network'));
    await sendSetupFailureWebhook(
      webhook as never,
      mockLogger as never,
      makeRequest(),
      'container start failed',
      new Error('docker down')
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Failed to send setup failure webhook'
    );
  });
});

describe('buildResultFromVerification', () => {
  it('returns the base git result untouched when agentData is absent', () => {
    const task = makeTask();
    const gitResult: TaskResult = { branch: 'feature/x', commits: 2 };
    const verification = {
      passed: true,
      missingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, gitResult, verification);
    expect(result).toEqual({ branch: 'feature/x', commits: 2 });
  });

  it('overlays planning agentData fields', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'planning',
        summary: 'Planned it',
        outcome: 'planned',
        superpowers_writing_plans: 'used',
        linear_url: 'https://linear.app/x',
        is_complex: true,
        has_plan_doc: true,
        subtask_urls: ['https://linear.app/y'],
        pr_url: 'https://github.com/pr/1',
        unclear_clarification: '',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.summary).toBe('Planned it');
    expect(result.planning_outcome_label).toBe('planned');
    expect(result.planning_superpowers_writing_plans_used).toBe('1');
    expect(result.planning_linear_url).toBe('https://linear.app/x');
    expect(result.planning_pr_url).toBe('https://github.com/pr/1');
  });

  it('overlays execution agentData and injects the linear issue URL', () => {
    const task = makeTask({ linearIssueId: 'INT-123' });
    const verification = {
      passed: true,
      missingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'execution',
        summary: 'Shipped',
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'not_used',
        gh_pr_url: 'https://github.com/pr/9',
        memory_ids_used: 'mem_a',
        memory_ids_rejected: '',
        memory_usage_summary: 'one',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.prUrl).toBe('https://github.com/pr/9');
    expect(result.execution_outcome_label).toBe('implemented');
    expect(result.execution_superpowers_subagent_driven_dev_used).toBe('1');
    expect(result.execution_superpowers_requesting_code_review_used).toBe('0');
    expect(result.execution_linear_issue_url).toBe('https://linear.app/pbuchman/issue/INT-123');
    expect(result.execution_memory_ids_used).toBe('mem_a');
  });
});

describe('enrichResultForResumedTask', () => {
  it('returns undefined when result is undefined', () => {
    expect(enrichResultForResumedTask(makeTask(), undefined)).toBeUndefined();
  });

  it('adds execution_linear_issue_url for execution agents with a linear id', () => {
    const task = makeTask({ agentType: 'execution', linearIssueId: 'INT-9' });
    const result: TaskResult = {};
    const enriched = enrichResultForResumedTask(task, result);
    expect(enriched?.execution_linear_issue_url).toBe('https://linear.app/pbuchman/issue/INT-9');
  });

  it('backfills review fields from lastSuccessResult', () => {
    const lastSuccessResult: TaskResult = {
      review_id: 'rev-1',
      review_comments_posted: '2',
      review_types: 'code',
      requirements_tracker_updated: 'true',
      gh_actions_status: 'success',
      needs_remediation: '0',
    };
    const task = makeTask({ agentType: 'review', lastSuccessResult });
    const result: TaskResult = {};
    const enriched = enrichResultForResumedTask(task, result);
    expect(enriched).toMatchObject(lastSuccessResult);
  });
});
