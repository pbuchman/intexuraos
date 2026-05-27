/**
 * Service wiring for code-agent. Thin DI composer.
 *
 * Interfaces live in `./services/types.ts`. Heavy construction logic lives
 * in `./services/factories/*`. This file only composes the final container.
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { createTaskDispatcherService } from './infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from './infra/services/whatsappNotifierImpl.js';
import { createLinearIssueService } from './domain/services/linearIssueService.js';
import { createStatusMirrorService } from './infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from './domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from './domain/usecases/detectZombieTasks.js';
import { createArchiveStaleGroupsUseCase } from './domain/usecases/archiveStaleGroups.js';
import { createAutoArchiveMergedTasksUseCase } from './domain/usecases/autoArchiveMergedTasks.js';
import { createMetricsClient, createNoOpMetricsClient } from './infra/metrics.js';
import { createWorkerHealthProbe } from './infra/services/workerHealthProbe.js';
import { createUserLookupService } from './infra/services/userLookupServiceImpl.js';
import { createGitHubUsernameResolver } from './infra/services/gitHubUsernameResolverImpl.js';
import { ActionableEventRule, CIFailureRule, CodeWorkerOutputRule, DraftPRRule, ProtectedBaseBranchRule, SenderWhitelistRule, SkipPrefixRule, createWebhookRulesService } from './domain/services/gitHubWebhookRules.js';
import { createWebhookDispatchService, type CIFailureDispatchService, type WebhookDispatchService } from './domain/services/gitHubDispatchService.js';
import { createWebhookMessageBuilder } from './domain/services/gitHubMessageBuilder.js';
import { ALLOWED_BOTS, CODE_WORKER_BOTS } from './domain/constants/gitHubBots.js';
import { createUnifiedEvaluator } from './domain/services/unifiedEvaluator.js';
import { evaluateEvent, type GitHubAgentEvalResult, type GitHubAgentError } from './domain/usecases/githubAgent.js';
import type { GitHubPREvent } from './domain/models/gitHubPREvent.js';
import { createReviewTask } from './domain/usecases/createReviewTask.js';
import { createRemediationTask, type CreateRemediationTaskError, type CreateRemediationTaskRequest, type CreateRemediationTaskResult } from './domain/usecases/createRemediationTask.js';
import { createDetectMergeConflictsOnPush } from './domain/usecases/detectMergeConflictsOnPush.js';
import { fetchGitHubToken } from './domain/utils/gitHubTokenResolver.js';
import { createGitHubPRAutomationLog } from './infra/services/gitHubPRAutomationLog.js';
import { createTaskEnqueueService } from './infra/services/taskEnqueueServiceImpl.js';
import { createUnauthorizedSenderCommentHandler } from './domain/services/unauthorizedSenderCommentHandler.js';
import { createOnReviewSkippedCallback } from './domain/services/onReviewSkippedCallback.js';
import { createE2EMocks } from './services/factories/e2eMocks.js';
import { createRepositoryServices } from './services/factories/repositoryFactory.js';
import { createPublisherServices } from './services/factories/publisherFactory.js';
import { createClientServices } from './services/factories/clientFactory.js';
import { createLlmServices } from './services/factories/llmFactory.js';
import type { ServiceConfig, ServiceContainer } from './services/types.js';

export type { ServiceConfig, ServiceContainer } from './services/types.js';

let container: ServiceContainer | null = null;

/**
 * Initialize services with config. Call before getServices().
 */
export function initServices(config: ServiceConfig): void {
  const firestore = getFirestore();
  const logger = createAppLogger({ name: 'code-agent' });
  const isE2eMode = process.env['E2E_MODE'] === 'true';
  if (isE2eMode) logger.info('Initializing services in E2E mode with mock external services');

  const e2eMocks = createE2EMocks(logger);
  const repos = createRepositoryServices({ firestore, logger });
  const { whatsappPublisher, prTriagePublisher } = createPublisherServices({ config, isE2eMode, e2eMocks, logger });
  const { linearAgentClient, actionsAgentClient, userServiceClient, usageServiceClient, gitHubPRClient, buildUsageSink } =
    createClientServices({ config, logger, isE2eMode, e2eMocks });
  const { resolveToolCallingClient, executionMemoryEmbeddingClient } = createLlmServices({ config, logger, userServiceClient, buildUsageSink });

  const enableMetrics = process.env['INTEXURAOS_ENABLE_METRICS'] === 'true';
  const metricsClient = isE2eMode || !enableMetrics ? createNoOpMetricsClient() : createMetricsClient();
  const workerHealthProbe = createWorkerHealthProbe();
  const taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe });
  const whatsappNotifier = createWhatsAppNotifier({
    whatsappPublisher,
    linearAgentClient,
    webAppUrl: config.webAppUrl,
  });
  const linearIssueService = createLinearIssueService({ linearAgentClient, logger });
  const statusMirrorService = createStatusMirrorService({ actionsAgentClient, logger });
  const userLookupService = createUserLookupService({
    gitHubUsernameResolver: createGitHubUsernameResolver({ userServiceClient, logger }),
    workerSettingsRepo: repos.workerSettingsRepo,
    logger,
  });
  const automationLog = createGitHubPRAutomationLog({
    gitHubPRClient, prAutomationCommentRepo: repos.prAutomationCommentRepo,
    resolveOAuthToken: async (userId) => await fetchGitHubToken(userServiceClient, userId, logger),
    userServiceClient, logger,
  });

  const webhookRules = createWebhookRulesService([
    // Note: RepositoryScopeRule is NOT included here because the route handler
    // already filters via shouldProcessRepository() which correctly handles
    // both intexuraos/* and */intexuraos patterns. Adding it here would be
    // redundant and risks scope mismatch (see PR #997 review).
    new CodeWorkerOutputRule(CODE_WORKER_BOTS),
    // DraftPRRule must come before CIFailureRule and ActionableEventRule
    // to block ALL code-tasks on draft PRs before any dispatch/triage cost.
    new DraftPRRule(),
    // CIFailureRule must come BEFORE ActionableEventRule to catch check_suite
    // events before ActionableEventRule short-circuits with "skip" (check_suite
    // is not in ActionableEventRule's list of known event types).
    new CIFailureRule(),
    new ActionableEventRule(ALLOWED_BOTS),
    new ProtectedBaseBranchRule(),
    new SenderWhitelistRule(ALLOWED_BOTS),
    new SkipPrefixRule(['@claude', '@codex', '@ignore']),
    // Note: BotReviewEditRule is NOT included here because it introduces
    // new "meaningful changes" filtering not present in the original code.
    // The original dispatched all edited bot comments without payload inspection.
  ]);

  const taskEnqueueService = createTaskEnqueueService({ logger: logger.child({ service: 'task-enqueue' }), codeTaskRepo: repos.codeTaskRepo });

  const mergeConflictDetector = createDetectMergeConflictsOnPush({
    logger, gitHubPRClient, gitHubPRSummaryRepo: repos.gitHubPRSummaryRepo, codeTaskRepo: repos.codeTaskRepo,
    userServiceClient, gitHubPREventRepo: repos.gitHubPREventRepo, linearIssueService, taskDispatcher,
    taskEnqueueService, logLineRepo: repos.logLineRepo, workerSettingsRepo: repos.workerSettingsRepo,
    statusMirrorService, whatsappNotifier, allowedBots: ALLOWED_BOTS, orchestratorSecret: config.orchestratorSecret,
  });

  const dispatchService: WebhookDispatchService & CIFailureDispatchService = createWebhookDispatchService({
    gitHubPREventRepo: repos.gitHubPREventRepo, codeTaskRepo: repos.codeTaskRepo, logLineRepo: repos.logLineRepo,
    userLookupService, linearIssueService, taskDispatcher, taskEnqueueService, whatsappNotifier,
    workerSettingsRepo: repos.workerSettingsRepo, statusMirrorService, gitHubPRClient, userServiceClient,
    firestore, messageBuilder: createWebhookMessageBuilder(ALLOWED_BOTS), allowedBots: ALLOWED_BOTS,
    orchestratorSecret: config.orchestratorSecret, serviceUrl: config.serviceUrl,
    dispatchRetryRepo: repos.dispatchRetryRepo, automationLog,
  });

  const unifiedEvaluator = createUnifiedEvaluator({
    webhookRules, dispatchService, ciFailureDispatchService: dispatchService,
    eventDecisionRepo: repos.eventDecisionRepo, gitHubEventLogEntryRepo: repos.gitHubEventLogEntryRepo,
    evaluateEvent: (event: GitHubPREvent, correctionContext?: string): Promise<Result<GitHubAgentEvalResult, GitHubAgentError>> =>
      evaluateEvent({ logger, gitHubPRClient, resolveToolCallingClient, userServiceClient, allowedBots: ALLOWED_BOTS }, event, correctionContext),
    createReviewTask: (taskLogger, request) => createReviewTask({
      logger: taskLogger, codeTaskRepo: repos.codeTaskRepo, userLookupService, taskDispatcher, taskEnqueueService,
      linearAgentClient, gitHubPRClient, userServiceClient, workerSettingsRepo: repos.workerSettingsRepo,
      orchestratorSecret: config.orchestratorSecret, automationLog, gitHubPRSummaryRepo: repos.gitHubPRSummaryRepo,
    }, request),
    automationLog,
    resolveTokenUserId: async (senderLogin) => {
      const userResult = await userServiceClient.resolveGitHubUsername(senderLogin);
      if (!userResult.ok) return undefined;
      const resolvedUser = userResult.value; // @allow-result-access -- narrowed by !userResult.ok
      if (resolvedUser === null) return undefined;
      return resolvedUser.userId;
    },
    allowedBots: ALLOWED_BOTS, codeTaskRepo: repos.codeTaskRepo,
    onReviewSkipped: createOnReviewSkippedCallback({ codeTaskRepo: repos.codeTaskRepo, linearAgentClient, automationLog, groupSummaryRepo: repos.groupSummaryRepo, logger }),
    onUnauthorizedSender: createUnauthorizedSenderCommentHandler({ gitHubPRClient, userServiceClient, logger }),
  });

  container = {
    firestore, logger, serviceUrl: config.serviceUrl,
    codeTaskRepo: repos.codeTaskRepo, logChunkRepo: repos.logChunkRepo, logLineRepo: repos.logLineRepo,
    taskDispatcher, whatsappNotifier, actionsAgentClient, linearAgentClient, statusMirrorService, linearIssueService,
    processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: repos.codeTaskRepo, logger }),
    detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: repos.codeTaskRepo, logger }),
    archiveStaleGroups: createArchiveStaleGroupsUseCase({
      codeTaskRepository: repos.codeTaskRepo,
      gitHubPRSummaryRepo: repos.gitHubPRSummaryRepo,
      logger,
    }),
    autoArchiveMergedTasks: createAutoArchiveMergedTasksUseCase({ codeTaskRepository: repos.codeTaskRepo, logger }),
    metricsClient, workerSettingsRepo: repos.workerSettingsRepo, workerHealthProbe,
    gitHubPREventRepo: repos.gitHubPREventRepo, gitHubPRSummaryRepo: repos.gitHubPRSummaryRepo,
    gitHubWebhookAuditEventRepo: repos.gitHubWebhookAuditEventRepo,
    gitHubEventLogEntryRepo: repos.gitHubEventLogEntryRepo, turnMetricsRepo: repos.turnMetricsRepo,
    userServiceClient, gitHubPRClient, userLookupService, webhookRules, resolveToolCallingClient,
    dispatchService, eventDecisionRepo: repos.eventDecisionRepo, dispatchRetryRepo: repos.dispatchRetryRepo,
    unifiedEvaluator, prTriagePublisher, mergeConflictDetector, automationLog, taskEnqueueService,
    mergeQueueWatchRepo: repos.mergeQueueWatchRepo, executionMemoryRepo: repos.executionMemoryRepo,
    executionMemoryApplicationRepo: repos.executionMemoryApplicationRepo,
    ...(executionMemoryEmbeddingClient !== undefined && { executionMemoryEmbeddingClient }),
    ...(usageServiceClient !== undefined && { usageServiceClient }),
    groupSummaryRepo: repos.groupSummaryRepo,
    createRemediationTaskFn: (taskLogger: Logger, request: CreateRemediationTaskRequest): Promise<Result<CreateRemediationTaskResult, CreateRemediationTaskError>> =>
      createRemediationTask({
        logger: taskLogger, codeTaskRepo: repos.codeTaskRepo, userLookupService, taskEnqueueService,
        workerSettingsRepo: repos.workerSettingsRepo, orchestratorSecret: config.orchestratorSecret, automationLog,
      }, request),
  };
}

/** Get the service container. Throws if initServices() wasn't called. */
export function getServices(): ServiceContainer {
  if (container === null) throw new Error('Service container not initialized. Call initServices() first.');
  return container;
}

/** Replace services for testing. Only use in tests. */
export function setServices(s: ServiceContainer): void { container = s; }

/** Reset services. Call in afterEach() in tests. */
export function resetServices(): void { container = null; }
