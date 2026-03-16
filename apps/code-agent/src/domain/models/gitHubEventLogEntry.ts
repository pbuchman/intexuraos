import type {
  GitHubWebhookAction,
  GitHubWebhookEventType,
} from './gitHubWebhookTypes.js';
import type { EventDecisionOutcome } from './eventDecision.js';

export type GitHubEventLogDecisionState = 'pending' | 'completed';

export interface GitHubEventLogEntry {
  id: string;
  githubEventName: string;
  eventType: GitHubWebhookEventType;
  action: GitHubWebhookAction | null;
  repository: string | null;
  pullRequestNumber: number | null;
  authPassedAt: Date;
  updatedAt: Date;
  decisionState: GitHubEventLogDecisionState;
  decisionOutcome: EventDecisionOutcome | null;
  decisionId: string | null;
  rowVersion: number;
}

export interface CreatePendingGitHubEventLogEntryInput {
  id: string;
  githubEventName: string;
  eventType: GitHubWebhookEventType;
  action: GitHubWebhookAction | null;
  repository: string | null;
  pullRequestNumber: number | null;
  authPassedAt: Date;
  updatedAt: Date;
  decisionState: 'pending';
  decisionOutcome: null;
  rowVersion: number;
}

export interface CompleteGitHubEventLogEntryInput {
  id: string;
  decisionId: string;
  decisionState: 'completed';
  decisionOutcome: EventDecisionOutcome;
  updatedAt: Date;
  rowVersion: number;
}
