export type ActionType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear' | 'code';
export type ActionStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'archived';

/**
 * Status of the associated resource (e.g., code task).
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 309-348)
 */
export type ResourceStatus =
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/**
 * Payload for code actions
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 */
export interface CodeActionPayload {
  /** The user's request (what they want Claude to do) */
  prompt: string;
  /** Which model to use (see design lines 1203-1230) */
  workerType: 'opus' | 'auto' | 'glm';
  /** Optional: existing Linear issue to work on */
  linearIssueId?: string;
  /** Optional: title if issue exists */
  linearIssueTitle?: string;
  /** Set when user approves (for idempotency - see design lines 1526-1536) */
  approvalEventId?: string;
  /** Set by code-agent after task creation (design lines 1471-1474) */
  resource_url?: string;
}

export interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: ActionType;
  confidence: number;
  title: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  /** Status of the associated resource (e.g., code task) */
  resource_status?: ResourceStatus;
  /** Error message from resource execution */
  resource_error?: string;
  /** Approval nonce for code actions (4-char hex) */
  approvalNonce?: string;
  /** When the approval nonce expires (ISO 8601 timestamp) */
  approvalNonceExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function createAction(params: {
  userId: string;
  commandId: string;
  type: ActionType;
  confidence: number;
  title: string;
}): Action {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: params.userId,
    commandId: params.commandId,
    type: params.type,
    confidence: params.confidence,
    title: params.title,
    status: 'pending',
    payload: {},
    createdAt: now,
    updatedAt: now,
  };
}
