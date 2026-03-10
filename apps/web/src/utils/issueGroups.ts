import type { CodeTask, CodeTaskStatus } from '@/types';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
export type StepState = 'completed' | 'running' | 'failed' | 'waiting' | 'actionable';
export type SortKey = 'linearId' | 'pr' | 'finished' | 'startedAt';

export interface PipelineState {
  planning: StepState | null;
  execution: StepState | null;
  review: StepState | null;
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
}

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

const ACTIVE_STATUSES: ReadonlySet<CodeTaskStatus> = new Set<CodeTaskStatus>([
  'running',
  'dispatched',
  'queued',
]);

function deriveStepState(status: CodeTaskStatus): StepState {
  if (status === 'planned' || status === 'implemented' || status === 'reviewed') {
    return 'completed';
  }
  if (status === 'running' || status === 'dispatched' || status === 'queued') {
    return 'running';
  }
  // failed | interrupted
  return 'failed';
}

function derivePipeline(tasks: CodeTask[]): PipelineState {
  // Find latest non-archived planning task
  const planningTask = tasks.find(
    (t) => t.agentType === 'planning' && t.status !== 'archived',
  );

  // Find latest non-archived execution task
  const executionTask = tasks.find(
    (t) => t.agentType === 'execution' && t.status !== 'archived',
  );

  // Planning step
  const planning = planningTask !== undefined ? deriveStepState(planningTask.status) : null;

  // Execution step
  let execution: StepState | null = null;
  if (executionTask !== undefined) {
    execution = deriveStepState(executionTask.status);
  } else if (
    planning === 'completed' &&
    planningTask !== undefined &&
    planningTask.implementationTaskId === undefined
  ) {
    execution = 'actionable';
  }

  // Review step
  const reviewTask = tasks.find(
    (t) => t.agentType === 'review' && t.status !== 'archived',
  );
  const review = reviewTask !== undefined ? deriveStepState(reviewTask.status) : null;

  // PR step — extract from any task's result.prUrl
  let pr: PipelineState['pr'] = null;
  for (const task of tasks) {
    const prUrl = task.result?.prUrl;
    if (prUrl !== undefined) {
      const match = PR_URL_REGEX.exec(prUrl);
      if (match !== null) {
        const prNumber = match[1];
        if (prNumber !== undefined) {
          pr = { url: prUrl, number: prNumber };
          break;
        }
      }
    }
  }

  // failedAttempts: count of tasks with status === 'failed'
  const failedAttempts = tasks.filter(
    (t) => t.status === 'failed',
  ).length;

  // archivedCount: count of tasks with status === 'archived'
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  return { planning, execution, review, pr, failedAttempts, archivedCount };
}

function deriveAggregateStatus(tasks: CodeTask[], pipeline: PipelineState): GroupStatus {
  // Active: any task is running | dispatched | queued
  const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
  if (hasActive) {
    return 'active';
  }

  // Needs-action: has planned task without implementationTaskId
  if (pipeline.execution === 'actionable') {
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

    // linearIssue from any task in group that has it
    let linearIssue: CodeTask['linearIssue'] | undefined;
    for (const task of group.tasks) {
      if (task.linearIssue !== undefined) {
        linearIssue = task.linearIssue;
        break;
      }
    }

    groups.push({
      linearIssueId: group.linearIssueId,
      linearIssue,
      tasks: group.tasks,
      pipeline,
      latestTask,
      aggregateStatus,
    });
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

/**
 * Get the most recent dispatchedAt timestamp from any task in the group.
 * Returns undefined if no task has been dispatched yet.
 */
function getGroupDispatchedAt(group: IssueGroup): string | undefined {
  for (const task of group.tasks) {
    if (task.dispatchedAt !== undefined) {
      return task.dispatchedAt;
    }
  }
  return undefined;
}

/**
 * Get the finished timestamp from the latest completed/reviewed task.
 * Returns undefined if no task is completed yet.
 */
function getGroupFinishedAt(group: IssueGroup): string | undefined {
  // Find the most recent completed/reviewed task
  const completedStatuses: CodeTaskStatus[] = ['planned', 'implemented', 'reviewed'];
  for (const task of group.tasks) {
    if (completedStatuses.includes(task.status)) {
      return task.updatedAt;
    }
  }
  return undefined;
}

/**
 * Get the PR number from the group (if any).
 * Returns 0 if no PR exists.
 */
function getGroupPrNumber(group: IssueGroup): number {
  if (group.pipeline.pr !== null) {
    return Number(group.pipeline.pr.number);
  }
  return 0;
}

/**
 * Sort groups by the specified sort key.
 * - linearId: Sort by Linear issue number desc (default)
 * - pr: Sort by PR number desc (groups with PRs first, then by issue number)
 * - finished: Sort by finished date desc (groups with completed tasks first, then by issue number)
 * - startedAt: Sort by most recent dispatchedAt desc (groups with dispatchedAt first, then by issue number)
 */
export function sortGroups(groups: IssueGroup[], sortKey: SortKey): IssueGroup[] {
  const sorted = [...groups];

  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'startedAt': {
        // Sort by most recent dispatchedAt desc, groups without dispatchedAt sort last
        const aDispatched = getGroupDispatchedAt(a);
        const bDispatched = getGroupDispatchedAt(b);

        // Both have dispatchedAt: sort by date desc
        if (aDispatched !== undefined && bDispatched !== undefined) {
          return bDispatched.localeCompare(aDispatched);
        }
        // Only a has dispatchedAt: a comes first
        if (aDispatched !== undefined) return -1;
        // Only b has dispatchedAt: b comes first
        if (bDispatched !== undefined) return 1;

        // Neither has dispatchedAt: fall back to linearId sort
        const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
        const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;
        if (aNum === null && bNum === null) {
          return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
        }
        if (aNum === null) return -1;
        if (bNum === null) return 1;
        return bNum - aNum;
      }

      case 'finished': {
        // Sort by finished date desc, groups without finished date sort last
        const aFinished = getGroupFinishedAt(a);
        const bFinished = getGroupFinishedAt(b);

        // Both have finishedAt: sort by date desc
        if (aFinished !== undefined && bFinished !== undefined) {
          return bFinished.localeCompare(aFinished);
        }
        // Only a has finishedAt: a comes first
        if (aFinished !== undefined) return -1;
        // Only b has finishedAt: b comes first
        if (bFinished !== undefined) return 1;

        // Neither has finishedAt: fall back to linearId sort
        const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
        const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;
        if (aNum === null && bNum === null) {
          return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
        }
        if (aNum === null) return -1;
        if (bNum === null) return 1;
        return bNum - aNum;
      }

      case 'pr': {
        // Sort by PR number desc, groups with PRs first
        const aPr = getGroupPrNumber(a);
        const bPr = getGroupPrNumber(b);

        // Both have PRs: sort by PR number desc
        if (aPr > 0 && bPr > 0) {
          return bPr - aPr;
        }
        // Only a has PR: a comes first
        if (aPr > 0) return -1;
        // Only b has PR: b comes first
        if (bPr > 0) return 1;

        // Neither has PR: fall back to linearId sort
        const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
        const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;
        if (aNum === null && bNum === null) {
          return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
        }
        if (aNum === null) return -1;
        if (bNum === null) return 1;
        return bNum - aNum;
      }

      case 'linearId':
      default: {
        // Default: sort by Linear issue number desc
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
      }
    }
  });

  return sorted;
}
