import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import {
  validateNonce,
  isNonceExpired,
} from '../utils/approvalNonce.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ApprovalMessageRepository } from '../ports/approvalMessageRepository.js';
import type { ApprovalIntent } from '../ports/approvalIntentClassifier.js';
import type { ApprovalIntentClassifierFactory } from '../ports/approvalIntentClassifierFactory.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionEventPublisher } from '../ports/actionEventPublisher.js';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { ExecuteNoteActionUseCase } from './executeNoteAction.js';
import type { ExecuteTodoActionUseCase } from './executeTodoAction.js';
import type { ExecuteResearchActionUseCase } from './executeResearchAction.js';
import type { ExecuteLinkActionUseCase } from './executeLinkAction.js';
import type { ExecuteCalendarActionUseCase } from './executeCalendarAction.js';
import type { ExecuteLinearActionUseCase } from './executeLinearAction.js';
import type { ExecuteCodeActionUseCase } from './executeCodeAction.js';
import type { CodeAgentClient } from '../ports/codeAgentClient.js';

export interface HandleApprovalReplyDeps {
  actionRepository: ActionRepository;
  approvalMessageRepository: ApprovalMessageRepository;
  approvalIntentClassifierFactory: ApprovalIntentClassifierFactory;
  whatsappPublisher: WhatsAppSendPublisher;
  actionEventPublisher: ActionEventPublisher;
  logger: Logger;
  /** Optional: If provided, note actions will be executed directly (skipping event publishing). */
  executeNoteAction?: ExecuteNoteActionUseCase;
  /** Optional: If provided, todo actions will be executed directly (skipping event publishing). */
  executeTodoAction?: ExecuteTodoActionUseCase;
  /** Optional: If provided, research actions will be executed directly (skipping event publishing). */
  executeResearchAction?: ExecuteResearchActionUseCase;
  /** Optional: If provided, link actions will be executed directly (skipping event publishing). */
  executeLinkAction?: ExecuteLinkActionUseCase;
  /** Optional: If provided, calendar actions will be executed directly (skipping event publishing). */
  executeCalendarAction?: ExecuteCalendarActionUseCase;
  /** Optional: If provided, linear actions will be executed directly (skipping event publishing). */
  executeLinearAction?: ExecuteLinearActionUseCase;
  /** Optional: If provided, code actions will be executed directly (skipping event publishing). */
  executeCodeAction?: ExecuteCodeActionUseCase;
  /** Optional: If provided, enables cancel-task button handling (INT-379). */
  codeAgentClient?: CodeAgentClient;
}

export interface ApprovalReplyInput {
  /** The wamid of the message being replied to */
  replyToWamid: string;
  /** The user's reply text */
  replyText: string;
  /** The user ID */
  userId: string;
  /** Optional action ID (if extracted from correlationId by whatsapp-service) */
  actionId?: string;
  /** Optional button ID (format: "approve:{actionId}:{nonce}" | "cancel:{actionId}" | "convert:{actionId}") */
  buttonId?: string;
  /** Optional button title (user-visible text of the button clicked) */
  buttonTitle?: string;
}

export interface ApprovalReplyResult {
  /** Whether an approval message was found for the reply */
  matched: boolean;
  /** The action ID if matched */
  actionId?: string;
  /** The classified intent */
  intent?: ApprovalIntent;
  /** What happened to the action */
  outcome?: 'approved' | 'rejected' | 'unclear_requested_clarification';
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
    approvalIntentClassifierFactory,
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
          taskId ?? '',
          nonce,
          userId,
          whatsappPublisher,
          codeAgentClient,
          logger
        );
      }

      if (intent === 'view-task') {
        const [, taskId] = parts;
        return await handleViewTaskButton(taskId ?? '', userId, whatsappPublisher, logger);
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
      // Clean up orphaned approval message if we used wamid lookup
      if (providedActionId === undefined) {
        const deleteResult = await approvalMessageRepository.deleteByActionId(targetActionId);
        if (!deleteResult.ok) {
          logger.warn(
            { actionId: targetActionId, error: deleteResult.error.message },
            'Failed to clean up orphaned approval message'
          );
        }
      }
      return err(new Error('Action not found'));
    }

    // Verify user owns the action
    if (action.userId !== userId) {
      logger.warn(
        { expectedUserId: action.userId, actualUserId: userId, actionId: action.id },
        'User ID mismatch for action'
      );
      return err(new Error('User ID mismatch'));
    }

    // Check if action is in a terminal state (already fully processed)
    // These states indicate the action cannot be modified by approval reply
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

    // Handle button response (if present) - bypass LLM classifier for deterministic intent
    if (buttonId !== undefined) {
      return await handleButtonResponse(
        buttonId,
        buttonTitle,
        action,
        replyText,
        userId,
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

    // Handle text fallback for nonce-based approvals ("approve XXXX" pattern)
    // This provides a fallback for users who prefer typing over clicking buttons
    const nonceMatch = /^approve\s+([0-9a-fA-F]{4})\s*$/.exec(replyText.trim());
    if (nonceMatch !== null) {
      const nonce = nonceMatch[1];
      if (nonce !== undefined) {
        const nonceResult = await handleNonceTextFallback(
          nonce,
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
        // If nonce validation succeeded, return the result
        // If it failed (returned null), fall through to LLM classifier
        if (nonceResult !== null) {
          return nonceResult;
        }
      }
    }

    // Create classifier and classify the intent
    const classifierResult = await approvalIntentClassifierFactory.createForUser(userId, logger);

    if (!classifierResult.ok) {
      const errorCode = classifierResult.error.code;
      logger.error(
        { userId, error: classifierResult.error.message, errorCode },
        'Failed to create approval intent classifier for user'
      );

      // Provide specific error message based on the failure reason
      let errorMessage: string;
      if (errorCode === 'NO_API_KEY') {
        errorMessage = `I couldn't process your reply because your LLM API key is not configured. Please add your API key in settings, then try again.`;
      } else if (errorCode === 'INVALID_MODEL') {
        errorMessage = `I couldn't process your reply because your LLM model preference is invalid. Please update your settings.`;
      } else {
        errorMessage = `I couldn't process your reply due to a temporary issue. Please reply with "yes" to approve or "no" to cancel the ${action.type}: "${action.title}"`;
      }

      const unclearPublishResult = await whatsappPublisher.publishSendMessage({
        userId,
        message: errorMessage,
        correlationId: `approval-error-${action.id}`,
      });

      if (!unclearPublishResult.ok) {
        logger.warn(
          { actionId: action.id, error: unclearPublishResult.error.message },
          'Failed to send error notification'
        );
      }

      return ok({
        matched: true,
        actionId: action.id,
        outcome: 'unclear_requested_clarification',
      });
    }

    const classificationResult = await classifierResult.value.classify(replyText);

    logger.info(
      {
        actionId: action.id,
        intent: classificationResult.intent,
        confidence: classificationResult.confidence,
        reasoning: classificationResult.reasoning,
      },
      'Classified approval intent'
    );

    // Handle based on intent
    let outcome: ApprovalReplyResult['outcome'];

    switch (classificationResult.intent) {
      case 'approve': {
        // Atomically update status to prevent race condition with concurrent approval replies
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
          return err(new Error('Action not found'));
        }

        if (updateResult.outcome === 'error') {
          logger.error(
            { actionId: action.id, error: updateResult.error.message },
            'Failed to update action status during approval'
          );
          return err(new Error('Failed to update action status'));
        }

        // Status successfully updated to 'pending'

        // Send approval confirmation FIRST (before execution) so user sees correct order
        const approvePublishResult = await whatsappPublisher.publishSendMessage({
          userId,
          message: `Approved! Processing your ${action.type}: "${action.title}"`,
          correlationId: `approval-approved-${action.id}`,
        });

        if (!approvePublishResult.ok) {
          logger.warn(
            { actionId: action.id, error: approvePublishResult.error.message },
            'Failed to send approval confirmation'
          );
        }

        // Clean up approval message after confirmation sent
        const deleteResult = await approvalMessageRepository.deleteByActionId(action.id);
        if (!deleteResult.ok) {
          logger.warn(
            { actionId: action.id, error: deleteResult.error.message },
            'Failed to clean up approval message after approval'
          );
        }

        // Execute action directly based on type to avoid duplicate notification.
        // If execute function is provided, call it directly (skipping event publishing).
        // Otherwise, fall back to publishing action.created event for backward compatibility.
        const executeAction = async (): Promise<void> => {
          switch (action.type) {
            case 'note':
              if (executeNoteAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing note action directly after approval');
                const result = await executeNoteAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute note action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Note action executed successfully after approval');
                }
                return;
              }
              break;
            case 'todo':
              if (executeTodoAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing todo action directly after approval');
                const result = await executeTodoAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute todo action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Todo action executed successfully after approval');
                }
                return;
              }
              break;
            case 'research':
              if (executeResearchAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing research action directly after approval');
                const result = await executeResearchAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute research action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Research action executed successfully after approval');
                }
                return;
              }
              break;
            case 'link':
              if (executeLinkAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing link action directly after approval');
                const result = await executeLinkAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute link action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Link action executed successfully after approval');
                }
                return;
              }
              break;
            case 'calendar':
              if (executeCalendarAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing calendar action directly after approval');
                const result = await executeCalendarAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute calendar action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Calendar action executed successfully after approval');
                }
                return;
              }
              break;
            case 'linear':
              if (executeLinearAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing linear action directly after approval');
                const result = await executeLinearAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute linear action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Linear action executed successfully after approval');
                }
                return;
              }
              break;
            case 'code':
              if (executeCodeAction !== undefined) {
                logger.info({ actionId: action.id }, 'Executing code action directly after approval');
                const result = await executeCodeAction(action.id);
                if (!result.ok) {
                  logger.error(
                    { actionId: action.id, error: getErrorMessage(result.error) },
                    'Failed to execute code action after approval'
                  );
                } else {
                  logger.info({ actionId: action.id }, 'Code action executed successfully after approval');
                }
                return;
              }
              break;
            case 'reminder':
              logger.warn({ actionId: action.id }, 'Reminder actions not implemented, falling through to event publishing');
              break;
          }

          // Fallback: No execute function provided for this action type, publish event
          const event: ActionCreatedEvent = {
            type: 'action.created',
            actionId: action.id,
            userId: action.userId,
            commandId: action.commandId,
            actionType: action.type,
            title: action.title,
            payload: {
              prompt: action.title,
              confidence: action.confidence,
            },
            timestamp: new Date().toISOString(),
          };

          const eventPublishResult = await actionEventPublisher.publishActionCreated(event);

          if (!eventPublishResult.ok) {
            logger.error(
              { actionId: action.id, error: eventPublishResult.error.message },
              'Failed to publish action.created event after approval'
            );
            // Continue anyway - action is already in pending status, will be picked up by retryPendingActions
          } else {
            logger.info({ actionId: action.id }, 'Published action.created event after approval');
          }
        };

        await executeAction();

        outcome = 'approved';
        logger.info({ actionId: action.id }, 'Action approved and set to pending');
        break;
      }

      case 'reject': {
        // Atomically update status to prevent race condition with concurrent approval replies
        const updateResult = await actionRepository.updateStatusIf(
          action.id,
          'rejected',
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
          logger.warn({ actionId: action.id }, 'Action not found during rejection update');
          return err(new Error('Action not found'));
        }

        if (updateResult.outcome === 'error') {
          logger.error(
            { actionId: action.id, error: updateResult.error.message },
            'Failed to update action status during rejection'
          );
          return err(new Error('Failed to update action status'));
        }

        // Status successfully updated to 'rejected', now add rejection metadata
        // This is a non-critical operation - if it fails, the status is already rejected
        const rejectedAction: Action = {
          ...action,
          status: 'rejected',
          payload: {
            ...action.payload,
            rejection_reason: replyText,
            rejected_at: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
        try {
          await actionRepository.update(rejectedAction);
        } catch (metadataError) {
          // Log but continue - status is already rejected, metadata is nice-to-have
          logger.warn(
            {
              actionId: action.id,
              error: getErrorMessage(metadataError, 'Unknown error'),
            },
            'Failed to add rejection metadata, continuing with notification'
          );
        }

        // Notify user first, then clean up (to avoid race condition)
        const rejectPublishResult = await whatsappPublisher.publishSendMessage({
          userId,
          message: `Got it. Rejected the ${action.type}: "${action.title}"`,
          correlationId: `approval-rejected-${action.id}`,
        });

        if (!rejectPublishResult.ok) {
          logger.warn(
            { actionId: action.id, error: rejectPublishResult.error.message },
            'Failed to send rejection confirmation'
          );
        }

        // Clean up approval message after confirmation sent
        const deleteResult = await approvalMessageRepository.deleteByActionId(action.id);
        if (!deleteResult.ok) {
          logger.warn(
            { actionId: action.id, error: deleteResult.error.message },
            'Failed to clean up approval message after rejection'
          );
        }

        outcome = 'rejected';
        logger.info({ actionId: action.id }, 'Action rejected');
        break;
      }

      case 'unclear': {
        const unclearPublishResult = await whatsappPublisher.publishSendMessage({
          userId,
          message: `I didn't understand your reply. Please reply with "yes" to approve or "no" to cancel the ${action.type}: "${action.title}"`,
          correlationId: `approval-unclear-${action.id}`,
        });

        if (!unclearPublishResult.ok) {
          logger.warn(
            { actionId: action.id, error: unclearPublishResult.error.message },
            'Failed to send clarification request'
          );
        }

        outcome = 'unclear_requested_clarification';
        logger.info({ actionId: action.id }, 'Requested clarification for unclear intent');
        break;
      }
    }

    return ok({
      matched: true,
      actionId: action.id,
      intent: classificationResult.intent,
      outcome,
    });
  };
}

/**
 * Handle button response with nonce validation.
 *
 * Button ID formats:
 * - Action buttons: "approve:{actionId}:{nonce}" | "cancel:{actionId}" | "convert:{actionId}"
 * - Code task buttons (INT-379): "cancel-task:{taskId}:{nonce}" | "view-task:{taskId}"
 *
 * This function handles deterministic button responses, bypassing the LLM classifier.
 * For approve/cancel-task actions, it validates the nonce to prevent replay attacks.
 */
async function handleButtonResponse(
  buttonId: string,
  _buttonTitle: string | undefined,
  action: Action | null,
  _replyText: string,
  _userId: string,
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
  // Parse button ID: "intent:id[:nonce]"
  const parts = buttonId.split(':');

  if (parts.length < 2) {
    logger.warn({ buttonId }, 'Invalid button ID format');
    return err(new Error('Invalid button ID format'));
  }

  const [intent, idFromButton, nonce] = parts;

  // For action-related buttons, verify we have an action
  if (action === null) {
    logger.warn({ buttonId, intent }, 'Action-related button received but no action found');
    return err(new Error('Action not found for button'));
  }

  // Verify the actionId from button matches the action we're processing
  if (idFromButton !== action.id) {
    logger.warn(
      { buttonActionId: idFromButton, actionId: action.id },
      'Button action ID mismatch'
    );
    return err(new Error('Button action ID mismatch'));
  }

  logger.info(
    { actionId: action.id, intent, hasNonce: nonce !== undefined },
    'Processing button response'
  );

  // Handle each intent type
  switch (intent) {
    case 'approve': {
      // Validate nonce for approval (security measure)
      if (nonce === undefined) {
        logger.warn({ buttonId }, 'Approve button missing nonce');
        const errorResult = await whatsappPublisher.publishSendMessage({
          userId: action.userId,
          message: 'Invalid approval: missing security code. Please request a new approval.',
          correlationId: `approval-error-${action.id}`,
        });
        if (!errorResult.ok) {
          logger.warn(
            { actionId: action.id, error: errorResult.error.message },
            'Failed to send nonce error notification'
          );
        }
        return err(new Error('Approve button missing nonce'));
      }

      // Check if nonce is present and valid
      if (action.approvalNonce === undefined) {
        logger.warn({ actionId: action.id }, 'Action has no nonce configured');
        const errorResult = await whatsappPublisher.publishSendMessage({
          userId: action.userId,
          message: 'This approval has expired. Please request a new one.',
          correlationId: `approval-error-${action.id}`,
        });
        if (!errorResult.ok) {
          logger.warn(
            { actionId: action.id, error: errorResult.error.message },
            'Failed to send nonce missing error notification'
          );
        }
        return err(new Error('Action has no nonce configured'));
      }

      // Check if nonce expired
      if (
        action.approvalNonceExpiresAt !== undefined &&
        isNonceExpired(action.approvalNonceExpiresAt)
      ) {
        logger.warn(
          { actionId: action.id, expiresAt: action.approvalNonceExpiresAt },
          'Approval nonce expired'
        );
        const errorResult = await whatsappPublisher.publishSendMessage({
          userId: action.userId,
          message: 'This approval has expired. Please request a new one.',
          correlationId: `approval-error-${action.id}`,
        });
        if (!errorResult.ok) {
          logger.warn(
            { actionId: action.id, error: errorResult.error.message },
            'Failed to send nonce expired error notification'
          );
        }
        return err(new Error('Approval nonce expired'));
      }

      // Validate nonce matches
      if (!validateNonce(action.approvalNonce, nonce)) {
        logger.warn(
          { actionId: action.id, providedNonce: nonce, storedNonce: action.approvalNonce },
          'Nonce mismatch - possible replay attack'
        );
        const errorResult = await whatsappPublisher.publishSendMessage({
          userId: action.userId,
          message: 'Invalid approval code. This may have been already used. Please request a new approval.',
          correlationId: `approval-error-${action.id}`,
        });
        if (!errorResult.ok) {
          logger.warn(
            { actionId: action.id, error: errorResult.error.message },
            'Failed to send nonce mismatch error notification'
          );
        }
        return err(new Error('Nonce mismatch'));
      }

      // Nonce is valid - proceed with approval using the same logic as text-based approval
      logger.info({ actionId: action.id }, 'Nonce validated successfully, proceeding with approval');

      // Atomically update status to pending and clear nonce (single-use)
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
        return err(new Error('Action not found'));
      }

      if (updateResult.outcome === 'error') {
        logger.error(
          { actionId: action.id, error: updateResult.error.message },
          'Failed to update action status during approval'
        );
        return err(new Error('Failed to update action status'));
      }

      // Clear nonce after successful status update (single-use token consumed)
      // Use destructuring to omit optional fields (TypeScript exactOptionalPropertyTypes)
      const { approvalNonce: _approvalNonce, approvalNonceExpiresAt: _approvalNonceExpiresAt, ...actionWithoutNonce } = action;
      const updatedAction: Action = {
        ...actionWithoutNonce,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
      try {
        await actionRepository.update(updatedAction);
        logger.info({ actionId: action.id }, 'Cleared nonce after approval');
      } catch (error) {
        logger.warn(
          { actionId: action.id, error: getErrorMessage(error) },
          'Failed to clear nonce after approval (non-critical)'
        );
      }

      // Send approval confirmation
      const approvePublishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: `Approved! Processing your ${action.type}: "${action.title}"`,
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

    case 'cancel': {
      return await executeRejection(
        action,
        actionRepository,
        'Cancelled via button',
        whatsappPublisher,
        approvalMessageRepository,
        logger
      );
    }

    case 'convert': {
      // Convert to Linear issue - treat as rejection with special message
      return await executeRejection(
        action,
        actionRepository,
        'Converting to Linear issue...',
        whatsappPublisher,
        approvalMessageRepository,
        logger,
        true // isConvert
      );
    }

    default: {
      logger.warn({ intent }, 'Unknown button intent');
      return err(new Error('Unknown button intent'));
    }
  }
}

/**
 * Execute action by type (shared between button and text-based approval).
 */
async function executeActionByType(
  action: Action,
  actionEventPublisher: HandleApprovalReplyDeps['actionEventPublisher'],
  logger: Logger,
  executeNoteAction?: HandleApprovalReplyDeps['executeNoteAction'],
  executeTodoAction?: HandleApprovalReplyDeps['executeTodoAction'],
  executeResearchAction?: HandleApprovalReplyDeps['executeResearchAction'],
  executeLinkAction?: HandleApprovalReplyDeps['executeLinkAction'],
  executeCalendarAction?: HandleApprovalReplyDeps['executeCalendarAction'],
  executeLinearAction?: HandleApprovalReplyDeps['executeLinearAction'],
  executeCodeAction?: HandleApprovalReplyDeps['executeCodeAction']
): Promise<void> {
  const executeAction = async (): Promise<void> => {
    switch (action.type) {
      case 'note':
        if (executeNoteAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing note action directly after approval');
          const result = await executeNoteAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute note action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Note action executed successfully after approval');
          }
          return;
        }
        break;
      case 'todo':
        if (executeTodoAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing todo action directly after approval');
          const result = await executeTodoAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute todo action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Todo action executed successfully after approval');
          }
          return;
        }
        break;
      case 'research':
        if (executeResearchAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing research action directly after approval');
          const result = await executeResearchAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute research action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Research action executed successfully after approval');
          }
          return;
        }
        break;
      case 'link':
        if (executeLinkAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing link action directly after approval');
          const result = await executeLinkAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute link action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Link action executed successfully after approval');
          }
          return;
        }
        break;
      case 'calendar':
        if (executeCalendarAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing calendar action directly after approval');
          const result = await executeCalendarAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute calendar action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Calendar action executed successfully after approval');
          }
          return;
        }
        break;
      case 'linear':
        if (executeLinearAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing linear action directly after approval');
          const result = await executeLinearAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute linear action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Linear action executed successfully after approval');
          }
          return;
        }
        break;
      case 'code':
        if (executeCodeAction !== undefined) {
          logger.info({ actionId: action.id }, 'Executing code action directly after approval');
          const result = await executeCodeAction(action.id);
          if (!result.ok) {
            logger.error(
              { actionId: action.id, error: getErrorMessage(result.error) },
              'Failed to execute code action after approval'
            );
          } else {
            logger.info({ actionId: action.id }, 'Code action executed successfully after approval');
          }
          return;
        }
        break;
      case 'reminder':
        logger.warn({ actionId: action.id }, 'Reminder actions not implemented, falling through to event publishing');
        break;
    }

    // Fallback: Publish action.created event
    const event = {
      type: 'action.created' as const,
      actionId: action.id,
      userId: action.userId,
      commandId: action.commandId,
      actionType: action.type,
      title: action.title,
      payload: {
        prompt: action.title,
        confidence: action.confidence,
      },
      timestamp: new Date().toISOString(),
    } as const;

    const eventPublishResult = await actionEventPublisher.publishActionCreated(event);

    if (!eventPublishResult.ok) {
      logger.error(
        { actionId: action.id, error: eventPublishResult.error.message },
        'Failed to publish action.created event after approval'
      );
    } else {
      logger.info({ actionId: action.id }, 'Published action.created event after approval');
    }
  };

  await executeAction();
}

/**
 * Execute action rejection (shared between cancel and convert).
 */
async function executeRejection(
  action: Action,
  actionRepository: ActionRepository,
  _reason: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  approvalMessageRepository: HandleApprovalReplyDeps['approvalMessageRepository'],
  logger: Logger,
  isConvert = false
): Promise<Result<ApprovalReplyResult>> {
  // Update action status to rejected
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
    return err(new Error('Action not found'));
  }

  if (updateResult.outcome === 'error') {
    logger.error(
      { actionId: action.id, error: updateResult.error.message },
      'Failed to update action status during rejection'
    );
    return err(new Error('Failed to update action status'));
  }

  const message = isConvert
    ? `Converting ${action.type} to Linear issue: "${action.title}"`
    : `Got it. Cancelled the ${action.type}: "${action.title}"`;

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

  // Clean up approval message
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

/**
 * Handle text-based nonce approval fallback ("approve XXXX" pattern).
 *
 * This provides a fallback for users who prefer typing the nonce over clicking buttons.
 * The nonce validation is the same as for button responses.
 *
 * @returns Result if approval was processed, null if should fall through to LLM classifier
 */
async function handleNonceTextFallback(
  providedNonce: string,
  action: Action,
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
): Promise<Result<ApprovalReplyResult> | null> {
  logger.info(
    { actionId: action.id, providedNonce },
    'Processing text-based nonce approval'
  );

  // Check if nonce is present on action
  if (action.approvalNonce === undefined) {
    logger.info({ actionId: action.id }, 'Action has no nonce configured for text fallback, using LLM classifier');
    // Fall through to LLM classifier
    return null;
  }

  // Check if nonce expired
  if (
    action.approvalNonceExpiresAt !== undefined &&
    isNonceExpired(action.approvalNonceExpiresAt)
  ) {
    logger.info(
      { actionId: action.id, expiresAt: action.approvalNonceExpiresAt },
      'Approval nonce expired for text fallback, sending error and not falling through'
    );
    const errorResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message: 'This approval has expired. Please request a new one.',
      correlationId: `approval-error-${action.id}`,
    });
    if (!errorResult.ok) {
      logger.warn(
        { actionId: action.id, error: errorResult.error.message },
        'Failed to send nonce expired error notification'
      );
    }
    // Return a result to indicate we handled this (don't fall through)
    return ok({
      matched: true,
      actionId: action.id,
      intent: 'reject' as ApprovalIntent,
      outcome: 'rejected',
    });
  }

  // Validate nonce matches (case-insensitive for user convenience)
  if (!validateNonce(action.approvalNonce, providedNonce.toLowerCase())) {
    logger.info(
      { actionId: action.id, providedNonce, storedNonce: action.approvalNonce },
      'Nonce mismatch for text fallback, sending error and not falling through'
    );
    const errorResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message: 'Invalid approval code. This may have been already used. Please request a new approval.',
      correlationId: `approval-error-${action.id}`,
    });
    if (!errorResult.ok) {
      logger.warn(
        { actionId: action.id, error: errorResult.error.message },
        'Failed to send nonce mismatch error notification'
      );
    }
    // Return a result to indicate we handled this (don't fall through)
    return ok({
      matched: true,
      actionId: action.id,
      intent: 'reject' as ApprovalIntent,
      outcome: 'rejected',
    });
  }

  // Nonce is valid - proceed with approval
  logger.info({ actionId: action.id }, 'Text-based nonce validated successfully, proceeding with approval');

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
    return err(new Error('Action not found'));
  }

  if (updateResult.outcome === 'error') {
    logger.error(
      { actionId: action.id, error: updateResult.error.message },
      'Failed to update action status during approval'
    );
    return err(new Error('Failed to update action status'));
  }

  // Clear nonce after successful status update (single-use token consumed)
  const { approvalNonce: _approvalNonce, approvalNonceExpiresAt: _approvalNonceExpiresAt, ...actionWithoutNonce } = action;
  const updatedAction: Action = {
    ...actionWithoutNonce,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
  try {
    await actionRepository.update(updatedAction);
    logger.info({ actionId: action.id }, 'Cleared nonce after text-based approval');
  } catch (error) {
    logger.warn(
      { actionId: action.id, error: getErrorMessage(error) },
      'Failed to clear nonce after approval (non-critical)'
    );
  }

  // Send approval confirmation
  const approvePublishResult = await whatsappPublisher.publishSendMessage({
    userId: action.userId,
    message: `Approved! Processing your ${action.type}: "${action.title}"`,
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

/**
 * Handle cancel-task button (INT-379).
 *
 * This button is sent with running code tasks to allow users to cancel them via WhatsApp.
 * Button ID format: "cancel-task:{taskId}:{nonce}"
 */
async function handleCancelTaskButton(
  taskId: string,
  nonce: string | undefined,
  userId: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  codeAgentClient: HandleApprovalReplyDeps['codeAgentClient'],
  logger: Logger
): Promise<Result<ApprovalReplyResult>> {
  logger.info({ taskId, userId, hasNonce: nonce !== undefined }, 'Handling cancel-task button');

  if (codeAgentClient === undefined) {
    logger.error({ taskId }, 'Code agent client not configured for cancel-task');
    await whatsappPublisher.publishSendMessage({
      userId,
      message: 'Unable to cancel task: service temporarily unavailable.',
      correlationId: `cancel-task-error-${taskId}`,
    });
    return err(new Error('Code agent client not configured'));
  }

  if (nonce === undefined) {
    logger.warn({ taskId }, 'Cancel-task button missing nonce');
    await whatsappPublisher.publishSendMessage({
      userId,
      message: 'Unable to cancel task: missing security code.',
      correlationId: `cancel-task-error-${taskId}`,
    });
    return err(new Error('Cancel-task button missing nonce'));
  }

  const result = await codeAgentClient.cancelTaskWithNonce({ taskId, nonce, userId });

  if (!result.ok) {
    const errorMessages: Record<string, string> = {
      'TASK_NOT_FOUND': 'Task not found.',
      'INVALID_NONCE': 'Invalid cancel code. The code may have already been used.',
      'NONCE_EXPIRED': 'Cancel link has expired.',
      'NOT_OWNER': 'You are not the owner of this task.',
      'TASK_NOT_CANCELLABLE': 'Task cannot be cancelled (it may have already completed).',
    };
    const message = errorMessages[result.error.code] ?? 'Unable to cancel task.';

    logger.warn(
      { taskId, errorCode: result.error.code, errorMessage: result.error.message },
      'Failed to cancel task with nonce'
    );

    await whatsappPublisher.publishSendMessage({
      userId,
      message,
      correlationId: `cancel-task-error-${taskId}`,
    });

    return ok({
      matched: true,
      outcome: 'rejected',
    });
  }

  logger.info({ taskId }, 'Task cancelled successfully via button');

  await whatsappPublisher.publishSendMessage({
    userId,
    message: 'Task cancellation requested.',
    correlationId: `cancel-task-success-${taskId}`,
  });

  return ok({
    matched: true,
    outcome: 'rejected',
  });
}

/**
 * Handle view-task button (INT-379).
 *
 * This button allows users to view task details/logs.
 * For now, we just acknowledge the click and suggest visiting the web app.
 * Button ID format: "view-task:{taskId}"
 */
async function handleViewTaskButton(
  taskId: string,
  userId: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  logger: Logger
): Promise<Result<ApprovalReplyResult>> {
  logger.info({ taskId, userId }, 'Handling view-task button');

  await whatsappPublisher.publishSendMessage({
    userId,
    message: `View task details at: https://app.intexuraos.cloud/#/tasks/${taskId}`,
    correlationId: `view-task-${taskId}`,
  });

  return ok({
    matched: true,
  });
}
