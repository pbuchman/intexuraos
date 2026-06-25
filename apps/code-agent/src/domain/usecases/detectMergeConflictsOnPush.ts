import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { GitHubPREventRepository } from '../repositories/gitHubPREventRepository.js';
import type { GitHubPRSummaryRepository } from '../repositories/gitHubPRSummaryRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import type { MergeConflictDetector, ReconcileResult } from '../services/mergeConflictDetector.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';
import {
  detectConflictForPushedPR,
  extractPushedBranch,
  reconcilePRSummaries,
  type DetectConflictDeps,
  type ProcessingTrigger,
} from './mergeConflicts/detectConflicts.js';

export interface DetectMergeConflictsOnPushDeps {
  logger: Logger;
  gitHubPRClient: Pick<
    GitHubPRClient,
    'getPullRequestDetails' | 'postPRComment' | 'updateIssueComment' | 'listAllOpenPullRequests'
  >;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  codeTaskRepo: CodeTaskRepository;
  userServiceClient: UserServiceClient;
  gitHubPREventRepo: Pick<GitHubPREventRepository, 'findByPullRequest'>;
  linearIssueService: LinearIssueService;
  taskDispatcher: TaskDispatcherService;
  taskEnqueueService: TaskEnqueueService;
  logLineRepo: LogLineRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  whatsappNotifier: WhatsAppNotifier;
  allowedBots: Set<string>;
  orchestratorSecret: string;
  sleep?: (ms: number) => Promise<void>;
  mergeabilityRetries?: number;
  retryDelayMs?: number;
}

function toDetectDeps(deps: DetectMergeConflictsOnPushDeps): DetectConflictDeps {
  return {
    gitHubPRClient: deps.gitHubPRClient,
    gitHubPRSummaryRepo: deps.gitHubPRSummaryRepo,
    codeTaskRepo: deps.codeTaskRepo,
    userServiceClient: deps.userServiceClient,
    gitHubPREventRepo: deps.gitHubPREventRepo,
    linearIssueService: deps.linearIssueService,
    taskEnqueueService: deps.taskEnqueueService,
    workerSettingsRepo: deps.workerSettingsRepo,
    allowedBots: deps.allowedBots,
    orchestratorSecret: deps.orchestratorSecret,
    ...(deps.sleep !== undefined && { sleep: deps.sleep }),
    ...(deps.mergeabilityRetries !== undefined && { mergeabilityRetries: deps.mergeabilityRetries }),
    ...(deps.retryDelayMs !== undefined && { retryDelayMs: deps.retryDelayMs }),
  };
}

async function detectOnPushImpl(
  detectDeps: DetectConflictDeps,
  gitHubPRSummaryRepo: GitHubPRSummaryRepository,
  event: GitHubPREvent,
  logger: Logger
): Promise<void> {
  const branch = extractPushedBranch(event.payload);
  if (branch === null) {
    logger.debug({ eventId: event.id }, 'Skipping merge-conflict detection for non-branch push');
    return;
  }

  const parsedRepository = parseOwnerRepo(event.repository);
  if (parsedRepository === null) {
    logger.warn({ repository: event.repository }, 'Skipping merge-conflict detection for invalid repository');
    return;
  }

  const openSummariesResult = await gitHubPRSummaryRepo.findOpenByBaseBranch(event.repository, branch);
  if (!openSummariesResult.ok) {
    logger.warn(
      { error: openSummariesResult.error, repository: event.repository, branch },
      'Failed to load open PR summaries for merge-conflict detection'
    );
    return;
  }

  if (openSummariesResult.value.length === 0) {
    logger.debug({ repository: event.repository, branch }, 'Skipping merge-conflict detection with no open PR summaries');
    return;
  }

  const trigger: ProcessingTrigger = {
    eventId: event.id,
    repository: event.repository,
    lastActivityAt: event.createdAt,
  };
  for (const existingSummary of openSummariesResult.value) {
    await detectConflictForPushedPR(detectDeps, trigger, logger, parsedRepository, existingSummary);
  }
}

export function createDetectMergeConflictsOnPush(
  deps: DetectMergeConflictsOnPushDeps
): MergeConflictDetector {
  const detectDeps = toDetectDeps(deps);

  return {
    async detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void> {
      await detectOnPushImpl(detectDeps, deps.gitHubPRSummaryRepo, event, logger);
    },

    async reconcile(logger: Logger): Promise<ReconcileResult> {
      return await reconcilePRSummaries(detectDeps, logger);
    },
  };
}
