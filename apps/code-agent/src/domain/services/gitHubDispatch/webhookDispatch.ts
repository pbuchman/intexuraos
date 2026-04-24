import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import { createTaskForPR } from '../../usecases/createTaskForPR.js';
import { sendTaskMessage } from '../../usecases/sendTaskMessage.js';
import { isRetryableErrorCode } from '../../utils/retryableErrors.js';
import { loadConfig } from '../../../config.js';
import { extractDispatchWorkerType } from '../../utils/dispatchWorkerTriage.js';
import {
  destroyPreservedContainer,
  isStaleTaskError,
  resolveLoginForTaskCreation,
  reusePreservedContainer,
} from './prTaskHelpers.js';
import type { DispatchContext, WebhookDispatchResult, WebhookDispatchServiceDeps } from './types.js';

/**
 * Execute the webhook dispatch workflow: route a validated PR event either to
 * an existing running task (via message) or to a newly-created task.
 */
export async function executeWebhookDispatch(
  deps: WebhookDispatchServiceDeps,
  context: DispatchContext,
): Promise<WebhookDispatchResult> {
  const { event, logger } = context;

  try {
    logger.info(
      { prNumber: event.pullRequestNumber, repo: event.repository, action: event.action },
      'Starting GitHub dispatch workflow'
    );

    // Extract @worker directive if present; will be passed to pull_request task creation.
    // Note: if an existing task is already executing for this PR, the @worker directive
    // is intentionally ignored — the comment is sent as a message to the running task
    // rather than creating a competing task.
    const workerDirective = extractDispatchWorkerType(event.body ?? '');

    // Use non-review lookup to avoid routing generic comments into review tasks
    const taskResult = await deps.codeTaskRepo.findLatestExecutionTaskByPR(event.repository, event.pullRequestNumber);

    if (!taskResult.ok) {
      logger.error(
        { prNumber: event.pullRequestNumber, repo: event.repository, error: taskResult.error },
        'Failed to find task for PR'
      );
      return { success: false, dispatched: false, error: `Failed to find task: ${taskResult.error.message}` };
    }

    const task = taskResult.value;

    if (task === null) {
      return await handleNewTask(deps, event, logger, workerDirective);
    }

    // Guard: PR is closed or merged — existing task context is stale
    if (event.state === 'closed' || event.mergedAt !== null) {
      logger.info(
        {
          staleTaskId: task.id,
          prNumber: event.pullRequestNumber,
          prState: event.state,
          merged: event.mergedAt !== null,
        },
        'PR is closed/merged — skipping existing task, creating new task'
      );
      return await handleNewTask(deps, event, logger, workerDirective);
    }

    const existingResult = await handleExistingTask(deps, event, task, logger);

    // If the existing task is stale (worker says "not found"), fall back to creating a new task
    if (!existingResult.success && isStaleTaskError(existingResult)) {
      logger.info(
        { staleTaskId: task.id, prNumber: event.pullRequestNumber },
        'Existing task is stale on worker, falling back to new task creation'
      );
      return await handleNewTask(deps, event, logger, workerDirective);
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
}

async function handleNewTask(
  deps: WebhookDispatchServiceDeps,
  event: GitHubPREvent,
  logger: Logger,
  workerType?: import('../../models/codeTask.js').WorkerType,
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

  // Use messageBuilder for pull_request_review events to apply template routing
  const comment = event.eventType === 'pull_request_review'
    ? deps.messageBuilder.build(event)
    : event.body ?? '';

  // Look up any preserved container for this PR once — used in both branches below.
  const preservedResult = await deps.codeTaskRepo.findPreservedPullRequestTask(
    event.repository,
    event.pullRequestNumber,
  );
  const preserved = preservedResult.ok ? preservedResult.value : null;

  // When @worker directive is present, destroy any preserved container first (best-effort).
  // The user's intent is a fresh agent with a specific model — failing to destroy the old
  // one should not block creating the new task.
  if (workerType !== undefined && preserved !== null) {
    logger.info(
      { taskId: preserved.id, prNumber: event.pullRequestNumber },
      'Destroying preserved container for @worker directive',
    );
    await destroyPreservedContainer(deps, preserved, logger);
  }

  // Check for preserved pull_request container to reuse (non-@worker comments only)
  if (workerType === undefined && preserved !== null) {
    const reuseResult = await reusePreservedContainer(deps, preserved, comment, logger);
    if (reuseResult !== null) {
      logger.info(
        { taskId: preserved.id, prNumber: event.pullRequestNumber },
        'Reused preserved container for PR comment',
      );
      return reuseResult;
    }
  }

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
      workerSettingsRepo: deps.workerSettingsRepo,
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
