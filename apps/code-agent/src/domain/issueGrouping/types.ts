/**
 * Type definitions for backend issue grouping.
 * Operates on serialized API-shaped tasks with ISO string dates.
 */
import type { CodeTaskRebaseResult } from '@intexuraos/code-task-domain';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
export type StepState = 'completed' | 'running' | 'dispatched' | 'queued' | 'failed' | 'waiting' | 'actionable';
export type SortOption = 'linear-id' | 'pr-number' | 'dispatched' | 'last-updated';

export interface PipelineStepData {
  agentType: string;
  state: StepState;
  label: string;
}

export interface PipelineState {
  steps: PipelineStepData[];
  pr: { url: string; number: string; status: 'open' | 'merged' | 'closed' | 'mergeable' } | null;
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
  linearIssueId?: string;
  agentType?: string;
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];
  parentTaskId?: string;
  followUpReason?: string;
  prNumber?: number;
  prMergedAt?: string; // ISO timestamp — set when PR was merged
  prClosedAt?: string; // ISO timestamp — set when PR was closed without merge
  requiresReReview?: boolean; // set on remediation tasks via task-complete callback
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
    requires_re_review?: string;
    execution_outcome_label?: string;
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
  isImportant?: boolean;
}
