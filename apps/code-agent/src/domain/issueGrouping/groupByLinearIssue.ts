/**
 * Group tasks by Linear issue and derive pipeline state.
 * Ported from apps/web/src/utils/issueGroups.ts lines 157-415.
 *
 * Key difference from frontend: the backend does not include 'archived' as a
 * GroupStatus because archived tasks are excluded from the query.
 */

import type { GroupStatus, IssueGroup, PipelineState, PipelineStepData, SerializedTask, StepState } from './types.js';
import { ACTIVE_STATUSES, AGENT_TYPE_LABELS, REMEDIATION_NOT_NEEDED } from './constants.js';
import { hasImplementationReadyLabel, hasMergeReadyLabel } from './labelHelpers.js';
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

export function derivePipeline(tasks: SerializedTask[]): PipelineState {
  // Tasks are already sorted by updatedAt desc from the caller.
  // Group by agentType, keeping only the first non-archived task per type (= latest by updatedAt).
  const stepMap = new Map<string, { task: SerializedTask; step: PipelineStepData }>();

  for (const task of tasks) {
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

  // Actionable logic: if planning completed, no execution step exists, no implementationTaskId,
  // AND the Linear issue has a ready-to-implement or code-task label (backward compat).
  const planningEntry = stepMap.get('planning');
  const executionEntry = stepMap.get('execution');
  if (
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined &&
    hasImplementationReadyLabel(planningEntry.task.linearIssue?.labels)
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
  const hasActiveTask = tasks.some((t) => t.status !== 'archived' && ACTIVE_STATUSES.has(t.status));

  // Merge-ready logic: if execution step is completed, PR exists, and ready-to-merge label present
  if (
    !hasActiveTask &&
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

  // Merge-ready fallback for review tasks: if the review step completed with
  // needs_remediation === '0' AND the ready-to-merge label is still present.
  // The label check is essential: handlePrClose removes ready-to-merge when
  // a PR is closed (merged or not), preventing a stale merge button.
  const reviewEntry = stepMap.get('review');
  if (
    !hasActiveTask &&
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.prNumber !== undefined &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED &&
    hasMergeReadyLabel(reviewEntry.task.linearIssue?.labels) &&
    !steps.some((s) => s.agentType === 'merge')
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }

  // PR step -- extract from first non-archived task that has a prUrl
  let pr: PipelineState['pr'] = null;
  for (const task of tasks) {
    if (task.status === 'archived') continue;
    const prUrl = task.result?.prUrl;
    if (prUrl !== undefined) {
      const match = PR_URL_REGEX.exec(prUrl);
      if (match?.[1] !== undefined) {
        pr = { url: prUrl, number: match[1] };
        break;
      }
    }
  }

  // failedAttempts: count of tasks with status === 'failed'
  const failedAttempts = tasks.filter((t) => t.status === 'failed').length;

  // archivedCount: count of tasks with status === 'archived'
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  return { steps, pr, failedAttempts, archivedCount };
}

export function deriveAggregateStatus(tasks: SerializedTask[], pipeline: PipelineState): GroupStatus {
  // Active: any task is running | dispatched | queued
  const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
  if (hasActive) {
    return 'active';
  }

  // Needs-action: has actionable step
  if (pipeline.steps.some((s) => s.state === 'actionable')) {
    return 'needs-action';
  }

  // Failed: latest non-archived task is failed | interrupted
  const latestNonArchived = tasks.find((t) => t.status !== 'archived');
  if (
    latestNonArchived !== undefined &&
    (latestNonArchived.status === 'failed' || latestNonArchived.status === 'interrupted')
  ) {
    return 'failed';
  }

  // Done: otherwise (includes cancelled)
  // Note: no 'archived' status on backend since archived tasks are excluded from the query
  return 'done';
}

function sortByUpdatedAtDesc(a: SerializedTask, b: SerializedTask): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function sortByCreatedAtAsc(a: SerializedTask, b: SerializedTask): number {
  return a.createdAt.localeCompare(b.createdAt);
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
    // Sort by updatedAt desc to derive pipeline, status, and latestTask
    group.tasks.sort(sortByUpdatedAtDesc);

    const pipeline = derivePipeline(group.tasks);
    const aggregateStatus = deriveAggregateStatus(group.tasks, pipeline);

    // latestTask is tasks[0] (most recently updated)
    const latestTask = group.tasks[0];

    // Re-sort by createdAt ascending for chronological display
    group.tasks.sort(sortByCreatedAtAsc);
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard -- groupMap always has non-empty tasks array so index 0 is always defined @preserve */
    if (latestTask === undefined) {
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
      aggregateStatus,
    };
    if (mostRecentDispatchedAt !== undefined) {
      issueGroup.mostRecentDispatchedAt = mostRecentDispatchedAt;
    }
    groups.push(issueGroup);
  }

  // Step 3: Default sort by Linear issue number desc, then by latestTask.updatedAt desc
  groups.sort((a, b) => {
    const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
    const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;

    // Both standalone: sort by updatedAt desc
    if (aNum === null && bNum === null) {
      return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
    }
    // Standalone sorts before linked
    if (aNum === null) return -1;
    if (bNum === null) return 1;

    // Both linked: sort by issue number desc, then updatedAt desc
    /* v8 ignore start -- ts-type: unreachable fallback -- groupByLinearIssue cannot produce two groups with same issue number; false branch of !== is dead code @preserve */
    if (aNum !== bNum) {
      return bNum - aNum;
    }
    return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
    /* v8 ignore stop @preserve */
  });

  return groups;
}
