import type { ActionType } from './action.js';

/**
 * Tracks outgoing WhatsApp approval request messages.
 * Used to match incoming replies to the action they're approving/rejecting.
 */
export interface ApprovalMessage {
  /** Firestore document ID */
  id: string;
  /** WhatsApp message ID (wamid.xxx) - indexed for lookup */
  wamid: string;
  /** Reference to the action awaiting approval */
  actionId: string;
  /** User who should approve/reject */
  userId: string;
  /** When the approval request was sent */
  sentAt: string;
  /** Action type for logging/debugging */
  actionType: ActionType;
  /** Action title for logging/debugging */
  actionTitle: string;
}

export function createApprovalMessage(params: {
  wamid: string;
  actionId: string;
  userId: string;
  actionType: ActionType;
  actionTitle: string;
}): ApprovalMessage {
  return {
    id: crypto.randomUUID(),
    wamid: params.wamid,
    actionId: params.actionId,
    userId: params.userId,
    sentAt: new Date().toISOString(),
    actionType: params.actionType,
    actionTitle: params.actionTitle,
  };
}
