import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask } from '../models/codeTask.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import { fetchGitHubToken } from './gitHubTokenResolver.js';
import type { AutomationLog } from '../ports/automationLog.js';

const SAME_ISSUE_SEARCH_LIMIT = 20;

export interface ContinuationPr {
  prNumber: number;
  prBranch: string;
}

export interface ResolveContinuationPrDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
}

export interface ResolveContinuationPrInput {
  task: CodeTask;
  userId: string;
  limit?: number;
}

export interface ResolveExecutionContinuationPrInput extends ResolveContinuationPrInput {
  agentType?: CodeTask['agentType'];
}

export interface ContinuationPrError {
  code: 'github_token_unavailable' | 'verification_failed';
  message: string;
}

export interface PostContinuationCommentDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  automationLog: AutomationLog;
}

export interface PostContinuationCommentInput {
  repository: string;
  prNumber: number;
  taskId: string;
  userId: string;
  linearIssueId?: string;
  commentTitle: string;
}

export interface PostContinuationCommentError {
  code: 'github_token_unavailable' | 'comment_failed';
  message: string;
}

export interface BootstrapContinuationPrTaskCommentDeps extends PostContinuationCommentDeps {
  codeTaskRepo: CodeTaskRepository;
}

export interface BootstrapContinuationPrTaskCommentInput {
  continuationPr: ContinuationPr | null;
  task: CodeTask;
  userId: string;
  commentTitle: string;
}

function parsePrNumber(task: CodeTask): number | undefined {
  if (task.prNumber !== undefined) {
    return task.prNumber;
  }

  const prUrl = task.result?.prUrl;
  if (prUrl === undefined) {
    return undefined;
  }

  const match = /\/pull\/(\d+)/.exec(prUrl);
  if (match?.[1] === undefined) {
    return undefined;
  }

  return Number(match[1]);
}

function buildContinuationComment(input: PostContinuationCommentInput): string {
  const lines: string[] = [
    '@ignore',
    `### ${input.commentTitle}`,
    '',
    `**Task ID:** \`${input.taskId}\``,
  ];

  if (input.linearIssueId !== undefined) {
    lines.push(`**Linear Issue:** ${input.linearIssueId}`);
  }

  lines.push(
    '',
    `[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/${input.taskId})`
  );

  return lines.join('\n');
}

async function verifyCandidate(
  deps: ResolveContinuationPrDeps,
  task: CodeTask,
  token: string,
  prNumber: number
): Promise<Result<ContinuationPr | null, ContinuationPrError>> {
  const [owner, repo] = task.repository.split('/');
  if (owner === undefined || repo === undefined) {
    return err({
      code: 'verification_failed',
      message: `Invalid repository format on task ${task.id}`,
    });
  }

  const statusResult = await deps.gitHubPRClient.getPullRequestStatus(
    token,
    owner,
    repo,
    prNumber
  );

  if (!statusResult.ok) {
    if (statusResult.error.code === 'NOT_FOUND') {
      deps.logger.info(
        { taskId: task.id, repository: task.repository, prNumber },
        'Continuation PR candidate no longer exists'
      );
      return ok(null);
    }

    return err({
      code: 'verification_failed',
      message: statusResult.error.message,
    });
  }

  const status = statusResult.value;
  if (status.state !== 'open' || status.mergedAt !== null) {
    deps.logger.info(
      {
        taskId: task.id,
        repository: task.repository,
        prNumber,
        state: status.state,
        mergedAt: status.mergedAt,
      },
      'Continuation PR candidate is closed or merged'
    );
    return ok(null);
  }

  return ok({
    prNumber,
    prBranch: status.headRef,
  });
}

async function loadLineageCandidates(
  deps: ResolveContinuationPrDeps,
  task: CodeTask
): Promise<CodeTask[]> {
  const visited = new Set<string>([task.id]);
  const queue: CodeTask[] = [task];
  const ordered: CodeTask[] = [];

  // The queue grows during iteration on purpose: this is a breadth-first walk
  // over retry/parent lineage so we prefer the closest continuation candidates first.
  for (const current of queue) {
    ordered.push(current);

    const ancestorIds = [current.retriedFrom, current.parentTaskId];
    for (const ancestorId of ancestorIds) {
      if (ancestorId === undefined || visited.has(ancestorId)) {
        continue;
      }

      visited.add(ancestorId);
      const ancestorResult = await deps.codeTaskRepo.findById(ancestorId);
      if (!ancestorResult.ok) {
        deps.logger.warn(
          { ancestorId, taskId: current.id, error: ancestorResult.error },
          'Failed to load continuation PR lineage task'
        );
        continue;
      }

      queue.push(ancestorResult.value);
    }
  }

  return ordered;
}

export async function resolveContinuationPr(
  deps: ResolveContinuationPrDeps,
  input: ResolveContinuationPrInput
): Promise<Result<ContinuationPr | null, ContinuationPrError>> {
  let token: string | undefined;
  const ensureToken = async (): Promise<Result<string, ContinuationPrError>> => {
    if (token !== undefined) {
      return ok(token);
    }

    const fetchedToken = await fetchGitHubToken(
      deps.userServiceClient,
      input.userId,
      deps.logger
    );
    if (fetchedToken === null) {
      return err({
        code: 'github_token_unavailable',
        message: 'GitHub OAuth token is required to verify continuation PR state',
      });
    }

    token = fetchedToken;
    return ok(token);
  };

  const lineageCandidates = await loadLineageCandidates(deps, input.task);
  const seenTaskIds = new Set(lineageCandidates.map((task) => task.id));

  for (const candidate of lineageCandidates) {
    const prNumber = parsePrNumber(candidate);
    if (prNumber === undefined) {
      continue;
    }

    const tokenResult = await ensureToken();
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const continuationResult = await verifyCandidate(deps, candidate, tokenResult.value, prNumber);
    // Hard GitHub verification failures stop here. Falling through to same-ticket
    // history would risk attaching the retry to a different PR while this candidate
    // still has an unknown state.
    if (!continuationResult.ok) {
      return continuationResult;
    }
    if (continuationResult.value !== null) {
      return continuationResult;
    }
  }

  if (input.task.linearIssueId === undefined) {
    return ok(null);
  }

  const recentTasksResult = await deps.codeTaskRepo.findRecentTasksByLinearIssue(
    input.task.linearIssueId,
    input.limit ?? SAME_ISSUE_SEARCH_LIMIT
  );
  if (!recentTasksResult.ok) {
    deps.logger.warn(
      { linearIssueId: input.task.linearIssueId, error: recentTasksResult.error },
      'Failed to load same-ticket tasks for continuation PR lookup'
    );
    return ok(null);
  }

  for (const candidate of recentTasksResult.value) {
    if (seenTaskIds.has(candidate.id) || candidate.repository !== input.task.repository) {
      continue;
    }

    const prNumber = parsePrNumber(candidate);
    if (prNumber === undefined) {
      continue;
    }

    const tokenResult = await ensureToken();
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const continuationResult = await verifyCandidate(deps, candidate, tokenResult.value, prNumber);
    if (!continuationResult.ok) {
      return continuationResult;
    }
    if (continuationResult.value !== null) {
      return continuationResult;
    }
  }

  return ok(null);
}

export async function resolveExecutionContinuationPr(
  deps: ResolveContinuationPrDeps,
  input: ResolveExecutionContinuationPrInput
): Promise<Result<ContinuationPr | null, ContinuationPrError>> {
  if (input.agentType !== 'execution') {
    return ok(null);
  }

  return await resolveContinuationPr(deps, input);
}

export async function postContinuationPrComment(
  deps: PostContinuationCommentDeps,
  input: PostContinuationCommentInput
): Promise<Result<void, PostContinuationCommentError>> {
  const [owner, repo] = input.repository.split('/');
  if (owner === undefined || repo === undefined) {
    return err({
      code: 'comment_failed',
      message: `Invalid repository format: ${input.repository}`,
    });
  }

  const token = await fetchGitHubToken(deps.userServiceClient, input.userId, deps.logger);
  if (token === null) {
    return err({
      code: 'github_token_unavailable',
      message: 'GitHub OAuth token is required to post continuation PR comment',
    });
  }

  const commentResult = await deps.gitHubPRClient.postPRComment(
    token,
    owner,
    repo,
    input.prNumber,
    buildContinuationComment(input)
  );
  if (!commentResult.ok) {
    return err({
      code: 'comment_failed',
      message: commentResult.error.message,
    });
  }

  deps.automationLog.record(
    { repository: input.repository, prNumber: input.prNumber },
    {
      type: 'task_dispatched',
      taskId: input.taskId,
      workerType: 'auto',
      agentType: 'execution',
      ...(input.linearIssueId !== undefined && { linearIssueId: input.linearIssueId }),
    },
    input.userId,
  ).catch((error: unknown) => {
    deps.logger.warn({ error, taskId: input.taskId }, 'Failed to record automation log for continuation PR comment');
  });

  return ok(undefined);
}

export async function bootstrapContinuationPrTaskComment(
  deps: BootstrapContinuationPrTaskCommentDeps,
  input: BootstrapContinuationPrTaskCommentInput
): Promise<Result<void, PostContinuationCommentError>> {
  if (input.continuationPr === null) {
    return ok(undefined);
  }

  const commentResult = await postContinuationPrComment(deps, {
    repository: input.task.repository,
    prNumber: input.continuationPr.prNumber,
    taskId: input.task.id,
    userId: input.userId,
    commentTitle: input.commentTitle,
    ...(input.task.linearIssueId !== undefined && { linearIssueId: input.task.linearIssueId }),
  });
  if (commentResult.ok) {
    return ok(undefined);
  }

  await deps.codeTaskRepo.update(input.task.id, {
    status: 'failed',
    error: {
      code: 'PR_BOOTSTRAP_COMMENT_FAILED',
      message: commentResult.error.message,
    },
  });

  return err(commentResult.error);
}
