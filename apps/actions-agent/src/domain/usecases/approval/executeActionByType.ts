import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../../models/action.js';
import type { ActionEventPublisher } from '../../ports/actionEventPublisher.js';
import type { HandleApprovalReplyDeps } from '../handleApprovalReply.js';

export async function executeActionByType(
  action: Action,
  actionEventPublisher: ActionEventPublisher,
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
