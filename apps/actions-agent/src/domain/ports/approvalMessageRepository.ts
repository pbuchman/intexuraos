import type { ApprovalMessage } from '../models/approvalMessage.js';

/**
 * Repository for managing approval message records.
 * Used to link incoming WhatsApp replies to their original approval requests.
 */
export interface ApprovalMessageRepository {
  /**
   * Save a new approval message record.
   * Called after sending an approval request via WhatsApp.
   */
  save(message: ApprovalMessage): Promise<void>;

  /**
   * Find an approval message by its WhatsApp message ID.
   * Used when processing incoming replies to identify the target action.
   */
  findByWamid(wamid: string): Promise<ApprovalMessage | null>;

  /**
   * Delete all approval messages for a given action.
   * Called when an action is completed, rejected, or deleted.
   */
  deleteByActionId(actionId: string): Promise<void>;

  /**
   * Find approval message by action ID.
   * Used to check if an approval message already exists for an action.
   */
  findByActionId(actionId: string): Promise<ApprovalMessage | null>;
}
