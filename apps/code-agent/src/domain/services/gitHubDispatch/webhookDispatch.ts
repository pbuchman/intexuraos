import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import { createTaskForPR } from '../../usecases/createTaskForPR.js';
import { extractDispatchWorkerType } from '../../utils/dispatchWorkerTriage.js';
import {
  destroyPreservedContainer,
  resolveLoginForTaskCreation,
  reusePreservedContainer,
} from './prTaskHelpers.js';
import type { DispatchContext, WebhookDispatchResult, WebhookDispatchServiceDeps } from './types.js';

/**
 * Execute the webhook dispatch workflow: every PR webhook event creates a
 * fresh pull_request task. Reusing a prior task caused RESUME_ATTEMPT_FAILED
 * when continueSession=true was attempted on a completed session.
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

    const workerDirective = extractDispatchWorkerType(event.body ?? '');
    return await handleNewTask(deps, event, logger, workerDirective);
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
