/**
 * Type definitions for backend issue grouping.
 * Operates on serialized API-shaped tasks with ISO string dates.
 */

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';
export type StepState = 'completed' | 'running' | 'dispatched' | 'queued' | 'failed' | 'waiting' | 'actionable';
export type SortOption = 'linear-id' | 'pr-number' | 'created-time' | 'started-time';

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

/** SerializedTask is the shape produced by taskToApiResponse (ISO strings, not Timestamps). */
export interface SerializedTask {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  linearIssueId?: string;
  agentType?: string;
  implementationTaskId?: string;
  prNumber?: number;
  result?: {
    prUrl?: string;
    needs_remediation?: string;
  };
  linearIssue?: {
    identifier: string;
    parentIdentifier?: string | null;
    title: string;
    state: { name: string; type: string };
    priority: number;
    assignee: { id: string; name: string } | null;
    labels: { id?: string; name: string }[];
    url: string;
    commentCount: number;
    lastCommentAt: string | null;
  };
  [key: string]: unknown;
}

export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: SerializedTask['linearIssue'] | undefined;
  tasks: SerializedTask[];
  pipeline: PipelineState;
  latestTask: SerializedTask;
  aggregateStatus: GroupStatus;
  mostRecentDispatchedAt?: string;
}
