import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { RuleOutcome } from './gitHubWebhookRules.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { UserLookupService } from '../ports/userLookupService.js';
import type { LinearIssueService } from './linearIssueService.js';
import type { TaskDispatcherService } from './taskDispatcher.js';
import type { WhatsAppNotifier } from './whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { StatusMirrorService } from './statusMirrorService.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WebhookMessageBuilder } from './gitHubMessageBuilder.js';
import { createTaskForPR } from '../usecases/createTaskForPR.js';
import { sendTaskMessage } from '../usecases/sendTaskMessage.js';

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
}

export interface WebhookDispatchService {
  dispatch(context: DispatchContext): Promise<WebhookDispatchResult>;
}

export interface WebhookDispatchServiceDeps {
  codeTaskRepo: CodeTaskRepository;
  logLineRepo: LogLineRepository;
  userLookupService?: UserLookupService;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
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
}

function resolveLoginForTaskCreation(senderLogin: string, repository: string, allowedBots: Set<string>): string {
  if (!allowedBots.has(senderLogin)) return senderLogin;
  const slashIndex = repository.indexOf('/');
  if (slashIndex <= 0) return senderLogin;
  return repository.slice(0, slashIndex);
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

        const taskResult = await deps.codeTaskRepo.findByPR(event.repository, event.pullRequestNumber);

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

        return await handleExistingTask(deps, event, task, logger);
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

async function handleNewTask(
  deps: WebhookDispatchServiceDeps,
  event: GitHubPREvent,
  logger: Logger,
): Promise<WebhookDispatchResult> {
  if (deps.userLookupService === undefined) {
    logger.warn({ repo: event.repository, prNumber: event.pullRequestNumber }, 'UserLookupService not configured, cannot create task');
    return { success: false, dispatched: false, error: 'UserLookupService not configured' };
  }

  const createResult = await createTaskForPR(
    {
      logger,
      codeTaskRepo: deps.codeTaskRepo,
      userLookupService: deps.userLookupService,
      linearIssueService: deps.linearIssueService,
      taskDispatcher: deps.taskDispatcher,
      whatsappNotifier: deps.whatsappNotifier,
      orchestratorSecret: deps.orchestratorSecret,
      serviceUrl: deps.serviceUrl,
      gitHubPRClient: deps.gitHubPRClient,
      userServiceClient: deps.userServiceClient,
      firestore: deps.firestore,
    },
    {
      repository: event.repository,
      prNumber: event.pullRequestNumber,
      senderLogin: resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
      comment: event.body ?? '',
      eventId: event.id,
      ...(event.title !== null && { prTitle: event.title }),
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
  task: { id: string; userId: string },
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
    logger.error(
      { taskId: task.id, error: sendResult.error },
      'Failed to send message to task'
    );
    return { success: false, dispatched: false, taskId: task.id, error: sendResult.error.message };
  }

  logger.info(
    { taskId: task.id, action: sendResult.value.action },
    'Dispatched webhook event to existing task'
  );
  return { success: true, dispatched: true, taskId: task.id };
}
