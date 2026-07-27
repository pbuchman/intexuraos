/**
 * Group tasks by Linear issue and derive pipeline state.
 * Ported from apps/web/src/utils/issueGroups.ts lines 157-415.
 *
 * When fetching archived groups, archived tasks are included and the derived
 * aggregateStatus will be 'archived' if all tasks in the group have status 'archived'.
 */

import type { GroupStatus, IssueGroup, PipelineState, PipelineStepData, SerializedTask, StepState } from './types.js';
import { ACTIVE_STATUSES, AGENT_TYPE_LABELS, REMEDIATION_NOT_NEEDED } from './constants.js';
import { hasMergeReadyLabel } from './labelHelpers.js';
import { parseLinearIssueNumber } from './sortIssueGroups.js';

const PR_URL_REGEX = /\/pull\/(\d+)/;

export function getAgentTypeLabel(agentType: string): string {
  const label = AGENT_TYPE_LABELS[agentType];
  if (label !== undefined) {
    return label;
  }
  // Capitalize first letter for unknown agent types
  return agentType.charAt(0).toUpperCase() + agentType.slice(1);
}

function deriveStepState(status: string): StepState {
  if (status === 'planned' || status === 'implemented' || status === 'reviewed') {
    return 'completed';
  }
  if (status === 'queued') {
    return 'queued';
  }
  if (status === 'dispatched') {
    return 'dispatched';
  }
  if (status === 'running') {
    return 'running';
  }
  // failed | interrupted | cancelled
  return 'failed';
}

function isMergeReadyInvalidator(task: SerializedTask): boolean {
  if (task.status === 'archived') {
    return false;
  }
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

function hasDurableMergeReadyEvidence(
  task: SerializedTask | undefined,
  latestInvalidator: SerializedTask | undefined,
): boolean {
  return task !== undefined &&
    task.result?.merge_ready === '1' &&
    task.prMergedAt === undefined &&
    task.prClosedAt === undefined &&
    (latestInvalidator === undefined || compareModifiedDesc(task, latestInvalidator) < 0);
}

export function derivePipeline(tasks: SerializedTask[]): PipelineState {
  const tasksByCreation = [...tasks].sort(compareCreatedDesc);
  const tasksByModification = [...tasks].sort(compareModifiedDesc);

  // Group by agentType, keeping the newest attempt per type. Technical writes
  // must not replace the attempt that represents a pipeline step.
  const stepMap = new Map<string, { task: SerializedTask; step: PipelineStepData }>();

  for (const task of tasksByCreation) {
    if (task.agentType === undefined || task.status === 'archived') {
      continue;
    }
    if (!stepMap.has(task.agentType)) {
      stepMap.set(task.agentType, {
        task,
        step: {
          agentType: task.agentType,
          state: deriveStepState(task.status),
          label: getAgentTypeLabel(task.agentType),
        },
      });
    }
  }

  // Sort steps by the representative task's createdAt ascending (chronological order)
  const entries = [...stepMap.values()];
  entries.sort((a, b) => a.task.createdAt.localeCompare(b.task.createdAt));

  const steps = entries.map((e) => e.step);

  // Actionable logic: if planning completed, no execution step exists, and no
  // implementationTaskId — the user can trigger execution from the UI.
  const planningEntry = stepMap.get('planning');
  const executionEntry = stepMap.get('execution');
  if (
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined &&
    (planningEntry.task.fanOutChildTaskIds === undefined || planningEntry.task.fanOutChildTaskIds.length === 0)
  ) {
    // Insert synthetic execution step right after planning
    const planningIndex = steps.findIndex((s) => s.agentType === 'planning');
    steps.splice(planningIndex + 1, 0, {
      agentType: 'execution',
      state: 'actionable',
      label: 'Execution',
    });
  }

  // Guard: do not show merge button while any task is actively processing
  const hasActiveTask = tasks.some((t) => ACTIVE_STATUSES.has(t.status));

  // Identify the task that owns the group's representative PR. A single Linear
  // issue can have sibling PRs (e.g. plan PR merged, execution PR still open);
  // the merge step and PR badge must scope terminal state to one PR, otherwise
  // a merged plan PR poisons the open execution PR's gate.
  const prOwnerTask = tasksByModification.find(
    (t) => t.status !== 'archived' && t.result?.prUrl !== undefined,
  );
  const isMerged = prOwnerTask?.prMergedAt !== undefined;
  const isClosed = prOwnerTask?.prClosedAt !== undefined;
  const isPrClosedOrMerged = isMerged || isClosed;
  const latestMergeReadyInvalidator = tasksByModification.find(isMergeReadyInvalidator);

  // Merge-ready logic: if execution step is completed, PR exists, and ready-to-merge label present
  if (
    !hasActiveTask &&
    !isPrClosedOrMerged &&
    executionEntry?.step.state === 'completed' &&
    executionEntry.task.result?.prUrl !== undefined &&
    hasMergeReadyLabel(executionEntry.task.linearIssue?.labels)
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }

  // Alt-unlock: latest non-archived remediation explicitly said "no re-review needed".
  // Defense in depth against label-propagation races (see 2026-04-05-fix-stale-merge-action.md
  // and the remediation-complete label restoration in webhookRoutes.ts). When the
  // label hasn't propagated back through the Linear cache yet, the terminal remediation's
  // requiresReReview=false still tells us the group is merge-ready.
  if (
    !hasActiveTask &&
    !isPrClosedOrMerged &&
    executionEntry?.step.state === 'completed' &&
    executionEntry.task.result?.prUrl !== undefined &&
    !steps.some((s) => s.agentType === 'merge')
  ) {
    const latestRemediation = stepMap.get('remediation')?.task;
    if (latestRemediation?.requiresReReview === false) {
      steps.push({
        agentType: 'merge',
        state: 'actionable',
        label: 'Merge',
      });
    }
  }

  if (
    !hasActiveTask &&
    !isPrClosedOrMerged &&
    executionEntry?.step.state === 'completed' &&
    executionEntry.task.result?.prUrl !== undefined &&
    !steps.some((s) => s.agentType === 'merge') &&
    hasDurableMergeReadyEvidence(executionEntry.task, latestMergeReadyInvalidator)
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }

  // Merge-ready fallback for review tasks: if the review step completed with
  // needs_remediation === '0' AND the ready-to-merge label is still present.
  // The label check is essential: handlePrClose removes ready-to-merge when
  // a PR is closed (merged or not), preventing a stale merge button.
  // GUARD: skip for planning→review pipelines where execution hasn't started yet.
  // The backend (submitToExecutionAgent) merges the plan PR under the hood.
  const reviewEntry = stepMap.get('review');
  if (
    !hasActiveTask &&
    !isPrClosedOrMerged &&
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.prNumber !== undefined &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED &&
    hasMergeReadyLabel(reviewEntry.task.linearIssue?.labels) &&
    !steps.some((s) => s.agentType === 'merge') &&
    (planningEntry === undefined || planningEntry.task.implementationTaskId !== undefined)
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }

  if (
    !hasActiveTask &&
    !isPrClosedOrMerged &&
    !steps.some((s) => s.agentType === 'merge') &&
    (
      hasDurableMergeReadyEvidence(reviewEntry?.task, latestMergeReadyInvalidator) ||
      hasDurableMergeReadyEvidence(stepMap.get('execution')?.task, latestMergeReadyInvalidator) ||
      hasDurableMergeReadyEvidence(stepMap.get('pull_request')?.task, latestMergeReadyInvalidator) ||
      hasDurableMergeReadyEvidence(stepMap.get('remediation')?.task, latestMergeReadyInvalidator)
    )
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }

  // PR step -- derive from prOwnerTask (same task used for terminal-state detection above)
  let pr: PipelineState['pr'] = null;
  const ownerPrUrl = prOwnerTask?.result?.prUrl;
  if (ownerPrUrl !== undefined) {
    const match = PR_URL_REGEX.exec(ownerPrUrl);
    if (match?.[1] !== undefined) {
      const hasMergeStep = steps.some((s) => s.agentType === 'merge' && s.state === 'actionable');

      let status: 'open' | 'merged' | 'closed' | 'mergeable';
      if (isMerged) {
        status = 'merged';
      } else if (isClosed) {
        status = 'closed';
      } else if (hasMergeStep) {
        status = 'mergeable';
      } else {
        status = 'open';
      }

      pr = { url: ownerPrUrl, number: match[1], status };
    }
  }

  let failedAttempts = 0;
  let archivedCount = 0;
  for (const t of tasks) {
    if (t.status === 'failed') failedAttempts++;
    else if (t.status === 'archived') archivedCount++;
  }

  return { steps, pr, failedAttempts, archivedCount };
}

export function deriveAggregateStatus(tasks: SerializedTask[], pipeline: PipelineState): GroupStatus {
  // Active: any task is running | dispatched | queued
  const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
  if (hasActive) {
    return 'active';
  }

  // Active: execution completed but review has not explicitly cleared it yet.
  // Keep this aligned with summary-based status derivation so repaired groups do
  // not disappear from the active filter after the route re-groups tasks.
  const hasActionableMerge = pipeline.steps.some(
    (step) => step.agentType === 'merge' && step.state === 'actionable',
  );
  const latestCompletedExecution = [...tasks].sort(compareCreatedDesc).find(
    (task) =>
      task.status !== 'archived' &&
      task.agentType === 'execution' &&
      (task.status === 'implemented' || task.status === 'reviewed'),
  );
  const latestNonArchivedReview = [...tasks].sort(compareCreatedDesc).find(
    (task) => task.status !== 'archived' && task.agentType === 'review',
  );
  if (
    latestCompletedExecution !== undefined &&
    !hasActionableMerge &&
    pipeline.pr?.status !== 'closed' &&
    pipeline.pr?.status !== 'merged' &&
    latestNonArchivedReview?.result?.needs_remediation !== REMEDIATION_NOT_NEEDED
  ) {
    return 'active';
  }

  // Needs-action: has actionable step
  if (pipeline.steps.some((s) => s.state === 'actionable')) {
    return 'needs-action';
  }

  // Failed: latest non-archived task is failed | interrupted
  const latestNonArchived = [...tasks]
    .filter((task) => task.status !== 'archived')
    .sort(compareCreatedDesc)[0];
  if (
    latestNonArchived !== undefined &&
    (latestNonArchived.status === 'failed' || latestNonArchived.status === 'interrupted')
  ) {
    return 'failed';
  }

  // Archived: all tasks are archived
  if (latestNonArchived === undefined && tasks.length > 0) {
    return 'archived';
  }

  // Done: otherwise (includes cancelled)
  return 'done';
}

function compareIsoTimestampDesc(a: string, b: string): number {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return bTime - aTime;
  if (Number.isFinite(aTime)) return -1;
  if (Number.isFinite(bTime)) return 1;
  return 0;
}

function compareCreatedDesc(a: SerializedTask, b: SerializedTask): number {
  return compareIsoTimestampDesc(a.createdAt, b.createdAt) || b.id.localeCompare(a.id);
}

function compareLifecycleDesc(a: SerializedTask, b: SerializedTask): number {
  return compareIsoTimestampDesc(a.statusChangedAt, b.statusChangedAt) || b.id.localeCompare(a.id);
}

function compareModifiedDesc(a: SerializedTask, b: SerializedTask): number {
  return compareIsoTimestampDesc(a.updatedAt, b.updatedAt) || b.id.localeCompare(a.id);
}

function compareCreatedAsc(a: SerializedTask, b: SerializedTask): number {
  return -compareCreatedDesc(a, b);
}

export function groupByLinearIssue(tasks: SerializedTask[]): IssueGroup[] {
  if (tasks.length === 0) {
    return [];
  }

  // Step 1: Group tasks by linearIssueId
  const groupMap = new Map<string, { linearIssueId: string | null; tasks: SerializedTask[] }>();

  for (const task of tasks) {
    const key = task.linearIssueId ?? task.id;
    const linearIssueId = task.linearIssueId ?? null;

    const existing = groupMap.get(key);
    if (existing !== undefined) {
      existing.tasks.push(task);
    } else {
      groupMap.set(key, { linearIssueId, tasks: [task] });
    }
  }

  // Step 2: Build IssueGroup for each group
  const groups: IssueGroup[] = [];

  for (const group of groupMap.values()) {
    const tasksByCreation = [...group.tasks].sort(compareCreatedDesc);
    const tasksByLifecycle = [...group.tasks].sort(compareLifecycleDesc);
    const tasksByModification = [...group.tasks].sort(compareModifiedDesc);

    const pipeline = derivePipeline(group.tasks);
    const aggregateStatus = deriveAggregateStatus(group.tasks, pipeline);

    const latestTask = tasksByCreation[0];
    const lastActivityTask = tasksByLifecycle[0];
    const lastModifiedTask = tasksByModification[0];

    // Re-sort by createdAt ascending for chronological display
    group.tasks.sort(compareCreatedAsc);
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard -- groupMap always has non-empty tasks array so index 0 is always defined @preserve */
    if (latestTask === undefined || lastActivityTask === undefined || lastModifiedTask === undefined) {
      continue;
    }
    /* v8 ignore stop @preserve */

    // Derive linearIssue and mostRecentDispatchedAt in a single pass
    let linearIssue: SerializedTask['linearIssue'] | undefined;
    let mostRecentDispatchedAt: string | undefined;
    for (const task of group.tasks) {
      if (linearIssue === undefined && task.linearIssue !== undefined) {
        linearIssue = task.linearIssue;
      }
      if (task.dispatchedAt !== undefined) {
        if (mostRecentDispatchedAt === undefined || task.dispatchedAt > mostRecentDispatchedAt) {
          mostRecentDispatchedAt = task.dispatchedAt;
        }
      }
    }

    const issueGroup: IssueGroup = {
      linearIssueId: group.linearIssueId,
      linearIssue,
      tasks: group.tasks,
      pipeline,
      latestTask,
      lastActivityAt: lastActivityTask.statusChangedAt,
      lastActivityStatus: lastActivityTask.status,
      lastActivityTaskId: lastActivityTask.id,
      lastModifiedAt: lastModifiedTask.updatedAt,
      aggregateStatus,
    };
    if (mostRecentDispatchedAt !== undefined) {
      issueGroup.mostRecentDispatchedAt = mostRecentDispatchedAt;
    }
    groups.push(issueGroup);
  }

  // Step 3: Default sort by Linear issue number desc, then lifecycle activity desc
  const compareGroupActivity = (a: IssueGroup, b: IssueGroup): number => {
    const activityOrder = b.lastActivityAt.localeCompare(a.lastActivityAt);
    if (activityOrder !== 0) return activityOrder;
    const aKey = a.linearIssueId ?? `standalone_${a.latestTask.id}`;
    const bKey = b.linearIssueId ?? `standalone_${b.latestTask.id}`;
    return bKey.localeCompare(aKey);
  };
  groups.sort((a, b) => {
    const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
    const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;

    // Both standalone: sort by updatedAt desc
    if (aNum === null && bNum === null) {
      return compareGroupActivity(a, b);
    }
    // Standalone sorts before linked
    if (aNum === null) return -1;
    if (bNum === null) return 1;

    // Both linked: sort by issue number desc, then updatedAt desc
    /* v8 ignore start -- ts-type: unreachable fallback -- groupByLinearIssue cannot produce two groups with same issue number; false branch of !== is dead code @preserve */
    if (aNum !== bNum) {
      return bNum - aNum;
    }
    return compareGroupActivity(a, b);
    /* v8 ignore stop @preserve */
  });

  return groups;
}
