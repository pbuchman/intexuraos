import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
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

export type ApprovalIntent = 'approve' | 'reject' | 'unclear';

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
  webAppUrl: string;
}

export interface ApprovalReplyInput {
  replyToWamid: string;
  replyText: string;
  userId: string;
  actionId?: string;
  buttonId?: string;
  buttonTitle?: string;
}

export interface ApprovalReplyResult {
  matched: boolean;
  actionId?: string;
  intent?: ApprovalIntent;
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
    webAppUrl,
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
        /* v8 ignore start -- ts-type: button ID format guarantees taskId exists @preserve */
        const [, taskId, nonce] = parts;
        /* v8 ignore stop @preserve */
        /* v8 ignore start -- ts-type: nullish coalescing after destructure @preserve */
        return await handleCancelTaskButton(
          taskId ?? '',
          /* v8 ignore stop @preserve */
          nonce,
          userId,
          whatsappPublisher,
          codeAgentClient,
          logger
        );
      }

      if (intent === 'view-task') {
        /* v8 ignore start -- ts-type: button ID format guarantees taskId exists @preserve */
        const [, taskId] = parts;
        return await handleViewTaskButton(taskId ?? '', userId, whatsappPublisher, webAppUrl, logger);
        /* v8 ignore stop @preserve */
      }

      // INT-628: Handle proceed-implementation button
      /* v8 ignore start -- test-infra: proceed-implementation button tested via integration tests @preserve */
      if (intent === 'proceed-implementation') {
        /* v8 ignore stop @preserve */
        /* v8 ignore start -- ts-type: button ID format guarantees taskId exists @preserve */
        const [, taskId] = parts;
        return await handleProceedToImplementationButton(
          taskId ?? '',
          userId,
          whatsappPublisher,
          codeAgentClient,
          logger
        );
        /* v8 ignore stop @preserve */
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

/**
 * Handle button response — deterministic intent from button ID.
 *
 * Button ID formats:
 * - "approve:{actionId}" | "reject:{actionId}" | "cancel:{actionId}" | "convert:{actionId}"
 */
async function handleButtonResponse(
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

  /* v8 ignore start -- test-infra: test button handlers always have valid actions @preserve */
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

/**
 * Execute action by type (shared between button approval flows).
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
 * Execute action rejection (shared between cancel, reject, and convert).
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

/**
 * Handle cancel-task button (INT-379).
 * Button ID format: "cancel-task:{taskId}:{nonce}"
 */
async function handleCancelTaskButton(
  taskId: string,
  nonce: string | undefined, // @allow-undefined-type -- function param from array destructure, not an interface property
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
    message: '🛑 Task cancellation requested.',
    correlationId: `cancel-task-success-${taskId}`,
  });

  return ok({
    matched: true,
    outcome: 'rejected',
  });
}

/**
 * Handle view-task button (INT-379).
 * Button ID format: "view-task:{taskId}"
 */
async function handleViewTaskButton(
  taskId: string,
  userId: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  webAppUrl: string,
  logger: Logger
): Promise<Result<ApprovalReplyResult>> {
  logger.info({ taskId, userId }, 'Handling view-task button');

  await whatsappPublisher.publishSendMessage({
    userId,
    message: `View task details at: ${webAppUrl}/#/code-tasks/${taskId}`,
    correlationId: `view-task-${taskId}`,
  });

  return ok({
    matched: true,
  });
}

/**
 * Handle proceed-implementation button (INT-628).
 * Button ID format: "proceed-implementation:{taskId}"
 */
async function handleProceedToImplementationButton(
  taskId: string,
  userId: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  codeAgentClient: HandleApprovalReplyDeps['codeAgentClient'],
  logger: Logger
): Promise<Result<ApprovalReplyResult>> {
  logger.info({ taskId, userId }, 'Handling proceed-implementation button');

  if (codeAgentClient === undefined) {
    logger.error({ taskId }, 'Code agent client not configured for proceed-implementation');
    const notifyResult = await whatsappPublisher.publishSendMessage({
      userId,
      message: 'Unable to start implementation: service temporarily unavailable.',
      correlationId: `proceed-implementation-error-${taskId}`,
    });
    if (!notifyResult.ok) {
      logger.warn({ taskId, error: notifyResult.error.message }, 'Failed to send error notification to user');
    }
    return err(new Error('Code agent client not configured'));
  }

  const result = await codeAgentClient.submitToPhase2({ taskId, userId });

  if (!result.ok) {
    const errorMessages: Record<string, string> = {
      'TASK_NOT_FOUND': 'Task not found.',
      'INVALID_STATUS': 'Task is not in designed status. It may have already been implemented.',
      'NO_LINEAR_ISSUE': 'Cannot proceed: no Linear issue attached to this task.',
      'LABEL_NOT_READY': 'Task is not ready for implementation. Required labels may be missing.',
      'ALREADY_IMPLEMENTED': 'Implementation has already started for this task.',
      'ACTIVE_TASK_EXISTS': 'An active task already exists for this request.',
      'WORKER_NOT_CONFIGURED': 'Unable to start implementation: no workers available.',
      'NETWORK_ERROR': 'Unable to start implementation: network error. Please try again.',
      'UNKNOWN': 'Unable to start implementation. Please try again later.',
    };
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; all SubmitToPhase2Error code values are mapped @preserve */
    const message = errorMessages[result.error.code] ?? 'Unable to start implementation.';
    /* v8 ignore stop @preserve */

    logger.warn(
      { taskId, errorCode: result.error.code, errorMessage: result.error.message },
      'Failed to proceed to implementation'
    );

    const errorNotifyResult = await whatsappPublisher.publishSendMessage({
      userId,
      message,
      correlationId: `proceed-implementation-error-${taskId}`,
    });
    if (!errorNotifyResult.ok) {
      logger.warn({ taskId, error: errorNotifyResult.error.message }, 'Failed to send error notification to user');
    }

    return ok({
      matched: true,
      outcome: 'rejected',
    });
  }

  logger.info({ taskId, phase2TaskId: result.value.codeTaskId }, 'Phase 2 started successfully via button');

  const successNotifyResult = await whatsappPublisher.publishSendMessage({
    userId,
    message: `🚀 Starting implementation for your task!\n\nYou'll receive another message when it's complete.`,
    correlationId: `proceed-implementation-success-${taskId}`,
  });
  if (!successNotifyResult.ok) {
    logger.warn({ taskId, error: successNotifyResult.error.message }, 'Failed to send success notification to user');
  }

  return ok({
    matched: true,
    outcome: 'approved',
  });
}
