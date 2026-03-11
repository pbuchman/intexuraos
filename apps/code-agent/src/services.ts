/**
 * Service wiring for code-agent.
 * Provides dependency injection for domain adapters.
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import type { Logger } from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import { ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { TOOL_CALLING_PRICING } from '@intexuraos/infra-gemini';
import { createWhatsAppSendPublisher, type WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { LlmModels, type ToolCallingClient } from '@intexuraos/llm-contract';
import type { CodeTaskRepository } from './domain/repositories/codeTaskRepository.js';
import type { LogChunkRepository } from './domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from './domain/repositories/logLineRepository.js';
import type { TaskDispatcherService } from './domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from './domain/services/whatsappNotifier.js';
import type { ActionsAgentClient } from './infra/clients/actionsAgentClient.js';
import type { RateLimitService } from './domain/services/rateLimitService.js';
import type { WorkerSettingsRepository } from './domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from './domain/ports/workerHealthProbe.js';
import type { UserLookupService } from './domain/ports/userLookupService.js';
import { createFirestoreCodeTaskRepository } from './infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from './infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from './infra/repositories/firestoreLogLineRepository.js';
import { createTaskDispatcherService } from './infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from './infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient } from './infra/clients/actionsAgentClient.js';
import { createUserUsageFirestoreRepository } from './infra/firestore/userUsageFirestoreRepository.js';
import { createRateLimitService } from './domain/services/rateLimitService.js';
import { createLinearAgentHttpClient } from './infra/http/linearAgentHttpClient.js';
import { createLinearIssueService, type LinearIssueService } from './domain/services/linearIssueService.js';
import type { LinearAgentClient } from './domain/ports/linearAgentClient.js';
import { createStatusMirrorService, type StatusMirrorService } from './infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase, type ProcessHeartbeatUseCase } from './domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase, type DetectZombieTasksUseCase } from './domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase, type CleanupTaskLogsUseCase } from './domain/usecases/cleanupTaskLogs.js';
import { createMetricsClient, createNoOpMetricsClient, type MetricsClient } from './infra/metrics.js';
import { createWorkerSettingsRepository } from './infra/firestore/workerSettingsRepository.js';
import { createWorkerHealthProbe } from './infra/services/workerHealthProbe.js';
import { createUserLookupService } from './infra/services/userLookupServiceImpl.js';
import type { GitHubPREventRepository } from './domain/repositories/gitHubPREventRepository.js';
import { createFirestoreGitHubPREventsRepository } from './infra/firestore/gitHubPREventsRepository.js';
import type { TurnMetricsRepository } from './domain/repositories/turnMetricsRepository.js';
import { createFirestoreTurnMetricsRepository } from './infra/repositories/firestoreTurnMetricsRepository.js';
import type { GitHubPRSummaryRepository } from './domain/repositories/gitHubPRSummaryRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from './infra/firestore/gitHubPRSummariesRepository.js';
import type { GitHubPRClient } from './domain/ports/gitHubPRClient.js';
import { createGitHubPRHttpClient } from './infra/http/gitHubPRHttpClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { createGitHubUsernameResolver } from './infra/services/gitHubUsernameResolverImpl.js';
import { CodeWorkerOutputRule, ActionableEventRule, ProtectedBaseBranchRule, SenderWhitelistRule, SkipPrefixRule, createWebhookRulesService, type WebhookRulesService } from './domain/services/gitHubWebhookRules.js';
import { createWebhookDispatchService, type WebhookDispatchService } from './domain/services/gitHubDispatchService.js';
import { createWebhookMessageBuilder } from './domain/services/gitHubMessageBuilder.js';
import { ALLOWED_BOTS, CODE_WORKER_BOTS } from './routes/webhooks/github.js';
import { createToolCallingClient } from '@intexuraos/llm-factory';
import type { EventDecisionRepository } from './domain/repositories/eventDecisionRepository.js';
import { createFirestoreEventDecisionRepository } from './infra/firestore/eventDecisionRepository.js';
import type { DispatchRetryRepository } from './domain/repositories/dispatchRetryRepository.js';
import { createFirestoreDispatchRetryRepository } from './infra/firestore/dispatchRetryRepository.js';
import { createUnifiedEvaluator, type UnifiedEvaluator } from './domain/services/unifiedEvaluator.js';
import { evaluateEvent, type GitHubAgentEvalResult, type GitHubAgentError } from './domain/usecases/githubAgent.js';
import type { GitHubPREvent } from './domain/models/gitHubPREvent.js';
import { createReviewTask } from './domain/usecases/createReviewTask.js';

const GEMINI_TOOL_CALLING_MODEL = LlmModels.Gemini25Flash;
const GEMINI_TOOL_CALLING_PRICING = TOOL_CALLING_PRICING[LlmModels.Gemini25Flash];

export interface ServiceContainer {
  firestore: Firestore;
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  logChunkRepo: LogChunkRepository;
  logLineRepo: LogLineRepository;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  actionsAgentClient: ActionsAgentClient;
  linearAgentClient: LinearAgentClient;
  rateLimitService: RateLimitService;
  linearIssueService: LinearIssueService;
  statusMirrorService: StatusMirrorService;
  processHeartbeat: ProcessHeartbeatUseCase;
  detectZombieTasks: DetectZombieTasksUseCase;
  cleanupTaskLogs: CleanupTaskLogsUseCase;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  workerHealthProbe: WorkerHealthProbe;
  gitHubPREventRepo: GitHubPREventRepository;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  turnMetricsRepo: TurnMetricsRepository;
  userServiceClient: UserServiceClient;
  gitHubPRClient: GitHubPRClient;
  userLookupService?: UserLookupService;
  webhookRules: WebhookRulesService;
  dispatchService: WebhookDispatchService;
  // GitHub Agent (INT-743)
  toolCallingClient: ToolCallingClient | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
  // INT-744: Unified Webhook Evaluator
  eventDecisionRepo: EventDecisionRepository;
  dispatchRetryRepo: DispatchRetryRepository;
  unifiedEvaluator: UnifiedEvaluator;
}

// Configuration required to initialize services
export interface ServiceConfig {
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  whatsappSendTopic: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  webhookVerifySecret: string;
  orchestratorSecret: string;
  serviceUrl: string;
  userServiceUrl: string;
  // GitHub Agent (INT-743)
  geminiAppApiKey: string;
}

let container: ServiceContainer | null = null;

const isE2eMode = process.env['E2E_MODE'] === 'true';

/**
 * Create a no-op WhatsApp publisher for E2E testing.
 */
function createE2eWhatsAppPublisher(): WhatsAppSendPublisher {
  return {
    publishSendMessage(): ReturnType<WhatsAppSendPublisher['publishSendMessage']> {
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Create a no-op Linear agent client for E2E testing.
 */
function createE2eLinearAgentClient(logger: Logger): LinearAgentClient {
  return {
    createIssue(request): ReturnType<LinearAgentClient['createIssue']> {
      const issueNum = Date.now() % 10000;
      logger.info({ title: request.title }, '[E2E] Mock Linear issue creation');
      return Promise.resolve(ok({
        issueId: `INT-${String(issueNum)}`,
        issueIdentifier: `INT-${String(issueNum)}`,
        issueTitle: request.title,
        issueUrl: `https://linear.app/intexura/issue/INT-${String(issueNum)}`,
      }));
    },
    updateIssueState(request): ReturnType<LinearAgentClient['updateIssueState']> {
      logger.info({ issueId: request.issueId, state: request.state }, '[E2E] Mock Linear state update');
      return Promise.resolve(ok(undefined));
    },
    validateIssue(request): ReturnType<LinearAgentClient['validateIssue']> {
      logger.info({ identifier: request.identifier }, '[E2E] Mock Linear issue validation');
      return Promise.resolve(ok({
        id: `issue-${request.identifier}`,
        identifier: request.identifier,
        title: `Mock ${request.identifier}`,
        url: `https://linear.app/intexura/issue/${request.identifier}`,
        labels: [],
        childCount: 0,
        parentId: null,
      }));
    },
    generateTitle(request): ReturnType<LinearAgentClient['generateTitle']> {
      logger.info({ descriptionLength: request.description.length }, '[E2E] Mock title generation');
      return Promise.resolve(ok({
        title: request.description.slice(0, 80),
        issueType: 'feature',
      }));
    },
    addComment(request): ReturnType<LinearAgentClient['addComment']> {
      logger.info({ issueId: request.issueId }, '[E2E] Mock Linear comment addition');
      return Promise.resolve(ok({
        commentId: `comment-${String(Date.now())}`,
      }));
    },
    fetchIssueTree(request): ReturnType<LinearAgentClient['fetchIssueTree']> {
      logger.info({ issueId: request.issueId }, '[E2E] Mock Linear issue tree fetch');
      return Promise.resolve(ok({
        root: {
          id: request.issueId,
          identifier: `INT-${request.issueId}`,
          url: `https://linear.app/intexuraos/issue/${request.issueId}`,
          parentId: null,
          labels: [],
          assigneeId: null,
          state: 'Backlog',
        },
        descendants: [],
      }));
    },
    updateIssueMetadata(request): ReturnType<LinearAgentClient['updateIssueMetadata']> {
      logger.info(
        { issueId: request.issueId, addLabels: request.addLabels, removeLabels: request.removeLabels, assigneeId: request.assigneeId },
        '[E2E] Mock Linear metadata update'
      );
      return Promise.resolve(ok(undefined));
    },
    fetchIssueForDisplay(request): ReturnType<LinearAgentClient['fetchIssueForDisplay']> {
      logger.info({ identifier: request.identifier }, '[E2E] Mock Linear issue fetch for display');
      return Promise.resolve(ok({
        identifier: request.identifier,
        title: `Mock ${request.identifier}`,
        state: { name: 'In Progress', type: 'started' },
        priority: 2,
        assignee: null,
        labels: [],
        url: `https://linear.app/intexura/issue/${request.identifier}`,
        commentCount: 0,
        lastCommentAt: null,
      }));
    },
    fetchIssuesForDisplay(request): ReturnType<LinearAgentClient['fetchIssuesForDisplay']> {
      logger.info({ issueCount: request.identifiers.length }, '[E2E] Mock Linear issues fetch for display');
      return Promise.resolve(ok(
        request.identifiers.map((identifier) => ({
          identifier,
          title: `Mock ${identifier}`,
          state: { name: 'In Progress', type: 'started' as const },
          priority: 2,
          assignee: null,
          labels: [],
          url: `https://linear.app/intexura/issue/${identifier}`,
          commentCount: 0,
          lastCommentAt: null,
        }))
      ));
    },
  };
}

/**
 * Create a no-op actions agent client for E2E testing.
 */
function createE2eActionsAgentClient(logger: Logger): ActionsAgentClient {
  return {
    updateActionStatus(actionId, status): ReturnType<ActionsAgentClient['updateActionStatus']> {
      logger.info({ actionId, status }, '[E2E] Mock action status update');
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Initialize services with config. Call this early in server startup.
 * MUST be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  const firestore = getFirestore();
  const logger = createAppLogger({ name: 'code-agent' });

  if (isE2eMode) {
    logger.info('Initializing services in E2E mode with mock external services');
  }

  const linearAgentClient = isE2eMode
    ? createE2eLinearAgentClient(logger)
    : createLinearAgentHttpClient({
        baseUrl: config.linearAgentUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: 30000,
      }, logger);

  const linearIssueService = createLinearIssueService({
    linearAgentClient,
    logger,
  });

  const actionsAgentClient = isE2eMode
    ? createE2eActionsAgentClient(logger)
    : createActionsAgentClient({
        baseUrl: config.actionsAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger,
      });

  const metricsClient = isE2eMode ? createNoOpMetricsClient() : createMetricsClient();

  const whatsappPublisher = isE2eMode
    ? createE2eWhatsAppPublisher()
    : createWhatsAppSendPublisher({
        projectId: config.gcpProjectId,
        topicName: config.whatsappSendTopic,
        logger: createAppLogger({ name: 'whatsapp-publisher' }),
      });

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger,
    pricingContext: {
      getPricing() { throw new Error('code-agent does not use LLM pricing'); },
      hasPricing() { return false; },
      validateModels() { throw new Error('code-agent does not use LLM pricing'); },
      validateAllModels() { throw new Error('code-agent does not use LLM pricing'); },
      getModelsWithPricing() { return []; },
    },
  });

  const codeTaskRepo = createFirestoreCodeTaskRepository({ firestore, logger });
  const logLineRepo = createFirestoreLogLineRepository({ firestore, logger });
  const workerSettingsRepo = createWorkerSettingsRepository({ firestore, logger });
  const workerHealthProbe = createWorkerHealthProbe();
  const taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe });
  const whatsappNotifier = createWhatsAppNotifier({ whatsappPublisher, linearAgentClient });
  const gitHubPRClient = createGitHubPRHttpClient({ timeoutMs: 10000 });

  const statusMirrorService = createStatusMirrorService({
    actionsAgentClient,
    logger,
  });

  const userLookupService = createUserLookupService({
    gitHubUsernameResolver: createGitHubUsernameResolver({ userServiceClient, logger }),
    workerSettingsRepo,
    logger,
  });

  const webhookRules = createWebhookRulesService([
    // Note: RepositoryScopeRule is NOT included here because the route handler
    // already filters via shouldProcessRepository() which correctly handles
    // both intexuraos/* and */intexuraos patterns. Adding it here would be
    // redundant and risks scope mismatch (see PR #997 review).
    new CodeWorkerOutputRule(CODE_WORKER_BOTS),
    new ActionableEventRule(ALLOWED_BOTS),
    new ProtectedBaseBranchRule(),
    new SenderWhitelistRule(ALLOWED_BOTS),
    new SkipPrefixRule(['@claude', '@codex', '@ignore']),
    // Note: BotReviewEditRule is NOT included here because it introduces
    // new "meaningful changes" filtering not present in the original code.
    // The original dispatched all edited bot comments without payload inspection.
  ]);

  const toolCallingClient = config.geminiAppApiKey !== ''
    ? createToolCallingClient({
        apiKey: config.geminiAppApiKey,
        model: GEMINI_TOOL_CALLING_MODEL,
        userId: 'system:github-agent',
        pricing: GEMINI_TOOL_CALLING_PRICING,
        logger,
      })
    : undefined;

  const gitHubPREventRepo = createFirestoreGitHubPREventsRepository({ logger });
  const dispatchRetryRepo = createFirestoreDispatchRetryRepository({ logger });

  const dispatchService = createWebhookDispatchService({
    gitHubPREventRepo,
    codeTaskRepo,
    logLineRepo,
    userLookupService,
    linearIssueService,
    taskDispatcher,
    whatsappNotifier,
    workerSettingsRepo,
    statusMirrorService,
    gitHubPRClient,
    userServiceClient,
    firestore,
    messageBuilder: createWebhookMessageBuilder(ALLOWED_BOTS),
    allowedBots: ALLOWED_BOTS,
    orchestratorSecret: config.orchestratorSecret,
    serviceUrl: config.serviceUrl,
    dispatchRetryRepo,
  });

  const eventDecisionRepo = createFirestoreEventDecisionRepository({ logger });

  const unifiedEvaluator = createUnifiedEvaluator({
    webhookRules,
    dispatchService,
    eventDecisionRepo,
    evaluateEvent: toolCallingClient !== undefined
      ? (event: GitHubPREvent): Promise<Result<GitHubAgentEvalResult, GitHubAgentError>> => evaluateEvent(
          { logger, gitHubPRClient, toolCallingClient, userServiceClient, allowedBots: ALLOWED_BOTS },
          event,
        )
      : undefined,
    createReviewTask: (taskLogger, request) => createReviewTask(
      { logger: taskLogger, codeTaskRepo, userLookupService, taskDispatcher, linearAgentClient, gitHubPRClient, userServiceClient, orchestratorSecret: config.orchestratorSecret, serviceUrl: config.serviceUrl },
      request,
    ),
    postTriageComment: async (senderLogin, repository, prNumber, body) => {
      const userResult = await userServiceClient.resolveGitHubUsername(senderLogin);
      if (!userResult.ok) {
        return { ok: false, error: { code: 'USER_NOT_FOUND', message: `Failed to resolve user: ${senderLogin}` } };
      }
      const resolvedUser = userResult.value; // @allow-result-access -- narrowed by !userResult.ok
      if (resolvedUser === null) {
        return { ok: false, error: { code: 'USER_NOT_FOUND', message: `No linked account for: ${senderLogin}` } };
      }
      const tokenResult = await userServiceClient.getOAuthToken(resolvedUser.userId, 'github');
      if (!tokenResult.ok) {
        return { ok: false, error: { code: 'TOKEN_NOT_AVAILABLE', message: `OAuth token unavailable for: ${resolvedUser.userId}` } };
      }
      const [owner, repo] = repository.split('/');
      if (owner === undefined || repo === undefined) {
        return { ok: false, error: { code: 'INVALID_REPO', message: `Invalid repository: ${repository}` } };
      }
      const commentResult = await gitHubPRClient.postPRComment(tokenResult.value.accessToken, owner, repo, prNumber, body); // @allow-result-access -- narrowed by !tokenResult.ok
      if (!commentResult.ok) {
        return { ok: false, error: { code: commentResult.error.code, message: commentResult.error.message } };
      }
      return { ok: true, value: { commentId: commentResult.value.commentId } }; // @allow-result-access -- narrowed by !commentResult.ok
    },
    allowedBots: ALLOWED_BOTS,
  });

  container = {
    firestore,
    logger,
    codeTaskRepo,
    logChunkRepo: createFirestoreLogChunkRepository({ firestore, logger }),
    logLineRepo,
    taskDispatcher,
    whatsappNotifier,
    actionsAgentClient,
    linearAgentClient,
    statusMirrorService,
    rateLimitService: createRateLimitService({
      userUsageRepository: createUserUsageFirestoreRepository(firestore, logger),
      logger,
    }),
    linearIssueService,
    processHeartbeat: createProcessHeartbeatUseCase({
      codeTaskRepository: codeTaskRepo,
      logger,
    }),
    detectZombieTasks: createDetectZombieTasksUseCase({
      codeTaskRepository: codeTaskRepo,
      logger,
    }),
    cleanupTaskLogs: createCleanupTaskLogsUseCase({
      codeTaskRepository: codeTaskRepo,
      logger,
    }),
    metricsClient,
    workerSettingsRepo,
    workerHealthProbe,
    gitHubPREventRepo,
    gitHubPRSummaryRepo: createFirestoreGitHubPRSummariesRepository({ logger }),
    turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore, logger }),
    userServiceClient,
    gitHubPRClient,
    userLookupService,
    webhookRules,
    toolCallingClient,
    dispatchService,
    eventDecisionRepo,
    dispatchRetryRepo,
    unifiedEvaluator,
  };
}


/**
 * Get the service container. Throws if initServices() wasn't called.
 * DO NOT add fallbacks here - that creates test code in production.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

/**
 * Replace services for testing. Only use in tests.
 */
export function setServices(s: ServiceContainer): void {
  container = s;
}

/**
 * Reset services. Call in afterEach() in tests.
 */
export function resetServices(): void {
  container = null;
}
