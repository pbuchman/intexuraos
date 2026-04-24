/**
 * Repository factory for code-agent.
 *
 * Constructs all Firestore-backed repositories used by the service container.
 * `codeTaskRepo` is returned already wrapped with group-summary update behavior.
 */

import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createFirestoreExecutionMemoryRepository } from '../../infra/repositories/firestoreExecutionMemoryRepository.js';
import { createFirestoreExecutionMemoryApplicationRepository } from '../../infra/repositories/firestoreExecutionMemoryApplicationRepository.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from '../../infra/firestore/gitHubPRSummariesRepository.js';
import { createFirestoreGitHubWebhookAuditEventRepository } from '../../infra/firestore/gitHubWebhookAuditEventRepository.js';
import { createFirestoreGitHubEventLogEntryRepository } from '../../infra/firestore/gitHubEventLogEntryRepository.js';
import { createFirestoreDispatchRetryRepository } from '../../infra/firestore/dispatchRetryRepository.js';
import { createFirestoreMergeQueueWatchRepository } from '../../infra/firestore/mergeQueueWatchRepository.js';
import { createFirestoreEventDecisionRepository } from '../../infra/firestore/eventDecisionRepository.js';
import { createTaskGroupSummaryFirestoreRepository } from '../../infra/firestore/taskGroupSummaryFirestoreRepository.js';
import { createFirestorePRAutomationCommentRepository } from '../../infra/firestore/prAutomationCommentRepository.js';
import { withGroupUpdates } from '../../infra/repositories/codeTaskRepositoryWithGroupUpdates.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { GitHubPREventRepository } from '../../domain/repositories/gitHubPREventRepository.js';
import type { GitHubPRSummaryRepository } from '../../domain/repositories/gitHubPRSummaryRepository.js';
import type { GitHubWebhookAuditEventRepository } from '../../domain/repositories/gitHubWebhookAuditEventRepository.js';
import type { GitHubEventLogEntryRepository } from '../../domain/repositories/gitHubEventLogEntryRepository.js';
import type { TurnMetricsRepository } from '../../domain/repositories/turnMetricsRepository.js';
import type { DispatchRetryRepository } from '../../domain/repositories/dispatchRetryRepository.js';
import type { MergeQueueWatchRepository } from '../../domain/repositories/mergeQueueWatchRepository.js';
import type { EventDecisionRepository } from '../../domain/repositories/eventDecisionRepository.js';
import type { ExecutionMemoryRepository } from '../../domain/repositories/executionMemoryRepository.js';
import type { ExecutionMemoryApplicationRepository } from '../../domain/repositories/executionMemoryApplicationRepository.js';
import type { TaskGroupSummaryRepository } from '../../domain/ports/taskGroupSummaryRepository.js';
import type { PRAutomationCommentRepository } from '../../domain/ports/prAutomationCommentRepository.js';

export interface RepositoryFactoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export interface RepositoryServices {
  groupSummaryRepo: TaskGroupSummaryRepository;
  codeTaskRepo: CodeTaskRepository;
  logChunkRepo: LogChunkRepository;
  logLineRepo: LogLineRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  gitHubPREventRepo: GitHubPREventRepository;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  gitHubWebhookAuditEventRepo: GitHubWebhookAuditEventRepository;
  gitHubEventLogEntryRepo: GitHubEventLogEntryRepository;
  turnMetricsRepo: TurnMetricsRepository;
  dispatchRetryRepo: DispatchRetryRepository;
  mergeQueueWatchRepo: MergeQueueWatchRepository;
  eventDecisionRepo: EventDecisionRepository;
  executionMemoryRepo: ExecutionMemoryRepository;
  executionMemoryApplicationRepo: ExecutionMemoryApplicationRepository;
  prAutomationCommentRepo: PRAutomationCommentRepository;
}

/**
 * Create all Firestore-backed repositories used by code-agent.
 *
 * `codeTaskRepo` is returned wrapped with `withGroupUpdates` so task writes
 * automatically fan out into the taskGroupSummary collection.
 */
export function createRepositoryServices(deps: RepositoryFactoryDeps): RepositoryServices {
  const { firestore, logger } = deps;

  const rawCodeTaskRepo = createFirestoreCodeTaskRepository({ firestore, logger });
  const groupSummaryRepo = createTaskGroupSummaryFirestoreRepository({ firestore, logger });
  const codeTaskRepo = withGroupUpdates(rawCodeTaskRepo, groupSummaryRepo, logger);

  return {
    groupSummaryRepo,
    codeTaskRepo,
    logChunkRepo: createFirestoreLogChunkRepository({ firestore, logger }),
    logLineRepo: createFirestoreLogLineRepository({ firestore, logger }),
    workerSettingsRepo: createWorkerSettingsRepository({ firestore, logger }),
    gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
    gitHubPRSummaryRepo: createFirestoreGitHubPRSummariesRepository({ logger }),
    gitHubWebhookAuditEventRepo: createFirestoreGitHubWebhookAuditEventRepository({ logger }),
    gitHubEventLogEntryRepo: createFirestoreGitHubEventLogEntryRepository({ logger }),
    turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore, logger }),
    dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
    mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
    eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
    executionMemoryRepo: createFirestoreExecutionMemoryRepository({ firestore, logger }),
    executionMemoryApplicationRepo: createFirestoreExecutionMemoryApplicationRepository({ firestore, logger }),
    prAutomationCommentRepo: createFirestorePRAutomationCommentRepository({ logger }),
  };
}
