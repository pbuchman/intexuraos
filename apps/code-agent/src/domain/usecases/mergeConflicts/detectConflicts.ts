/**
 * Detection layer: classifies mergeability, loads PR details with retry, resolves
 * GitHub access context, and coordinates the per-PR pipeline by delegating to
 * `resolveConflicts` (task/workflow) and, transitively, `notifyConflicts`
 * (managed PR comment). The thin facade at `../detectMergeConflictsOnPush.ts`
 * sequences these at the PR list level (push event / reconcile sweep).
 */
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { GitHubPRSummary, UpsertGitHubPRSummaryInput } from '../../models/gitHubPRSummary.js';
import type { GitHubPRClient, GitHubPullRequestDetails } from '../../ports/gitHubPRClient.js';
import type { GitHubPREventRepository } from '../../repositories/gitHubPREventRepository.js';
import type { GitHubPRSummaryRepository } from '../../repositories/gitHubPRSummaryRepository.js';
import { EMPTY_RECONCILE_RESULT, type ReconcileResult } from '../../services/mergeConflictDetector.js';
import { resolveLoginForTaskCreation } from '../../services/gitHubDispatchService.js';
import { parseOwnerRepo } from '../../utils/parseOwnerRepo.js';
import { fetchGitHubToken } from '../../utils/gitHubTokenResolver.js';
import {
  buildInitialWorkflowResult,
  executeConflictWorkflow,
  resolveConflictWorkflow,
  resolveExistingConflictTask,
  shouldResolveTaskState,
  type ConflictWorkflowParams,
  type ConflictWorkflowResult,
  type ExistingConflictTaskResolution,
  type GitHubAccessContext,
  type ParsedRepository,
  type ResolveConflictDeps,
} from './resolveConflicts.js';

const BRANCH_REF_PREFIX = 'refs/heads/';

export type MergeConflictStatus = GitHubPRSummary['mergeConflictStatus'];
export type ClassifiedMergeConflictStatus = NonNullable<MergeConflictStatus>;

export interface AccessContextDeps {
  userServiceClient: UserServiceClient;
  gitHubPREventRepo: Pick<GitHubPREventRepository, 'findByPullRequest'>;
  allowedBots: Set<string>;
}

export interface DetectConflictDeps extends ResolveConflictDeps, AccessContextDeps {
  gitHubPRClient: Pick<
    GitHubPRClient,
    'getPullRequestDetails' | 'postPRComment' | 'updateIssueComment' | 'listAllOpenPullRequests'
  >;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  sleep?: (ms: number) => Promise<void>;
  mergeabilityRetries?: number;
  retryDelayMs?: number;
}

export interface ProcessingTrigger {
  eventId: string;
  repository: string;
  lastActivityAt: Date;
}

export type ProcessingOutcome = 'closed' | 'clean' | 'conflicting' | 'unknown' | 'skipped';

export interface MergeConflictTransitionParams {
  deps: DetectConflictDeps;
  logger: Logger;
  repository: string;
  parsedRepository: ParsedRepository;
  existingSummary: GitHubPRSummary;
  details: GitHubPullRequestDetails;
  newStatus: ClassifiedMergeConflictStatus;
  needsConflictWorkflow: boolean;
  needsResolveWorkflow: boolean;
}

export interface MergeConflictTransitionResult {
  mergeConflictRefreshed: number;
  conflictWorkflowsTriggered: number;
}

export interface SummaryUpdateParams {
  repository: string;
  lastActivityAt: Date;
  existingSummary: GitHubPRSummary;
  details: GitHubPullRequestDetails;
  status: MergeConflictStatus;
  workflowResult: ConflictWorkflowResult;
}

export const DEFAULT_RETRY_DELAY_MS = 500;
export const DEFAULT_MERGEABILITY_RETRIES = 2;

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function extractPushedBranch(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const ref = (payload as Record<string, unknown>)['ref'];
  if (typeof ref !== 'string' || !ref.startsWith(BRANCH_REF_PREFIX)) {
    return null;
  }

  return ref.slice(BRANCH_REF_PREFIX.length);
}

export function classifyMergeConflictStatus(mergeable: boolean | null): ClassifiedMergeConflictStatus {
  if (mergeable === false) {
    return 'conflicting';
  }
  if (mergeable === true) {
    return 'clean';
  }
  return 'unknown';
}

export async function loadPullRequestDetails(
  deps: { gitHubPRClient: Pick<GitHubPRClient, 'getPullRequestDetails'>; sleep?: (ms: number) => Promise<void> },
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  retries: number,
  retryDelayMs: number
): Promise<Result<GitHubPullRequestDetails, { code: string; message: string }>> {
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await deps.gitHubPRClient.getPullRequestDetails(token, owner, repo, prNumber);
    if (!result.ok) {
      return err(result.error);
    }

    if (result.value.mergeable !== null || attempt === retries) {
      return ok(result.value);
    }

    await sleep(retryDelayMs);
  }

  return err({ code: 'API_ERROR', message: `Unable to resolve mergeability for PR #${String(prNumber)}` });
}

export async function upsertSummary(
  repo: GitHubPRSummaryRepository,
  input: UpsertGitHubPRSummaryInput,
  logger: Logger
): Promise<void> {
  const result = await repo.upsert(input);
  if (!result.ok) {
    logger.warn({ error: result.error, input }, 'Failed to upsert merge-conflict summary');
  }
}

async function resolveUserIdFromGitHubLogin(
  userServiceClient: UserServiceClient,
  gitHubLogin: string,
  logger: Logger
): Promise<string | null> {
  const userResult = await userServiceClient.resolveGitHubUsername(gitHubLogin);
  if (!userResult.ok) {
    logger.warn({ error: userResult.error, gitHubLogin }, 'Failed to resolve GitHub username for conflict detection');
    return null;
  }

  return userResult.value?.userId ?? null;
}

function findOpenedPRAuthorLogin(events: GitHubPREvent[]): string | null {
  const openedEvent = events.find((event) => event.eventType === 'pull_request' && event.action === 'opened');
  if (openedEvent !== undefined) {
    return openedEvent.senderLogin;
  }

  return events.find((event) => event.senderLogin.length > 0)?.senderLogin ?? null;
}

export async function resolveGitHubAccessContext(
  deps: AccessContextDeps,
  summary: GitHubPRSummary,
  logger: Logger
): Promise<GitHubAccessContext | null> {
  const managedOwnerUserId = summary.managedConflictTaskOwnerUserId;
  if (managedOwnerUserId !== null) {
    const managedToken = await fetchGitHubToken(deps.userServiceClient, managedOwnerUserId, logger);
    if (managedToken !== null) {
      return { userId: managedOwnerUserId, token: managedToken };
    }
  }

  if (summary.authorLogin !== null) {
    const resolvedAuthorLogin = resolveLoginForTaskCreation(
      summary.authorLogin, summary.repository, deps.allowedBots
    );
    const authorUserId = await resolveUserIdFromGitHubLogin(deps.userServiceClient, resolvedAuthorLogin, logger);
    if (authorUserId !== null) {
      const authorToken = await fetchGitHubToken(deps.userServiceClient, authorUserId, logger);
      if (authorToken !== null) {
        return { userId: authorUserId, token: authorToken };
      }
    }
  }

  const eventsResult = await deps.gitHubPREventRepo.findByPullRequest(summary.repository, summary.pullRequestNumber);
  if (!eventsResult.ok) {
    logger.warn(
      { error: eventsResult.error, repository: summary.repository, prNumber: summary.pullRequestNumber },
      'Failed to load PR events for conflict detection'
    );
    return null;
  }

  const fallbackLogin = findOpenedPRAuthorLogin(eventsResult.value);
  if (fallbackLogin === null) {
    return null;
  }

  const resolvedFallbackLogin = resolveLoginForTaskCreation(
    fallbackLogin, summary.repository, deps.allowedBots
  );
  const fallbackUserId = await resolveUserIdFromGitHubLogin(deps.userServiceClient, resolvedFallbackLogin, logger);
  if (fallbackUserId === null) {
    return null;
  }

  const fallbackToken = await fetchGitHubToken(deps.userServiceClient, fallbackUserId, logger);
  if (fallbackToken === null) {
    return null;
  }

  return { userId: fallbackUserId, token: fallbackToken };
}

function resolveConflictEpisodeStartedAt(
  existingSummary: GitHubPRSummary,
  status: MergeConflictStatus,
  now: Date
): Date | null {
  if (status === 'conflicting') {
    return existingSummary.conflictEpisodeStartedAt ?? now;
  }

  if (status === 'unknown' && existingSummary.mergeConflictStatus === 'conflicting') {
    return existingSummary.conflictEpisodeStartedAt ?? null;
  }

  return null;
}

export function buildSummaryUpdateInput(params: SummaryUpdateParams): UpsertGitHubPRSummaryInput {
  const now = new Date();

  return {
    repository: params.repository,
    pullRequestNumber: params.existingSummary.pullRequestNumber,
    title: params.details.title,
    state: 'open',
    mergedAt: null,
    baseBranch: params.details.baseBranch,
    authorLogin: params.details.authorLogin,
    headBranch: params.details.headBranch,
    mergeConflictStatus: params.status,
    lastConflictCheckedAt: now,
    conflictEpisodeStartedAt: resolveConflictEpisodeStartedAt(
      params.existingSummary,
      params.status,
      now
    ),
    conflictResolvedAt:
      params.status === 'clean' &&
      params.existingSummary.mergeConflictStatus === 'conflicting'
        ? now
        : null,
    managedConflictCommentId:
      params.status === 'conflicting' || params.status === 'unknown'
        ? params.workflowResult.commentId
        : null,
    managedConflictTaskId:
      params.status === 'conflicting' || params.status === 'unknown'
        ? params.workflowResult.taskId
        : null,
    managedConflictTaskOwnerUserId:
      params.status === 'conflicting' || params.status === 'unknown'
        ? params.workflowResult.ownerUserId
        : null,
    lastActivityAt: params.lastActivityAt,
    firstSeenAt: params.existingSummary.firstSeenAt,
  };
}

export function buildStatusOnlyUpsertInput(
  repository: string,
  existingSummary: GitHubPRSummary,
  newStatus: ClassifiedMergeConflictStatus
): UpsertGitHubPRSummaryInput {
  return {
    repository,
    pullRequestNumber: existingSummary.pullRequestNumber,
    lastActivityAt: existingSummary.lastActivityAt,
    firstSeenAt: existingSummary.firstSeenAt,
    mergeConflictStatus: newStatus,
    lastConflictCheckedAt: new Date(),
  };
}

export async function handleMergeConflictTransition(
  params: MergeConflictTransitionParams
): Promise<MergeConflictTransitionResult> {
  const {
    deps,
    logger,
    repository,
    parsedRepository,
    existingSummary,
    details,
    newStatus,
    needsConflictWorkflow,
    needsResolveWorkflow,
  } = params;

  if (!needsConflictWorkflow && !needsResolveWorkflow) {
    await upsertSummary(
      deps.gitHubPRSummaryRepo,
      buildStatusOnlyUpsertInput(repository, existingSummary, newStatus),
      logger
    );
    return { mergeConflictRefreshed: 1, conflictWorkflowsTriggered: 0 };
  }

  const summaryAccessContext = await resolveGitHubAccessContext(
    {
      userServiceClient: deps.userServiceClient,
      gitHubPREventRepo: deps.gitHubPREventRepo,
      allowedBots: deps.allowedBots,
    },
    existingSummary,
    logger
  );

  if (summaryAccessContext === null) {
    logger.warn(
      { repository, prNumber: existingSummary.pullRequestNumber, newStatus },
      'Skipping conflict workflow in reconcile — no per-summary OAuth user'
    );
    await upsertSummary(
      deps.gitHubPRSummaryRepo,
      buildStatusOnlyUpsertInput(repository, existingSummary, newStatus),
      logger
    );
    return { mergeConflictRefreshed: 1, conflictWorkflowsTriggered: 0 };
  }

  let taskResolution: ExistingConflictTaskResolution = {
    latestTask: null,
    reusableTask: null,
    staleSummaryTaskId: false,
  };

  if (shouldResolveTaskState(newStatus, existingSummary)) {
    const resolutionResult = await resolveExistingConflictTask(
      deps.codeTaskRepo,
      existingSummary,
      repository,
      existingSummary.pullRequestNumber,
      logger
    );
    if (resolutionResult.ok) {
      taskResolution = resolutionResult.value;
    }
  }

  const eventId = `reconcile-${String(Date.now())}-pr${String(existingSummary.pullRequestNumber)}`;
  const workflowParams: ConflictWorkflowParams = {
    deps,
    logger,
    repository,
    parsedRepository,
    eventId,
    existingSummary,
    details,
    accessContext: summaryAccessContext,
    taskResolution,
  };

  let workflowResult = buildInitialWorkflowResult(existingSummary, taskResolution);
  let workflowExecuted = false;
  if (needsConflictWorkflow) {
    workflowResult = await executeConflictWorkflow(workflowParams);
    workflowExecuted = true;
  } else if (needsResolveWorkflow && existingSummary.managedConflictCommentId !== null) {
    workflowResult = await resolveConflictWorkflow(workflowParams);
    workflowExecuted = true;
  }

  await upsertSummary(
    deps.gitHubPRSummaryRepo,
    buildSummaryUpdateInput({
      repository,
      lastActivityAt: existingSummary.lastActivityAt,
      existingSummary,
      details,
      status: newStatus,
      workflowResult,
    }),
    logger
  );

  return {
    mergeConflictRefreshed: 1,
    conflictWorkflowsTriggered: workflowExecuted ? 1 : 0,
  };
}

export async function detectConflictForPushedPR(
  deps: DetectConflictDeps,
  trigger: ProcessingTrigger,
  logger: Logger,
  parsedRepository: ParsedRepository,
  existingSummary: GitHubPRSummary
): Promise<ProcessingOutcome> {
  const accessContext = await resolveGitHubAccessContext(
    {
      userServiceClient: deps.userServiceClient,
      gitHubPREventRepo: deps.gitHubPREventRepo,
      allowedBots: deps.allowedBots,
    },
    existingSummary,
    logger
  );
  if (accessContext === null) {
    logger.info(
      { repository: existingSummary.repository, prNumber: existingSummary.pullRequestNumber },
      'Skipping conflict detection for PR without an OAuth-backed user'
    );
    return 'skipped';
  }

  const detailsResult = await loadPullRequestDetails(
    deps,
    accessContext.token,
    parsedRepository.owner,
    parsedRepository.repo,
    existingSummary.pullRequestNumber,
    deps.mergeabilityRetries ?? DEFAULT_MERGEABILITY_RETRIES,
    deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  );
  if (!detailsResult.ok) {
    logger.warn(
      { error: detailsResult.error, prNumber: existingSummary.pullRequestNumber },
      'Failed to load PR details for conflict detection'
    );
    return 'skipped';
  }

  const details = detailsResult.value;

  if (details.state !== 'open') {
    logger.info(
      { prNumber: existingSummary.pullRequestNumber, state: details.state },
      'Closing stale PR summary — PR is no longer open on GitHub'
    );
    await upsertSummary(
      deps.gitHubPRSummaryRepo,
      {
        repository: trigger.repository,
        pullRequestNumber: existingSummary.pullRequestNumber,
        lastActivityAt: trigger.lastActivityAt,
        firstSeenAt: existingSummary.firstSeenAt,
        state: details.state,
      },
      logger
    );
    return 'closed';
  }

  const status = classifyMergeConflictStatus(details.mergeable);
  let taskResolution: ExistingConflictTaskResolution = {
    latestTask: null,
    reusableTask: null,
    staleSummaryTaskId: false,
  };

  if (shouldResolveTaskState(status, existingSummary)) {
    const resolutionResult = await resolveExistingConflictTask(
      deps.codeTaskRepo,
      existingSummary,
      trigger.repository,
      existingSummary.pullRequestNumber,
      logger
    );
    if (!resolutionResult.ok) {
      return 'skipped';
    }
    taskResolution = resolutionResult.value;
  }

  const workflowParams: ConflictWorkflowParams = {
    deps,
    logger,
    repository: trigger.repository,
    parsedRepository,
    eventId: trigger.eventId,
    existingSummary,
    details,
    accessContext,
    taskResolution,
  };

  let workflowResult = buildInitialWorkflowResult(existingSummary, taskResolution);
  if (status === 'conflicting') {
    workflowResult = await executeConflictWorkflow(workflowParams);
  } else if (
    status === 'clean' &&
    existingSummary.mergeConflictStatus === 'conflicting' &&
    existingSummary.managedConflictCommentId !== null
  ) {
    workflowResult = await resolveConflictWorkflow(workflowParams);
  }

  logger.info(
    { prNumber: existingSummary.pullRequestNumber, mergeConflictStatus: status },
    'PR mergeability checked'
  );

  await upsertSummary(
    deps.gitHubPRSummaryRepo,
    buildSummaryUpdateInput({
      repository: trigger.repository,
      lastActivityAt: trigger.lastActivityAt,
      existingSummary,
      details,
      status,
      workflowResult,
    }),
    logger
  );

  return status;
}

function groupSummariesByRepository(summaries: GitHubPRSummary[]): Map<string, GitHubPRSummary[]> {
  const byRepo = new Map<string, GitHubPRSummary[]>();
  for (const summary of summaries) {
    const existing = byRepo.get(summary.repository);
    if (existing !== undefined) {
      existing.push(summary);
    } else {
      byRepo.set(summary.repository, [summary]);
    }
  }
  return byRepo;
}

async function resolveAccessContextForRepo(
  deps: AccessContextDeps,
  repoSummaries: GitHubPRSummary[],
  logger: Logger
): Promise<GitHubAccessContext | null> {
  for (const candidate of repoSummaries) {
    const accessContext = await resolveGitHubAccessContext(deps, candidate, logger);
    if (accessContext !== null) {
      return accessContext;
    }
  }
  return null;
}

interface ReconcileCounters {
  processed: number;
  closed: number;
  reopened: number;
  mergeConflictRefreshed: number;
  conflictWorkflowsTriggered: number;
  skipped: number;
  error: number;
}

async function reconcileSummary(
  deps: DetectConflictDeps,
  logger: Logger,
  repository: string,
  parsedRepository: ParsedRepository,
  accessContext: GitHubAccessContext,
  openPRNumbers: Set<number>,
  existingSummary: GitHubPRSummary,
  counters: ReconcileCounters
): Promise<void> {
  counters.processed++;

  if (!openPRNumbers.has(existingSummary.pullRequestNumber)) {
    if (existingSummary.state === 'open') {
      logger.info(
        { prNumber: existingSummary.pullRequestNumber, repository },
        'Closing PR summary — PR is no longer open on GitHub'
      );
      await upsertSummary(
        deps.gitHubPRSummaryRepo,
        {
          repository,
          pullRequestNumber: existingSummary.pullRequestNumber,
          lastActivityAt: existingSummary.lastActivityAt,
          firstSeenAt: existingSummary.firstSeenAt,
          state: 'closed',
        },
        logger
      );
      counters.closed++;
    }
    return;
  }

  if (existingSummary.state !== 'open') {
    logger.info(
      { prNumber: existingSummary.pullRequestNumber, repository, previousState: existingSummary.state },
      'Re-opening PR summary — PR is open on GitHub'
    );
    await upsertSummary(
      deps.gitHubPRSummaryRepo,
      {
        repository,
        pullRequestNumber: existingSummary.pullRequestNumber,
        lastActivityAt: existingSummary.lastActivityAt,
        firstSeenAt: existingSummary.firstSeenAt,
        state: 'open',
      },
      logger
    );
    counters.reopened++;
  }

  const detailsResult = await deps.gitHubPRClient.getPullRequestDetails(
    accessContext.token,
    parsedRepository.owner,
    parsedRepository.repo,
    existingSummary.pullRequestNumber
  );
  if (!detailsResult.ok) {
    logger.info(
      { error: detailsResult.error, prNumber: existingSummary.pullRequestNumber, repository },
      'Failed to fetch PR details for mergeability refresh during reconcile; skipping'
    );
    return;
  }

  const details = detailsResult.value;
  const newStatus = classifyMergeConflictStatus(details.mergeable);
  const previousStatus = existingSummary.mergeConflictStatus;
  if (newStatus === 'unknown' || newStatus === previousStatus) {
    return;
  }

  logger.info(
    { prNumber: existingSummary.pullRequestNumber, repository, previousStatus, newStatus },
    'Refreshing mergeConflictStatus during reconcile'
  );

  const needsConflictWorkflow = newStatus === 'conflicting' && previousStatus !== 'conflicting';
  const needsResolveWorkflow = newStatus === 'clean' && previousStatus === 'conflicting';

  const transitionResult = await handleMergeConflictTransition({
    deps,
    logger,
    repository,
    parsedRepository,
    existingSummary,
    details,
    newStatus,
    needsConflictWorkflow,
    needsResolveWorkflow,
  });
  counters.mergeConflictRefreshed += transitionResult.mergeConflictRefreshed;
  counters.conflictWorkflowsTriggered += transitionResult.conflictWorkflowsTriggered;
}

export async function reconcilePRSummaries(
  deps: DetectConflictDeps,
  logger: Logger
): Promise<ReconcileResult> {
  const trackedResult = await deps.gitHubPRSummaryRepo.findRecentlyActive(30);
  if (!trackedResult.ok) {
    logger.warn({ error: trackedResult.error }, 'Failed to load PR summaries for reconciliation');
    return EMPTY_RECONCILE_RESULT;
  }

  const summaries = trackedResult.value;
  if (summaries.length === 0) {
    logger.debug({}, 'No tracked PR summaries to reconcile');
    return EMPTY_RECONCILE_RESULT;
  }

  logger.info({ count: summaries.length }, 'Reconciling PR state from GitHub');

  const counters: ReconcileCounters = {
    processed: 0,
    closed: 0,
    reopened: 0,
    mergeConflictRefreshed: 0,
    conflictWorkflowsTriggered: 0,
    skipped: 0,
    error: 0,
  };

  const byRepo = groupSummariesByRepository(summaries);
  const accessDeps: AccessContextDeps = {
    userServiceClient: deps.userServiceClient,
    gitHubPREventRepo: deps.gitHubPREventRepo,
    allowedBots: deps.allowedBots,
  };

  for (const [repository, repoSummaries] of byRepo) {
    const parsedRepository = parseOwnerRepo(repository);
    if (parsedRepository === null) {
      logger.warn({ repository }, 'Skipping reconcile for repo with invalid repository format');
      continue;
    }

    const accessContext = await resolveAccessContextForRepo(accessDeps, repoSummaries, logger);
    if (accessContext === null) {
      logger.info(
        { repository, count: repoSummaries.length },
        'Skipping reconcile for repo — no OAuth-backed user found'
      );
      counters.skipped += repoSummaries.length;
      counters.processed += repoSummaries.length;
      continue;
    }

    const openPRsResult = await deps.gitHubPRClient.listAllOpenPullRequests(
      accessContext.token,
      parsedRepository.owner,
      parsedRepository.repo
    );
    if (!openPRsResult.ok) {
      logger.warn(
        { error: openPRsResult.error, repository },
        'Failed to list open PRs for repo during reconcile; skipping repo'
      );
      counters.skipped += repoSummaries.length;
      counters.processed += repoSummaries.length;
      continue;
    }

    const openPRNumbers = new Set(openPRsResult.value.map((pr) => pr.number));

    for (const existingSummary of repoSummaries) {
      try {
        await reconcileSummary(
          deps,
          logger,
          repository,
          parsedRepository,
          accessContext,
          openPRNumbers,
          existingSummary,
          counters
        );
      } catch (caughtError: unknown) {
        counters.error++;
        logger.error(
          { error: caughtError, repository: existingSummary.repository, prNumber: existingSummary.pullRequestNumber },
          'Unhandled error processing PR summary in reconcile; continuing'
        );
      }
    }
  }

  logger.info(counters, 'PR state reconciliation complete');

  return { ...counters };
}
