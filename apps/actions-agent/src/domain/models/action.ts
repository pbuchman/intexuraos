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
