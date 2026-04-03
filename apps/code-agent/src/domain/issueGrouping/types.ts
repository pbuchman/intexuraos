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

/**
 * SerializedTask is the shape produced by taskToSerializedTask in the route handler.
 * Includes all fields needed by the grouping/pipeline logic and the frontend CodeTask type.
 */
export interface SerializedTask {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: string;
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: string;
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  agentType?: string;
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];
  parentTaskId?: string;
  followUpReason?: string;
  prNumber?: number;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
    review_comments_posted?: string;
    review_types?: string;
    requirements_tracker_updated?: string;
    needs_remediation?: string;
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
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
