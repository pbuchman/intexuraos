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

/**
 * Context for CI failure dispatch.
 */
export interface CIFailureDispatchContext {
  event: GitHubPREvent;
  logger: Logger;
}

export interface CIFailureDispatchResult {
  success: boolean;
  fixTaskCreated: boolean;
  parentTaskId?: string;
  fixTaskId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface CIFailureDispatchService {
  dispatchCIFailure(context: CIFailureDispatchContext): Promise<CIFailureDispatchResult>;
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

export function createWebhookDispatchService(deps: WebhookDispatchServiceDeps): WebhookDispatchService & CIFailureDispatchService {
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

    async dispatchCIFailure(context: CIFailureDispatchContext): Promise<CIFailureDispatchResult> {
      const { event, logger } = context;

      try {
        logger.info(
          { prNumber: event.pullRequestNumber, repo: event.repository, eventType: event.eventType },
          'Starting CI failure dispatch workflow'
        );

        // Find the original task that created this PR
        const taskResult = await deps.codeTaskRepo.findLatestNonReviewTaskByPR(event.repository, event.pullRequestNumber);

        if (!taskResult.ok) {
          logger.error(
            { prNumber: event.pullRequestNumber, repo: event.repository, error: taskResult.error },
            'Failed to find original task for CI failure'
          );
          return { success: false, fixTaskCreated: false, error: `Failed to find task: ${taskResult.error.message}` };
        }

        const originalTask = taskResult.value;

        if (originalTask === null) {
          logger.info(
            { prNumber: event.pullRequestNumber, repo: event.repository },
            'No original task found for CI failure, skipping'
          );
          return { success: true, fixTaskCreated: false, skipped: true, skipReason: 'no_original_task' };
        }

        // Check loop prevention: has a ci_failure follow-up already been created?
        // Check if parentTaskId chain depth > 1 for ci_failure follow-ups
        if (originalTask.followUpReason === 'ci_failure' || originalTask.parentTaskId !== undefined) {
          logger.info(
            { taskId: originalTask.id, prNumber: event.pullRequestNumber },
            'CI failure follow-up already exists or task is already a follow-up, skipping'
          );
          return { success: true, fixTaskCreated: false, skipped: true, skipReason: 'already_follow_up' };
        }

        // Extract CI failure details from payload
        const payload = event.payload as Record<string, unknown> | null;
        const checkName = typeof payload?.['checkName'] === 'string' ? payload['checkName'] : 'Unknown Check';
        const headBranch = event.baseBranch ?? 'unknown';
        const headSha = typeof payload?.['headSha'] === 'string' ? payload['headSha'] : 'unknown';
        const checkSuiteId = typeof payload?.['checkSuiteId'] === 'number' ? payload['checkSuiteId'] : 0;
        const checkRunUrl = typeof payload?.['checkRunUrl'] === 'string' ? payload['checkRunUrl'] : undefined;

        // Record ci_failure_detected in automation log
        const prUrl = `https://github.com/${event.repository}/pull/${String(event.pullRequestNumber)}`;
        await deps.automationLog.record(
          { repository: event.repository, prNumber: event.pullRequestNumber },
          {
            type: 'ci_failure_detected',
            checkName,
            conclusion: 'failure',
            headBranch,
            headSha,
            checkSuiteId,
            prUrl,
          },
          originalTask.userId,
        ).catch((error: unknown) => {
          logger.warn({ error }, 'Failed to record ci_failure_detected in automation log');
        });

        // Build follow-up task prompt
        const fixPrompt = buildCIFixPrompt({
          repository: event.repository,
          prNumber: event.pullRequestNumber,
          prUrl,
          checkName,
          branch: headBranch,
          headSha,
        });

        // Create follow-up task
        const createInput: {
          id: string;
          userId: string;
          prompt: string;
          sanitizedPrompt: string;
          systemPromptHash: string;
          workerType: typeof originalTask.workerType;
          workerLocation: string;
          repository: string;
          baseBranch: string;
          traceId: string;
          parentTaskId: string;
          followUpReason: 'ci_failure';
          agentType: 'pull_request';
          initialStatus: 'queued';
          prNumber: number;
          prBranch?: string;
          linearIssueId?: string;
        } = {
          id: `fix-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
          userId: originalTask.userId,
          prompt: fixPrompt,
          sanitizedPrompt: fixPrompt,
          systemPromptHash: 'ci-fix-task',
          workerType: originalTask.workerType,
          workerLocation: originalTask.workerLocation,
          repository: event.repository,
          baseBranch: event.baseBranch ?? originalTask.baseBranch,
          traceId: `ci-fix-${event.id}`,
          parentTaskId: originalTask.id,
          followUpReason: 'ci_failure',
          agentType: 'pull_request',
          initialStatus: 'queued',
          prNumber: event.pullRequestNumber,
          ...(event.baseBranch !== null && { prBranch: event.baseBranch }),
          ...(originalTask.linearIssueId !== undefined && { linearIssueId: originalTask.linearIssueId }),
        };

        const createResult = await deps.codeTaskRepo.create(createInput);

        if (!createResult.ok) {
          logger.error(
            { error: createResult.error, originalTaskId: originalTask.id },
            'Failed to create CI fix follow-up task'
          );
          return { success: false, fixTaskCreated: false, error: `Failed to create task: ${createResult.error.message}` };
        }

        const fixTaskId = createResult.value.id;

        // Record fix_task_dispatched in automation log
        await deps.automationLog.record(
          { repository: event.repository, prNumber: event.pullRequestNumber },
          {
            type: 'fix_task_dispatched',
            parentTaskId: originalTask.id,
            fixTaskId,
            checkName,
          },
          originalTask.userId,
        ).catch((error: unknown) => {
          logger.warn({ error }, 'Failed to record fix_task_dispatched in automation log');
        });

        // Enqueue the fix task
        await deps.taskEnqueueService.enqueue({ taskId: fixTaskId, userId: originalTask.userId }).catch((error: unknown) => {
          logger.warn({ error, fixTaskId }, 'Failed to enqueue CI fix task');
        });

        // Send WhatsApp notification
        await deps.whatsappNotifier.notifyCIFailure(originalTask.userId, {
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          prUrl,
          checkName,
          branch: headBranch,
          taskId: originalTask.id,
          ...(checkRunUrl !== undefined && { runUrl: checkRunUrl }),
        }).catch((error: unknown) => {
          logger.warn({ error }, 'Failed to send CI failure WhatsApp notification');
        });

        logger.info(
          { originalTaskId: originalTask.id, fixTaskId, prNumber: event.pullRequestNumber },
          'CI failure follow-up task created'
        );

        return {
          success: true,
          fixTaskCreated: true,
          parentTaskId: originalTask.id,
          fixTaskId,
        };
      } catch (error) {
        const errorMessage = getErrorMessage(error, 'Unknown error');
        logger.error(
          { prNumber: event.pullRequestNumber, repo: event.repository, error: errorMessage },
          'Unexpected error in CI failure dispatch workflow'
        );
        return { success: false, fixTaskCreated: false, error: `Unexpected error: ${errorMessage}` };
      }
    },
  };
}

/**
 * Build the prompt for a CI fix follow-up task.
 */
function buildCIFixPrompt(input: {
  repository: string;
  prNumber: number;
  prUrl: string;
  checkName: string;
  branch: string;
  headSha: string;
}): string {
  return `## CI Failure Fix Task

### Context
A CI check failed on your agent's Pull Request.

### PR Details
- Repository: ${input.repository}
- PR Number: #${String(input.prNumber)}
- PR URL: ${input.prUrl}
- Branch: ${input.branch}
- Commit: ${input.headSha}

### Failing Check
${input.checkName}

### Instructions
1. First, check the GitHub Actions run to understand what failed:
   - Visit: ${input.prUrl}/checks
   - Look at the failing check's logs

2. The most common cause is coverage failures from missing test exemptions.
   If you see "uncovered branch" errors, add v8 ignore comments with valid exemptions.

3. Fix the issue in your code:
   - If it's a coverage issue, add v8 ignore comments with valid exemptions
   - If it's a lint error, fix the linting issues
   - If it's a type error, fix the TypeScript types

4. After fixing, run \`pnpm run ci:tracked\` locally to verify

5. Commit and push your fix

### Important Reminders
- Only fix the CI failure issue - do not make unrelated changes
- Add proper v8 ignore exemptions with specific categories and explanations
- Ensure all existing tests still pass
`;
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
