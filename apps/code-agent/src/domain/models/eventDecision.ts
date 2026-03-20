/**
 * Event Decision domain model.
 *
 * Records the decision made for each GitHub webhook event that reaches
 * the UnifiedEvaluator. Provides an audit trail linking events to actions.
 */

import type {
  GitHubWebhookAction,
  GitHubWebhookEventType,
} from './gitHubWebhookTypes.js';
import type { WorkerType } from './codeTask.js';

export type EventDecisionMaker = 'hard_rules' | 'github_agent' | 'webhook_route';
export type EventDecisionOutcome = 'dispatch' | 'skip' | 'request_review';
export type EventDecisionDispatchAction = 'create_task' | 'send_message' | 'create_review_task';
export type EventDecisionReviewType = 'code_quality' | 'security' | 'architecture' | 'plan_review';

export interface EventDecision {
  id: string;
  eventId: string;
  normalizedEventId?: string;
  repository: string | null;
  pullRequestNumber: number | null;

  eventType: GitHubWebhookEventType;
  eventAction: GitHubWebhookAction;
  senderLogin: string | null;

  decidedBy: EventDecisionMaker;

  decision: EventDecisionOutcome;
  reason: string;

  dispatchAction?: EventDecisionDispatchAction;
  dispatchParams?: {
    taskId?: string;
    messageTemplate?: string;
    reviewTypes?: EventDecisionReviewType[];
    workerType?: WorkerType;
  };

  llmModel?: string;
  llmCostUsd?: number;
  llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
  llmReasoning?: string;

  dispatchSuccess?: boolean;
  dispatchError?: string;

  createdAt: Date;
  decisionLatencyMs: number;
}

/**
 * Input for creating a new event decision record.
 */
export interface CreateEventDecisionInput {
  eventId: string;
  normalizedEventId?: string;
  repository: string | null;
  pullRequestNumber: number | null;

  eventType: GitHubWebhookEventType;
  eventAction: GitHubWebhookAction;
  senderLogin: string | null;

  decidedBy: EventDecisionMaker;

  decision: EventDecisionOutcome;
  reason: string;

  dispatchAction?: EventDecisionDispatchAction;
  dispatchParams?: {
    taskId?: string;
    messageTemplate?: string;
    reviewTypes?: EventDecisionReviewType[];
    workerType?: WorkerType;
  };

  llmModel?: string;
  llmCostUsd?: number;
  llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
  llmReasoning?: string;

  dispatchSuccess?: boolean;
  dispatchError?: string;

  decisionLatencyMs: number;
}
