import type { CodeTask, CodeTaskStatus } from '@/types';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
export type StepState = 'completed' | 'running' | 'dispatched' | 'queued' | 'failed' | 'waiting' | 'actionable';

export interface PipelineStepData {
  agentType: string;
  state: StepState;
  label: string;
}

export interface PipelineState {
  steps: PipelineStepData[];
  pr: { url: string; number: string } | null;
  failedAttempts: number;
  archivedCount: number;
}

export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: CodeTask['linearIssue'] | undefined;
  tasks: CodeTask[];
  pipeline: PipelineState;
  latestTask: CodeTask;
  aggregateStatus: GroupStatus;
  mostRecentDispatchedAt?: string;
}

export type SortOption = 'linear-id' | 'pr-number' | 'started-time' | 'created-time';

const PR_URL_REGEX = /\/pull\/(\d+)/;
const LINEAR_ID_REGEX = /\w+-(\d+)/;

export function parseLinearIssueNumber(id: string): number | null {
  const match = LINEAR_ID_REGEX.exec(id);
  if (match === null) {
    return null;
  }
  const num = match[1];
  if (num === undefined) {
    return null;
  }
  return Number(num);
}

export const ACTIVE_STATUSES: ReadonlySet<CodeTaskStatus> = new Set<CodeTaskStatus>([
  'running',
  'dispatched',
  'queued',
]);

const AGENT_TYPE_LABELS: Record<string, string> = {
  planning: 'Planning',
  execution: 'Execution',
  pull_request: 'PR Task',
  review: 'Review',
  remediation: 'Remediation',
  merge: 'Merge',
};

export function getAgentTypeLabel(agentType: string): string {
  const label = AGENT_TYPE_LABELS[agentType];
  if (label !== undefined) {
    return label;
  }
  // Capitalize first letter for unknown agent types
  return agentType.charAt(0).toUpperCase() + agentType.slice(1);
}

// Mirrors packages/common-core/src/labels.ts normalizeLabel — local copy avoids
// barrel import that pulls in node:crypto, breaking jsdom browser tests.
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

/** Value of `needs_remediation` when the review passed without requiring fixes. */
const REMEDIATION_NOT_NEEDED = '0';

/** Labels that gate the Implement button (backward compat includes `code-task`). */
const IMPLEMENTATION_READY_LABELS: ReadonlySet<string> = new Set([
  'ready-to-implement',
  'code-task',
]);

/**
 * Checks if a task's Linear labels indicate it's ready for implementation.
 *
 * Returns true (show Implement button) when:
 * - `ready-to-implement` label exists (new gated behavior)
 * - `code-task` label exists (backward compat for pre-existing planned tasks)
 * - labels are undefined or empty (graceful fallback when Linear hydration fails or issue has no labels)
 *
 * Returns false (hide Implement button) when:
 * - labels array has items but contains neither `ready-to-implement` nor `code-task`
 */
export function hasImplementationReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return true;
  }
  return labels.some((l) => IMPLEMENTATION_READY_LABELS.has(normalizeLabel(l.name)));
}

/**
 * Checks if a task's Linear labels indicate it's ready for merge.
 *
 * Unlike `hasImplementationReadyLabel`, this returns false for undefined/empty labels —
 * the `ready-to-merge` label is set deterministically by the review-outcome handler,
 * so there is no legacy-data fallback needed.
 */
export function hasMergeReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return false;
  }
  return labels.some((l) => normalizeLabel(l.name) === 'ready-to-merge');
}

/**
 * Determines if a single task is merge-ready for the detail view.
 *
 * Covers three cases:
 * 1. An `implemented` task with its own `result.prUrl` and `ready-to-merge` label
 * 2. A `reviewed` task with a `prNumber` and `ready-to-merge` label — the reviewed
 *    task won't have `result.prUrl` but the merge URL can be constructed from
 *    `repository` + `prNumber`.
 * 3. A `reviewed` task with a `prNumber` and `result.needs_remediation === '0'` —
 *    fallback for review tasks / external PRs where the `ready-to-merge` label was
 *    set on the origin task's Linear issue, not the review task's.
 */
export function isTaskMergeable(task: {
  status: string;
  prNumber?: number;
  result?: { prUrl?: string; needs_remediation?: string };
  linearIssue?: { labels: { name: string }[] };
}): boolean {
  const hasLabel = hasMergeReadyLabel(task.linearIssue?.labels);
  const passedReview = task.result?.needs_remediation === REMEDIATION_NOT_NEEDED;

  if (!hasLabel && !passedReview) {
    return false;
  }
  return (
    (task.status === 'implemented' && task.result?.prUrl !== undefined) ||
    (task.status === 'reviewed' && task.prNumber !== undefined)
  );
}

/**
 * Extracts the merge URL for a single task (detail view).
 *
 * Prefers `result.prUrl`; falls back to constructing from `repository` + `prNumber`.
 */
export function getTaskMergeUrl(task: {
  repository: string;
  prNumber?: number;
  result?: { prUrl?: string };
}): string | undefined {
  if (task.result?.prUrl !== undefined) {
    return task.result.prUrl;
  }
  if (task.prNumber !== undefined) {
    return `https://github.com/${task.repository}/pull/${String(task.prNumber)}`;
  }
  return undefined;
}

function deriveStepState(status: CodeTaskStatus): StepState {
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
  // failed | interrupted
  return 'failed';
}

function derivePipeline(tasks: CodeTask[]): PipelineState {
  // Tasks are already sorted by updatedAt desc from the caller.
  // Group by agentType, keeping only the first non-archived task per type (= latest by updatedAt).
  const stepMap = new Map<string, { task: CodeTask; step: PipelineStepData }>();

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
  // Falls back to allowing actionable if label data is unavailable.
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

  // Merge-ready logic: if execution step is completed, PR exists, and ready-to-merge label present
  if (
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
  // needs_remediation === '0', the PR is mergeable even without the ready-to-merge
  // label (which may have been set on the origin task's Linear issue instead).
  const reviewEntry = stepMap.get('review');
  if (
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.prNumber !== undefined &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED &&
    !steps.some((s) => s.agentType === 'merge')
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }

  // PR step — extract from first non-archived task that has a prUrl
  // Tasks are already sorted by updatedAt desc from the caller, so iterating
  // finds the most-recently-updated task with a prUrl (not just the latest task overall).
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
  const failedAttempts = tasks.filter(
    (t) => t.status === 'failed',
  ).length;

  // archivedCount: count of tasks with status === 'archived'
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  return { steps, pr, failedAttempts, archivedCount };
}

function deriveAggregateStatus(tasks: CodeTask[], pipeline: PipelineState): GroupStatus {
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

  // Archived: ALL tasks are archived
  const allArchived = tasks.every((t) => t.status === 'archived');
  if (allArchived) {
    return 'archived';
  }

  // Done: otherwise (includes cancelled)
  return 'done';
}

function sortByUpdatedAtDesc(a: CodeTask, b: CodeTask): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function sortByCreatedAtAsc(a: CodeTask, b: CodeTask): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function groupByLinearIssue(tasks: CodeTask[]): IssueGroup[] {
  if (tasks.length === 0) {
    return [];
  }

  // Step 1: Group tasks by linearIssueId
  const groupMap = new Map<string, { linearIssueId: string | null; tasks: CodeTask[] }>();

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
    if (latestTask === undefined) {
      continue;
    }

    // Derive linearIssue and mostRecentDispatchedAt in a single pass
    let linearIssue: CodeTask['linearIssue'] | undefined;
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

  // Step 3: Sort groups by Linear issue number desc, then by latestTask.updatedAt desc
  // Groups without linearIssueId sort before all Linear-linked groups
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
    if (aNum !== bNum) {
      return bNum - aNum;
    }
    return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
  });

  return groups;
}

export function sortIssueGroups(groups: IssueGroup[], sortBy: SortOption): IssueGroup[] {
  const sorted = [...groups];

  if (sortBy === 'linear-id') {
    // Sort by Linear issue number descending; standalone (null linearIssueId) groups sort first.
    // This mirrors the sort already applied inside groupByLinearIssue(), making the function
    // correct regardless of the caller's input order.
    sorted.sort((a, b) => {
      const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
      const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;

      if (aNum === null && bNum === null) {
        return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
      }
      if (aNum === null) return -1;
      if (bNum === null) return 1;
      if (aNum !== bNum) return bNum - aNum;
      return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
    });
    return sorted;
  }

  if (sortBy === 'pr-number') {
    sorted.sort((a, b) => {
      const aNum = a.pipeline.pr !== null ? Number(a.pipeline.pr.number) : null;
      const bNum = b.pipeline.pr !== null ? Number(b.pipeline.pr.number) : null;

      // Both have PR: sort desc
      if (aNum !== null && bNum !== null) return bNum - aNum;
      // Only one has PR: the one with PR sorts first
      if (aNum !== null) return -1;
      if (bNum !== null) return 1;
      // Neither has PR: fall back to updatedAt desc
      return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
    });
    return sorted;
  }

  // created-time: sort by createdAt desc
  if (sortBy === 'created-time') {
    sorted.sort((a, b) => b.latestTask.createdAt.localeCompare(a.latestTask.createdAt));
    return sorted;
  }

  // started-time: sort by most recent dispatchedAt desc (groups with dispatchedAt first, then by issue number)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (sortBy === 'started-time') {
    sorted.sort((a, b) => {
      const aDispatched = a.mostRecentDispatchedAt;
      const bDispatched = b.mostRecentDispatchedAt;

      // Both have dispatchedAt: sort desc
      if (aDispatched !== undefined && bDispatched !== undefined) {
        return bDispatched.localeCompare(aDispatched);
      }
      // Only one has dispatchedAt: the one with dispatchedAt sorts first
      if (aDispatched !== undefined) return -1;
      if (bDispatched !== undefined) return 1;
      // Neither has dispatchedAt: fall back to createdAt desc
      return b.latestTask.createdAt.localeCompare(a.latestTask.createdAt);
    });
    return sorted;
  }

  return sorted;
}
