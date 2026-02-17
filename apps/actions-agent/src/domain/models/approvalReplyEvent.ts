/**
 * Event published by whatsapp-service when a user replies to an approval message.
 */
export interface ApprovalReplyEvent {
  /** Event type identifier */
  type: 'action.approval.reply';
  /** The wamid of the original approval message being replied to */
  replyToWamid: string;
  /** The user's reply text */
  replyText: string;
  /** The user ID */
  userId: string;
  /** Timestamp of the reply */
  timestamp: string;
  /** Optional action ID extracted from correlation ID */
  actionId?: string;
  /** Optional button ID (format: "approve:{actionId}:{nonce}" | "cancel:{actionId}" | "cancel-task:{taskId}:{nonce}") */
  buttonId?: string;
  /** Optional button title (user-visible text of the button clicked) */
  buttonTitle?: string;
}
