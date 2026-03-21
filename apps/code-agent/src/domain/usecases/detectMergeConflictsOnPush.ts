import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH, type CodeTask } from '../models/codeTask.js';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { GitHubPRSummary, UpsertGitHubPRSummaryInput } from '../models/gitHubPRSummary.js';
import type { WorkerConfig } from '../models/workerSettings.js';
import type { GitHubPRClient, GitHubPullRequestDetails } from '../ports/gitHubPRClient.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { CodeTaskRepository, CreateTaskInput } from '../repositories/codeTaskRepository.js';
import type { GitHubPREventRepository } from '../repositories/gitHubPREventRepository.js';
import type { GitHubPRSummaryRepository } from '../repositories/gitHubPRSummaryRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import { EMPTY_RECONCILE_RESULT, type MergeConflictDetector, type ReconcileResult } from '../services/mergeConflictDetector.js';
import type { StatusMirrorService } from '../services/statusMirrorService.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import { resolveLoginForTaskCreation } from '../services/gitHubDispatchService.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { sendTaskMessage } from './sendTaskMessage.js';

const BRANCH_REF_PREFIX = 'refs/heads/';
const SYSTEM_PROMPT_HASH = MERGE_CONFLICT_SYSTEM_PROMPT_HASH;
const DEFAULT_WEB_URL = 'https://intexuraos.cloud';
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MERGEABILITY_RETRIES = 2;
const TERMINAL_OR_PLANNED_TASK_STATUSES = new Set<CodeTask['status']>([
  'planned',
  'implemented',
  'reviewed',
  'failed',
  'interrupted',
  'cancelled',
  'archived',
]);

type MergeConflictStatus = GitHubPRSummary['mergeConflictStatus'];
type ClassifiedMergeConflictStatus = NonNullable<MergeConflictStatus>;

interface ConflictWorkflowResult {
  commentId: number | null;
  taskId: string | null;
  ownerUserId: string | null;
}

interface ExistingConflictTaskResolution {
  latestTask: CodeTask | null;
  reusableTask: CodeTask | null;
  staleSummaryTaskId: boolean;
}

interface GitHubAccessContext {
  userId: string;
  token: string;
}

interface ParsedRepository {
  owner: string;
  repo: string;
}

interface CreateTaskDeps {
  codeTaskRepo: CodeTaskRepository;
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
}

interface ConflictWorkflowParams {
  deps: DetectMergeConflictsOnPushDeps;
  logger: Logger;
  repository: string;
  parsedRepository: ParsedRepository;
  eventId: string;
  existingSummary: GitHubPRSummary;
  details: GitHubPullRequestDetails;
  accessContext: GitHubAccessContext;
  taskResolution: ExistingConflictTaskResolution;
}

interface SummaryUpdateParams {
  repository: string;
  lastActivityAt: Date;
  existingSummary: GitHubPRSummary;
  details: GitHubPullRequestDetails;
  status: MergeConflictStatus;
  workflowResult: ConflictWorkflowResult;
}

export interface DetectMergeConflictsOnPushDeps {
  logger: Logger;
  gitHubPRClient: Pick<
    GitHubPRClient,
    'getPullRequestDetails' | 'postPRComment' | 'updateIssueComment' | 'listAllOpenPullRequests'
  >;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  codeTaskRepo: CodeTaskRepository;
  userServiceClient: UserServiceClient;
  gitHubPREventRepo: Pick<GitHubPREventRepository, 'findByPullRequest'>;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  taskEnqueueService: TaskEnqueueService;
  logLineRepo: LogLineRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  statusMirrorService: StatusMirrorService;
  whatsappNotifier: WhatsAppNotifier;
  allowedBots: Set<string>;
  orchestratorSecret: string;
  sleep?: (ms: number) => Promise<void>;
  mergeabilityRetries?: number;
  retryDelayMs?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractPushedBranch(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const ref = (payload as Record<string, unknown>)['ref'];
  if (typeof ref !== 'string' || !ref.startsWith(BRANCH_REF_PREFIX)) {
    return null;
  }

  return ref.slice(BRANCH_REF_PREFIX.length);
}

function classifyMergeConflictStatus(mergeable: boolean | null): ClassifiedMergeConflictStatus {
  if (mergeable === false) {
    return 'conflicting';
  }
  if (mergeable === true) {
    return 'clean';
  }
  return 'unknown';
}

function shouldEnsureConflictWorkflow(
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

function buildTaskUrl(taskId: string): string {
  const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? DEFAULT_WEB_URL;
  return `${webUrl}/#/code-tasks/${taskId}`;
}

function buildConflictCommentBody(params: {
  phase: 'starting' | 'queued' | 'resumed' | 'no-worker' | 'failed' | 'resolved';
  repository: string;
  prNumber: number;
  baseBranch: string;
  taskId?: string;
}): string {
  const lines = [
    '<!-- intexuraos:merge-conflict:v1 -->',
    '### Merge Conflict Detected',
    '',
    `PR #${String(params.prNumber)} in \`${params.repository}\` no longer merges cleanly into \`${params.baseBranch}\`.`,
  ];

  if (params.phase === 'resolved') {
    lines.push('', `The merge conflict with \`${params.baseBranch}\` appears to be resolved.`);
    return lines.join('\n');
  }

  if (params.taskId !== undefined) {
    lines.push('', `Task: [${params.taskId}](${buildTaskUrl(params.taskId)})`);
  }

  switch (params.phase) {
    case 'starting':
      lines.push('', 'Automated conflict resolution has started.');
      break;
    case 'queued':
      lines.push('', 'Automated conflict resolution is queued and will start when worker capacity is available.');
      break;
    case 'resumed':
      lines.push('', 'An existing PR task has been instructed to resolve the conflict.');
      break;
    case 'no-worker':
      lines.push('', 'Automatic resolution could not start because the PR owner has no enabled worker mapping.');
      break;
    case 'failed':
      lines.push('', 'Automatic resolution could not be started. A future push will retry the workflow.');
      break;
  }

  return lines.join('\n');
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

function buildEnsureIssuePrompt(details: GitHubPullRequestDetails, repository: string): string {
  return [
    `Resolve merge conflicts for PR #${String(details.number)} in ${repository}.`,
    `PR title: ${details.title}`,
    `Base branch: ${details.baseBranch}`,
    `Head branch: ${details.headBranch}`,
    `Author: @${details.authorLogin}`,
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
  linearIssueId?: string;
}): CreateTaskInput {
  return {
    id: params.taskId,
    userId: params.userId,
    prompt: params.prompt,
    sanitizedPrompt: params.prompt,
    systemPromptHash: SYSTEM_PROMPT_HASH,
    workerType: 'auto',
    workerLocation: 'queued',
    repository: params.repository,
    baseBranch: params.baseBranch,
    traceId: params.eventId,
    actionId: `merge-conflict/${params.repository}/${String(params.prNumber)}/${params.eventId}`,
    approvalEventId: params.eventId,
    prNumber: params.prNumber,
    webhookSecret: params.webhookSecret,
    agentType: 'pull_request',
    ...(params.linearIssueId !== undefined && { linearIssueId: params.linearIssueId }),
  };
}

function isReusableConflictTask(task: CodeTask, repository: string, prNumber: number): boolean {
  return (
    task.repository === repository &&
    task.prNumber === prNumber &&
    task.agentType === 'pull_request' &&
    task.status !== 'archived'
  );
}

async function loadPullRequestDetails(
  deps: Pick<DetectMergeConflictsOnPushDeps, 'gitHubPRClient' | 'sleep'>,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  retries: number,
  retryDelayMs: number
): Promise<Result<GitHubPullRequestDetails, { code: string; message: string }>> {
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await deps.gitHubPRClient.getPullRequestDetails(token, owner, repo, prNumber);
    if (!result.ok) {
      return err(result.error);
    }

    if (result.value.mergeable !== null || attempt === retries) {
      return ok(result.value);
    }

    await sleep(retryDelayMs);
  }

  return err({ code: 'API_ERROR', message: `Unable to resolve mergeability for PR #${String(prNumber)}` });
}

async function upsertSummary(
  repo: GitHubPRSummaryRepository,
  input: UpsertGitHubPRSummaryInput,
  logger: Logger
): Promise<void> {
  const result = await repo.upsert(input);
  if (!result.ok) {
    logger.warn({ error: result.error, input }, 'Failed to upsert merge-conflict summary');
  }
}

async function resolveExistingConflictTask(
  codeTaskRepo: Pick<CodeTaskRepository, 'findById' | 'findByPR'>,
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

  const byPRResult = await codeTaskRepo.findByPR(repository, prNumber);
  if (!byPRResult.ok) {
    logger.warn({ error: byPRResult.error, repository, prNumber }, 'Failed to load task by PR for merge-conflict detection');
    return err({ code: byPRResult.error.code, message: byPRResult.error.message });
  }

  const latestTask = byPRResult.value;
  return ok({
    latestTask,
    reusableTask:
      latestTask !== null && isReusableConflictTask(latestTask, repository, prNumber)
        ? latestTask
        : null,
    staleSummaryTaskId,
  });
}

async function updateManagedComment(
  gitHubPRClient: Pick<GitHubPRClient, 'postPRComment' | 'updateIssueComment'>,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  existingCommentId: number | null,
  body: string,
  logger: Logger
): Promise<number | null> {
  if (existingCommentId !== null) {
    const updateResult = await gitHubPRClient.updateIssueComment(token, owner, repo, existingCommentId, body);
    if (updateResult.ok) {
      return updateResult.value.commentId;
    }

    logger.warn({ error: updateResult.error, existingCommentId }, 'Failed to update managed conflict comment');
  }

  const createResult = await gitHubPRClient.postPRComment(token, owner, repo, prNumber, body);
  if (!createResult.ok) {
    logger.warn({ error: createResult.error, prNumber }, 'Failed to create managed conflict comment');
    return null;
  }

  return createResult.value.commentId;
}

async function resolveUserIdFromGitHubLogin(
  userServiceClient: UserServiceClient,
  gitHubLogin: string,
  logger: Logger
): Promise<string | null> {
  const userResult = await userServiceClient.resolveGitHubUsername(gitHubLogin);
  if (!userResult.ok) {
    logger.warn({ error: userResult.error, gitHubLogin }, 'Failed to resolve GitHub username for conflict detection');
    return null;
  }

  return userResult.value?.userId ?? null;
}

function findOpenedPRAuthorLogin(events: GitHubPREvent[]): string | null {
  const openedEvent = events.find((event) => event.eventType === 'pull_request' && event.action === 'opened');
  if (openedEvent !== undefined) {
    return openedEvent.senderLogin;
  }

  return events.find((event) => event.senderLogin.length > 0)?.senderLogin ?? null;
}

async function resolveGitHubAccessContext(
  deps: Pick<DetectMergeConflictsOnPushDeps, 'userServiceClient' | 'gitHubPREventRepo' | 'allowedBots'>,
  summary: GitHubPRSummary,
  logger: Logger
): Promise<GitHubAccessContext | null> {
  const managedOwnerUserId = summary.managedConflictTaskOwnerUserId;
  if (managedOwnerUserId !== null) {
    const managedToken = await fetchGitHubToken(deps.userServiceClient, managedOwnerUserId, logger);
    if (managedToken !== null) {
      return { userId: managedOwnerUserId, token: managedToken };
    }
  }

  if (summary.authorLogin !== null) {
    const resolvedAuthorLogin = resolveLoginForTaskCreation(
      summary.authorLogin, summary.repository, deps.allowedBots
    );
    const authorUserId = await resolveUserIdFromGitHubLogin(deps.userServiceClient, resolvedAuthorLogin, logger);
    if (authorUserId !== null) {
      const authorToken = await fetchGitHubToken(deps.userServiceClient, authorUserId, logger);
      if (authorToken !== null) {
        return { userId: authorUserId, token: authorToken };
      }
    }
  }

  const eventsResult = await deps.gitHubPREventRepo.findByPullRequest(summary.repository, summary.pullRequestNumber);
  if (!eventsResult.ok) {
    logger.warn(
      { error: eventsResult.error, repository: summary.repository, prNumber: summary.pullRequestNumber },
      'Failed to load PR events for conflict detection'
    );
    return null;
  }

  const fallbackLogin = findOpenedPRAuthorLogin(eventsResult.value);
  if (fallbackLogin === null) {
    return null;
  }

  const resolvedFallbackLogin = resolveLoginForTaskCreation(
    fallbackLogin, summary.repository, deps.allowedBots
  );
  const fallbackUserId = await resolveUserIdFromGitHubLogin(deps.userServiceClient, resolvedFallbackLogin, logger);
  if (fallbackUserId === null) {
    return null;
  }

  const fallbackToken = await fetchGitHubToken(deps.userServiceClient, fallbackUserId, logger);
  if (fallbackToken === null) {
    return null;
  }

  return { userId: fallbackUserId, token: fallbackToken };
}

async function resolveEnabledWorker(
  workerSettingsRepo: WorkerSettingsRepository,
  userId: string,
  logger: Logger
): Promise<Result<WorkerConfig, { code: 'NO_ENABLED_WORKER' | 'INTERNAL_ERROR'; message: string }>> {
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.warn({ error: settingsResult.error, userId }, 'Failed to load worker settings for conflict detection');
    return err({ code: 'INTERNAL_ERROR', message: settingsResult.error.message });
  }

  const worker = settingsResult.value?.workers.find((candidate) => candidate.enabled);
  if (worker === undefined) {
    return err({ code: 'NO_ENABLED_WORKER', message: `No enabled worker for user ${userId}` });
  }

  return ok(worker);
}

async function createMergeConflictTask(
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
  const shouldOmitLinearIssueId =
    params.existingTask?.linearIssueId !== undefined &&
    !TERMINAL_OR_PLANNED_TASK_STATUSES.has(params.existingTask.status) &&
    params.existingTask.agentType !== 'pull_request';

  const prompt = buildConflictInstruction({
    repository: params.repository,
    prNumber: params.details.number,
    baseBranch: params.details.baseBranch,
    commentId: params.commentId,
  });
  const taskId = `task_${crypto.randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, taskId);

  const createResult = await deps.codeTaskRepo.create(buildCreateTaskInput({
    taskId,
    repository: params.repository,
    prNumber: params.details.number,
    baseBranch: params.details.baseBranch,
    prompt,
    eventId: params.eventId,

    userId: params.ownerUserId,
    webhookSecret,
    ...(linkedLinearIssueId !== undefined && !shouldOmitLinearIssueId && { linearIssueId: linkedLinearIssueId }),
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

function shouldResolveTaskState(
  status: MergeConflictStatus,
  existingSummary: GitHubPRSummary
): boolean {
  return status === 'conflicting' || (
    status === 'unknown' &&
    existingSummary.mergeConflictStatus === 'conflicting'
  );
}

function buildInitialWorkflowResult(
  existingSummary: GitHubPRSummary,
  taskResolution: ExistingConflictTaskResolution
): ConflictWorkflowResult {
  return {
    commentId: existingSummary.managedConflictCommentId,
    taskId:
      taskResolution.reusableTask?.id ??
      (taskResolution.staleSummaryTaskId ? null : existingSummary.managedConflictTaskId),
    ownerUserId:
      taskResolution.reusableTask?.userId ??
      existingSummary.managedConflictTaskOwnerUserId,
  };
}

async function reuseConflictTask(
  params: ConflictWorkflowParams,
  reusableTask: CodeTask,
  commentId: number
): Promise<ConflictWorkflowResult> {
  const sendResult = await sendTaskMessage(
    {
      logger: params.logger,
      codeTaskRepo: params.deps.codeTaskRepo,
      logLineRepo: params.deps.logLineRepo,
      taskDispatcher: params.deps.taskDispatcher,
      workerSettingsRepo: params.deps.workerSettingsRepo,
      statusMirrorService: params.deps.statusMirrorService,
      whatsappNotifier: params.deps.whatsappNotifier,
    },
    {
      taskId: reusableTask.id,
      userId: reusableTask.userId,
      message: buildConflictInstruction({
        repository: params.repository,
        prNumber: params.existingSummary.pullRequestNumber,
        baseBranch: params.details.baseBranch,
        commentId,
      }),
    }
  );

  const phase = sendResult.ok
    ? sendResult.value.action === 'queued' ? 'queued' : 'resumed'
    : 'failed';

  await updateManagedComment(
    params.deps.gitHubPRClient,
    params.accessContext.token,
    params.parsedRepository.owner,
    params.parsedRepository.repo,
    params.existingSummary.pullRequestNumber,
    commentId,
    buildConflictCommentBody({
      phase,
      repository: params.repository,
      prNumber: params.existingSummary.pullRequestNumber,
      baseBranch: params.details.baseBranch,
      ...(sendResult.ok ? { taskId: reusableTask.id } : {}),
    }),
    params.logger
  );

  return {
    commentId,
    taskId: sendResult.ok ? reusableTask.id : null,
    ownerUserId: reusableTask.userId,
  };
}

async function createConflictTaskWorkflow(
  params: ConflictWorkflowParams & { commentId: number }
): Promise<ConflictWorkflowResult> {
  const workerResult = await resolveEnabledWorker(
    params.deps.workerSettingsRepo,
    params.accessContext.userId,
    params.logger
  );

  if (!workerResult.ok) {
    const phase = workerResult.error.code === 'NO_ENABLED_WORKER' ? 'no-worker' : 'failed';
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

async function executeConflictWorkflow(
  params: ConflictWorkflowParams
): Promise<ConflictWorkflowResult> {
  const initialWorkflowResult = buildInitialWorkflowResult(
    params.existingSummary,
    params.taskResolution
  );

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
    }),
    params.logger
  );

  if (commentId === null) {
    return initialWorkflowResult;
  }

  const reusableTask = params.taskResolution.reusableTask;
  if (reusableTask !== null) {
    return await reuseConflictTask(params, reusableTask, commentId);
  }

  return await createConflictTaskWorkflow({ ...params, commentId });
}

async function resolveConflictWorkflow(
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

function resolveConflictEpisodeStartedAt(
  existingSummary: GitHubPRSummary,
  status: MergeConflictStatus,
  now: Date
): Date | null {
  if (status === 'conflicting') {
    return existingSummary.conflictEpisodeStartedAt ?? now;
  }

  if (status === 'unknown' && existingSummary.mergeConflictStatus === 'conflicting') {
    // Preserve the active conflict window when GitHub temporarily reports mergeability as unknown.
    return existingSummary.conflictEpisodeStartedAt ?? null;
  }

  return null;
}

function buildSummaryUpdateInput(params: SummaryUpdateParams): UpsertGitHubPRSummaryInput {
  const now = new Date();

  return {
    repository: params.repository,
    pullRequestNumber: params.existingSummary.pullRequestNumber,
    title: params.details.title,
    state: 'open',
    mergedAt: null,
    baseBranch: params.details.baseBranch,
    authorLogin: params.details.authorLogin,
    headBranch: params.details.headBranch,
    mergeConflictStatus: params.status,
    lastConflictCheckedAt: now,
    conflictEpisodeStartedAt: resolveConflictEpisodeStartedAt(
      params.existingSummary,
      params.status,
      now
    ),
    conflictResolvedAt:
      params.status === 'clean' &&
      params.existingSummary.mergeConflictStatus === 'conflicting'
        ? now
        : null,
    managedConflictCommentId:
      params.status === 'conflicting' || params.status === 'unknown'
        ? params.workflowResult.commentId
        : null,
    managedConflictTaskId:
      params.status === 'conflicting' || params.status === 'unknown'
        ? params.workflowResult.taskId
        : null,
    managedConflictTaskOwnerUserId:
      params.status === 'conflicting' || params.status === 'unknown'
        ? params.workflowResult.ownerUserId
        : null,
    lastActivityAt: params.lastActivityAt,
    firstSeenAt: params.existingSummary.firstSeenAt,
  };
}

interface ProcessingTrigger {
  eventId: string;
  repository: string;
  lastActivityAt: Date;
}

type ProcessingOutcome = 'closed' | 'clean' | 'conflicting' | 'unknown' | 'skipped' | 'error';

async function processOpenSummaryOnPush(
  deps: DetectMergeConflictsOnPushDeps,
  trigger: ProcessingTrigger,
  logger: Logger,
  parsedRepository: ParsedRepository,
  existingSummary: GitHubPRSummary
): Promise<ProcessingOutcome> {
  const accessContext = await resolveGitHubAccessContext(
    {
      userServiceClient: deps.userServiceClient,
      gitHubPREventRepo: deps.gitHubPREventRepo,
      allowedBots: deps.allowedBots,
    },
    existingSummary,
    logger
  );
  if (accessContext === null) {
    logger.info(
      { repository: existingSummary.repository, prNumber: existingSummary.pullRequestNumber },
      'Skipping conflict detection for PR without an OAuth-backed user'
    );
    return 'skipped';
  }

  const detailsResult = await loadPullRequestDetails(
    deps,
    accessContext.token,
    parsedRepository.owner,
    parsedRepository.repo,
    existingSummary.pullRequestNumber,
    deps.mergeabilityRetries ?? DEFAULT_MERGEABILITY_RETRIES,
    deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  );
  if (!detailsResult.ok) {
    logger.warn(
      { error: detailsResult.error, prNumber: existingSummary.pullRequestNumber },
      'Failed to load PR details for conflict detection'
    );
    return 'skipped';
  }

  const details = detailsResult.value;

  if (details.state !== 'open') {
    logger.info(
      { prNumber: existingSummary.pullRequestNumber, state: details.state },
      'Closing stale PR summary — PR is no longer open on GitHub'
    );
    await upsertSummary(
      deps.gitHubPRSummaryRepo,
      {
        repository: trigger.repository,
        pullRequestNumber: existingSummary.pullRequestNumber,
        lastActivityAt: trigger.lastActivityAt,
        firstSeenAt: existingSummary.firstSeenAt,
        state: details.state,
      },
      logger
    );
    return 'closed';
  }

  const status = classifyMergeConflictStatus(details.mergeable);
  let taskResolution: ExistingConflictTaskResolution = {
    latestTask: null,
    reusableTask: null,
    staleSummaryTaskId: false,
  };

  if (shouldResolveTaskState(status, existingSummary)) {
    const resolutionResult = await resolveExistingConflictTask(
      deps.codeTaskRepo,
      existingSummary,
      trigger.repository,
      existingSummary.pullRequestNumber,
      logger
    );
    if (!resolutionResult.ok) {
      return 'skipped';
    }
    taskResolution = resolutionResult.value;
  }

  const workflowParams: ConflictWorkflowParams = {
    deps,
    logger,
    repository: trigger.repository,
    parsedRepository,
    eventId: trigger.eventId,
    existingSummary,
    details,
    accessContext,
    taskResolution,
  };

  let workflowResult = buildInitialWorkflowResult(existingSummary, taskResolution);
  if (status === 'conflicting') {
    workflowResult = await executeConflictWorkflow(workflowParams);
  } else if (
    status === 'clean' &&
    existingSummary.mergeConflictStatus === 'conflicting' &&
    existingSummary.managedConflictCommentId !== null
  ) {
    workflowResult = await resolveConflictWorkflow(workflowParams);
  }

  logger.info(
    { prNumber: existingSummary.pullRequestNumber, mergeConflictStatus: status },
    'PR mergeability checked'
  );

  await upsertSummary(
    deps.gitHubPRSummaryRepo,
    buildSummaryUpdateInput({
      repository: trigger.repository,
      lastActivityAt: trigger.lastActivityAt,
      existingSummary,
      details,
      status,
      workflowResult,
    }),
    logger
  );

  return status;
}

export function createDetectMergeConflictsOnPush(
  deps: DetectMergeConflictsOnPushDeps
): MergeConflictDetector {
  return {
    async detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void> {
      const branch = extractPushedBranch(event.payload);
      if (branch === null) {
        logger.debug({ eventId: event.id }, 'Skipping merge-conflict detection for non-branch push');
        return;
      }

      const parsedRepository = parseOwnerRepo(event.repository);
      if (parsedRepository === null) {
        logger.warn({ repository: event.repository }, 'Skipping merge-conflict detection for invalid repository');
        return;
      }

      const openSummariesResult = await deps.gitHubPRSummaryRepo.findOpenByBaseBranch(event.repository, branch);
      if (!openSummariesResult.ok) {
        logger.warn(
          { error: openSummariesResult.error, repository: event.repository, branch },
          'Failed to load open PR summaries for merge-conflict detection'
        );
        return;
      }

      if (openSummariesResult.value.length === 0) {
        logger.debug({ repository: event.repository, branch }, 'Skipping merge-conflict detection with no open PR summaries');
        return;
      }

      const trigger: ProcessingTrigger = {
        eventId: event.id,
        repository: event.repository,
        lastActivityAt: event.createdAt,
      };
      for (const existingSummary of openSummariesResult.value) {
        await processOpenSummaryOnPush(
          deps,
          trigger,
          logger,
          parsedRepository,
          existingSummary
        );
      }
    },

    async reconcile(logger: Logger): Promise<ReconcileResult> {
      // Query all tracked summaries (any state) so we discover repos even when
      // every summary has been closed.  30 days covers any PR with recent activity.
      const trackedResult = await deps.gitHubPRSummaryRepo.findRecentlyActive(30);
      if (!trackedResult.ok) {
        logger.warn({ error: trackedResult.error }, 'Failed to load PR summaries for reconciliation');
        return EMPTY_RECONCILE_RESULT;
      }

      const summaries = trackedResult.value;
      if (summaries.length === 0) {
        logger.debug({}, 'No tracked PR summaries to reconcile');
        return EMPTY_RECONCILE_RESULT;
      }

      logger.info({ count: summaries.length }, 'Reconciling PR state from GitHub');

      let processed = 0;
      let closed = 0;
      let reopened = 0;
      let mergeConflictRefreshed = 0;
      let skipped = 0;
      let error = 0;

      // Group summaries by repository
      const byRepo = new Map<string, GitHubPRSummary[]>();
      for (const summary of summaries) {
        const existing = byRepo.get(summary.repository);
        if (existing !== undefined) {
          existing.push(summary);
        } else {
          byRepo.set(summary.repository, [summary]);
        }
      }

      for (const [repository, repoSummaries] of byRepo) {
        const parsedRepository = parseOwnerRepo(repository);
        if (parsedRepository === null) {
          logger.warn({ repository }, 'Skipping reconcile for repo with invalid repository format');
          continue;
        }

        // Iterate through summaries until one yields a valid access context
        let accessContext: GitHubAccessContext | null = null;
        for (const candidate of repoSummaries) {
          accessContext = await resolveGitHubAccessContext(
            {
              userServiceClient: deps.userServiceClient,
              gitHubPREventRepo: deps.gitHubPREventRepo,
              allowedBots: deps.allowedBots,
            },
            candidate,
            logger
          );
          if (accessContext !== null) break;
        }
        if (accessContext === null) {
          logger.info(
            { repository, count: repoSummaries.length },
            'Skipping reconcile for repo — no OAuth-backed user found'
          );
          skipped += repoSummaries.length;
          processed += repoSummaries.length;
          continue;
        }

        const openPRsResult = await deps.gitHubPRClient.listAllOpenPullRequests(
          accessContext.token,
          parsedRepository.owner,
          parsedRepository.repo
        );
        if (!openPRsResult.ok) {
          logger.warn(
            { error: openPRsResult.error, repository },
            'Failed to list open PRs for repo during reconcile; skipping repo'
          );
          skipped += repoSummaries.length;
          processed += repoSummaries.length;
          continue;
        }

        const openPRNumbers = new Set(openPRsResult.value.map((pr) => pr.number));

        for (const existingSummary of repoSummaries) {
          try {
            if (!openPRNumbers.has(existingSummary.pullRequestNumber)) {
              // PR is not open on GitHub
              if (existingSummary.state === 'open') {
                logger.info(
                  { prNumber: existingSummary.pullRequestNumber, repository },
                  'Closing PR summary — PR is no longer open on GitHub'
                );
                await upsertSummary(
                  deps.gitHubPRSummaryRepo,
                  {
                    repository,
                    pullRequestNumber: existingSummary.pullRequestNumber,
                    lastActivityAt: existingSummary.lastActivityAt,
                    firstSeenAt: existingSummary.firstSeenAt,
                    state: 'closed',
                  },
                  logger
                );
                processed++;
                closed++;
              }
              // Already closed in Firestore — skip silently
              continue;
            }

            // PR is open on GitHub
            if (existingSummary.state !== 'open') {
              logger.info(
                { prNumber: existingSummary.pullRequestNumber, repository, previousState: existingSummary.state },
                'Re-opening PR summary — PR is open on GitHub'
              );
              await upsertSummary(
                deps.gitHubPRSummaryRepo,
                {
                  repository,
                  pullRequestNumber: existingSummary.pullRequestNumber,
                  lastActivityAt: existingSummary.lastActivityAt,
                  firstSeenAt: existingSummary.firstSeenAt,
                  state: 'open',
                },
                logger
              );
              processed++;
              reopened++;
            }

            // Refresh mergeConflictStatus for all open PRs (INT-1051)
            const detailsResult = await deps.gitHubPRClient.getPullRequestDetails(
              accessContext.token,
              parsedRepository.owner,
              parsedRepository.repo,
              existingSummary.pullRequestNumber
            );
            if (detailsResult.ok) {
              const newStatus = classifyMergeConflictStatus(detailsResult.value.mergeable);
              const previousStatus = existingSummary.mergeConflictStatus;
              if (newStatus !== 'unknown' && newStatus !== previousStatus) {
                logger.info(
                  {
                    prNumber: existingSummary.pullRequestNumber,
                    repository,
                    previousStatus,
                    newStatus,
                  },
                  'Refreshing mergeConflictStatus during reconcile'
                );
                await upsertSummary(
                  deps.gitHubPRSummaryRepo,
                  {
                    repository,
                    pullRequestNumber: existingSummary.pullRequestNumber,
                    lastActivityAt: existingSummary.lastActivityAt,
                    firstSeenAt: existingSummary.firstSeenAt,
                    mergeConflictStatus: newStatus,
                    lastConflictCheckedAt: new Date(),
                  },
                  logger
                );
                mergeConflictRefreshed++;
                processed++;
              }
            } else {
              logger.warn(
                { error: detailsResult.error, prNumber: existingSummary.pullRequestNumber, repository },
                'Failed to fetch PR details for mergeability refresh during reconcile; skipping'
              );
            }
          } catch (caughtError: unknown) {
            error++;
            processed++;
            logger.error(
              { error: caughtError, repository: existingSummary.repository, prNumber: existingSummary.pullRequestNumber },
              'Unhandled error processing PR summary in reconcile; continuing'
            );
          }
        }
      }

      logger.info(
        { processed, closed, reopened, mergeConflictRefreshed, skipped, error },
        'PR state reconciliation complete'
      );

      return { processed, closed, reopened, mergeConflictRefreshed, skipped, error };
    },
  };
}
