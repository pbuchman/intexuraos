import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from '@intexuraos/common-core';
import type { Task, TaskResult } from '../../types/task.js';
import type { CreateTaskRequest } from '../../types/api.js';
import type { WebhookClient } from '../webhook-client.js';
import type { CompletionVerifierVerdict } from '../completion-verifier.js';
import { parseRebaseResultOutput, parseContinuationPrOutput } from './prompts.js';

const execFileAsync = promisify(execFile);

/**
 * Shape of the `execFile` helper used inside `checkForResult`. Argv-form spawn
 * (no `/bin/sh`) — every untrusted value (branch name, PR number, file path)
 * is a literal argv element and cannot be re-interpreted by a shell.
 *
 * Extracted as a type so tests can inject a fake implementation instead of
 * relying on module-level `vi.mock('node:child_process')`, which is
 * incompatible with the way the rest of this suite is wired.
 */
export type CheckForResultExecFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string }
) => Promise<{ stdout: string }>;

/**
 * Shape of the `readFile` helper used to load `.rebase-result.json`. Injectable
 * so tests can stub the read without bringing in a full `node:fs/promises`
 * mock.
 */
export type CheckForResultReadFile = (path: string) => Promise<string>;

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

function toStringOr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  return fallback;
}

function arrayToCsv(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : String(v))).join(',');
  }
  if (typeof value === 'string') return value;
  return '';
}

function boolToBoolZeroOne(value: unknown): '0' | '1' | undefined {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === '0' || value === '1') return value;
  return undefined;
}

/**
 * [INT-1470] Merges the deterministic-verifier's parsed AGENT_FINAL data
 * into the git-discovered TaskResult. Accepts the new discriminated verdict;
 * hard-error variants are handled upstream and should never reach here.
 *
 * Wire format for memory fields stays unchanged: `TaskResult` exposes the
 * legacy `execution_memory_*` string names so web/webhook consumers don't
 * break. Coerced arrays get joined back to CSV strings.
 */
type BuildResultAgentType =
  | 'planning'
  | 'execution'
  | 'pull_request'
  | 'review'
  | 'remediation'
  | 'ask_agent'
  | 'sentry';

export function buildResultFromVerification(
  task: Task,
  gitResult: TaskResult | undefined, // @allow-undefined-type -- function parameter, not optional property
  verification: CompletionVerifierVerdict,
  agentType?: BuildResultAgentType // back-compat: older call sites didn't pass agentType; we dispatch off fields present in data when omitted
): TaskResult {
  const base: TaskResult = { ...(gitResult ?? {}) };
  if (verification.kind !== 'parsed') return base;
  const data = verification.data;
  if (Object.keys(data).length === 0) return base;

  base.summary = toStringOr(data['summary']);

  // Memory fields: wire format preserves legacy `execution_memory_*` strings.
  //
  // [INT-1470] The wire keys (`execution_memory_ids_used`,
  // `execution_memory_ids_rejected`, `execution_memory_usage_summary`) are
  // INTENTIONALLY different from the canonical internal field names
  // (`memory_ids_used`, `memory_ids_rejected`, `memory_usage_summary`) used
  // by the deterministic AGENT_FINAL parser and by every consumer inside
  // this worker. The canonical names were introduced in INT-1470; the
  // `execution_memory_*` wire format pre-dates that rename and is preserved
  // here for backward compatibility with external webhook consumers
  // (code-agent, metrics aggregators, web UI) that were not cut over in the
  // same change.
  //
  // Plan follow-up: "Alias removal PR two releases after this lands" — once
  // all downstream consumers read the canonical names, rename these three
  // `base.execution_memory_*` assignments to `base.memory_*` and drop the
  // `execution_memory_*` aliases from the TaskResult type + webhook schema.
  if (
    'memory_ids_used' in data ||
    'memory_ids_rejected' in data ||
    'memory_usage_summary' in data
  ) {
    base.execution_memory_ids_used = arrayToCsv(data['memory_ids_used']);
    base.execution_memory_ids_rejected = arrayToCsv(data['memory_ids_rejected']);
    base.execution_memory_usage_summary = toStringOr(data['memory_usage_summary']);
  }

  // Dispatch by agent type if provided; otherwise infer from the fields present.
  const inferredType: typeof agentType =
    agentType ??
    ('plan_pr' in data
      ? 'planning'
      : 'tracking_comment_id' in data
        ? 'pull_request'
        : 'sentry_issue' in data
          ? 'sentry'
          : 'review_id' in data
            ? 'review'
            : 'requires_re_review' in data
              ? 'remediation'
              : 'execution');

  if (inferredType === 'planning') {
    const outcome = toStringOr(data['outcome']);
    if (outcome === 'planned' || outcome === 'unclear') {
      base.planning_outcome_label = outcome;
    }
    base.planning_superpowers_writing_plans_used =
      boolToBoolZeroOne(data['superpowers_writing_plans_used']) ?? '0';
    base.planning_linear_url = toStringOr(data['linear_issue']);
    base.planning_is_complex = boolToBoolZeroOne(data['complex_task']) ?? '0';
    base.planning_has_plan_doc = boolToBoolZeroOne(data['plan_doc']) ?? '0';
    base.planning_subtask_urls = arrayToCsv(data['subtask_urls']);
    const planPr = toStringOr(data['plan_pr']);
    if (planPr !== '') {
      base.planning_pr_url = planPr;
    }
    base.planning_unclear_clarification = toStringOr(data['clarification_message']);
  } else if (inferredType === 'execution') {
    const outcome = toStringOr(data['outcome']);
    if (outcome === 'implemented' || outcome === 'already_completed' || outcome === 'failed') {
      base.execution_outcome_label = outcome;
    }
    base.execution_superpowers_subagent_driven_dev_used =
      boolToBoolZeroOne(data['superpowers_subagent_driven_dev_used']) ?? '0';
    base.execution_superpowers_requesting_code_review_used =
      boolToBoolZeroOne(data['superpowers_requesting_code_review_used']) ?? '0';
    const prUrl = toStringOr(data['pr']);
    if (prUrl !== '') {
      base.prUrl = prUrl;
    }
    if (task.linearIssueId !== undefined) {
      base.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
    }
  } else if (inferredType === 'review') {
    const prUrl = toStringOr(data['pr']);
    if (prUrl !== '') {
      base.prUrl = prUrl;
    }
    const reviewId = toStringOr(data['review_id']);
    if (reviewId !== '') {
      base.review_id = reviewId;
    }
    const reviewCommentsPosted = data['review_comments_posted'];
    if (typeof reviewCommentsPosted === 'number') {
      base.review_comments_posted = String(reviewCommentsPosted);
    } else if (typeof reviewCommentsPosted === 'string') {
      base.review_comments_posted = reviewCommentsPosted;
    }
    base.review_types = arrayToCsv(data['review_types']);
    base.requirements_tracker_updated = toStringOr(data['requirements_tracker_updated']);
    base.gh_actions_status = toStringOr(data['gh_actions_status']);
    const needsRemediation = boolToBoolZeroOne(data['needs_remediation']);
    if (needsRemediation !== undefined) {
      base.needs_remediation = needsRemediation;
    }
  } else if (inferredType === 'remediation') {
    const outcome = toStringOr(data['outcome']);
    if (outcome === 'implemented' || outcome === 'already_completed') {
      base.execution_outcome_label = outcome;
    }
    const prUrl = toStringOr(data['pr']);
    if (prUrl !== '') {
      base.prUrl = prUrl;
    }
    const requiresReReview = boolToBoolZeroOne(data['requires_re_review']);
    if (requiresReReview !== undefined) {
      base.requires_re_review = requiresReReview;
    }
  } else if (inferredType === 'pull_request') {
    const prUrl = toStringOr(data['pr']);
    if (prUrl !== '') {
      base.prUrl = prUrl;
    }
    const commentReplied = toStringOr(data['comment_replied']);
    base.comment_replied = commentReplied === 'yes';
  } else if (inferredType === 'sentry') {
    const prUrl = toStringOr(data['pr']);
    if (prUrl !== '') {
      base.prUrl = prUrl;
    }
    const outcome = toStringOr(data['outcome']);
    if (outcome === 'fixed' || outcome === 'suppressed') {
      base.sentry_outcome = outcome;
    }
    base.sentry_issue_url = toStringOr(data['sentry_issue']);
    base.sentry_linear_issue = toStringOr(data['linear_issue']);
    base.sentry_verification = toStringOr(data['verification']);
  }

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
  return result;
}

/**
 * Reads `.rebase-result.json` from the worktree, returning `'{}'` on failure.
 *
 * `ENOENT` is the common case (no rebase happened) and is silenced. Any other
 * error (permission, I/O fault, etc.) is logged at debug so disk faults are
 * visible without spamming successful no-rebase paths.
 */
async function readRebaseResultJson(
  worktreePath: string,
  readRebaseFile: CheckForResultReadFile,
  logger: Logger
): Promise<string> {
  try {
    return await readRebaseFile(join(worktreePath, '.rebase-result.json'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      logger.debug({ err }, 'Failed to read .rebase-result.json (non-ENOENT)');
    }
    return '{}';
  }
}

/**
 * Inspects the task worktree for a PR (via `gh pr list`/`gh pr view`) and
 * returns a TaskResult describing the produced branch/PR + optional rebase
 * outcome. Returns `undefined` when no PR is found or the git/gh calls fail.
 */
export async function checkForResult(
  logger: Logger,
  task: Task,
  // TODO(INT-1483 follow-up): drop the `as unknown as` once a typed wrapper
  // around `promisify(execFile)` lands. See worktree-manager.ts for context.
  execFileFn: CheckForResultExecFile = execFileAsync as unknown as CheckForResultExecFile,
  readRebaseFile: CheckForResultReadFile = (path) => readFile(path, 'utf8')
): Promise<TaskResult | undefined> {
  try {
    const execOptions = { cwd: task.worktreePath };

    if (task.continuationPrNumber !== undefined) {
      const { stdout: prOutput } = await execFileFn(
        'gh',
        [
          'pr',
          'view',
          String(task.continuationPrNumber),
          '--json',
          'url,number,headRefName,title,state,mergedAt',
          '--jq',
          '.',
        ],
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
        const rebaseOutput = await readRebaseResultJson(task.worktreePath, readRebaseFile, logger);
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

    // Get current branch name from worktree
    const { stdout: branchOutput } = await execFileFn(
      'git',
      ['branch', '--show-current'],
      execOptions
    );
    const currentBranch = branchOutput.trim();

    // Check for pull requests on this branch
    const { stdout: prOutput } = await execFileFn(
      'gh',
      [
        'pr',
        'list',
        '--head',
        currentBranch,
        '--json',
        'url,number,headRefName,title,commits',
        '--jq',
        '.',
      ],
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
      const rebaseOutput = await readRebaseResultJson(task.worktreePath, readRebaseFile, logger);
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
