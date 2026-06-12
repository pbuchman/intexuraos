import type { Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { RuleOutcome } from '../gitHubWebhookRules.js';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../../repositories/logLineRepository.js';
import type { UserLookupService } from '../../ports/userLookupService.js';
import type { LinearIssueService } from '../linearIssueService.js';
import type { TaskDispatcherService } from '../taskDispatcher.js';
import type { TaskEnqueueService } from '../taskEnqueueService.js';
import type { WhatsAppNotifier } from '../whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../../ports/workerSettingsRepository.js';
import type { StatusMirrorService } from '../statusMirrorService.js';
import type { GitHubPRClient } from '../../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPREventRepository } from '../../repositories/gitHubPREventRepository.js';
import type { WebhookMessageBuilder } from '../gitHubMessageBuilder.js';
import type { SendTaskMessageErrorCode } from '../../usecases/sendTaskMessage.js';
import type { DispatchRetryRepository } from '../../repositories/dispatchRetryRepository.js';
import type { AutomationLog } from '../../ports/automationLog.js';

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
