/**
 * Event Decision domain model.
 *
 * Records the decision made for each GitHub webhook event that reaches
 * the UnifiedEvaluator. Provides an audit trail linking events to actions.
 */

import type { GitHubEventType } from './gitHubPREvent.js';

export interface EventDecision {
  id: string;
  eventId: string;
  repository: string;
  pullRequestNumber: number;

  eventType: GitHubEventType;
  eventAction: string;
  senderLogin: string;

  decidedBy: 'hard_rules' | 'github_agent';

  decision: 'dispatch' | 'skip' | 'request_review';
  reason: string;

  dispatchAction?: 'create_task' | 'send_message' | 'create_review_task';
  dispatchParams?: {
    taskId?: string;
    messageTemplate?: string;
    reviewTypes?: string[];
  };

  llmModel?: string;
  llmCostUsd?: number;
  llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
  llmReasoning?: string;

  createdAt: Date;
  decisionLatencyMs: number;
}

/**
 * Input for creating a new event decision record.
 */
export interface CreateEventDecisionInput {
  eventId: string;
  repository: string;
  pullRequestNumber: number;

  eventType: GitHubEventType;
  eventAction: string;
  senderLogin: string;

  decidedBy: 'hard_rules' | 'github_agent';

  decision: 'dispatch' | 'skip' | 'request_review';
  reason: string;

  dispatchAction?: 'create_task' | 'send_message' | 'create_review_task';
  dispatchParams?: {
    taskId?: string;
    messageTemplate?: string;
    reviewTypes?: string[];
  };

  llmModel?: string;
  llmCostUsd?: number;
  llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
  llmReasoning?: string;

  decisionLatencyMs: number;
}
