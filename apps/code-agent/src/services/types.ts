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
import type { EmbeddingClient } from '@intexuraos/infra-gpt';
import type { UserServiceClient, UsageServiceClient } from '@intexuraos/internal-clients';
import type { CodeTaskRepository } from '../domain/repositories/codeTaskRepository.js';
import type { LogChunkRepository } from '../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../domain/repositories/logLineRepository.js';
import type { TaskDispatcherService } from '../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../domain/services/whatsappNotifier.js';
import type { ActionsAgentClient } from '../infra/clients/actionsAgentClient.js';
import type { WorkerSettingsRepository } from '../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../domain/ports/workerHealthProbe.js';
import type { UserLookupService } from '../domain/ports/userLookupService.js';
import type { LinearIssueService } from '../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../domain/ports/linearAgentClient.js';
import type { StatusMirrorService } from '../infra/services/statusMirrorServiceImpl.js';
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

export interface ServiceContainer {
  firestore: Firestore;
  logger: Logger;
  serviceUrl?: string;
  codeTaskRepo: CodeTaskRepository;
  logChunkRepo: LogChunkRepository;
  logLineRepo: LogLineRepository;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  actionsAgentClient: ActionsAgentClient;
  linearAgentClient: LinearAgentClient;
  linearIssueService: LinearIssueService;
  statusMirrorService: StatusMirrorService;
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
  unifiedEvaluator: UnifiedEvaluator;
  prTriagePublisher: PRTriagePublisher;
  mergeConflictDetector: MergeConflictDetector;
  automationLog: AutomationLog;
  taskEnqueueService: TaskEnqueueService;
  mergeQueueWatchRepo: MergeQueueWatchRepository;
  executionMemoryRepo?: ExecutionMemoryRepository;
  executionMemoryApplicationRepo?: ExecutionMemoryApplicationRepository;
  executionMemoryEmbeddingClient?: EmbeddingClient;
  usageServiceClient?: UsageServiceClient;
  // The two fields below are optional so existing `setServices({fakes})` call
  // sites in tests don't need updating when these services are added to the
  // container. Production code paths always populate them via `initServices()`.
  groupSummaryRepo?: TaskGroupSummaryRepository;
  createRemediationTaskFn?: (
    logger: Logger,
    request: CreateRemediationTaskRequest,
  ) => Promise<Result<CreateRemediationTaskResult, CreateRemediationTaskError>>;
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
  actionsAgentUrl: string;
  webhookVerifySecret: string;
  orchestratorSecret: string;
  serviceUrl: string;
  userServiceUrl: string;
  // GitHub Agent (INT-743)
  geminiAppApiKey: string;
  openaiAppApiKey: string;
  llmUsageServiceUrl: string;
}
