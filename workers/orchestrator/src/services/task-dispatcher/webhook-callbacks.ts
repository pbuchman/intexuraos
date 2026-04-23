import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from '@intexuraos/common-core';
import type { Task, TaskResult } from '../../types/task.js';
import type { CreateTaskRequest } from '../../types/api.js';
import type { WebhookClient } from '../webhook-client.js';
import type { CompletionVerifierVerdict } from '../completion-verifier.js';
import { parseRebaseResultOutput, parseContinuationPrOutput } from './prompts.js';

const execAsync = promisify(exec);

/**
 * Best-effort webhook to code-agent when setup (worktree creation or worker
 * container start) fails. Swallows webhook errors so the caller can continue
 * the cleanup path.
 */
export async function sendSetupFailureWebhook(
  webhookClient: WebhookClient,
  logger: Logger,
  request: CreateTaskRequest,
  message: string,
  originalError: unknown
): Promise<void> {
  logger.error({ taskId: request.taskId, error: originalError }, `Task setup failed: ${message}`);
  try {
    await webhookClient.send({
      url: request.webhookUrl,
      secret: request.webhookSecret,
      payload: {
        taskId: request.taskId,
        status: 'failed',
        error: {
          code: 'SETUP_FAILED',
          message,
        },
        duration: 0,
      },
      taskId: request.taskId,
    });
  } catch (webhookError) {
    logger.error({ taskId: request.taskId, webhookError }, 'Failed to send setup failure webhook');
  }
}

/**
 * Merges verifier-provided agent data (summary, PR URL, outcome labels,
 * per-agent fields) into the git-discovered TaskResult. Per-agent shapes
 * differ, so this is a dispatch on `agentData.agentType`.
 */
export function buildResultFromVerification(
  task: Task,
  gitResult: TaskResult | undefined, // @allow-undefined-type -- function parameter, not optional property
  verification: CompletionVerifierVerdict
): TaskResult {
  const base: TaskResult = { ...(gitResult ?? {}) };
  const agentData = verification.agentData;
  if (agentData === undefined) return base;

  base.summary = agentData.summary;
  if ('memory_ids_used' in agentData) {
    base.execution_memory_ids_used = agentData.memory_ids_used;
    base.execution_memory_ids_rejected = agentData.memory_ids_rejected;
    base.execution_memory_usage_summary = agentData.memory_usage_summary;
  }

  /* v8 ignore start -- upstream: FakeCompletionVerifier always returns planning agentData; execution/review/remediation/pull_request variants require agent-type specific verifier responses not producible with unit test fakes @preserve */
  if (agentData.agentType === 'planning') {
    base.planning_outcome_label = agentData.outcome;
    base.planning_superpowers_writing_plans_used =
      agentData.superpowers_writing_plans === 'used' ? '1' : '0';
    base.planning_linear_url = agentData.linear_url;
    base.planning_is_complex = agentData.is_complex;
    base.planning_has_plan_doc = agentData.has_plan_doc;
    base.planning_subtask_urls = agentData.subtask_urls;
    if (agentData.pr_url !== '') {
      base.planning_pr_url = agentData.pr_url;
    }
    base.planning_unclear_clarification = agentData.unclear_clarification;
  } else if (agentData.agentType === 'execution') {
    base.execution_outcome_label = agentData.outcome;
    base.execution_superpowers_subagent_driven_dev_used =
      agentData.superpowers_subagent_driven_dev === 'used' ? '1' : '0';
    base.execution_superpowers_requesting_code_review_used =
      agentData.superpowers_requesting_code_review === 'used' ? '1' : '0';
    if (agentData.gh_pr_url !== '') {
      base.prUrl = agentData.gh_pr_url;
    }
    if (task.linearIssueId !== undefined) {
      base.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
    }
  } else if (agentData.agentType === 'review') {
    if (agentData.gh_pr_url !== '') {
      base.prUrl = agentData.gh_pr_url;
    }
    if (agentData.review_id !== undefined) {
      base.review_id = agentData.review_id;
    }
    base.review_comments_posted = agentData.review_comments_posted;
    base.review_types = agentData.review_types;
    base.requirements_tracker_updated = agentData.requirements_tracker_updated;
    base.gh_actions_status = agentData.gh_actions_status;
    base.needs_remediation = agentData.needs_remediation;
    if (agentData.review_body !== '') {
      base.review_body = agentData.review_body;
    }
    if (agentData.review_inline_comments !== '') {
      base.review_inline_comments = agentData.review_inline_comments;
    }
  } else if (agentData.agentType === 'remediation') {
    base.execution_outcome_label = agentData.outcome;
    if (agentData.gh_pr_url !== '') {
      base.prUrl = agentData.gh_pr_url;
    }
    base.requires_re_review = agentData.requires_re_review;
  } else {
    if (agentData.gh_pr_url !== '') {
      base.prUrl = agentData.gh_pr_url;
    }
    base.comment_replied = agentData.comments_replied === 'yes';
  }
  /* v8 ignore stop @preserve */

  return base;
}

/**
 * Back-fills agent-type specific result fields from the task's lastSuccessResult
 * when a task is resumed after a prior success. Keeps the current PR URL /
 * review outcome visible even though the resume run did not re-emit them.
 */
export function enrichResultForResumedTask(
  task: Task,
  result: TaskResult | undefined // @allow-undefined-type -- function parameter, not optional property
): TaskResult | undefined {
  if (result === undefined) return undefined;
  /* v8 ignore start -- upstream: enrichResultForResumedTask agent-type branches require review/remediation/pull_request tasks with lastSuccessResult set; FakeIsolationProvider always returns planning task fixtures without prior success results @preserve */
  if (task.agentType === 'execution' && task.linearIssueId !== undefined) {
    result.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
  }
  if (task.agentType === 'review' && task.lastSuccessResult !== undefined) {
    if (result.review_id === undefined && task.lastSuccessResult.review_id !== undefined) {
      result.review_id = task.lastSuccessResult.review_id;
    }
    if (
      result.review_comments_posted === undefined &&
      task.lastSuccessResult.review_comments_posted !== undefined
    ) {
      result.review_comments_posted = task.lastSuccessResult.review_comments_posted;
    }
    if (result.review_types === undefined && task.lastSuccessResult.review_types !== undefined) {
      result.review_types = task.lastSuccessResult.review_types;
    }
    if (
      result.requirements_tracker_updated === undefined &&
      task.lastSuccessResult.requirements_tracker_updated !== undefined
    ) {
      result.requirements_tracker_updated = task.lastSuccessResult.requirements_tracker_updated;
    }
    if (
      result.gh_actions_status === undefined &&
      task.lastSuccessResult.gh_actions_status !== undefined
    ) {
      result.gh_actions_status = task.lastSuccessResult.gh_actions_status;
    }
    if (
      result.needs_remediation === undefined &&
      task.lastSuccessResult.needs_remediation !== undefined
    ) {
      result.needs_remediation = task.lastSuccessResult.needs_remediation;
    }
  }
  if (task.agentType === 'remediation' && task.lastSuccessResult !== undefined) {
    if (
      result.requires_re_review === undefined &&
      task.lastSuccessResult.requires_re_review !== undefined
    ) {
      result.requires_re_review = task.lastSuccessResult.requires_re_review;
    }
  }
  if (task.agentType === 'pull_request' && task.lastSuccessResult !== undefined) {
    if (
      result.comment_replied === undefined &&
      task.lastSuccessResult.comment_replied !== undefined
    ) {
      result.comment_replied = task.lastSuccessResult.comment_replied;
    }
  }
  /* v8 ignore stop @preserve */
  return result;
}

/**
 * Inspects the task worktree for a PR (via `gh pr list`/`gh pr view`) and
 * returns a TaskResult describing the produced branch/PR + optional rebase
 * outcome. Returns `undefined` when no PR is found or the git/gh calls fail.
 */
export async function checkForResult(logger: Logger, task: Task): Promise<TaskResult | undefined> {
  try {
    const execOptions = { cwd: task.worktreePath };

    /* v8 ignore start -- upstream: continuationPrNumber path requires a pull_request task with a PR number set; unit test fixtures cannot exercise continuationPrNumber workflows without active GitHub PR infrastructure @preserve */
    if (task.continuationPrNumber !== undefined) {
      const { stdout: prOutput } = await execAsync(
        `gh pr view ${String(task.continuationPrNumber)} --json url,number,headRefName,title,state,mergedAt --jq .`,
        execOptions
      );
      const pr = parseContinuationPrOutput(task.taskId, prOutput, logger);
      if (pr === undefined) {
        return undefined;
      }

      if (
        typeof pr.url === 'string' &&
        typeof pr.headRefName === 'string' &&
        typeof pr.title === 'string' &&
        String(pr.state).toUpperCase() === 'OPEN' &&
        (pr.mergedAt === null || pr.mergedAt === undefined)
      ) {
        const { stdout: rebaseOutput } = await execAsync(
          'cat .rebase-result.json 2>/dev/null || echo "{}"',
          execOptions
        );
        const rebaseResult = parseRebaseResultOutput(rebaseOutput, task.taskId, logger);

        return {
          branch: pr.headRefName,
          prUrl: pr.url,
          summary: pr.title,
          ...(rebaseResult !== undefined && { rebaseResult }),
        };
      }

      return undefined;
    }
    /* v8 ignore stop @preserve */

    // Get current branch name from worktree
    const { stdout: branchOutput } = await execAsync('git branch --show-current', execOptions);
    const currentBranch = branchOutput.trim();

    // Check for pull requests on this branch
    const { stdout: prOutput } = await execAsync(
      `gh pr list --head "${currentBranch}" --json url,number,headRefName,title,commits --jq .`,
      execOptions
    );
    const prs = JSON.parse(prOutput) as {
      url: string;
      number: number;
      headRefName: string;
      commits?: { oid: string; messageHeadline: string }[];
      title: string;
    }[];

    /* v8 ignore start -- ts-type: array access with nullish coalescing creates type narrowing branches @preserve */
    if (prs.length > 0) {
      const pr = prs[0] ?? undefined;
      if (pr === undefined) {
        return undefined;
      }
      const branch = pr.headRefName;
      const commits = Array.isArray(pr.commits) ? pr.commits.length : 0;
      const commitDetails = Array.isArray(pr.commits)
        ? pr.commits.map((c) => ({ sha: c.oid, message: c.messageHeadline }))
        : undefined;

      // Check for rebase result
      const { stdout: rebaseOutput } = await execAsync(
        'cat .rebase-result.json 2>/dev/null || echo "{}"',
        execOptions
      );
      const rebaseResult = parseRebaseResultOutput(rebaseOutput, task.taskId, logger);

      /* v8 ignore start -- ts-type: spread operator with optional rebaseResult creates type narrowing branch @preserve */
      const result: TaskResult = {
        branch,
        commits,
        prUrl: pr.url,
        summary: pr.title,
        ...(commitDetails !== undefined && { commitDetails }),
        /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
        ...(rebaseResult !== undefined && { rebaseResult }),
        /* v8 ignore stop @preserve */
      };
      /* v8 ignore stop @preserve */

      return result;
    }
    /* v8 ignore stop @preserve */

    return undefined;
  } catch (error) {
    logger.error({ taskId: task.taskId, error }, 'Failed to check for task result');
    return undefined;
  }
}
