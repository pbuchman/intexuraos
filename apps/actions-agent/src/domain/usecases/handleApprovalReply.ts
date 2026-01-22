import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ApprovalMessageRepository } from '../ports/approvalMessageRepository.js';
import type { ApprovalIntent } from '../ports/approvalIntentClassifier.js';
import type { ApprovalIntentClassifierFactory } from '../ports/approvalIntentClassifierFactory.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';

export interface HandleApprovalReplyDeps {
  actionRepository: ActionRepository;
  approvalMessageRepository: ApprovalMessageRepository;
  approvalIntentClassifierFactory: ApprovalIntentClassifierFactory;
  whatsappPublisher: WhatsAppSendPublisher;
  logger: Logger;
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
    logger,
  } = deps;

  return async (input: ApprovalReplyInput): Promise<Result<ApprovalReplyResult>> => {
    const { replyToWamid, replyText, userId, actionId: providedActionId } = input;

    logger.info(
      { replyToWamid, userId, replyTextLength: replyText.length, providedActionId },
      'Handling approval reply'
    );

    // Step 1: Determine the action ID
    let targetActionId: string | undefined = providedActionId;

    // If actionId not provided directly, try to find via approvalMessageRepository (legacy path)
    if (targetActionId === undefined) {
      const approvalMessage = await approvalMessageRepository.findByWamid(replyToWamid);

      if (approvalMessage === null) {
        logger.info({ replyToWamid }, 'No approval message found for this wamid');
        return ok({ matched: false });
      }

      logger.info(
        { actionId: approvalMessage.actionId, actionType: approvalMessage.actionType },
        'Found approval message via legacy lookup'
      );

      // Verify user matches
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

    // Step 2: Get the action
    const action = await actionRepository.getById(targetActionId);

    if (action === null) {
      logger.warn({ actionId: targetActionId }, 'Action not found for approval');
      // Clean up orphaned approval message if we used legacy lookup
      if (providedActionId === undefined) {
        await approvalMessageRepository.deleteByActionId(targetActionId);
      }
      return err(new Error('Action not found'));
    }

    // Step 3: Verify user owns the action
    if (action.userId !== userId) {
      logger.warn(
        { expectedUserId: action.userId, actualUserId: userId, actionId: action.id },
        'User ID mismatch for action'
      );
      return err(new Error('User ID mismatch'));
    }

    // Step 4: Verify action is still awaiting approval
    if (action.status !== 'awaiting_approval') {
      logger.info(
        { actionId: action.id, status: action.status },
        'Action is no longer awaiting approval'
      );
      return ok({
        matched: true,
        actionId: action.id,
      });
    }

    // Step 5: Create classifier and classify the intent
    const classifierResult = await approvalIntentClassifierFactory.createForUser(userId, logger);

    if (!classifierResult.ok) {
      logger.error(
        { userId, error: classifierResult.error.message },
        'Failed to create approval intent classifier for user'
      );
      // Default to unclear if we can't create the classifier
      // This triggers a clarification request instead of failing silently
      const unclearPublishResult = await whatsappPublisher.publishSendMessage({
        userId,
        message: `I couldn't process your reply. Please reply with "yes" to approve or "no" to cancel the ${action.type}: "${action.title}"`,
        correlationId: `approval-unclear-${action.id}`,
      });

      if (!unclearPublishResult.ok) {
        logger.warn(
          { actionId: action.id, error: unclearPublishResult.error.message },
          'Failed to send clarification request'
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

    // Step 6: Handle based on intent
    let outcome: ApprovalReplyResult['outcome'];
    let updatedAction: Action;

    switch (classificationResult.intent) {
      case 'approve': {
        // Transition to pending for execution
        updatedAction = {
          ...action,
          status: 'pending',
          updatedAt: new Date().toISOString(),
        };
        await actionRepository.update(updatedAction);

        // Clean up the approval message
        await approvalMessageRepository.deleteByActionId(action.id);

        // Notify user
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

        outcome = 'approved';
        logger.info({ actionId: action.id }, 'Action approved and set to pending');
        break;
      }

      case 'reject': {
        // Transition to rejected
        updatedAction = {
          ...action,
          status: 'rejected',
          payload: {
            ...action.payload,
            rejection_reason: replyText,
            rejected_at: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
        await actionRepository.update(updatedAction);

        // Clean up the approval message
        await approvalMessageRepository.deleteByActionId(action.id);

        // Notify user
        const rejectPublishResult = await whatsappPublisher.publishSendMessage({
          userId,
          message: `Got it. Cancelled the ${action.type}: "${action.title}"`,
          correlationId: `approval-rejected-${action.id}`,
        });

        if (!rejectPublishResult.ok) {
          logger.warn(
            { actionId: action.id, error: rejectPublishResult.error.message },
            'Failed to send rejection confirmation'
          );
        }

        outcome = 'rejected';
        logger.info({ actionId: action.id }, 'Action rejected');
        break;
      }

      case 'unclear': {
        // Ask for clarification, keep awaiting_approval
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
