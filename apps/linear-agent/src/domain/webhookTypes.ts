/**
 * Linear webhook event types.
 * Based on Linear API documentation.
 */

export type WebhookAction = 'create' | 'update' | 'remove';

/** Webhook type constants for type-safe comparisons */
export const WEBHOOK_TYPES = {
  ISSUE: 'Issue',
  COMMENT: 'Comment',
} as const;

export type WebhookType = typeof WEBHOOK_TYPES[keyof typeof WEBHOOK_TYPES];

export interface LinearWebhookPayload {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  assignee: {
    id: string;
    name: string;
  } | null;
  labels: {
    id: string;
    name: string;
    color?: string; // Not provided by webhooks, only by API
  }[];
  team: {
    id: string;
    key: string;
  };
  parent?: {
    id: string;
  };
}

export interface LinearWebhookUpdatedFrom {
  assigneeId?: string | null;
  stateId?: string | null;
  updatedAt?: string;
}

export interface LinearWebhookEvent {
  action: WebhookAction;
  type: string;
  data: LinearWebhookPayload;
  updatedFrom?: LinearWebhookUpdatedFrom;
  webhookTimestamp: number;
  webhookId: string;
}

export interface LinearCommentWebhookPayload {
  id: string;
  issueId: string;
  /** Issue identifier (e.g., "INT-123") */
  issueIdentifier: string;
  /** Comment author */
  user: {
    id: string;
    name: string;
  };
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface LinearCommentWebhookEvent {
  action: WebhookAction;
  type: string;
  data: LinearCommentWebhookPayload;
  webhookTimestamp: number;
  webhookId: string;
}
