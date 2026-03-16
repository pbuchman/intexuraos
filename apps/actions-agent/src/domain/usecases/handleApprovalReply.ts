import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ApprovalMessageRepository } from '../ports/approvalMessageRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionEventPublisher } from '../ports/actionEventPublisher.js';
import type { ExecuteNoteActionUseCase } from './executeNoteAction.js';
import type { ExecuteTodoActionUseCase } from './executeTodoAction.js';
import type { ExecuteResearchActionUseCase } from './executeResearchAction.js';
import type { ExecuteLinkActionUseCase } from './executeLinkAction.js';
import type { ExecuteCalendarActionUseCase } from './executeCalendarAction.js';
import type { ExecuteLinearActionUseCase } from './executeLinearAction.js';
import type { ExecuteCodeActionUseCase } from './executeCodeAction.js';
import type { CodeAgentClient } from '../ports/codeAgentClient.js';
import { buildApprovalButtons } from '../utils/approvalButtons.js';
import type { ApprovalReplyResult } from './approval/types.js';
import { handleButtonResponse } from './approval/handleButtonResponse.js';
import { handleCancelTaskButton } from './approval/handleCancelTaskButton.js';
import { handleProceedToImplementationButton } from './approval/handleProceedToImplementationButton.js';

// Re-export shared types for external consumers
export type { ApprovalIntent, ApprovalReplyResult } from './approval/types.js';

export interface HandleApprovalReplyDeps {
  actionRepository: ActionRepository;
  approvalMessageRepository: ApprovalMessageRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  actionEventPublisher: ActionEventPublisher;
  logger: Logger;
  executeNoteAction?: ExecuteNoteActionUseCase;
  executeTodoAction?: ExecuteTodoActionUseCase;
  executeResearchAction?: ExecuteResearchActionUseCase;
  executeLinkAction?: ExecuteLinkActionUseCase;
  executeCalendarAction?: ExecuteCalendarActionUseCase;
  executeLinearAction?: ExecuteLinearActionUseCase;
  executeCodeAction?: ExecuteCodeActionUseCase;
  codeAgentClient?: CodeAgentClient;
}

export interface ApprovalReplyInput {
  replyToWamid: string;
  replyText: string;
  userId: string;
  actionId?: string;
  buttonId?: string;
  buttonTitle?: string;
}

export type HandleApprovalReplyUseCase = (
  input: ApprovalReplyInput
) => Promise<Result<ApprovalReplyResult>>;

export function createHandleApprovalReplyUseCase(
  deps: HandleApprovalReplyDeps
): HandleApprovalReplyUseCase {
  const {
    actionRepository,
    approvalMessageRepository,
    whatsappPublisher,
    actionEventPublisher,
    logger,
    executeNoteAction,
    executeTodoAction,
    executeResearchAction,
    executeLinkAction,
    executeCalendarAction,
    executeLinearAction,
    executeCodeAction,
    codeAgentClient,
  } = deps;

  return async (input: ApprovalReplyInput): Promise<Result<ApprovalReplyResult>> => {
    const { replyToWamid, replyText, userId, actionId: providedActionId, buttonId, buttonTitle } = input;

    logger.info(
      {
        replyToWamid,
        userId,
        replyTextLength: replyText.length,
        providedActionId,
        buttonId,
        buttonTitle,
      },
      'Handling approval reply'
    );

    // Handle code task buttons (INT-379) early - these don't require an action lookup
    if (buttonId !== undefined) {
      const parts = buttonId.split(':');
      const intent = parts[0];

      if (intent === 'cancel-task') {
        const [, taskId, nonce] = parts;
        return await handleCancelTaskButton(
          /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; button ID format cancel-task:{taskId}:{nonce} guarantees taskId exists @preserve */
          taskId ?? '',
          /* v8 ignore stop @preserve */
          nonce,
          userId,
          whatsappPublisher,
          codeAgentClient,
          logger
        );
      }

      // INT-628: Handle proceed-implementation button
      if (intent === 'proceed-implementation') {
        const [, taskId] = parts;
        return await handleProceedToImplementationButton(
          /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; button ID format proceed-implementation:{taskId} guarantees taskId exists @preserve */
          taskId ?? '',
          /* v8 ignore stop @preserve */
          userId,
          whatsappPublisher,
          codeAgentClient,
          logger
        );
      }
    }

    // Determine the action ID - either provided directly or looked up by wamid
    let targetActionId: string | undefined = providedActionId;

    if (targetActionId === undefined) {
      const findResult = await approvalMessageRepository.findByWamid(replyToWamid);

      if (!findResult.ok) {
        logger.error(
          { replyToWamid, error: findResult.error.message },
          'Failed to look up approval message by wamid'
        );
        return err(new Error('Failed to look up approval message'));
      }

      const approvalMessage = findResult.value;

      if (approvalMessage === null) {
        logger.info({ replyToWamid }, 'No approval message found for this wamid');
        return ok({ matched: false });
      }

      logger.info(
        { actionId: approvalMessage.actionId, actionType: approvalMessage.actionType },
        'Found approval message by wamid lookup'
      );

      if (approvalMessage.userId !== userId) {
        logger.warn(
          { expectedUserId: approvalMessage.userId, actualUserId: userId },
          'User ID mismatch for approval reply'
        );
        return err(new Error('User ID mismatch'));
      }

      targetActionId = approvalMessage.actionId;
    }

    logger.info({ targetActionId }, 'Looking up action');

    // Get the action
    const action = await actionRepository.getById(targetActionId);

    if (action === null) {
      logger.warn({ actionId: targetActionId }, 'Action not found for approval');
      if (providedActionId === undefined) {
        const deleteResult = await approvalMessageRepository.deleteByActionId(targetActionId);
        if (!deleteResult.ok) {
          logger.warn(
            { actionId: targetActionId, error: deleteResult.error.message },
            'Failed to clean up orphaned approval message'
          );
        }
      }
      await whatsappPublisher.publishSendMessage({
        userId,
        message: 'This action is no longer available. It may have been deleted or already processed.',
        correlationId: `approval-not-found-${targetActionId}`,
      });
      return ok({ matched: false });
    }

    // Verify user owns the action
    if (action.userId !== userId) {
      logger.warn(
        { expectedUserId: action.userId, actualUserId: userId, actionId: action.id },
        'User ID mismatch for action'
      );
      return err(new Error('User ID mismatch'));
    }

    // Check if action is in a terminal state
    const terminalStatuses = ['completed', 'rejected'];
    if (terminalStatuses.includes(action.status)) {
      logger.info(
        { actionId: action.id, status: action.status },
        'Action is in terminal state, ignoring approval reply'
      );
      return ok({
        matched: true,
        actionId: action.id,
      });
    }

    // Handle button response (if present) - deterministic intent from button ID
    if (buttonId !== undefined) {
      return await handleButtonResponse(
        buttonId,
        action,
        actionRepository,
        whatsappPublisher,
        approvalMessageRepository,
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
    }

    // Text reply without button — re-send approval buttons
    logger.info(
      { actionId: action.id, replyText },
      'Text reply to approval message, re-sending buttons'
    );

    const buttons = action.type === 'code'
      ? buildApprovalButtons({
          actionId: action.id,
          extraButtons: [{
            type: 'reply',
            reply: { id: `convert:${action.id}`, title: 'Convert to Issue' },
          }],
        })
      : buildApprovalButtons({ actionId: action.id });

    await whatsappPublisher.publishSendMessage({
      userId,
      message: `Please use the buttons to approve or reject. If buttons expired, here they are again:`,
      buttons,
      correlationId: `approval-resend-${action.id}`,
    });

    return ok({
      matched: true,
      actionId: action.id,
      outcome: 'unclear_requested_clarification',
    });
  };
}
