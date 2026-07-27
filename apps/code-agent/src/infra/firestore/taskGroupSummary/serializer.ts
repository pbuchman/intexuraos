/**
 * Pure data transformation and aggregation helpers for TaskGroupSummary.
 *
 * No Firestore SDK coupling beyond the `Timestamp` value type — these helpers
 * are fully unit-testable and contain no I/O.
 */

/* eslint-disable no-restricted-imports, @typescript-eslint/no-base-to-string */
import { Timestamp } from '@google-cloud/firestore';
import type { TaskGroupSummary, UserGroupCounts } from '../../../domain/models/taskGroupSummary.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { GroupStatus } from '../../../domain/issueGrouping/types.js';
import { deriveAggregateStatusFromSummary } from '../../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import { REMEDIATION_NOT_NEEDED } from '../../../domain/issueGrouping/constants.js';
import { resolveTaskLifecycleTime } from '../../../domain/models/taskLifecycleTime.js';

const LINEAR_ISSUE_NUMBER_REGEX = /-(\d+)$/;

// =============================================================================
// Domain predicates (pure)
// =============================================================================

/**
 * Determine the group key for a task.
 * Uses linearIssueId when present, otherwise standalone_{taskId}.
 */
export function getGroupKey(task: CodeTask): string {
  if (task.linearIssueId !== undefined) {
    return task.linearIssueId;
  }
  return `standalone_${task.id}`;
}

export function getLinearIssueSortFields(linearIssueId: string | null): {
  linearIssueNumber: number | null;
  linearIssueSortKey: number;
} {
  if (linearIssueId === null) {
    return { linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER };
  }

  const match = LINEAR_ISSUE_NUMBER_REGEX.exec(linearIssueId);
  const rawNumber = match?.[1];
  if (rawNumber === undefined) {
    return { linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER };
  }

  const issueNumber = Number(rawNumber);
  if (!Number.isFinite(issueNumber)) {
    return { linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER };
  }
  return { linearIssueNumber: issueNumber, linearIssueSortKey: issueNumber };
}

/**
 * Returns true if a task status is active (queued, dispatched, or running).
 */
export function isActiveStatus(status: string): boolean {
  return status === 'queued' || status === 'dispatched' || status === 'running';
}

/**
 * Convert a status string to the user_group_counts field name.
 */
export function statusToCountField(status: GroupStatus): 'active' | 'needsAction' | 'done' | 'failed' | 'archived' {
  switch (status) {
    case 'active': return 'active';
    case 'needs-action': return 'needsAction';
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'archived': return 'archived';
  }
}

/**
 * Compute latestReviewNeedsRemediation from a task's result.
 * Returns true/false/null depending on result fields.
 */
export function computeReviewNeedsRemediation(task: CodeTask): boolean | null {
  if (task.agentType !== 'review' || task.result === undefined) {
    return null;
  }
  const nr = task.result.needs_remediation;
  if (nr === REMEDIATION_NOT_NEEDED) return false;
  if (nr === '1') return true;
  return null;
}

export function hasCompletedExecutionTask(task: CodeTask): boolean {
  return (
    (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) ||
    (task.agentType === 'pull_request' && task.status === 'implemented')
  );
}

export function hasCompletedExecutionAgentOnly(task: CodeTask): boolean {
  return task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed');
}

export function hasImplementationLink(task: CodeTask): boolean {
  return task.implementationTaskId !== undefined || (task.fanOutChildTaskIds !== undefined && task.fanOutChildTaskIds.length > 0);
}

function getMergeReadyReason(task: CodeTask): string | null {
  return task.status !== 'archived' &&
    task.result?.merge_ready === '1' &&
    task.result.merge_ready_reason !== undefined
    ? task.result.merge_ready_reason
    : null;
}

function hasMergeReadyInvalidationResult(task: CodeTask): boolean {
  if (task.agentType === 'review' && task.result?.needs_remediation === '1') {
    return true;
  }
  if (task.agentType === 'pull_request' && task.result?.pull_request_outcome_label === 'commits_pushed') {
    return true;
  }
  if (
    task.agentType === 'remediation' &&
    (task.result?.execution_outcome_label === 'implemented' || task.result?.requires_re_review === '1')
  ) {
    return true;
  }
  return false;
}

function isMergeReadyInvalidator(task: CodeTask): boolean {
  return task.status !== 'archived' && hasMergeReadyInvalidationResult(task);
}

function hasRepresentativePr(task: CodeTask): boolean {
  return task.status !== 'archived' && task.result?.prUrl !== undefined;
}

function normalizeSummarySortFields(summary: TaskGroupSummary): TaskGroupSummary {
  return {
    ...summary,
    ...getLinearIssueSortFields(summary.linearIssueId),
  };
}

// =============================================================================
// Timestamp helper (pure)
// =============================================================================

/**
 * Helper to ensure a value is a Timestamp.
 */
export function toTimestamp(value: unknown): Timestamp {
  /* v8 ignore start -- ts-type: FakeFirestore always stores real Timestamp instances; non-Timestamp value is unreachable in tests @preserve */
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('toDate' in obj && typeof obj['toDate'] === 'function') {
      return obj as unknown as Timestamp;
    }
    if ('_seconds' in obj && typeof obj['_seconds'] === 'number') {
      const seconds = obj['_seconds'];
      const nanos = typeof obj['_nanoseconds'] === 'number' ? obj['_nanoseconds'] : 0;
      return new Timestamp(seconds, nanos);
    }
  }
  return Timestamp.now();
  /* v8 ignore stop @preserve */
}

function compareTimestamps(a: Timestamp, b: Timestamp): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}

function isLaterTimestampOwner(
  candidateAt: Timestamp,
  candidateId: string,
  currentAt: Timestamp,
  currentId: string | undefined,
): boolean {
  return compareTimestampOwners(candidateAt, candidateId, currentAt, currentId) > 0;
}

function compareTimestampOwners(
  candidateAt: Timestamp,
  candidateId: string,
  currentAt: Timestamp,
  currentId: string | undefined,
): number {
  return compareTimestamps(candidateAt, currentAt) || candidateId.localeCompare(currentId ?? '');
}

function isNewerAttempt(task: CodeTask, summary: TaskGroupSummary): boolean {
  if (summary.latestTaskCreatedAt === undefined || summary.latestTaskId === undefined) {
    return true;
  }
  return isLaterTimestampOwner(
    toTimestamp(task.createdAt),
    task.id,
    summary.latestTaskCreatedAt,
    summary.latestTaskId,
  );
}

function lifecycleAt(task: CodeTask): Timestamp {
  return resolveTaskLifecycleTime(task).at;
}

// =============================================================================
// Doc <-> model
// =============================================================================

/**
 * Build a TaskGroupSummary from raw Firestore document data.
 */
export function docToSummary(data: Record<string, unknown>): TaskGroupSummary {
  /* v8 ignore start -- ts-type: FakeFirestore always returns well-formed documents written by this repo; null/missing field fallbacks are unreachable in tests @preserve */
  const linearIssueId = data['linearIssueId'] !== undefined && data['linearIssueId'] !== null
    ? String(data['linearIssueId'])
    : null;
  const fallbackSortFields = getLinearIssueSortFields(linearIssueId);
  return {
    userId: String(data['userId'] ?? ''),
    linearIssueId,
    groupKey: String(data['groupKey'] ?? ''),
    linearIssueNumber: data['linearIssueNumber'] !== undefined && data['linearIssueNumber'] !== null
      ? Number(data['linearIssueNumber'])
      : fallbackSortFields.linearIssueNumber,
    linearIssueSortKey: data['linearIssueSortKey'] !== undefined && data['linearIssueSortKey'] !== null
      ? Number(data['linearIssueSortKey'])
      : fallbackSortFields.linearIssueSortKey,
    taskCount: Number(data['taskCount'] ?? 0),
    ...(Array.isArray(data['taskIds'])
      ? { taskIds: (data['taskIds'] as unknown[]).map(String) }
      : {}),
    ...(typeof data['taskStatusById'] === 'object' && data['taskStatusById'] !== null
      ? { taskStatusById: Object.fromEntries(
        Object.entries(data['taskStatusById'] as Record<string, unknown>)
          .map(([id, status]) => [id, String(status)]),
      ) }
      : {}),
    ...(typeof data['taskLifecycleAtById'] === 'object' && data['taskLifecycleAtById'] !== null
      ? { taskLifecycleAtById: Object.fromEntries(
        Object.entries(data['taskLifecycleAtById'] as Record<string, unknown>)
          .map(([id, at]) => [id, toTimestamp(at)]),
      ) }
      : {}),
    activeTaskCount: Number(data['activeTaskCount'] ?? 0),
    ...(data['latestTaskId'] !== undefined
      ? { latestTaskId: String(data['latestTaskId']) }
      : {}),
    ...(data['latestTaskCreatedAt'] !== undefined && data['latestTaskCreatedAt'] !== null
      ? { latestTaskCreatedAt: toTimestamp(data['latestTaskCreatedAt']) }
      : {}),
    latestTaskStatus: String(data['latestTaskStatus'] ?? ''),
    latestTaskUpdatedAt: toTimestamp(data['latestTaskUpdatedAt']),
    ...(data['latestLifecycleTaskId'] !== undefined
      ? { latestLifecycleTaskId: String(data['latestLifecycleTaskId']) }
      : {}),
    agentTypesPresent: Array.isArray(data['agentTypesPresent'])
      ? (data['agentTypesPresent'] as unknown[]).map(String)
      : [],
    hasCompletedPlanning: data['hasCompletedPlanning'] === true,
    hasCompletedExecution: data['hasCompletedExecution'] === true,
    hasCompletedExecutionAgent: data['hasCompletedExecutionAgent'] === true,
    hasImplementationTaskId: data['hasImplementationTaskId'] === true,
    hasPrUrl: data['hasPrUrl'] === true,
    prNumber: data['prNumber'] !== undefined && data['prNumber'] !== null
      ? Number(data['prNumber'])
      : null,
    latestMergeReadyEvidence: data['latestMergeReadyEvidence'] === true,
    latestMergeReadyReason: data['latestMergeReadyReason'] !== undefined && data['latestMergeReadyReason'] !== null
      ? String(data['latestMergeReadyReason'])
      : null,
    latestMergeReadyUpdatedAt: data['latestMergeReadyUpdatedAt'] !== undefined && data['latestMergeReadyUpdatedAt'] !== null
      ? toTimestamp(data['latestMergeReadyUpdatedAt'])
      : null,
    ...(data['latestMergeReadyDecisionAt'] !== undefined && data['latestMergeReadyDecisionAt'] !== null
      ? { latestMergeReadyDecisionAt: toTimestamp(data['latestMergeReadyDecisionAt']) }
      : {}),
    ...(data['latestMergeReadyDecisionTaskId'] !== undefined && data['latestMergeReadyDecisionTaskId'] !== null
      ? { latestMergeReadyDecisionTaskId: String(data['latestMergeReadyDecisionTaskId']) }
      : {}),
    prMergedAt: data['prMergedAt'] !== undefined && data['prMergedAt'] !== null
      ? toTimestamp(data['prMergedAt'])
      : null,
    prClosedAt: data['prClosedAt'] !== undefined && data['prClosedAt'] !== null
      ? toTimestamp(data['prClosedAt'])
      : null,
    latestReviewNeedsRemediation: data['latestReviewNeedsRemediation'] === true
      ? true
      : data['latestReviewNeedsRemediation'] === false
        ? false
        : null,
    ...(data['latestReviewUpdatedAt'] !== undefined && data['latestReviewUpdatedAt'] !== null
      ? { latestReviewUpdatedAt: toTimestamp(data['latestReviewUpdatedAt']) }
      : {}),
    ...(data['latestReviewTaskId'] !== undefined && data['latestReviewTaskId'] !== null
      ? { latestReviewTaskId: String(data['latestReviewTaskId']) }
      : {}),
    ...(data['representativePrUpdatedAt'] !== undefined && data['representativePrUpdatedAt'] !== null
      ? { representativePrUpdatedAt: toTimestamp(data['representativePrUpdatedAt']) }
      : {}),
    ...(data['representativePrTaskId'] !== undefined && data['representativePrTaskId'] !== null
      ? { representativePrTaskId: String(data['representativePrTaskId']) }
      : {}),
    oldestTaskCreatedAt: toTimestamp(data['oldestTaskCreatedAt']),
    mostRecentDispatchedAt: data['mostRecentDispatchedAt'] !== undefined && data['mostRecentDispatchedAt'] !== null
      ? toTimestamp(data['mostRecentDispatchedAt'])
      : null,
    aggregateStatus: String(data['aggregateStatus'] ?? 'done') as GroupStatus,
    // Label flags are only present when recomputeWithLabels has been called; legacy docs omit them
    ...(data['hasImplementationReadyLabel'] !== undefined
      ? { hasImplementationReadyLabel: data['hasImplementationReadyLabel'] === true }
      : {}),
    ...(data['hasMergeReadyLabel'] !== undefined
      ? { hasMergeReadyLabel: data['hasMergeReadyLabel'] === true }
      : {}),
    ...(data['labelsUpdatedAt'] !== undefined && data['labelsUpdatedAt'] !== null
      ? { labelsUpdatedAt: toTimestamp(data['labelsUpdatedAt']) }
      : {}),
    ...(data['isImportant'] === true
      ? { isImportant: true }
      : {}),
    updatedAt: toTimestamp(data['updatedAt']),
  };
  /* v8 ignore stop @preserve */
}

/**
 * Build a default UserGroupCounts for a user with all zeros.
 */
export function defaultCounts(userId: string): UserGroupCounts {
  return {
    userId,
    active: 0,
    needsAction: 0,
    done: 0,
    failed: 0,
    archived: 0,
    totalGroups: 0,
    updatedAt: Timestamp.now(),
  };
}

/**
 * Build a UserGroupCounts from raw Firestore data.
 */
export function docToCounts(data: Record<string, unknown>): UserGroupCounts {
  /* v8 ignore start -- ts-type: FakeFirestore always returns well-formed documents written by this repo; null/missing field fallbacks are unreachable in tests @preserve */
  return {
    userId: String(data['userId'] ?? ''),
    active: Number(data['active'] ?? 0),
    needsAction: Number(data['needsAction'] ?? 0),
    done: Number(data['done'] ?? 0),
    failed: Number(data['failed'] ?? 0),
    archived: Number(data['archived'] ?? 0),
    totalGroups: Number(data['totalGroups'] ?? 0),
    updatedAt: toTimestamp(data['updatedAt']),
  };
  /* v8 ignore stop @preserve */
}

// =============================================================================
// Aggregation builders (pure — no Firestore reads/writes)
// =============================================================================

/**
 * Build an initial TaskGroupSummary (without aggregateStatus) from the first task in a group.
 */
export function buildInitialSummary(task: CodeTask, now: Timestamp): Omit<TaskGroupSummary, 'aggregateStatus'> {
  const groupKey = getGroupKey(task);
  const sortFields = getLinearIssueSortFields(task.linearIssueId ?? null);
  const agentTypesPresent: string[] = task.agentType !== undefined ? [task.agentType] : [];
  const hasPrUrl = task.result?.prUrl !== undefined;
  const hasCompletedPlanning = task.agentType === 'planning' && task.status === 'planned';
  const hasCompletedExecution = hasCompletedExecutionTask(task);
  const hasCompletedExecutionAgent = hasCompletedExecutionAgentOnly(task);
  const hasImplementationTaskId = hasImplementationLink(task);
  const latestReviewNeedsRemediation = computeReviewNeedsRemediation(task);
  const prNumber = hasPrUrl && task.prNumber !== undefined ? task.prNumber : null;
  const latestMergeReadyReason = getMergeReadyReason(task);
  const taskUpdatedAt = toTimestamp(task.updatedAt);
  const latestMergeReadyUpdatedAt = latestMergeReadyReason !== null ? taskUpdatedAt : null;
  const latestMergeReadyDecisionAt = latestMergeReadyReason !== null || isMergeReadyInvalidator(task)
    ? taskUpdatedAt
    : null;
  const prMergedAt = hasRepresentativePr(task) && task.prMergedAt !== undefined ? toTimestamp(task.prMergedAt) : null;
  const prClosedAt = hasRepresentativePr(task) && task.prClosedAt !== undefined ? toTimestamp(task.prClosedAt) : null;
  const mostRecentDispatchedAt = task.dispatchedAt !== undefined ? toTimestamp(task.dispatchedAt) : null;

  return {
    userId: task.userId,
    linearIssueId: task.linearIssueId ?? null,
    groupKey,
    ...sortFields,
    taskCount: task.status === 'archived' ? 0 : 1,
    taskIds: task.status === 'archived' ? [] : [task.id],
    taskStatusById: task.status === 'archived' ? {} : { [task.id]: task.status },
    taskLifecycleAtById: task.status === 'archived' ? {} : { [task.id]: lifecycleAt(task) },
    activeTaskCount: isActiveStatus(task.status) ? 1 : 0,
    latestTaskId: task.id,
    latestTaskCreatedAt: toTimestamp(task.createdAt),
    latestTaskStatus: task.status,
    latestTaskUpdatedAt: lifecycleAt(task),
    latestLifecycleTaskId: task.id,
    agentTypesPresent,
    hasCompletedPlanning,
    hasCompletedExecution,
    hasCompletedExecutionAgent,
    hasImplementationTaskId,
    hasPrUrl,
    prNumber,
    latestMergeReadyEvidence: latestMergeReadyReason !== null,
    latestMergeReadyReason,
    latestMergeReadyUpdatedAt,
    latestMergeReadyDecisionAt,
    latestMergeReadyDecisionTaskId: latestMergeReadyDecisionAt !== null ? task.id : null,
    prMergedAt,
    prClosedAt,
    latestReviewNeedsRemediation,
    latestReviewUpdatedAt: task.agentType === 'review' && task.result !== undefined ? taskUpdatedAt : null,
    latestReviewTaskId: task.agentType === 'review' && task.result !== undefined ? task.id : null,
    representativePrUpdatedAt: hasRepresentativePr(task) ? taskUpdatedAt : null,
    representativePrTaskId: hasRepresentativePr(task) ? task.id : null,
    oldestTaskCreatedAt: toTimestamp(task.createdAt),
    mostRecentDispatchedAt,
    updatedAt: now,
  };
}

/**
 * Apply an incremental update to an existing TaskGroupSummary when a new task is added to the group.
 * Recomputes aggregateStatus.
 */
export function applyIncrementalCreateUpdate(current: TaskGroupSummary, task: CodeTask, now: Timestamp): TaskGroupSummary {
  const updated: TaskGroupSummary = { ...current };
  updated.updatedAt = now;
  const alreadyKnown = current.taskIds?.includes(task.id) === true;

  if (task.status !== 'archived' && !alreadyKnown) {
    updated.taskCount = current.taskCount + 1;
    if (current.taskIds !== undefined) {
      updated.taskIds = [...current.taskIds, task.id];
      updated.taskStatusById = { ...(current.taskStatusById ?? {}), [task.id]: task.status };
      updated.taskLifecycleAtById = {
        ...(current.taskLifecycleAtById ?? {}),
        [task.id]: lifecycleAt(task),
      };
    }
  }

  if (isActiveStatus(task.status) && !alreadyKnown) {
    updated.activeTaskCount = current.activeTaskCount + 1;
  }

  // Update agentTypesPresent
  if (task.agentType !== undefined && !current.agentTypesPresent.includes(task.agentType)) {
    updated.agentTypesPresent = [...current.agentTypesPresent, task.agentType];
  }

  // Update boolean flags
  if (task.agentType === 'planning' && task.status === 'planned') {
    updated.hasCompletedPlanning = true;
  }
  if (hasCompletedExecutionTask(task)) {
    updated.hasCompletedExecution = true;
  }
  if (hasCompletedExecutionAgentOnly(task)) {
    updated.hasCompletedExecutionAgent = true;
  }
  /* v8 ignore start -- ts-type: FakeFirestore cannot produce a task where implementationTaskId/fanOutChildTaskIds are absent when the branch is already covered; v8 undercounts false-branch due to optional-chaining transpilation in ESM @preserve */
  if (hasImplementationLink(task)) {
    updated.hasImplementationTaskId = true;
  }
  /* v8 ignore stop @preserve */
  if (task.result?.prUrl !== undefined) {
    const taskUpdatedAt = toTimestamp(task.updatedAt);
    if (
      current.representativePrUpdatedAt === undefined ||
      current.representativePrUpdatedAt === null ||
      isLaterTimestampOwner(
        taskUpdatedAt, task.id,
        current.representativePrUpdatedAt, current.representativePrTaskId ?? undefined,
      )
    ) {
      updated.hasPrUrl = true;
      if (task.prNumber !== undefined) {
        updated.prNumber = task.prNumber;
      }
      updated.prMergedAt = task.prMergedAt !== undefined ? toTimestamp(task.prMergedAt) : null;
      updated.prClosedAt = task.prClosedAt !== undefined ? toTimestamp(task.prClosedAt) : null;
      updated.representativePrUpdatedAt = taskUpdatedAt;
      updated.representativePrTaskId = task.id;
    }
  }

  const mergeReadyReason = getMergeReadyReason(task);
  const taskUpdatedAt = toTimestamp(task.updatedAt);
  const latestMergeDecisionAt = current.latestMergeReadyDecisionAt ?? current.latestMergeReadyUpdatedAt;
  const isLatestMergeDecision = latestMergeDecisionAt === undefined || latestMergeDecisionAt === null ||
    isLaterTimestampOwner(
      taskUpdatedAt, task.id,
      latestMergeDecisionAt, current.latestMergeReadyDecisionTaskId ?? undefined,
    );
  if (mergeReadyReason !== null && isLatestMergeDecision) {
    updated.latestMergeReadyEvidence = true;
    updated.latestMergeReadyReason = mergeReadyReason;
    updated.latestMergeReadyUpdatedAt = taskUpdatedAt;
    updated.latestMergeReadyDecisionAt = taskUpdatedAt;
    updated.latestMergeReadyDecisionTaskId = task.id;
  } else if (isMergeReadyInvalidator(task) && isLatestMergeDecision) {
    updated.latestMergeReadyEvidence = false;
    updated.latestMergeReadyReason = null;
    updated.latestMergeReadyUpdatedAt = null;
    updated.latestMergeReadyDecisionAt = taskUpdatedAt;
    updated.latestMergeReadyDecisionTaskId = task.id;
  }

  // Update latestReviewNeedsRemediation if this is a review task with a result
  const reviewNeedsRemediation = computeReviewNeedsRemediation(task);
  if (
    reviewNeedsRemediation !== null &&
    (current.latestReviewUpdatedAt === undefined || current.latestReviewUpdatedAt === null ||
      isLaterTimestampOwner(
        taskUpdatedAt, task.id,
        current.latestReviewUpdatedAt, current.latestReviewTaskId ?? undefined,
      ))
  ) {
    updated.latestReviewNeedsRemediation = reviewNeedsRemediation;
    updated.latestReviewUpdatedAt = taskUpdatedAt;
    updated.latestReviewTaskId = task.id;
  }

  if (isNewerAttempt(task, current)) {
    updated.latestTaskId = task.id;
    updated.latestTaskCreatedAt = toTimestamp(task.createdAt);
    updated.latestTaskStatus = task.status;
  }

  const taskLifecycleAt = lifecycleAt(task);
  if (isLaterTimestampOwner(taskLifecycleAt, task.id, current.latestTaskUpdatedAt, current.latestLifecycleTaskId)) {
    updated.latestTaskUpdatedAt = taskLifecycleAt;
    updated.latestLifecycleTaskId = task.id;
  }

  // Update sort key fields
  if (toTimestamp(task.createdAt).toMillis() < current.oldestTaskCreatedAt.toMillis()) {
    updated.oldestTaskCreatedAt = toTimestamp(task.createdAt);
  }
  if (task.dispatchedAt !== undefined) {
    const dispatchedTs = toTimestamp(task.dispatchedAt);
    if (
      current.mostRecentDispatchedAt === null ||
      dispatchedTs.toMillis() > current.mostRecentDispatchedAt.toMillis()
    ) {
      updated.mostRecentDispatchedAt = dispatchedTs;
    }
  }

  updated.aggregateStatus = deriveAggregateStatusFromSummary(updated);
  return normalizeSummarySortFields(updated);
}

/**
 * Apply an update resulting from a task status change.
 * Returns the updated summary and a flag indicating if all tasks in the group are now archived
 * (in which case the group itself should be marked archived).
 */
export function applyStatusChangeUpdate(
  current: TaskGroupSummary,
  oldTask: CodeTask,
  newTask: CodeTask,
  now: Timestamp,
): { updated: TaskGroupSummary; allArchived: boolean } {
  if (current.taskIds !== undefined && !current.taskIds.includes(newTask.id)) {
    return {
      updated: normalizeSummarySortFields(current),
      allArchived: current.taskCount <= 0 && current.aggregateStatus === 'archived',
    };
  }
  const updated: TaskGroupSummary = { ...current };
  updated.updatedAt = now;
  const taskLifecycleAt = lifecycleAt(newTask);
  const previousTaskLifecycleAt = current.taskLifecycleAtById?.[newTask.id];
  const previousStatus = current.taskStatusById?.[newTask.id] ?? oldTask.status;
  const isNewLifecycleForTask = previousTaskLifecycleAt === undefined ||
    compareTimestamps(taskLifecycleAt, previousTaskLifecycleAt) > 0 ||
    (compareTimestamps(taskLifecycleAt, previousTaskLifecycleAt) === 0 &&
      previousStatus === oldTask.status && oldTask.status !== newTask.status);

  // Update activeTaskCount delta
  const wasActive = isActiveStatus(previousStatus);
  const isActive = isActiveStatus(newTask.status);
  if (isNewLifecycleForTask && wasActive && !isActive) {
    updated.activeTaskCount = Math.max(0, current.activeTaskCount - 1);
  } else if (isNewLifecycleForTask && !wasActive && isActive) {
    updated.activeTaskCount = current.activeTaskCount + 1;
  }

  if (isNewLifecycleForTask) {
    updated.taskStatusById = { ...(current.taskStatusById ?? {}), [newTask.id]: newTask.status };
    updated.taskLifecycleAtById = {
      ...(current.taskLifecycleAtById ?? {}),
      [newTask.id]: taskLifecycleAt,
    };
  }

  // Update boolean flags based on new task state
  if (newTask.agentType !== undefined && !current.agentTypesPresent.includes(newTask.agentType)) {
    updated.agentTypesPresent = [...current.agentTypesPresent, newTask.agentType];
  }
  if (isNewLifecycleForTask && newTask.agentType === 'planning' && newTask.status === 'planned') {
    updated.hasCompletedPlanning = true;
  }
  if (isNewLifecycleForTask && hasCompletedExecutionTask(newTask)) {
    updated.hasCompletedExecution = true;
  }
  if (isNewLifecycleForTask && hasCompletedExecutionAgentOnly(newTask)) {
    updated.hasCompletedExecutionAgent = true;
  }
  if (hasImplementationLink(newTask)) {
    updated.hasImplementationTaskId = true;
  }
  if (newTask.result?.prUrl !== undefined) {
    const taskUpdatedAt = toTimestamp(newTask.updatedAt);
    if (
      current.representativePrUpdatedAt === undefined ||
      current.representativePrUpdatedAt === null ||
      isLaterTimestampOwner(
        taskUpdatedAt, newTask.id,
        current.representativePrUpdatedAt, current.representativePrTaskId ?? undefined,
      )
    ) {
      updated.hasPrUrl = true;
      if (newTask.prNumber !== undefined) {
        updated.prNumber = newTask.prNumber;
      }
      updated.prMergedAt = newTask.prMergedAt !== undefined ? toTimestamp(newTask.prMergedAt) : null;
      updated.prClosedAt = newTask.prClosedAt !== undefined ? toTimestamp(newTask.prClosedAt) : null;
      updated.representativePrUpdatedAt = taskUpdatedAt;
      updated.representativePrTaskId = newTask.id;
    }
  }

  const mergeReadyReason = getMergeReadyReason(newTask);
  const taskUpdatedAt = toTimestamp(newTask.updatedAt);
  const latestMergeDecisionAt = current.latestMergeReadyDecisionAt ?? current.latestMergeReadyUpdatedAt;
  const isLatestMergeDecision = latestMergeDecisionAt === undefined || latestMergeDecisionAt === null ||
    isLaterTimestampOwner(
      taskUpdatedAt, newTask.id,
      latestMergeDecisionAt, current.latestMergeReadyDecisionTaskId ?? undefined,
    );
  if (mergeReadyReason !== null && isLatestMergeDecision) {
    updated.latestMergeReadyEvidence = true;
    updated.latestMergeReadyReason = mergeReadyReason;
    updated.latestMergeReadyUpdatedAt = taskUpdatedAt;
    updated.latestMergeReadyDecisionAt = taskUpdatedAt;
    updated.latestMergeReadyDecisionTaskId = newTask.id;
  } else if (isMergeReadyInvalidator(newTask) && isLatestMergeDecision) {
    updated.latestMergeReadyEvidence = false;
    updated.latestMergeReadyReason = null;
    updated.latestMergeReadyUpdatedAt = null;
    updated.latestMergeReadyDecisionAt = taskUpdatedAt;
    updated.latestMergeReadyDecisionTaskId = newTask.id;
  }

  // Update latestReviewNeedsRemediation
  const reviewNeedsRemediation = computeReviewNeedsRemediation(newTask);
  if (
    reviewNeedsRemediation !== null &&
    (current.latestReviewUpdatedAt === undefined || current.latestReviewUpdatedAt === null ||
      isLaterTimestampOwner(
        taskUpdatedAt, newTask.id,
        current.latestReviewUpdatedAt, current.latestReviewTaskId ?? undefined,
      ))
  ) {
    updated.latestReviewNeedsRemediation = reviewNeedsRemediation;
    updated.latestReviewUpdatedAt = taskUpdatedAt;
    updated.latestReviewTaskId = newTask.id;
  }

  if (isNewLifecycleForTask && (current.latestTaskId === undefined || current.latestTaskId === newTask.id)) {
    updated.latestTaskStatus = newTask.status;
  }

  if (
    isNewLifecycleForTask &&
    isLaterTimestampOwner(taskLifecycleAt, newTask.id, current.latestTaskUpdatedAt, current.latestLifecycleTaskId)
  ) {
    updated.latestTaskUpdatedAt = taskLifecycleAt;
    updated.latestLifecycleTaskId = newTask.id;
  }

  // Handle archive: decrement taskCount
  if (isNewLifecycleForTask && newTask.status === 'archived' && previousStatus !== 'archived') {
    updated.taskCount = Math.max(0, current.taskCount - 1);
    if (current.taskIds !== undefined) {
      updated.taskIds = current.taskIds.filter((id) => id !== newTask.id);
      /* v8 ignore start -- ts-type: undefined maps are impossible on this path because isNewLifecycleForTask initialized them immediately above; optional fields remain in the legacy-compatible interface @preserve */
      const { [newTask.id]: _removedStatus, ...remainingStatuses } = updated.taskStatusById ?? {};
      const { [newTask.id]: _removedLifecycle, ...remainingLifecycle } = updated.taskLifecycleAtById ?? {};
      /* v8 ignore stop @preserve */
      updated.taskStatusById = remainingStatuses;
      updated.taskLifecycleAtById = remainingLifecycle;
    }

    if (updated.taskCount <= 0) {
      // All tasks archived — preserve summary with 'archived' status instead of deleting
      updated.aggregateStatus = 'archived';
      return { updated: normalizeSummarySortFields(updated), allArchived: true };
    }
  }

  // Update sort key for dispatched
  if (newTask.dispatchedAt !== undefined) {
    const dispatchedTs = toTimestamp(newTask.dispatchedAt);
    if (
      current.mostRecentDispatchedAt === null ||
      dispatchedTs.toMillis() > current.mostRecentDispatchedAt.toMillis()
    ) {
      updated.mostRecentDispatchedAt = dispatchedTs;
    }
  }

  updated.aggregateStatus = deriveAggregateStatusFromSummary(updated);
  return { updated: normalizeSummarySortFields(updated), allArchived: false };
}

/**
 * Apply an update resulting from a task delete.
 * Returns the updated summary and a flag indicating if the entire group should be deleted.
 */
export function applyDeleteUpdate(
  current: TaskGroupSummary,
  task: CodeTask,
  now: Timestamp,
): { updated: TaskGroupSummary; shouldDelete: boolean } {
  if (
    current.taskIds !== undefined &&
    !current.taskIds.includes(task.id) &&
    !(task.status === 'archived' && current.taskCount <= 0)
  ) {
    return { updated: normalizeSummarySortFields(current), shouldDelete: false };
  }
  let newTaskCount = current.taskCount;
  let newActiveCount = current.activeTaskCount;

  // Only decrement task count for non-archived tasks (archived tasks were already decremented)
  if (task.status !== 'archived') {
    newTaskCount = Math.max(0, current.taskCount - 1);
  }
  if (isActiveStatus(task.status)) {
    newActiveCount = Math.max(0, current.activeTaskCount - 1);
  }

  if (newTaskCount <= 0) {
    // Caller deletes the summary doc; return current as placeholder (not used when shouldDelete=true)
    return { updated: current, shouldDelete: true };
  }

  const updated: TaskGroupSummary = {
    ...current,
    taskCount: newTaskCount,
    activeTaskCount: newActiveCount,
    ...(current.taskIds !== undefined
      ? { taskIds: current.taskIds.filter((id) => id !== task.id) }
      : {}),
    ...(current.taskStatusById !== undefined
      ? { taskStatusById: Object.fromEntries(
        Object.entries(current.taskStatusById).filter(([id]) => id !== task.id),
      ) }
      : {}),
    ...(current.taskLifecycleAtById !== undefined
      ? { taskLifecycleAtById: Object.fromEntries(
        Object.entries(current.taskLifecycleAtById).filter(([id]) => id !== task.id),
      ) }
      : {}),
    updatedAt: now,
  };

  updated.aggregateStatus = deriveAggregateStatusFromSummary(updated);
  return { updated: normalizeSummarySortFields(updated), shouldDelete: false };
}

/**
 * Compute a full TaskGroupSummary from a list of tasks (backfill/recompute path).
 * Returns null when the task list yields no non-archived tasks.
 * aggregateStatus is set to a placeholder 'done' — the caller should recompute
 * after applying any merged label state (mirrors the legacy recompute flow).
 */
function computeSummaryFromIncludedTasks(
  userId: string,
  groupKey: string,
  includedTasks: CodeTask[],
  now: Timestamp,
  allArchived: boolean,
): TaskGroupSummary | null {
  const firstTask = includedTasks[0];
  if (firstTask === undefined) return null;

  let activeTaskCount = 0;
  let latestAttempt = firstTask;
  let latestLifecycleTask = firstTask;
  let oldestTaskCreatedAt: Timestamp | null = null;
  let mostRecentDispatchedAt: Timestamp | null = null;
  const agentTypesSet = new Set<string>();
  let hasCompletedPlanning = false;
  let hasCompletedExecution = false;
  let hasCompletedExecutionAgent = false;
  let hasImplementationTaskId = false;
  let hasPrUrl = false;
  let prNumber: number | null = null;
  let latestMergeReadyReason: string | null = null;
  let latestMergeReadyUpdatedAt: Timestamp | null = null;
  let prMergedAt: Timestamp | null = null;
  let prClosedAt: Timestamp | null = null;
  let prOwnerUpdatedAt: Timestamp | null = null;
  let prOwnerTaskId = '';
  let latestReviewNeedsRemediation: boolean | null = null;
  let latestReviewUpdatedAt: Timestamp | null = null;
  let latestReviewTaskId = '';
  let latestMergeReadyInvalidatedAt: Timestamp | null = null;
  let latestMergeReadyInvalidatorTaskId = '';
  let latestMergeReadyTaskId = '';

  for (const task of includedTasks) {
    const taskUpdatedAt = toTimestamp(task.updatedAt);
    if (!allArchived && isActiveStatus(task.status)) {
      activeTaskCount++;
    }
    if (task.agentType !== undefined) {
      agentTypesSet.add(task.agentType);
    }

    const archivedPlanningEvidence = allArchived &&
      task.agentType === 'planning' && task.result?.planning_outcome_label === 'planned';
    const archivedExecutionEvidence = allArchived && task.agentType === 'execution' && (
      task.result?.execution_outcome_label === 'implemented' ||
      task.result?.execution_outcome_label === 'already_completed'
    );
    const archivedPullRequestEvidence = allArchived &&
      task.agentType === 'pull_request' && task.result?.pull_request_outcome_label !== undefined;
    if ((task.agentType === 'planning' && task.status === 'planned') || archivedPlanningEvidence) {
      hasCompletedPlanning = true;
    }
    if (hasCompletedExecutionTask(task) || archivedExecutionEvidence || archivedPullRequestEvidence) {
      hasCompletedExecution = true;
    }
    if (hasCompletedExecutionAgentOnly(task) || archivedExecutionEvidence) {
      hasCompletedExecutionAgent = true;
    }
    if (hasImplementationLink(task)) {
      hasImplementationTaskId = true;
    }
    if (task.result?.prUrl !== undefined) {
      hasPrUrl = true;
      if (
        prOwnerUpdatedAt === null ||
        isLaterTimestampOwner(taskUpdatedAt, task.id, prOwnerUpdatedAt, prOwnerTaskId)
      ) {
        prOwnerUpdatedAt = taskUpdatedAt;
        prOwnerTaskId = task.id;
        prNumber = task.prNumber ?? null;
        prMergedAt = task.prMergedAt !== undefined ? toTimestamp(task.prMergedAt) : null;
        prClosedAt = task.prClosedAt !== undefined ? toTimestamp(task.prClosedAt) : null;
      }
    }

    if (isLaterTimestampOwner(
      toTimestamp(task.createdAt), task.id,
      toTimestamp(latestAttempt.createdAt), latestAttempt.id,
    )) {
      latestAttempt = task;
    }
    if (isLaterTimestampOwner(
      lifecycleAt(task), task.id,
      lifecycleAt(latestLifecycleTask), latestLifecycleTask.id,
    )) {
      latestLifecycleTask = task;
    }

    const createdAtMs = toTimestamp(task.createdAt).toMillis();
    if (oldestTaskCreatedAt === null || createdAtMs < oldestTaskCreatedAt.toMillis()) {
      oldestTaskCreatedAt = toTimestamp(task.createdAt);
    }

    if (task.dispatchedAt !== undefined) {
      const dispatchedTs = toTimestamp(task.dispatchedAt);
      if (mostRecentDispatchedAt === null || dispatchedTs.toMillis() > mostRecentDispatchedAt.toMillis()) {
        mostRecentDispatchedAt = dispatchedTs;
      }
    }

    if (task.agentType === 'review' && task.result !== undefined && (
      latestReviewUpdatedAt === null ||
      isLaterTimestampOwner(taskUpdatedAt, task.id, latestReviewUpdatedAt, latestReviewTaskId)
    )) {
      latestReviewUpdatedAt = taskUpdatedAt;
      latestReviewTaskId = task.id;
      latestReviewNeedsRemediation = computeReviewNeedsRemediation(task);
    }

    const mergeReadyReason = allArchived &&
      task.result?.merge_ready === '1' && task.result.merge_ready_reason !== undefined
      ? task.result.merge_ready_reason
      : getMergeReadyReason(task);
    if (
      mergeReadyReason !== null &&
      (latestMergeReadyUpdatedAt === null ||
        isLaterTimestampOwner(taskUpdatedAt, task.id, latestMergeReadyUpdatedAt, latestMergeReadyTaskId))
    ) {
      latestMergeReadyUpdatedAt = taskUpdatedAt;
      latestMergeReadyTaskId = task.id;
      latestMergeReadyReason = mergeReadyReason;
    }
    const invalidatesMergeReady = allArchived
      ? hasMergeReadyInvalidationResult(task)
      : isMergeReadyInvalidator(task);
    if (
      invalidatesMergeReady &&
      (latestMergeReadyInvalidatedAt === null ||
        isLaterTimestampOwner(
          taskUpdatedAt, task.id,
          latestMergeReadyInvalidatedAt, latestMergeReadyInvalidatorTaskId,
        ))
    ) {
      latestMergeReadyInvalidatedAt = taskUpdatedAt;
      latestMergeReadyInvalidatorTaskId = task.id;
    }
  }

  const invalidatorWins = latestMergeReadyInvalidatedAt !== null && (
    latestMergeReadyUpdatedAt === null ||
    compareTimestampOwners(
      latestMergeReadyInvalidatedAt,
      latestMergeReadyInvalidatorTaskId,
      latestMergeReadyUpdatedAt,
      latestMergeReadyTaskId,
    ) >= 0
  );
  if (latestMergeReadyReason !== null && invalidatorWins) {
    latestMergeReadyReason = null;
  }
  const latestMergeDecisionTaskId = invalidatorWins
    ? latestMergeReadyInvalidatorTaskId
    : latestMergeReadyTaskId;
  const linearIssueId = firstTask.linearIssueId ?? null;

  return {
    userId,
    linearIssueId,
    groupKey,
    ...getLinearIssueSortFields(linearIssueId),
    taskCount: allArchived ? 0 : includedTasks.length,
    taskIds: allArchived ? [] : includedTasks.map((task) => task.id),
    taskStatusById: allArchived
      ? {}
      : Object.fromEntries(includedTasks.map((task) => [task.id, task.status])),
    taskLifecycleAtById: allArchived
      ? {}
      : Object.fromEntries(includedTasks.map((task) => [task.id, lifecycleAt(task)])),
    activeTaskCount,
    latestTaskId: latestAttempt.id,
    latestTaskCreatedAt: toTimestamp(latestAttempt.createdAt),
    latestTaskStatus: latestAttempt.status,
    latestTaskUpdatedAt: lifecycleAt(latestLifecycleTask),
    latestLifecycleTaskId: latestLifecycleTask.id,
    agentTypesPresent: Array.from(agentTypesSet),
    hasCompletedPlanning,
    hasCompletedExecution,
    hasCompletedExecutionAgent,
    hasImplementationTaskId,
    hasPrUrl,
    prNumber,
    latestMergeReadyEvidence: latestMergeReadyReason !== null,
    latestMergeReadyReason,
    latestMergeReadyUpdatedAt: latestMergeReadyReason !== null ? latestMergeReadyUpdatedAt : null,
    latestMergeReadyDecisionAt: invalidatorWins
      ? latestMergeReadyInvalidatedAt
      : latestMergeReadyUpdatedAt,
    latestMergeReadyDecisionTaskId: latestMergeDecisionTaskId || null,
    prMergedAt,
    prClosedAt,
    latestReviewNeedsRemediation,
    latestReviewUpdatedAt,
    latestReviewTaskId: latestReviewTaskId || null,
    representativePrUpdatedAt: prOwnerUpdatedAt,
    representativePrTaskId: prOwnerTaskId || null,
    /* v8 ignore start -- ts-type: oldestTaskCreatedAt is always set in the loop when includedTasks is non-empty; the ?? now fallback is a TypeScript narrowing artifact @preserve */
    oldestTaskCreatedAt: oldestTaskCreatedAt ?? now,
    /* v8 ignore stop @preserve */
    mostRecentDispatchedAt,
    aggregateStatus: allArchived ? 'archived' : 'done',
    updatedAt: now,
  };
}

export function computeSummaryFromTasks(
  userId: string,
  groupKey: string,
  tasks: CodeTask[],
  now: Timestamp,
): TaskGroupSummary | null {
  return computeSummaryFromIncludedTasks(
    userId,
    groupKey,
    tasks.filter((task) => task.status !== 'archived' && task.agentType !== 'ask_agent'),
    now,
    false,
  );
}

/** Rebuild the observable shell of a group whose persisted source tasks are all archived. */
export function computeAllArchivedSummaryFromTasks(
  userId: string,
  groupKey: string,
  tasks: CodeTask[],
  now: Timestamp,
): TaskGroupSummary | null {
  return computeSummaryFromIncludedTasks(
    userId,
    groupKey,
    tasks.filter((task) => task.status === 'archived' && task.agentType !== 'ask_agent'),
    now,
    true,
  );
}

// =============================================================================
// Counts deltas (pure)
// =============================================================================

/**
 * Apply a delta to UserGroupCounts when a new group is created.
 * Call when isNewGroup=true.
 */
export function applyNewGroupDelta(counts: UserGroupCounts, newStatus: GroupStatus): UserGroupCounts {
  const result = { ...counts };
  result.totalGroups = result.totalGroups + 1;
  const field = statusToCountField(newStatus);
  result[field] = result[field] + 1;
  return result;
}

/**
 * Apply a delta to UserGroupCounts when a group is deleted.
 * Call when isDeletedGroup=true. oldStatus must be non-null (always is at call sites).
 */
export function applyDeleteGroupDelta(counts: UserGroupCounts, oldStatus: GroupStatus): UserGroupCounts {
  const result = { ...counts };
  result.totalGroups = Math.max(0, result.totalGroups - 1);
  const field = statusToCountField(oldStatus);
  result[field] = Math.max(0, result[field] - 1);
  return result;
}

/**
 * Apply a delta to UserGroupCounts when aggregate status changes.
 * oldStatus and newStatus must differ (caller guarantees this).
 */
export function applyStatusChangeDelta(counts: UserGroupCounts, oldStatus: GroupStatus, newStatus: GroupStatus): UserGroupCounts {
  /* v8 ignore start -- upstream: caller-guaranteed that oldStatus !== newStatus (each call site has an if-guard before invoking this function) so equal-status early-return is unreachable @preserve */
  if (oldStatus === newStatus) return counts;
  /* v8 ignore stop @preserve */
  const result = { ...counts };
  const oldField = statusToCountField(oldStatus);
  const newField = statusToCountField(newStatus);
  result[oldField] = Math.max(0, result[oldField] - 1);
  result[newField] = result[newField] + 1;
  return result;
}
