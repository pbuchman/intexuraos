/**
 * API response types for the issue-groups endpoint.
 * These types match the backend IssueGroup shape, enabling direct
 * reuse of IssueGroupRow and other existing components.
 */

import type { CodeTask } from './index.js';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
export type SortOption = 'linear-id' | 'pr-number' | 'dispatched' | 'last-updated';
export type ActioningType = 'archive' | 'delete' | 'implement' | 'retry' | null;
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

export interface ListIssueGroupsResponse {
  groups: IssueGroup[];
  counts: Record<GroupStatus, number>;
  totalGroups: number;
  nextCursor?: string;
}
