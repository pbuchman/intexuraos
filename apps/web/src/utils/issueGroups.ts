import type { CodeTask, CodeTaskStatus } from '@/types';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
export type StepState = 'completed' | 'running' | 'failed' | 'waiting' | 'actionable';

export interface PipelineState {
  planning: StepState | null;
  execution: StepState | null;
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
  if (status === 'planned' || status === 'implemented') {
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

  return { planning, execution, pr, failedAttempts, archivedCount };
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
    // Sort tasks by updatedAt desc
    group.tasks.sort(sortByUpdatedAtDesc);

    const pipeline = derivePipeline(group.tasks);
    const aggregateStatus = deriveAggregateStatus(group.tasks, pipeline);

    // latestTask is tasks[0] (already sorted)
    const latestTask = group.tasks[0];
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
