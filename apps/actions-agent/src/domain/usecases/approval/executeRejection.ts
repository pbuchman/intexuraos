import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../../models/action.js';
import type { ActionRepository } from '../../ports/actionRepository.js';
import type { HandleApprovalReplyDeps } from '../handleApprovalReply.js';
import type { ApprovalReplyResult, ApprovalIntent } from './types.js';

/**
 * Execute action rejection (shared between cancel, reject, and convert).
 */
export async function executeRejection(
  action: Action,
  actionRepository: ActionRepository,
  _reason: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  approvalMessageRepository: HandleApprovalReplyDeps['approvalMessageRepository'],
  logger: Logger,
  isConvert = false
): Promise<Result<ApprovalReplyResult>> {
  const updateResult = await actionRepository.updateStatusIf(
    action.id,
    'rejected',
    'awaiting_approval'
  );

  if (updateResult.outcome === 'status_mismatch') {
    logger.info(
      { actionId: action.id, currentStatus: updateResult.currentStatus },
      'Action already processed by another response'
    );
    return ok({
      matched: true,
      actionId: action.id,
    });
  }

  if (updateResult.outcome === 'not_found') {
    logger.warn({ actionId: action.id }, 'Action not found during rejection update');
    await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message: 'This action is no longer available. It may have been deleted or already processed.',
      correlationId: `approval-not-found-${action.id}`,
    });
    return ok({ matched: false });
  }

  if (updateResult.outcome === 'error') {
    logger.error(
      { actionId: action.id, error: updateResult.error.message },
      'Failed to update action status during rejection'
    );
    return err(new Error('Failed to update action status'));
  }

  const message = isConvert
    ? `🔀 Converting ${action.type} to Linear issue: "${action.title}"`
    : `🛑 Got it. Cancelled the ${action.type}: "${action.title}"`;

  const publishResult = await whatsappPublisher.publishSendMessage({
    userId: action.userId,
    message,
    correlationId: `approval-cancelled-${action.id}`,
  });

  if (!publishResult.ok) {
    logger.warn(
      { actionId: action.id, error: publishResult.error.message },
      'Failed to send cancellation confirmation'
    );
  }

  const deleteResult = await approvalMessageRepository.deleteByActionId(action.id);
  if (!deleteResult.ok) {
    logger.warn(
      { actionId: action.id, error: deleteResult.error.message },
      'Failed to clean up approval message after cancellation'
    );
  }

  return ok({
    matched: true,
    actionId: action.id,
    intent: 'reject' as ApprovalIntent,
    outcome: 'rejected',
  });
}
