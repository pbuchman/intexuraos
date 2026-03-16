import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../../models/action.js';
import type { ActionRepository } from '../../ports/actionRepository.js';
import type { HandleApprovalReplyDeps } from '../handleApprovalReply.js';
import type { ApprovalReplyResult, ApprovalIntent } from './types.js';
import { executeActionByType } from './executeActionByType.js';
import { executeRejection } from './executeRejection.js';

/**
 * Handle button response — deterministic intent from button ID.
 *
 * Button ID formats:
 * - "approve:{actionId}" | "reject:{actionId}" | "cancel:{actionId}" | "convert:{actionId}"
 */
export async function handleButtonResponse(
  buttonId: string,
  action: Action | null,
  actionRepository: ActionRepository,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  approvalMessageRepository: HandleApprovalReplyDeps['approvalMessageRepository'],
  actionEventPublisher: HandleApprovalReplyDeps['actionEventPublisher'],
  logger: Logger,
  executeNoteAction?: HandleApprovalReplyDeps['executeNoteAction'],
  executeTodoAction?: HandleApprovalReplyDeps['executeTodoAction'],
  executeResearchAction?: HandleApprovalReplyDeps['executeResearchAction'],
  executeLinkAction?: HandleApprovalReplyDeps['executeLinkAction'],
  executeCalendarAction?: HandleApprovalReplyDeps['executeCalendarAction'],
  executeLinearAction?: HandleApprovalReplyDeps['executeLinearAction'],
  executeCodeAction?: HandleApprovalReplyDeps['executeCodeAction']
): Promise<Result<ApprovalReplyResult>> {
  const parts = buttonId.split(':');

  if (parts.length < 2) {
    logger.warn({ buttonId }, 'Invalid button ID format');
    return err(new Error('Invalid button ID format'));
  }

  const [intent, idFromButton] = parts;

  /* v8 ignore start -- ts-type: caller narrows action to non-null at line 162 before invoking handleButtonResponse; this guard is defensive for the Action | null parameter type @preserve */
  if (action === null) {
    logger.warn({ buttonId, intent }, 'Action-related button received but no action found');
    return err(new Error('Action not found for button'));
  }
  /* v8 ignore stop @preserve */

  if (idFromButton !== action.id) {
    logger.warn(
      { buttonActionId: idFromButton, actionId: action.id },
      'Button action ID mismatch'
    );
    return err(new Error('Button action ID mismatch'));
  }

  logger.info(
    { actionId: action.id, intent },
    'Processing button response'
  );

  switch (intent) {
    case 'approve': {
      // Atomically update status to pending
      const updateResult = await actionRepository.updateStatusIf(
        action.id,
        'pending',
        'awaiting_approval'
      );

      if (updateResult.outcome === 'status_mismatch') {
        logger.info(
          { actionId: action.id, currentStatus: updateResult.currentStatus },
          'Action already processed by another approval reply (race condition prevented)'
        );
        return ok({
          matched: true,
          actionId: action.id,
        });
      }

      if (updateResult.outcome === 'not_found') {
        logger.warn({ actionId: action.id }, 'Action not found during approval update');
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
          'Failed to update action status during approval'
        );
        return err(new Error('Failed to update action status'));
      }

      // Send approval confirmation
      const approvePublishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: `✅ Approved! Processing your ${action.type}: "${action.title}"`,
        correlationId: `approval-approved-${action.id}`,
      });

      if (!approvePublishResult.ok) {
        logger.warn(
          { actionId: action.id, error: approvePublishResult.error.message },
          'Failed to send approval confirmation'
        );
      }

      // Clean up approval message
      const deleteResult = await approvalMessageRepository.deleteByActionId(action.id);
      if (!deleteResult.ok) {
        logger.warn(
          { actionId: action.id, error: deleteResult.error.message },
          'Failed to clean up approval message after approval'
        );
      }

      // Execute action directly based on type
      await executeActionByType(
        action,
        actionEventPublisher,
        logger,
        executeNoteAction,
        executeTodoAction,
        executeResearchAction,
        executeLinkAction,
        executeCalendarAction,
        executeLinearAction,
        executeCodeAction
      );

      return ok({
        matched: true,
        actionId: action.id,
        intent: 'approve' as ApprovalIntent,
        outcome: 'approved',
      });
    }

    case 'reject':
    case 'cancel': {
      return await executeRejection(
        action,
        actionRepository,
        `${intent === 'reject' ? 'Rejected' : 'Cancelled'} via button`,
        whatsappPublisher,
        approvalMessageRepository,
        logger
      );
    }

    case 'convert': {
      return await executeRejection(
        action,
        actionRepository,
        'Converting to Linear issue...',
        whatsappPublisher,
        approvalMessageRepository,
        logger,
        true
      );
    }

    default: {
      logger.warn({ intent }, 'Unknown button intent');
      return err(new Error('Unknown button intent'));
    }
  }
}
