import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH, type CodeTask, type WorkerType } from '../../models/codeTask.js';
import type { GitHubPRSummary } from '../../models/gitHubPRSummary.js';
import type { GitHubPRClient, GitHubPullRequestDetails } from '../../ports/gitHubPRClient.js';
import type { WorkerSettingsRepository } from '../../ports/workerSettingsRepository.js';
import type { CodeTaskRepository, CreateTaskInput } from '../../repositories/codeTaskRepository.js';
import type { LinearIssueService } from '../../services/linearIssueService.js';
import type { TaskEnqueueService } from '../../services/taskEnqueueService.js';
import { generateWebhookSecret } from '../../utils/secrets.js';
import { buildConflictCommentBody, updateManagedComment } from './notifyConflicts.js';

const SYSTEM_PROMPT_HASH = MERGE_CONFLICT_SYSTEM_PROMPT_HASH;

export interface ConflictWorkflowResult {
  commentId: number | null;
  taskId: string | null;
  ownerUserId: string | null;
}

export interface ExistingConflictTaskResolution {
  latestTask: CodeTask | null;
  reusableTask: CodeTask | null;
  staleSummaryTaskId: boolean;
}

export interface GitHubAccessContext {
  userId: string;
  token: string;
}

export interface ParsedRepository {
  owner: string;
  repo: string;
}

export interface ResolveConflictDeps {
  gitHubPRClient: Pick<GitHubPRClient, 'postPRComment' | 'updateIssueComment'>;
  codeTaskRepo: Pick<CodeTaskRepository, 'create' | 'update' | 'findById' | 'findLatestExecutionTaskByPR'>;
  linearIssueService: LinearIssueService;
  taskEnqueueService: TaskEnqueueService;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
}

export interface ConflictWorkflowParams {
  deps: ResolveConflictDeps;
  logger: Logger;
  repository: string;
  parsedRepository: ParsedRepository;
  eventId: string;
  existingSummary: GitHubPRSummary;
  details: GitHubPullRequestDetails;
  accessContext: GitHubAccessContext;
  taskResolution: ExistingConflictTaskResolution;
}

interface CreateTaskDeps {
  codeTaskRepo: Pick<CodeTaskRepository, 'create' | 'update'>;
  linearIssueService: LinearIssueService;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
}

interface CreateTaskParams {
  logger: Logger;
  repository: string;
  eventId: string;
  details: GitHubPullRequestDetails;
  commentId: number;
  existingTask: CodeTask | null;
  ownerUserId: string;
  workerType: WorkerType;
}

export function isMergeConflictTask(task: Pick<CodeTask, 'followUpReason' | 'systemPromptHash'>): boolean {
  return task.followUpReason === 'merge_conflict' || task.systemPromptHash === SYSTEM_PROMPT_HASH;
}

export function isReusableConflictTask(task: CodeTask, repository: string, prNumber: number): boolean {
  return (
    task.repository === repository &&
    task.prNumber === prNumber &&
    task.agentType === 'pull_request' &&
    task.status !== 'archived' &&
    isMergeConflictTask(task)
  );
}

export function resolveConflictParentTaskId(existingTask: CodeTask | null): string | undefined {
  if (existingTask === null || isMergeConflictTask(existingTask)) {
    return undefined;
  }

  return existingTask.id;
}

export function shouldEnsureConflictWorkflow(
  existingSummary: GitHubPRSummary,
  staleSummaryTaskId: boolean
): boolean {
  if (existingSummary.mergeConflictStatus !== 'conflicting') {
    return true;
  }

  if (staleSummaryTaskId) {
    return true;
  }

  if (existingSummary.managedConflictCommentId === null) {
    return true;
  }

  return (
    existingSummary.managedConflictTaskId === null &&
    existingSummary.managedConflictTaskOwnerUserId !== null
  );
}

export function shouldResolveTaskState(
  status: GitHubPRSummary['mergeConflictStatus'],
  existingSummary: GitHubPRSummary
): boolean {
  return status === 'conflicting' || (
    status === 'unknown' &&
    existingSummary.mergeConflictStatus === 'conflicting'
  );
}

export function shouldRetainExistingConflictTask(
  status: GitHubPRSummary['mergeConflictStatus']
): boolean {
  return status === 'conflicting' || status === 'unknown';
}

export function buildInitialWorkflowResult(
  existingSummary: GitHubPRSummary,
  taskResolution: ExistingConflictTaskResolution
): ConflictWorkflowResult {
  const reusableTask = shouldRetainExistingConflictTask(existingSummary.mergeConflictStatus)
    ? taskResolution.reusableTask
    : null;

  return {
    commentId: existingSummary.managedConflictCommentId,
    taskId:
      reusableTask?.id ??
      (taskResolution.staleSummaryTaskId ? null : existingSummary.managedConflictTaskId),
    ownerUserId:
      reusableTask?.userId ??
      existingSummary.managedConflictTaskOwnerUserId,
  };
}

export async function resolveExistingConflictTask(
  codeTaskRepo: Pick<CodeTaskRepository, 'findById' | 'findLatestExecutionTaskByPR'>,
  existingSummary: GitHubPRSummary,
  repository: string,
  prNumber: number,
  logger: Logger
): Promise<Result<ExistingConflictTaskResolution, { code: string; message: string }>> {
  let staleSummaryTaskId = false;
  const managedTaskId = existingSummary.managedConflictTaskId;

  if (managedTaskId !== null) {
    const managedTaskResult = await codeTaskRepo.findById(managedTaskId);
    if (!managedTaskResult.ok) {
      if (managedTaskResult.error.code === 'NOT_FOUND') {
        staleSummaryTaskId = true;
        logger.warn({ repository, prNumber, taskId: managedTaskId }, 'Stored merge-conflict task no longer exists');
      } else {
        logger.warn(
          { error: managedTaskResult.error, repository, prNumber, taskId: managedTaskId },
          'Failed to load stored merge-conflict task'
        );
        return err({ code: managedTaskResult.error.code, message: managedTaskResult.error.message });
      }
    } else if (isReusableConflictTask(managedTaskResult.value, repository, prNumber)) {
      return ok({
        latestTask: managedTaskResult.value,
        reusableTask: managedTaskResult.value,
        staleSummaryTaskId: false,
      });
    } else {
      staleSummaryTaskId = true;
      logger.warn(
        {
          repository,
          prNumber,
          taskId: managedTaskId,
          taskRepository: managedTaskResult.value.repository,
          taskPrNumber: managedTaskResult.value.prNumber ?? null,
          taskStatus: managedTaskResult.value.status,
          taskAgentType: managedTaskResult.value.agentType ?? null,
        },
        'Stored merge-conflict task is stale'
      );
    }
  }

  const byPRResult = await codeTaskRepo.findLatestExecutionTaskByPR(repository, prNumber);
  if (!byPRResult.ok) {
    logger.warn(
      { error: byPRResult.error, repository, prNumber },
      'Failed to load latest execution task by PR for merge-conflict detection'
    );
    return err({ code: byPRResult.error.code, message: byPRResult.error.message });
  }

  const latestTask = byPRResult.value;
  return ok({
    latestTask,
    reusableTask: null,
    staleSummaryTaskId,
  });
}

async function resolveMergeConflictWorkerType(
  workerSettingsRepo: WorkerSettingsRepository,
  userId: string,
  logger: Logger
): Promise<Result<WorkerType, { code: 'NO_ENABLED_WORKER' | 'INTERNAL_ERROR'; message: string }>> {
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.warn({ error: settingsResult.error, userId }, 'Failed to load worker settings for conflict detection');
    return err({ code: 'INTERNAL_ERROR', message: settingsResult.error.message });
  }

  const hasEnabledWorker = settingsResult.value?.workers.some((candidate) => candidate.enabled) === true;
  if (!hasEnabledWorker) {
    return err({ code: 'NO_ENABLED_WORKER', message: `No enabled worker for user ${userId}` });
  }

  return ok(settingsResult.value.defaultPullRequestWorkerType ?? 'auto');
}

function buildEnsureIssuePrompt(details: GitHubPullRequestDetails, repository: string): string {
  return [
    `Resolve merge conflicts for PR #${String(details.number)} in ${repository}.`,
    `PR title: ${details.title}`,
    `Base branch: ${details.baseBranch}`,
    `Head branch: ${details.headBranch}`,
    `Author: @${details.authorLogin}`,
  ].join('\n');
}

function buildConflictInstruction(params: {
  repository: string;
  prNumber: number;
  baseBranch: string;
  commentId: number;
}): string {
  return [
    `[Merge Conflict Task] Resolve merge conflicts on PR #${String(params.prNumber)} in ${params.repository}`,
    '',
    `A push to ${params.baseBranch} introduced merge conflicts for this PR.`,
    `A managed tracking comment already exists at /repos/${params.repository}/issues/comments/${String(params.commentId)}.`,
    'Use that exact comment for status and delivery updates. Do NOT create a new tracking comment for this conflict episode.',
    '',
    'Required steps:',
    `1. Check the PR mergeability and branch state for PR #${String(params.prNumber)}.`,
    `2. Rebase or merge \`${params.baseBranch}\` into the PR branch and resolve all conflicts.`,
    '3. Run pnpm run ci:tracked before pushing.',
    '4. Push the resolved branch updates to the existing PR branch.',
    `5. PATCH /repos/${params.repository}/issues/comments/${String(params.commentId)} with the delivery summary.`,
  ].join('\n');
}

function buildCreateTaskInput(params: {
  taskId: string;
  repository: string;
  prNumber: number;
  baseBranch: string;
  prompt: string;
  eventId: string;
  userId: string;
  webhookSecret: string;
  workerType: WorkerType;
  linearIssueId?: string | undefined;
  parentTaskId?: string | undefined;
}): CreateTaskInput {
  return {
    id: params.taskId,
    userId: params.userId,
    prompt: params.prompt,
    sanitizedPrompt: params.prompt,
    systemPromptHash: SYSTEM_PROMPT_HASH,
    workerType: params.workerType,
    workerLocation: 'queued',
    repository: params.repository,
    baseBranch: params.baseBranch,
    traceId: params.eventId,
    actionId: `merge-conflict/${params.repository}/${String(params.prNumber)}/${params.eventId}`,
    approvalEventId: params.eventId,
    prNumber: params.prNumber,
    webhookSecret: params.webhookSecret,
    agentType: 'pull_request',
    followUpReason: 'merge_conflict',
    ...(params.linearIssueId !== undefined && { linearIssueId: params.linearIssueId }),
    ...(params.parentTaskId !== undefined && { parentTaskId: params.parentTaskId }),
  };
}

export async function createMergeConflictTask(
  deps: CreateTaskDeps,
  params: CreateTaskParams
): Promise<Result<{ taskId: string; ownerUserId: string }, { code: string; message: string }>> {
  let linearIssueId = params.existingTask?.linearIssueId;
  if (linearIssueId === undefined) {
    const titleMatch = /\bINT-(\d+)\b/i.exec(params.details.title);
    if (titleMatch !== null) {
      linearIssueId = `INT-${String(titleMatch[1])}`;
    }
  }

  const linearResult = await deps.linearIssueService.ensureIssueExists({
    userId: params.ownerUserId,
    ...(linearIssueId !== undefined && { linearIssueId }),
    taskPrompt: buildEnsureIssuePrompt(params.details, params.repository),
  });

  const linkedLinearIssueId = linearResult.linearIssueId;

  const prompt = buildConflictInstruction({
    repository: params.repository,
    prNumber: params.details.number,
    baseBranch: params.details.baseBranch,
    commentId: params.commentId,
  });
  const taskId = `task_${crypto.randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, taskId);
  const conflictParentTaskId = resolveConflictParentTaskId(params.existingTask);

  const createResult = await deps.codeTaskRepo.create(buildCreateTaskInput({
    taskId,
    repository: params.repository,
    prNumber: params.details.number,
    baseBranch: params.details.baseBranch,
    prompt,
    eventId: params.eventId,
    userId: params.ownerUserId,
    webhookSecret,
    workerType: params.workerType,
    ...(linkedLinearIssueId !== undefined && { linearIssueId: linkedLinearIssueId }),
    ...(conflictParentTaskId !== undefined && { parentTaskId: conflictParentTaskId }),
  }));

  if (!createResult.ok) {
    return err({ code: createResult.error.code, message: createResult.error.message });
  }

  const enqueueResult = await deps.taskEnqueueService.enqueue({
    taskId,
    userId: params.ownerUserId,
  });

  if (!enqueueResult.ok) {
    await deps.codeTaskRepo.update(taskId, {
      status: 'failed',
      error: {
        code: enqueueResult.error.code,
        message: enqueueResult.error.message,
      },
    });
    return err({ code: enqueueResult.error.code, message: enqueueResult.error.message });
  }

  return ok({ taskId, ownerUserId: params.ownerUserId });
}

async function createConflictTaskWorkflow(
  params: ConflictWorkflowParams & { commentId: number }
): Promise<ConflictWorkflowResult> {
  const workerTypeResult = await resolveMergeConflictWorkerType(
    params.deps.workerSettingsRepo,
    params.accessContext.userId,
    params.logger
  );

  if (!workerTypeResult.ok) {
    const phase = workerTypeResult.error.code === 'NO_ENABLED_WORKER' ? 'no-worker' : 'failed';
    await updateManagedComment(
      params.deps.gitHubPRClient,
      params.accessContext.token,
      params.parsedRepository.owner,
      params.parsedRepository.repo,
      params.existingSummary.pullRequestNumber,
      params.commentId,
      buildConflictCommentBody({
        phase,
        repository: params.repository,
        prNumber: params.existingSummary.pullRequestNumber,
        baseBranch: params.details.baseBranch,
      }),
      params.logger
    );
    return {
      commentId: params.commentId,
      taskId: null,
      ownerUserId: params.accessContext.userId,
    };
  }

  const taskResult = await createMergeConflictTask(
    {
      codeTaskRepo: params.deps.codeTaskRepo,
      linearIssueService: params.deps.linearIssueService,
      taskEnqueueService: params.deps.taskEnqueueService,
      orchestratorSecret: params.deps.orchestratorSecret,
    },
    {
      logger: params.logger,
      repository: params.repository,
      eventId: params.eventId,
      details: params.details,
      commentId: params.commentId,
      existingTask: params.taskResolution.latestTask,
      ownerUserId: params.accessContext.userId,
      workerType: workerTypeResult.value,
    }
  );

  if (!taskResult.ok) {
    await updateManagedComment(
      params.deps.gitHubPRClient,
      params.accessContext.token,
      params.parsedRepository.owner,
      params.parsedRepository.repo,
      params.existingSummary.pullRequestNumber,
      params.commentId,
      buildConflictCommentBody({
        phase: 'failed',
        repository: params.repository,
        prNumber: params.existingSummary.pullRequestNumber,
        baseBranch: params.details.baseBranch,
      }),
      params.logger
    );
    return {
      commentId: params.commentId,
      taskId: null,
      ownerUserId: params.accessContext.userId,
    };
  }

  const taskPhase = params.taskResolution.latestTask === null ? 'starting' : 'queued';
  await updateManagedComment(
    params.deps.gitHubPRClient,
    params.accessContext.token,
    params.parsedRepository.owner,
    params.parsedRepository.repo,
    params.existingSummary.pullRequestNumber,
    params.commentId,
    buildConflictCommentBody({
      phase: taskPhase,
      repository: params.repository,
      prNumber: params.existingSummary.pullRequestNumber,
      baseBranch: params.details.baseBranch,
      taskId: taskResult.value.taskId,
    }),
    params.logger
  );

  return {
    commentId: params.commentId,
    taskId: taskResult.value.taskId,
    ownerUserId: taskResult.value.ownerUserId,
  };
}

export async function executeConflictWorkflow(
  params: ConflictWorkflowParams
): Promise<ConflictWorkflowResult> {
  const initialWorkflowResult = buildInitialWorkflowResult(
    params.existingSummary,
    params.taskResolution
  );
  const reusableTask = shouldRetainExistingConflictTask(params.existingSummary.mergeConflictStatus)
    ? params.taskResolution.reusableTask
    : null;

  if (!shouldEnsureConflictWorkflow(
    params.existingSummary,
    params.taskResolution.staleSummaryTaskId
  )) {
    return initialWorkflowResult;
  }

  const commentId = await updateManagedComment(
    params.deps.gitHubPRClient,
    params.accessContext.token,
    params.parsedRepository.owner,
    params.parsedRepository.repo,
    params.existingSummary.pullRequestNumber,
    params.existingSummary.managedConflictCommentId,
    buildConflictCommentBody({
      phase: 'starting',
      repository: params.repository,
      prNumber: params.existingSummary.pullRequestNumber,
      baseBranch: params.details.baseBranch,
      ...(reusableTask !== null ? { taskId: reusableTask.id } : {}),
    }),
    params.logger
  );

  if (commentId === null) {
    return initialWorkflowResult;
  }

  if (reusableTask !== null) {
    return {
      commentId,
      taskId: reusableTask.id,
      ownerUserId: reusableTask.userId,
    };
  }

  return await createConflictTaskWorkflow({ ...params, commentId });
}

export async function resolveConflictWorkflow(
  params: ConflictWorkflowParams
): Promise<ConflictWorkflowResult> {
  await updateManagedComment(
    params.deps.gitHubPRClient,
    params.accessContext.token,
    params.parsedRepository.owner,
    params.parsedRepository.repo,
    params.existingSummary.pullRequestNumber,
    params.existingSummary.managedConflictCommentId,
    buildConflictCommentBody({
      phase: 'resolved',
      repository: params.repository,
      prNumber: params.existingSummary.pullRequestNumber,
      baseBranch: params.details.baseBranch,
    }),
    params.logger
  );

  return {
    commentId: null,
    taskId: null,
    ownerUserId: null,
  };
}
