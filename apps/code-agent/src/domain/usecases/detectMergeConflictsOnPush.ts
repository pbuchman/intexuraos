import { createHmac } from 'node:crypto';
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask } from '../models/codeTask.js';
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
import type { MergeConflictDetector } from '../services/mergeConflictDetector.js';
import type { StatusMirrorService } from '../services/statusMirrorService.js';
import type { DispatchWorkerCredentials, TaskDispatcherService } from '../services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import { fetchGitHubToken } from '../utils/prTaskNotification.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';
import { sendTaskMessage } from './sendTaskMessage.js';

const BRANCH_REF_PREFIX = 'refs/heads/';
const SYSTEM_PROMPT_HASH = 'pr-merge-conflict-auto';
const DEFAULT_WEB_URL = 'https://intexuraos.cloud';
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MERGEABILITY_RETRIES = 2;

type MergeConflictStatus = GitHubPRSummary['mergeConflictStatus'];

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

interface CreateTaskDeps {
  codeTaskRepo: CodeTaskRepository;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  serviceUrl: string;
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
  worker: WorkerConfig;
}

export interface DetectMergeConflictsOnPushDeps {
  logger: Logger;
  gitHubPRClient: Pick<
    GitHubPRClient,
    'getPullRequestDetails' | 'postPRComment' | 'updateIssueComment'
  >;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  codeTaskRepo: CodeTaskRepository;
  userServiceClient: UserServiceClient;
  gitHubPREventRepo: Pick<GitHubPREventRepository, 'findByPullRequest'>;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  logLineRepo: LogLineRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  statusMirrorService: StatusMirrorService;
  whatsappNotifier: WhatsAppNotifier;
  serviceUrl: string;
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

function classifyMergeConflictStatus(mergeable: boolean | null): MergeConflictStatus {
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
  status: MergeConflictStatus,
  staleSummaryTaskId: boolean
): boolean {
  if (status !== 'conflicting') {
    return false;
  }

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
  workerName: string;
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
    workerLocation: params.workerName,
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

function buildWorkerCredentials(worker: WorkerConfig): DispatchWorkerCredentials {
  return {
    workers: [{
      name: worker.name,
      url: worker.url,
      cfAccessClientId: worker.cfAccessClientId,
      cfAccessClientSecret: worker.cfAccessClientSecret,
      dispatchSigningSecret: worker.dispatchSigningSecret,
    }],
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
  deps: Pick<DetectMergeConflictsOnPushDeps, 'userServiceClient' | 'gitHubPREventRepo'>,
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
    const authorUserId = await resolveUserIdFromGitHubLogin(deps.userServiceClient, summary.authorLogin, logger);
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

  const fallbackUserId = await resolveUserIdFromGitHubLogin(deps.userServiceClient, fallbackLogin, logger);
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
    params.existingTask.status !== 'planned' &&
    params.existingTask.status !== 'implemented' &&
    params.existingTask.status !== 'reviewed' &&
    params.existingTask.status !== 'failed' &&
    params.existingTask.status !== 'interrupted' &&
    params.existingTask.status !== 'cancelled' &&
    params.existingTask.status !== 'archived' &&
    params.existingTask.agentType !== 'pull_request';

  const prompt = buildConflictInstruction({
    repository: params.repository,
    prNumber: params.details.number,
    baseBranch: params.details.baseBranch,
    commentId: params.commentId,
  });
  const taskId = `task_${crypto.randomUUID()}`;
  const webhookSecret = createHmac('sha256', deps.orchestratorSecret).update(taskId).digest('hex');

  let createResult = await deps.codeTaskRepo.create(buildCreateTaskInput({
    taskId,
    repository: params.repository,
    prNumber: params.details.number,
    baseBranch: params.details.baseBranch,
    prompt,
    eventId: params.eventId,
    workerName: params.worker.name,
    userId: params.ownerUserId,
    webhookSecret,
    ...(linkedLinearIssueId !== undefined && !shouldOmitLinearIssueId && { linearIssueId: linkedLinearIssueId }),
  }));

  if (
    !createResult.ok &&
    createResult.error.code === 'ACTIVE_TASK_EXISTS' &&
    linkedLinearIssueId !== undefined &&
    !shouldOmitLinearIssueId
  ) {
    createResult = await deps.codeTaskRepo.create(buildCreateTaskInput({
      taskId,
      repository: params.repository,
      prNumber: params.details.number,
      baseBranch: params.details.baseBranch,
      prompt,
      eventId: params.eventId,
      workerName: params.worker.name,
      userId: params.ownerUserId,
      webhookSecret,
    }));
  }

  if (!createResult.ok) {
    return err({ code: createResult.error.code, message: createResult.error.message });
  }

  const dispatchResult = await deps.taskDispatcher.dispatch({
    taskId,
    ...(linkedLinearIssueId !== undefined && !shouldOmitLinearIssueId && { linearIssueId: linkedLinearIssueId }),
    linearIssueLabels:
      linearResult.linearIssueLabels.includes('pr-comment')
        ? linearResult.linearIssueLabels
        : [...linearResult.linearIssueLabels, 'pr-comment'],
    hasChildren: linearResult.hasChildren,
    prompt,
    systemPromptHash: SYSTEM_PROMPT_HASH,
    repository: params.repository,
    baseBranch: params.details.baseBranch,
    workerType: 'auto',
    webhookUrl: `${deps.serviceUrl}/internal/webhooks/task-complete`,
    webhookSecret,
    traceId: params.eventId,
    workerCredentials: buildWorkerCredentials(params.worker),
    agentType: 'pull_request',
    trackingCommentId: String(params.commentId),
  });

  if (!dispatchResult.ok) {
    if (dispatchResult.error.code === 'at_capacity') {
      return ok({ taskId, ownerUserId: params.ownerUserId });
    }

    await deps.codeTaskRepo.update(taskId, {
      status: 'failed',
      error: {
        code: dispatchResult.error.code,
        message: dispatchResult.error.message,
      },
    });
    return err({ code: dispatchResult.error.code, message: dispatchResult.error.message });
  }

  await deps.codeTaskRepo.update(taskId, {
    status: 'dispatched',
    workerLocation: dispatchResult.value.workerLocation,
  });

  return ok({ taskId, ownerUserId: params.ownerUserId });
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

      for (const existingSummary of openSummariesResult.value) {
        const accessContext = await resolveGitHubAccessContext(
          {
            userServiceClient: deps.userServiceClient,
            gitHubPREventRepo: deps.gitHubPREventRepo,
          },
          existingSummary,
          logger
        );
        if (accessContext === null) {
          logger.info(
            { repository: existingSummary.repository, prNumber: existingSummary.pullRequestNumber },
            'Skipping conflict detection for PR without an OAuth-backed user'
          );
          continue;
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
          continue;
        }

        const details = detailsResult.value;
        const status = classifyMergeConflictStatus(details.mergeable);
        let taskResolution: ExistingConflictTaskResolution = {
          latestTask: null,
          reusableTask: null,
          staleSummaryTaskId: false,
        };

        const shouldResolveTaskState =
          status === 'conflicting' ||
          (status === 'unknown' && existingSummary.mergeConflictStatus === 'conflicting');
        if (shouldResolveTaskState) {
          const resolutionResult = await resolveExistingConflictTask(
            deps.codeTaskRepo,
            existingSummary,
            event.repository,
            existingSummary.pullRequestNumber,
            logger
          );
          if (!resolutionResult.ok) {
            continue;
          }
          taskResolution = resolutionResult.value;
        }

        let workflowResult: ConflictWorkflowResult = {
          commentId: existingSummary.managedConflictCommentId,
          taskId:
            taskResolution.reusableTask?.id ??
            (taskResolution.staleSummaryTaskId ? null : existingSummary.managedConflictTaskId),
          ownerUserId:
            taskResolution.reusableTask?.userId ??
            existingSummary.managedConflictTaskOwnerUserId,
        };

        if (shouldEnsureConflictWorkflow(existingSummary, status, taskResolution.staleSummaryTaskId)) {
          const commentId = await updateManagedComment(
            deps.gitHubPRClient,
            accessContext.token,
            parsedRepository.owner,
            parsedRepository.repo,
            existingSummary.pullRequestNumber,
            existingSummary.managedConflictCommentId,
            buildConflictCommentBody({
              phase: 'starting',
              repository: event.repository,
              prNumber: existingSummary.pullRequestNumber,
              baseBranch: details.baseBranch,
            }),
            logger
          );

          if (commentId !== null && taskResolution.reusableTask !== null) {
            const sendResult = await sendTaskMessage(
              {
                logger,
                codeTaskRepo: deps.codeTaskRepo,
                logLineRepo: deps.logLineRepo,
                taskDispatcher: deps.taskDispatcher,
                workerSettingsRepo: deps.workerSettingsRepo,
                statusMirrorService: deps.statusMirrorService,
                whatsappNotifier: deps.whatsappNotifier,
              },
              {
                taskId: taskResolution.reusableTask.id,
                userId: taskResolution.reusableTask.userId,
                message: buildConflictInstruction({
                  repository: event.repository,
                  prNumber: existingSummary.pullRequestNumber,
                  baseBranch: details.baseBranch,
                  commentId,
                }),
              }
            );

            if (sendResult.ok) {
              await updateManagedComment(
                deps.gitHubPRClient,
                accessContext.token,
                parsedRepository.owner,
                parsedRepository.repo,
                existingSummary.pullRequestNumber,
                commentId,
                buildConflictCommentBody({
                  phase: sendResult.value.action === 'queued' ? 'queued' : 'resumed',
                  repository: event.repository,
                  prNumber: existingSummary.pullRequestNumber,
                  baseBranch: details.baseBranch,
                  taskId: taskResolution.reusableTask.id,
                }),
                logger
              );
              workflowResult = {
                commentId,
                taskId: taskResolution.reusableTask.id,
                ownerUserId: taskResolution.reusableTask.userId,
              };
            } else {
              await updateManagedComment(
                deps.gitHubPRClient,
                accessContext.token,
                parsedRepository.owner,
                parsedRepository.repo,
                existingSummary.pullRequestNumber,
                commentId,
                buildConflictCommentBody({
                  phase: 'failed',
                  repository: event.repository,
                  prNumber: existingSummary.pullRequestNumber,
                  baseBranch: details.baseBranch,
                }),
                logger
              );
              workflowResult = {
                commentId,
                taskId: null,
                ownerUserId: taskResolution.reusableTask.userId,
              };
            }
          } else if (commentId !== null) {
            const workerResult = await resolveEnabledWorker(
              deps.workerSettingsRepo,
              accessContext.userId,
              logger
            );

            if (!workerResult.ok) {
              const phase = workerResult.error.code === 'NO_ENABLED_WORKER' ? 'no-worker' : 'failed';
              await updateManagedComment(
                deps.gitHubPRClient,
                accessContext.token,
                parsedRepository.owner,
                parsedRepository.repo,
                existingSummary.pullRequestNumber,
                commentId,
                buildConflictCommentBody({
                  phase,
                  repository: event.repository,
                  prNumber: existingSummary.pullRequestNumber,
                  baseBranch: details.baseBranch,
                }),
                logger
              );
              workflowResult = {
                commentId,
                taskId: null,
                ownerUserId: accessContext.userId,
              };
            } else {
              const taskResult = await createMergeConflictTask(
                {
                  codeTaskRepo: deps.codeTaskRepo,
                  linearIssueService: deps.linearIssueService,
                  taskDispatcher: deps.taskDispatcher,
                  serviceUrl: deps.serviceUrl,
                  orchestratorSecret: deps.orchestratorSecret,
                },
                {
                  logger,
                  repository: event.repository,
                  eventId: event.id,
                  details,
                  commentId,
                  existingTask: taskResolution.latestTask,
                  ownerUserId: accessContext.userId,
                  worker: workerResult.value,
                }
              );

              if (taskResult.ok) {
                const taskPhase =
                  taskResolution.latestTask === null ? 'starting' : 'queued';
                await updateManagedComment(
                  deps.gitHubPRClient,
                  accessContext.token,
                  parsedRepository.owner,
                  parsedRepository.repo,
                  existingSummary.pullRequestNumber,
                  commentId,
                  buildConflictCommentBody({
                    phase: taskPhase,
                    repository: event.repository,
                    prNumber: existingSummary.pullRequestNumber,
                    baseBranch: details.baseBranch,
                    taskId: taskResult.value.taskId,
                  }),
                  logger
                );
                workflowResult = {
                  commentId,
                  taskId: taskResult.value.taskId,
                  ownerUserId: taskResult.value.ownerUserId,
                };
              } else {
                await updateManagedComment(
                  deps.gitHubPRClient,
                  accessContext.token,
                  parsedRepository.owner,
                  parsedRepository.repo,
                  existingSummary.pullRequestNumber,
                  commentId,
                  buildConflictCommentBody({
                    phase: 'failed',
                    repository: event.repository,
                    prNumber: existingSummary.pullRequestNumber,
                    baseBranch: details.baseBranch,
                  }),
                  logger
                );
                workflowResult = {
                  commentId,
                  taskId: null,
                  ownerUserId: accessContext.userId,
                };
              }
            }
          }
        } else if (
          status === 'clean' &&
          existingSummary.mergeConflictStatus === 'conflicting' &&
          existingSummary.managedConflictCommentId !== null
        ) {
          await updateManagedComment(
            deps.gitHubPRClient,
            accessContext.token,
            parsedRepository.owner,
            parsedRepository.repo,
            existingSummary.pullRequestNumber,
            existingSummary.managedConflictCommentId,
            buildConflictCommentBody({
              phase: 'resolved',
              repository: event.repository,
              prNumber: existingSummary.pullRequestNumber,
              baseBranch: details.baseBranch,
            }),
            logger
          );
          workflowResult = {
            commentId: null,
            taskId: null,
            ownerUserId: null,
          };
        }

        const now = new Date();
        const preserveActiveEpisode =
          status !== 'clean' && existingSummary.mergeConflictStatus === 'conflicting';
        await upsertSummary(
          deps.gitHubPRSummaryRepo,
          {
            repository: event.repository,
            pullRequestNumber: existingSummary.pullRequestNumber,
            title: details.title,
            state: 'open',
            mergedAt: null,
            baseBranch: details.baseBranch,
            authorLogin: details.authorLogin,
            headBranch: details.headBranch,
            mergeConflictStatus: status,
            lastConflictCheckedAt: now,
            conflictEpisodeStartedAt:
              status === 'conflicting'
                ? existingSummary.conflictEpisodeStartedAt ?? now
                : preserveActiveEpisode
                  ? existingSummary.conflictEpisodeStartedAt ?? null
                  : null,
            conflictResolvedAt:
              status === 'clean' && existingSummary.mergeConflictStatus === 'conflicting' ? now : null,
            managedConflictCommentId:
              status === 'conflicting' || status === 'unknown' ? workflowResult.commentId : null,
            managedConflictTaskId:
              status === 'conflicting' || status === 'unknown' ? workflowResult.taskId : null,
            managedConflictTaskOwnerUserId:
              status === 'conflicting' || status === 'unknown'
                ? workflowResult.ownerUserId
                : null,
            lastActivityAt: event.createdAt,
            firstSeenAt: existingSummary.firstSeenAt,
          },
          logger
        );
      }
    },
  };
}
