import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendSetupFailureWebhook,
  buildResultFromVerification,
  enrichResultForResumedTask,
  checkForResult,
  type CheckForResultExec,
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

// Reset all logger spy state between tests so call-history from one describe
// block cannot leak into another.
beforeEach(() => {
  mockLogger.info.mockReset();
  mockLogger.warn.mockReset();
  mockLogger.error.mockReset();
  mockLogger.debug.mockReset();
  mockLogger.child.mockReset();
});

describe('sendSetupFailureWebhook', () => {
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
      telemetryMissingFields: [],
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
      telemetryMissingFields: [],
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

  it('records planning_superpowers_writing_plans_used="0" when not used and skips empty pr_url', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'planning',
        summary: 'Planned it',
        outcome: 'planned',
        superpowers_writing_plans: 'not_used',
        linear_url: 'https://linear.app/x',
        is_complex: false,
        has_plan_doc: false,
        subtask_urls: [],
        pr_url: '',
        unclear_clarification: 'why',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.planning_superpowers_writing_plans_used).toBe('0');
    expect(result.planning_pr_url).toBeUndefined();
  });

  it('overlays execution agentData and injects the linear issue URL', () => {
    const task = makeTask({ linearIssueId: 'INT-123' });
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
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

  it('records execution flags as "0" when not used and skips empty gh_pr_url + missing linearIssueId', () => {
    const task = makeTask(); // no linearIssueId
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'execution',
        summary: 'Shipped',
        outcome: 'failed',
        superpowers_subagent_driven_dev: 'not_used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.execution_superpowers_subagent_driven_dev_used).toBe('0');
    expect(result.execution_superpowers_requesting_code_review_used).toBe('1');
    expect(result.prUrl).toBeUndefined();
    expect(result.execution_linear_issue_url).toBeUndefined();
  });

  it('overlays review agentData (PR url, ids, counters, optional bodies)', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'review',
        summary: 'Reviewed',
        gh_pr_url: 'https://github.com/pr/42',
        review_id: 'rev-1',
        review_comments_posted: '3',
        review_types: 'code,test',
        requirements_tracker_updated: 'true',
        gh_actions_status: 'success',
        needs_remediation: '0',
        review_body: 'looks good',
        review_inline_comments: 'one inline',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.prUrl).toBe('https://github.com/pr/42');
    expect(result.review_id).toBe('rev-1');
    expect(result.review_comments_posted).toBe('3');
    expect(result.review_types).toBe('code,test');
    expect(result.requirements_tracker_updated).toBe('true');
    expect(result.gh_actions_status).toBe('success');
    expect(result.needs_remediation).toBe('0');
    expect(result.review_body).toBe('looks good');
    expect(result.review_inline_comments).toBe('one inline');
  });

  it('skips empty optional review fields (gh_pr_url, review_body, review_inline_comments)', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'review',
        summary: 'Reviewed',
        gh_pr_url: '',
        review_comments_posted: '0',
        review_types: 'code',
        requirements_tracker_updated: 'false',
        gh_actions_status: 'pending',
        needs_remediation: '0',
        review_body: '',
        review_inline_comments: '',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.prUrl).toBeUndefined();
    expect(result.review_id).toBeUndefined();
    expect(result.review_body).toBeUndefined();
    expect(result.review_inline_comments).toBeUndefined();
  });

  it('overlays remediation agentData (PR url, outcome, requires_re_review)', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'remediation',
        summary: 'Remediated',
        outcome: 'implemented',
        gh_pr_url: 'https://github.com/pr/77',
        requires_re_review: '1',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.execution_outcome_label).toBe('implemented');
    expect(result.prUrl).toBe('https://github.com/pr/77');
    expect(result.requires_re_review).toBe('1');
  });

  it('skips empty gh_pr_url for remediation agentData', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'remediation',
        summary: 'Remediated',
        outcome: 'already_completed',
        gh_pr_url: '',
        requires_re_review: '0',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.prUrl).toBeUndefined();
    expect(result.requires_re_review).toBe('0');
  });

  it('overlays pull_request agentData (PR url, comment_replied="yes")', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'pull_request',
        summary: 'Replied',
        gh_pr_url: 'https://github.com/pr/55',
        comments_replied: 'yes',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.prUrl).toBe('https://github.com/pr/55');
    expect(result.comment_replied).toBe(true);
  });

  it('treats non-"yes" comments_replied as false for pull_request agentData', () => {
    const task = makeTask();
    const verification = {
      passed: true,
      missingFields: [],
      telemetryMissingFields: [],
      verifierFailure: false,
      trace: { transcript: '' },
      agentData: {
        agentType: 'pull_request',
        summary: 'No reply',
        gh_pr_url: '',
        comments_replied: 'no',
      },
    } as unknown as CompletionVerifierVerdict;
    const result = buildResultFromVerification(task, undefined, verification);
    expect(result.prUrl).toBeUndefined();
    expect(result.comment_replied).toBe(false);
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

  it('does not overwrite existing review fields when already populated', () => {
    const lastSuccessResult: TaskResult = {
      review_id: 'rev-old',
      review_comments_posted: '1',
      review_types: 'old',
      requirements_tracker_updated: 'old',
      gh_actions_status: 'old',
      needs_remediation: 'old',
    };
    const task = makeTask({ agentType: 'review', lastSuccessResult });
    const existing: TaskResult = {
      review_id: 'rev-new',
      review_comments_posted: '9',
      review_types: 'new',
      requirements_tracker_updated: 'new',
      gh_actions_status: 'new',
      needs_remediation: 'new',
    };
    const enriched = enrichResultForResumedTask(task, { ...existing });
    expect(enriched).toMatchObject(existing);
  });

  it('backfills requires_re_review for remediation tasks from lastSuccessResult', () => {
    const task = makeTask({
      agentType: 'remediation',
      lastSuccessResult: { requires_re_review: '1' },
    });
    const enriched = enrichResultForResumedTask(task, {});
    expect(enriched?.requires_re_review).toBe('1');
  });

  it('does not overwrite an existing requires_re_review for remediation tasks', () => {
    const task = makeTask({
      agentType: 'remediation',
      lastSuccessResult: { requires_re_review: '0' },
    });
    const enriched = enrichResultForResumedTask(task, { requires_re_review: '1' });
    expect(enriched?.requires_re_review).toBe('1');
  });

  it('backfills comment_replied for pull_request tasks from lastSuccessResult', () => {
    const task = makeTask({
      agentType: 'pull_request',
      lastSuccessResult: { comment_replied: true },
    });
    const enriched = enrichResultForResumedTask(task, {});
    expect(enriched?.comment_replied).toBe(true);
  });

  it('does not overwrite an existing comment_replied for pull_request tasks', () => {
    const task = makeTask({
      agentType: 'pull_request',
      lastSuccessResult: { comment_replied: false },
    });
    const enriched = enrichResultForResumedTask(task, { comment_replied: true });
    expect(enriched?.comment_replied).toBe(true);
  });

  it('is a no-op when no agent-specific branch matches', () => {
    const task = makeTask();
    delete task.agentType;
    const result: TaskResult = { branch: 'feature/x' };
    expect(enrichResultForResumedTask(task, result)).toEqual({ branch: 'feature/x' });
  });
});

describe('checkForResult', () => {
  function makeExec(
    responses: Record<string, { stdout: string } | Error>
  ): CheckForResultExec & { calls: string[] } {
    const calls: string[] = [];
    const fn: CheckForResultExec = async (command) => {
      calls.push(command);
      for (const [match, response] of Object.entries(responses)) {
        if (command.includes(match)) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      throw new Error(`Unexpected exec command: ${command}`);
    };
    return Object.assign(fn, { calls });
  }

  it('returns a TaskResult built from continuation PR data when the PR is OPEN and not merged', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec({
      'gh pr view 42': {
        stdout: JSON.stringify({
          url: 'https://github.com/pr/42',
          number: 42,
          headRefName: 'feature/int-1425',
          title: 'Nitpick fixes',
          state: 'OPEN',
          mergedAt: null,
        }),
      },
      '.rebase-result.json': {
        stdout: '{"attempted":true,"success":true,"conflictFiles":[]}',
      },
    });
    const result = await checkForResult(mockLogger as never, task, exec);
    expect(result).toEqual({
      branch: 'feature/int-1425',
      prUrl: 'https://github.com/pr/42',
      summary: 'Nitpick fixes',
      rebaseResult: { attempted: true, success: true, conflictFiles: [] },
    });
  });

  it('treats an absent mergedAt field as not-merged', async () => {
    const task = makeTask({ continuationPrNumber: 7 });
    const exec = makeExec({
      'gh pr view 7': {
        stdout: JSON.stringify({
          url: 'https://github.com/pr/7',
          number: 7,
          headRefName: 'feature/int-1425',
          title: 'No mergedAt field',
          state: 'OPEN',
          // mergedAt omitted entirely -> undefined branch
        }),
      },
      '.rebase-result.json': { stdout: '{}' },
    });
    const result = await checkForResult(mockLogger as never, task, exec);
    expect(result?.prUrl).toBe('https://github.com/pr/7');
    expect(result?.rebaseResult).toBeUndefined();
  });

  it('returns undefined when the continuation PR is merged', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec({
      'gh pr view 42': {
        stdout: JSON.stringify({
          url: 'https://github.com/pr/42',
          number: 42,
          headRefName: 'feature/int-1425',
          title: 'Nitpick fixes',
          state: 'MERGED',
          mergedAt: '2026-04-22T00:00:00Z',
        }),
      },
    });
    expect(await checkForResult(mockLogger as never, task, exec)).toBeUndefined();
  });

  it('returns undefined when the continuation PR parse fails (invalid JSON)', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec({
      'gh pr view 42': { stdout: '{not-json' },
    });
    expect(await checkForResult(mockLogger as never, task, exec)).toBeUndefined();
  });

  it('resolves branch/PR info from gh pr list when no continuationPrNumber is set', async () => {
    const task = makeTask();
    const exec = makeExec({
      'git branch --show-current': { stdout: 'feature/int-1425\n' },
      'gh pr list': {
        stdout: JSON.stringify([
          {
            url: 'https://github.com/pr/99',
            number: 99,
            headRefName: 'feature/int-1425',
            title: 'branch-driven result',
            commits: [{ oid: 'abc', messageHeadline: 'init' }],
          },
        ]),
      },
      '.rebase-result.json': { stdout: '{}' },
    });
    const result = await checkForResult(mockLogger as never, task, exec);
    expect(result?.prUrl).toBe('https://github.com/pr/99');
    expect(result?.branch).toBe('feature/int-1425');
    expect(result?.commits).toBe(1);
  });

  it('returns undefined when gh pr list yields no PRs', async () => {
    const task = makeTask();
    const exec = makeExec({
      'git branch --show-current': { stdout: 'feature/int-1425\n' },
      'gh pr list': { stdout: '[]' },
    });
    expect(await checkForResult(mockLogger as never, task, exec)).toBeUndefined();
  });

  it('swallows exec errors and logs them', async () => {
    const task = makeTask();
    const exec = makeExec({
      'git branch --show-current': new Error('not a git repo'),
    });
    expect(await checkForResult(mockLogger as never, task, exec)).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Failed to check for task result'
    );
  });
});
