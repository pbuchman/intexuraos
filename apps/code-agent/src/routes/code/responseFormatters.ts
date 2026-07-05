/**
 * Response formatters for code routes.
 *
 * Converts domain Firestore entities to JSON-serializable API responses.
 * Extracted from codeRoutes.ts as part of INT-1430 route split.
 */
import type {
  AgentType,
  CodeTask,
  CodeTaskCallbackState,
  CodeTaskDispatchStatus,
  WorkerType,
} from '../../domain/models/codeTask.js';
import type { ExecutionMemoryType } from '../../domain/models/executionMemory.js';
import type { CodeTaskRebaseResult } from '@intexuraos/code-task-domain';

interface SerializedDispatchStatus {
  state: CodeTaskDispatchStatus['state'];
  reason: CodeTaskDispatchStatus['reason'];
  terminal: boolean;
  severity: CodeTaskDispatchStatus['severity'];
  message: string;
  remediation: string;
  workerNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  nextAction: CodeTaskDispatchStatus['nextAction'];
  lastAttemptAt?: string;
  attemptCount?: number;
  expiresAt?: string;
  terminalCause?: Omit<NonNullable<CodeTaskDispatchStatus['terminalCause']>, 'lastSeenAt'> & {
    lastSeenAt: string;
  };
  workerHealthDetails?: CodeTaskDispatchStatus['workerHealthDetails'];
}

interface SerializedCallbackState {
  webhookUrl: string;
  callbackBaseUrl: string;
  owner: CodeTaskCallbackState['owner'];
  configuredAt: string;
  lastSuccessAt?: string;
  lastSuccessEndpoint?: CodeTaskCallbackState['lastSuccessEndpoint'];
  lastFailure?: Omit<NonNullable<CodeTaskCallbackState['lastFailure']>, 'occurredAt'> & {
    occurredAt: string;
  };
}

/**
 * Track in-flight health-probe requests per user for deduplication.
 *
 * Prevents thundering herd when multiple concurrent requests arrive while
 * health status is stale. Kept in this shared module (rather than any one
 * route file) so every route plugin and their tests share the same Map
 * instance — the previous monolith exported it from `codeRoutes.ts`.
 */
export const inFlightRequests = new Map<string, Promise<void>>();

/**
 * Convert Firestore Timestamp to ISO string for JSON serialization
 * Exported for testing
 */
export function timestampToIso(
  timestamp: { toDate: () => Date } | string | undefined
): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  return undefined;
}

/**
 * Convert CodeTask domain model to API response format
 */
function taskToApiResponse(task: {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: WorkerType;
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'queued' | 'planned' | 'implemented' | 'reviewed' | 'failed' | 'interrupted' | 'cancelled' | 'archived';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  dispatchedAt?: unknown;
  linearIssueId?: string;
  prNumber?: number;
  agentType?: AgentType;
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: CodeTaskRebaseResult;
    pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
    merge_ready?: '1';
    merge_ready_reason?: 'review_no_remediation' | 'pull_request_no_changes_rebase_clean' | 'remediation_already_completed' | 'review_skipped';
    review_comments_posted?: string;
    review_types?: string;
    requirements_tracker_updated?: string;
    needs_remediation?: string;
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      action?: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
  dispatchStatus?: CodeTaskDispatchStatus;
  callbackState?: CodeTaskCallbackState;
  executionMemoryContext?: CodeTask['executionMemoryContext'];
  executionMemoryPostRun?: CodeTask['executionMemoryPostRun'];
  completedAt?: unknown;
  logChunksDropped?: number;
  statusSummary?: unknown;
  retriedFrom?: string;
}): {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: WorkerType;
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'queued' | 'planned' | 'implemented' | 'reviewed' | 'failed' | 'interrupted' | 'cancelled' | 'archived';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  linearIssueId?: string;
  prNumber?: number;
  agentType?: AgentType;
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: CodeTaskRebaseResult;
    pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
    merge_ready?: '1';
    merge_ready_reason?: 'review_no_remediation' | 'pull_request_no_changes_rebase_clean' | 'remediation_already_completed' | 'review_skipped';
    review_comments_posted?: string;
    review_types?: string;
    requirements_tracker_updated?: string;
    needs_remediation?: string;
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      action?: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
  dispatchStatus?: SerializedDispatchStatus;
  callbackState?: SerializedCallbackState;
  executionMemoryContext?: {
    status: 'none' | 'matched' | 'error';
    applicationId?: string;
    retrievalVersion?: string;
    querySummary?: string;
    matchedAt?: string;
    matchedMemories?: {
      memoryId: string;
      title: string;
      memoryType: ExecutionMemoryType;
      score: number;
      appliesWhen: string;
      action: string;
      avoid: string;
      verification: string;
    }[];
    topCandidates?: {
      memoryId: string;
      title: string;
      memoryType: ExecutionMemoryType;
      vectorScore: number;
      rerankScore: number;
      componentOverlap: number;
      effectiveness: number;
      passedThreshold: boolean;
    }[];
    totalSearchResults?: number;
    errorCode?: string;
    errorMessage?: string;
  };
  executionMemoryPostRun?: {
    status: 'pending' | 'processing' | 'completed' | 'skipped' | 'error';
    attempts: number;
    lastAttemptAt?: string;
    generatedMemoryIds: string[];
    evaluationSummary?: string;
    skipReason?: 'infra_only' | 'insufficient_signal' | 'already_completed' | 'no_reusable_lesson' | 'planning_unclear';
    errorMessage?: string;
    completedAt?: string;
  };
}
{
  const executionMemoryMatchedAt = task.executionMemoryContext?.matchedAt !== undefined
    ? timestampToIso(task.executionMemoryContext.matchedAt)
    : undefined;
  const buildExecutionMemoryContext = (
    ctx: NonNullable<typeof task.executionMemoryContext>,
  ): Omit<NonNullable<typeof task.executionMemoryContext>, 'matchedAt'> & { matchedAt?: string } => {
    const { matchedAt: _matchedAt, ...rest } = ctx;
    return {
      ...rest,
      ...(executionMemoryMatchedAt !== undefined && { matchedAt: executionMemoryMatchedAt }),
    };
  };
  const executionMemoryContext = task.executionMemoryContext !== undefined
    ? buildExecutionMemoryContext(task.executionMemoryContext)
    : undefined;
  const executionMemoryLastAttemptAt = task.executionMemoryPostRun?.lastAttemptAt !== undefined
    ? timestampToIso(task.executionMemoryPostRun.lastAttemptAt)
    : undefined;
  const executionMemoryCompletedAt = task.executionMemoryPostRun?.completedAt !== undefined
    ? timestampToIso(task.executionMemoryPostRun.completedAt)
    : undefined;
  const buildExecutionMemoryPostRun = (
    postRun: NonNullable<typeof task.executionMemoryPostRun>,
  ): Omit<NonNullable<typeof task.executionMemoryPostRun>, 'lastAttemptAt' | 'completedAt'> & {
    lastAttemptAt?: string;
    completedAt?: string;
  } => {
    const {
      lastAttemptAt: _lastAttemptAt,
      completedAt: _completedAt,
      ...rest
    } = postRun;
    return {
      ...rest,
      ...(executionMemoryLastAttemptAt !== undefined && {
        lastAttemptAt: executionMemoryLastAttemptAt,
      }),
      ...(executionMemoryCompletedAt !== undefined && {
        completedAt: executionMemoryCompletedAt,
      }),
    };
  };
  const executionMemoryPostRun = task.executionMemoryPostRun !== undefined
    ? buildExecutionMemoryPostRun(task.executionMemoryPostRun)
    : undefined;
  const dispatchStatus = task.dispatchStatus !== undefined
    ? serializeDispatchStatus(task.dispatchStatus)
    : undefined;
  const callbackState = task.callbackState !== undefined
    ? serializeCallbackState(task.callbackState)
    : undefined;

  return {
    id: task.id,
    userId: task.userId,
    prompt: task.prompt,
    sanitizedPrompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    workerType: task.workerType,
    workerLocation: task.workerLocation,
    repository: task.repository,
    baseBranch: task.baseBranch,
    traceId: task.traceId,
    status: task.status,
    dedupKey: task.dedupKey,
    callbackReceived: task.callbackReceived,
    createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
    updatedAt: timestampToIso(task.updatedAt as { toDate: () => Date } | string | undefined) ?? '',
    ...(task.dispatchedAt !== undefined && { dispatchedAt: timestampToIso(task.dispatchedAt as { toDate: () => Date } | string | undefined) as string }),
    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    ...(task.prNumber !== undefined && { prNumber: task.prNumber }),
    ...(task.agentType !== undefined && { agentType: task.agentType }),
    ...(task.implementationTaskId !== undefined && { implementationTaskId: task.implementationTaskId }),
    ...(task.fanOutChildTaskIds !== undefined && { fanOutChildTaskIds: task.fanOutChildTaskIds }),
    ...(task.parentTaskId !== undefined && { parentTaskId: task.parentTaskId }),
    ...(task.followUpReason !== undefined && { followUpReason: task.followUpReason }),
    ...(task.result !== undefined && { result: task.result }),
    ...(task.error !== undefined && { error: task.error }),
    ...(dispatchStatus !== undefined && { dispatchStatus }),
    ...(callbackState !== undefined && { callbackState }),
    ...(executionMemoryContext !== undefined && { executionMemoryContext }),
    ...(executionMemoryPostRun !== undefined && { executionMemoryPostRun }),
  };
}

function serializeCallbackState(callbackState: CodeTaskCallbackState): SerializedCallbackState {
  const lastFailure = callbackState.lastFailure;
  return {
    webhookUrl: callbackState.webhookUrl,
    callbackBaseUrl: callbackState.callbackBaseUrl,
    owner: callbackState.owner,
    configuredAt: timestampToIso(callbackState.configuredAt) ?? '',
    ...(callbackState.lastSuccessAt !== undefined && {
      /* v8 ignore start -- ts-type: persisted callbackState.lastSuccessAt is a Timestamp; empty fallback only defends malformed legacy documents @preserve */
      lastSuccessAt: timestampToIso(callbackState.lastSuccessAt) ?? '',
      /* v8 ignore stop @preserve */
    }),
    ...(callbackState.lastSuccessEndpoint !== undefined && {
      lastSuccessEndpoint: callbackState.lastSuccessEndpoint,
    }),
    ...(lastFailure !== undefined && {
      lastFailure: {
        endpoint: lastFailure.endpoint,
        ...(lastFailure.status !== undefined && { status: lastFailure.status }),
        message: lastFailure.message,
        occurredAt: timestampToIso(lastFailure.occurredAt) ?? '',
      },
    }),
  };
}

function serializeDispatchStatus(
  dispatchStatus: CodeTaskDispatchStatus,
): SerializedDispatchStatus {
  const terminalCause = dispatchStatus.terminalCause;
  return {
    state: dispatchStatus.state,
    reason: dispatchStatus.reason,
    terminal: dispatchStatus.terminal,
    severity: dispatchStatus.severity,
    message: dispatchStatus.message,
    remediation: dispatchStatus.remediation,
    workerNames: dispatchStatus.workerNames,
    firstSeenAt: timestampToIso(dispatchStatus.firstSeenAt) ?? '',
    lastSeenAt: timestampToIso(dispatchStatus.lastSeenAt) ?? '',
    nextAction: dispatchStatus.nextAction,
    ...(dispatchStatus.lastAttemptAt !== undefined && {
      /* v8 ignore start -- ts-type: Timestamp union can include malformed values; nullish fallback is defensive and API tests cover valid timestamps @preserve */
      lastAttemptAt: timestampToIso(dispatchStatus.lastAttemptAt) ?? '',
      /* v8 ignore stop @preserve */
    }),
    /* v8 ignore start -- ts-type: optional attemptCount spread for exactOptionalPropertyTypes; absence is represented by omitting the property @preserve */
    ...(dispatchStatus.attemptCount !== undefined && { attemptCount: dispatchStatus.attemptCount }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional expiresAt spread for exactOptionalPropertyTypes; malformed Timestamp fallback is defensive and valid timestamps are covered @preserve */
    ...(dispatchStatus.expiresAt !== undefined && {
      expiresAt: timestampToIso(dispatchStatus.expiresAt) ?? '',
    }),
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: optional terminalCause spread for exactOptionalPropertyTypes; malformed Timestamp fallback is defensive and valid terminal cause serialization is covered @preserve */
    ...(terminalCause !== undefined && {
      terminalCause: {
        reason: terminalCause.reason,
        message: terminalCause.message,
        remediation: terminalCause.remediation,
        workerNames: terminalCause.workerNames,
        lastSeenAt: timestampToIso(terminalCause.lastSeenAt) ?? '',
      },
    }),
    /* v8 ignore stop @preserve */
    ...(dispatchStatus.workerHealthDetails !== undefined && {
      workerHealthDetails: dispatchStatus.workerHealthDetails,
    }),
  };
}

export { taskToApiResponse };
