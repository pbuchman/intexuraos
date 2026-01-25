import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
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
  } = deps;

  return async (input: ApprovalReplyInput): Promise<Result<ApprovalReplyResult>> => {
    const { replyToWamid, replyText, userId, actionId: providedActionId } = input;

    logger.info(
      { replyToWamid, userId, replyTextLength: replyText.length, providedActionId },
      'Handling approval reply'
    );

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
