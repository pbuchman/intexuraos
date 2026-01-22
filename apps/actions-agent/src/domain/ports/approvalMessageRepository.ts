import type { Result } from '@intexuraos/common-core';
import type { ApprovalMessage } from '../models/approvalMessage.js';

/**
 * Error returned by ApprovalMessageRepository operations.
 */
export interface ApprovalMessageRepositoryError {
  code: 'PERSISTENCE_ERROR';
  message: string;
}

/**
 * Repository for managing approval message records.
 * Used to link incoming WhatsApp replies to their original approval requests.
 */
export interface ApprovalMessageRepository {
  /**
   * Save a new approval message record.
   * Called after sending an approval request via WhatsApp.
   */
  save(message: ApprovalMessage): Promise<Result<void, ApprovalMessageRepositoryError>>;

  /**
   * Find an approval message by its WhatsApp message ID.
   * Used when processing incoming replies to identify the target action.
   */
  findByWamid(wamid: string): Promise<Result<ApprovalMessage | null, ApprovalMessageRepositoryError>>;

  /**
   * Delete all approval messages for a given action.
   * Called when an action is completed, rejected, or deleted.
   */
  deleteByActionId(actionId: string): Promise<Result<void, ApprovalMessageRepositoryError>>;

  /**
   * Find approval message by action ID.
   * Used to check if an approval message already exists for an action.
   */
  findByActionId(actionId: string): Promise<Result<ApprovalMessage | null, ApprovalMessageRepositoryError>>;
}
