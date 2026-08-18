/**
 * Service container types for code-agent.
 *
 * Kept in a separate file so `services.ts` stays a thin DI composer.
 */

import type { Logger } from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import type { Result } from '@intexuraos/common-core';
import type { PRTriagePublisher } from '@intexuraos/pr-triage-pubsub-client';
import type { ToolCallingClient } from '@intexuraos/llm-contract';
import type { UserServiceClient, UsageServiceClient } from '@intexuraos/internal-clients';
import type { CodeTaskRepository } from '../domain/repositories/codeTaskRepository.js';
import type { LogChunkRepository } from '../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../domain/repositories/logLineRepository.js';
import type { TaskDispatcherService } from '../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../domain/services/whatsappNotifier.js';
import type { CodeTaskDispatchStatusService } from '../domain/services/codeTaskDispatchStatusService.js';
import type { WorkerSettingsRepository } from '../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../domain/ports/workerHealthProbe.js';
import type { UserLookupService } from '../domain/ports/userLookupService.js';
import type { LinearIssueService } from '../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../domain/ports/linearAgentClient.js';
import type { ProcessHeartbeatUseCase } from '../domain/usecases/processHeartbeat.js';
import type { DetectZombieTasksUseCase } from '../domain/usecases/detectZombieTasks.js';
import type { ArchiveStaleGroupsUseCase } from '../domain/usecases/archiveStaleGroups.js';
import type { AutoArchiveMergedTasksUseCase } from '../domain/usecases/autoArchiveMergedTasks.js';
import type { MetricsClient } from '../infra/metrics.js';
import type { GitHubPREventRepository } from '../domain/repositories/gitHubPREventRepository.js';
import type { TurnMetricsRepository } from '../domain/repositories/turnMetricsRepository.js';
import type { ExecutionMemoryRepository } from '../domain/repositories/executionMemoryRepository.js';
import type { ExecutionMemoryApplicationRepository } from '../domain/repositories/executionMemoryApplicationRepository.js';
import type { GitHubPRSummaryRepository } from '../domain/repositories/gitHubPRSummaryRepository.js';
import type { GitHubPRClient } from '../domain/ports/gitHubPRClient.js';
import type { WebhookRulesService } from '../domain/services/gitHubWebhookRules.js';
import type { WebhookDispatchService } from '../domain/services/gitHubDispatchService.js';
import type { EventDecisionRepository } from '../domain/repositories/eventDecisionRepository.js';
import type { DispatchRetryRepository } from '../domain/repositories/dispatchRetryRepository.js';
import type { CodeTaskSystemStatusRepository } from '../domain/repositories/codeTaskSystemStatusRepository.js';
import type { UnifiedEvaluator } from '../domain/services/unifiedEvaluator.js';
import type { GitHubAgentError } from '../domain/usecases/githubAgent.js';
import type {
  CreateRemediationTaskError,
  CreateRemediationTaskRequest,
  CreateRemediationTaskResult,
} from '../domain/usecases/createRemediationTask.js';
import type { MergeConflictDetector } from '../domain/services/mergeConflictDetector.js';
import type { GitHubWebhookAuditEventRepository } from '../domain/repositories/gitHubWebhookAuditEventRepository.js';
import type { GitHubEventLogEntryRepository } from '../domain/repositories/gitHubEventLogEntryRepository.js';
import type { AutomationLog } from '../domain/ports/automationLog.js';
import type { TaskEnqueueService } from '../domain/services/taskEnqueueService.js';
import type { MergeQueueWatchRepository } from '../domain/repositories/mergeQueueWatchRepository.js';
import type { TaskGroupSummaryRepository } from '../domain/ports/taskGroupSummaryRepository.js';
import type { CodeTaskDispatchNotificationRepository } from '../domain/repositories/codeTaskDispatchNotificationRepository.js';
import type { SentryIssueEventRepository } from '../domain/repositories/sentryIssueEventRepository.js';
import type { ExecutionMemoryEmbeddingClient } from '../domain/usecases/prepareExecutionMemoryContext.js';

export interface ServiceContainer {
  firestore: Firestore;
  logger: Logger;
  serviceUrl?: string;
  codeTaskCallbackBaseUrl?: string;
  codeTaskRepo: CodeTaskRepository;
  logChunkRepo: LogChunkRepository;
  logLineRepo: LogLineRepository;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  linearAgentClient: LinearAgentClient;
  linearIssueService: LinearIssueService;
  processHeartbeat: ProcessHeartbeatUseCase;
  detectZombieTasks: DetectZombieTasksUseCase;
  archiveStaleGroups: ArchiveStaleGroupsUseCase;
  autoArchiveMergedTasks: AutoArchiveMergedTasksUseCase;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  workerHealthProbe: WorkerHealthProbe;
  gitHubPREventRepo: GitHubPREventRepository;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  gitHubWebhookAuditEventRepo?: GitHubWebhookAuditEventRepository;
  gitHubEventLogEntryRepo?: GitHubEventLogEntryRepository;
  turnMetricsRepo: TurnMetricsRepository;
  userServiceClient: UserServiceClient;
  gitHubPRClient: GitHubPRClient;
  userLookupService?: UserLookupService;
  webhookRules: WebhookRulesService;
  dispatchService: WebhookDispatchService;
  // GitHub Agent (INT-743)
  resolveToolCallingClient: (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>>;
  // INT-744: Unified Webhook Evaluator
  eventDecisionRepo: EventDecisionRepository;
  dispatchRetryRepo: DispatchRetryRepository;
  codeTaskSystemStatusRepo?: CodeTaskSystemStatusRepository;
  unifiedEvaluator: UnifiedEvaluator;
  prTriagePublisher: PRTriagePublisher;
  mergeConflictDetector: MergeConflictDetector;
  automationLog: AutomationLog;
  taskEnqueueService: TaskEnqueueService;
  codeTaskDispatchNotificationRepo?: CodeTaskDispatchNotificationRepository;
  mergeQueueWatchRepo: MergeQueueWatchRepository;
  executionMemoryRepo?: ExecutionMemoryRepository;
  executionMemoryApplicationRepo?: ExecutionMemoryApplicationRepository;
  executionMemoryEmbeddingClient?: ExecutionMemoryEmbeddingClient;
  usageServiceClient?: UsageServiceClient;
  // The fields below are optional so existing `setServices({fakes})` call
  // sites in tests don't need updating when these services are added to the
  // container. Production code paths always populate them via `initServices()`.
  codeTaskDispatchStatusService?: CodeTaskDispatchStatusService;
  groupSummaryRepo?: TaskGroupSummaryRepository;
  createRemediationTaskFn?: (
    logger: Logger,
    request: CreateRemediationTaskRequest,
  ) => Promise<Result<CreateRemediationTaskResult, CreateRemediationTaskError>>;
  sentryIssueEventRepo?: SentryIssueEventRepository;
}

// Configuration required to initialize services
export interface ServiceConfig {
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  whatsappSendTopic: string;
  prTriageTopic: string;
  linearAgentUrl: string;
  webhookVerifySecret: string;
  orchestratorSecret: string;
  serviceUrl: string;
  codeTaskCallbackBaseUrl: string;
  webAppUrl: string;
  userServiceUrl: string;
  // GitHub Agent (INT-743)
  openRouterAppApiKey: string;
  llmUsageServiceUrl: string;
}
