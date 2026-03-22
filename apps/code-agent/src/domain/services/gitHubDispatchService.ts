import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { RuleOutcome } from './gitHubWebhookRules.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { LinearIssueService } from './linearIssueService.js';
import type { TaskDispatcherService } from './taskDispatcher.js';
import type { TaskEnqueueService } from './taskEnqueueService.js';
import type { WhatsAppNotifier } from './whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { StatusMirrorService } from './statusMirrorService.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPREventRepository } from '../repositories/gitHubPREventRepository.js';
import type { WebhookMessageBuilder } from './gitHubMessageBuilder.js';
import { createTaskForPR } from '../usecases/createTaskForPR.js';
import { sendTaskMessage } from '../usecases/sendTaskMessage.js';
import type { SendTaskMessageErrorCode } from '../usecases/sendTaskMessage.js';
import type { DispatchRetryRepository } from '../repositories/dispatchRetryRepository.js';
import { isRetryableErrorCode } from '../utils/retryableErrors.js';
import { loadConfig } from '../../config.js';

import { extractDispatchWorkerType } from '../utils/dispatchWorkerTriage.js';
import type { AutomationLog } from '../ports/automationLog.js';

export interface DispatchContext {
  event: GitHubPREvent;
  decision: Extract<RuleOutcome, { action: 'dispatch' }>;
  logger: Logger;
}

export interface WebhookDispatchResult {
  success: boolean;
  dispatched: boolean;
  taskId?: string;
  error?: string;
  errorCode?: SendTaskMessageErrorCode;
}

export interface WebhookDispatchService {
  dispatch(context: DispatchContext): Promise<WebhookDispatchResult>;
}

export interface WebhookDispatchServiceDeps {
  gitHubPREventRepo: GitHubPREventRepository;
  codeTaskRepo: CodeTaskRepository;
  logLineRepo: LogLineRepository;
  userLookupService?: UserLookupService;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
  workerSettingsRepo: WorkerSettingsRepository;
  statusMirrorService: StatusMirrorService;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  firestore: {
    runTransaction: <T>(fn: (transaction: import('@google-cloud/firestore').Transaction) => Promise<T>) => Promise<T>;
    doc: (path: string) => import('@google-cloud/firestore').DocumentReference;
  };
  messageBuilder: WebhookMessageBuilder;
  allowedBots: Set<string>;
  orchestratorSecret: string;
  serviceUrl: string;
  dispatchRetryRepo?: DispatchRetryRepository;
  automationLog: AutomationLog;
}

export function resolveLoginForTaskCreation(senderLogin: string, repository: string, allowedBots: Set<string>): string {
  if (!allowedBots.has(senderLogin)) return senderLogin;
  const slashIndex = repository.indexOf('/');
  if (slashIndex <= 0) return senderLogin;
  const owner = repository.slice(0, slashIndex);
  // Only remap for personal forks (e.g. pbuchman/intexuraos),
  // not org repos (e.g. intexuraos/some-repo) where the owner is an org, not a user.
  if (owner === 'intexuraos') return senderLogin;
  return owner;
}

export function createWebhookDispatchService(deps: WebhookDispatchServiceDeps): WebhookDispatchService {
  return {
    async dispatch(context: DispatchContext): Promise<WebhookDispatchResult> {
      const { event, logger } = context;

      try {
        logger.info(
          { prNumber: event.pullRequestNumber, repo: event.repository, action: event.action },
          'Starting GitHub dispatch workflow'
        );

        // Use non-review lookup to avoid routing generic comments into review tasks
        const taskResult = await deps.codeTaskRepo.findLatestNonReviewTaskByPR(event.repository, event.pullRequestNumber);

        if (!taskResult.ok) {
          logger.error(
            { prNumber: event.pullRequestNumber, repo: event.repository, error: taskResult.error },
            'Failed to find task for PR'
          );
          return { success: false, dispatched: false, error: `Failed to find task: ${taskResult.error.message}` };
        }

        const task = taskResult.value;

        if (task === null) {
          return await handleNewTask(deps, event, logger);
        }

        const existingResult = await handleExistingTask(deps, event, task, logger);

        // If the existing task is stale (worker says "not found"), fall back to creating a new task
        if (!existingResult.success && isStaleTaskError(existingResult)) {
          logger.info(
            { staleTaskId: task.id, prNumber: event.pullRequestNumber },
            'Existing task is stale on worker, falling back to new task creation'
          );
          return await handleNewTask(deps, event, logger);
        }

        return existingResult;
      } catch (error) {
        const errorMessage = getErrorMessage(error, 'Unknown error');
        logger.error(
          { prNumber: event.pullRequestNumber, repo: event.repository, error: errorMessage },
          'Unexpected error in dispatch workflow'
        );
        return { success: false, dispatched: false, error: `Unexpected error: ${errorMessage}` };
      }
    },
  };
}

/**
 * Detect when a dispatch failure indicates the task is stale and no longer reachable.
 * Two scenarios: (1) task_not_found — task was found by PR lookup but deleted before
 * message send (Firestore-level race), (2) worker_error with "Task not found" — task
 * completed/crashed and was cleaned up on the worker but Firestore still has a record.
 *
 * Checks the structured error code first (preferred), then falls back to message
 * matching for worker_error responses where the code is generic.
 */
export function isStaleTaskError(result: WebhookDispatchResult): boolean {
  if (result.errorCode === 'task_not_found') return true;
  if (result.errorCode === 'worker_error' && result.error !== undefined) {
    return result.error.includes('Task not found') || result.error.includes('HTTP 404');
  }
  return false;
}

async function handleNewTask(
  deps: WebhookDispatchServiceDeps,
  event: GitHubPREvent,
  logger: Logger,
): Promise<WebhookDispatchResult> {
  if (deps.userLookupService === undefined) {
    logger.warn({ repo: event.repository, prNumber: event.pullRequestNumber }, 'UserLookupService not configured, cannot create task');
    return { success: false, dispatched: false, error: 'UserLookupService not configured' };
  }

  // Resolve baseBranch from stored PR events when not in the current event
  // (issue_comment payloads don't include base branch)
  let resolvedBaseBranch = event.baseBranch;
  if (resolvedBaseBranch === null) {
    const eventsResult = await deps.gitHubPREventRepo.findByPullRequest(
      event.repository, event.pullRequestNumber
    );
    if (eventsResult.ok) {
      const eventWithBranch = eventsResult.value.find(e => e.baseBranch !== null); // @allow-result-access -- narrowed by eventsResult.ok
      if (eventWithBranch !== undefined) {
        resolvedBaseBranch = eventWithBranch.baseBranch;
        logger.info(
          { baseBranch: resolvedBaseBranch, sourceEventId: eventWithBranch.id },
          'Resolved baseBranch from stored PR event'
        );
      }
    }
  }

  // Extract @worker/@model directive from comment
  const workerType = extractDispatchWorkerType(event.body ?? '');
  if (workerType !== undefined) {
    logger.info({ workerType, prNumber: event.pullRequestNumber }, 'Extracted worker type from comment');
  }

  // Use messageBuilder for pull_request_review events to apply template routing
  // (e.g. code-worker reviews → nitpick-nuker template)
  const comment = event.eventType === 'pull_request_review'
    ? deps.messageBuilder.build(event)
    : event.body ?? '';

  const createResult = await createTaskForPR(
    {
      logger,
      codeTaskRepo: deps.codeTaskRepo,
      userLookupService: deps.userLookupService,
      linearIssueService: deps.linearIssueService,
      taskEnqueueService: deps.taskEnqueueService,
      whatsappNotifier: deps.whatsappNotifier,
      orchestratorSecret: deps.orchestratorSecret,
      gitHubPRClient: deps.gitHubPRClient,
      userServiceClient: deps.userServiceClient,
      firestore: deps.firestore,
      automationLog: deps.automationLog,
    },
    {
      repository: event.repository,
      prNumber: event.pullRequestNumber,
      senderLogin: resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
      comment,
      eventId: event.id,
      ...(event.title !== null && { prTitle: event.title }),
      ...(resolvedBaseBranch !== null && { baseBranch: resolvedBaseBranch }),
      ...(workerType !== undefined && { workerType }),
    },
  );

  if (!createResult.ok) {
    logger.error(
      { repo: event.repository, prNumber: event.pullRequestNumber, error: createResult.error },
      'Failed to create task for PR'
    );
    return { success: false, dispatched: false, error: createResult.error.message };
  }

  logger.info(
    { repo: event.repository, prNumber: event.pullRequestNumber, taskId: createResult.value.taskId },
    'Created and dispatched new task from webhook'
  );
  return { success: true, dispatched: true, taskId: createResult.value.taskId };
}

async function handleExistingTask(
  deps: WebhookDispatchServiceDeps,
  event: GitHubPREvent,
  task: { id: string; userId: string; linearIssueId?: string },
  logger: Logger,
): Promise<WebhookDispatchResult> {
  const message = deps.messageBuilder.build(event);

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
      taskId: task.id,
      userId: task.userId,
      message,
    },
  );

  if (!sendResult.ok) {
    // Queue retry for retryable errors
    if (isRetryableErrorCode(sendResult.error.code) && deps.dispatchRetryRepo !== undefined) {
      const retryConfig = loadConfig();
      await deps.dispatchRetryRepo.create({
        type: 'task_message',
        eventId: event.id,
        repository: event.repository,
        pullRequestNumber: event.pullRequestNumber,
        senderLogin: event.senderLogin,
        taskId: task.id,
        userId: task.userId,
        message,
        attempts: 0,
        maxAttempts: retryConfig.retryQueue.maxAttempts,
        lastError: sendResult.error.message,
        ttlMinutes: retryConfig.retryQueue.ttlMinutes,
      });
      logger.info({ taskId: task.id }, 'Message delivery failed, queued for retry');
      return { success: true, dispatched: true, taskId: task.id };
    }
    // Non-retryable: existing behavior
    logger.error(
      { taskId: task.id, error: sendResult.error },
      'Failed to send message to task'
    );
    return { success: false, dispatched: false, taskId: task.id, error: sendResult.error.message, errorCode: sendResult.error.code };
  }

  deps.automationLog.record(
    { repository: event.repository, prNumber: event.pullRequestNumber },
    {
      type: 'task_dispatched',
      taskId: task.id,
      workerType: 'auto',
      agentType: 'pull_request',
      ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    },
    task.userId,
  ).catch((error: unknown) => {
    logger.warn({ error, taskId: task.id }, 'Failed to record automation log for existing task dispatch');
  });

  logger.info(
    { taskId: task.id, action: sendResult.value.action },
    'Dispatched webhook event to existing task'
  );
  return { success: true, dispatched: true, taskId: task.id };
}
