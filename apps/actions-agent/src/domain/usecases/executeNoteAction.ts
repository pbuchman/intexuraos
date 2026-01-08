import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { NotesServiceClient } from '../ports/notesServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';

export interface ExecuteNoteActionDeps {
  actionRepository: ActionRepository;
  notesServiceClient: NotesServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface ExecuteNoteActionResult {
  status: 'completed' | 'failed';
  resource_url?: string;
  error?: string;
}

export type ExecuteNoteActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteNoteActionResult>>;

export function createExecuteNoteActionUseCase(
  deps: ExecuteNoteActionDeps
): ExecuteNoteActionUseCase {
  const { actionRepository, notesServiceClient, whatsappPublisher, webAppUrl, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteNoteActionResult>> => {
    logger.info({ actionId }, 'Executing note action');

    const action = await actionRepository.getById(actionId);
    if (action === null) {
      logger.error({ actionId }, 'Action not found');
      return err(new Error('Action not found'));
    }

    logger.info(
      { actionId, userId: action.userId, status: action.status, title: action.title },
      'Retrieved action for execution'
    );

    if (action.status === 'completed') {
      const resourceUrl = action.payload['resource_url'] as string | undefined;
      logger.info({ actionId, resourceUrl }, 'Action already completed, returning existing result');
      return ok({
        status: 'completed' as const,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
      });
    }

    if (action.status !== 'awaiting_approval' && action.status !== 'failed') {
      logger.error(
        { actionId, status: action.status },
        'Cannot execute action with invalid status'
      );
      return err(new Error(`Cannot execute action with status: ${action.status}`));
    }

    logger.info({ actionId }, 'Setting action to processing');
    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    const prompt =
      typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;

    logger.info(
      { actionId, userId: action.userId, title: action.title },
      'Creating note via notes-agent'
    );

    const result = await notesServiceClient.createNote({
      userId: action.userId,
      title: action.title,
      content: prompt,
      tags: [],
      source: 'actions-agent',
      sourceId: action.id,
    });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to create note via notes-agent'
      );
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          error: result.error.message,
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      logger.info({ actionId, status: 'failed' }, 'Action marked as failed');
      return ok({
        status: 'failed',
        error: result.error.message,
      });
    }

    const noteId = result.value.id;
    const resourceUrl = `/#/notes/${noteId}`;

    logger.info({ actionId, noteId }, 'Note created successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        noteId,
        resource_url: resourceUrl,
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, noteId, status: 'completed' }, 'Action marked as completed');

    const fullUrl = `${webAppUrl}${resourceUrl}`;
    const message = `Note created: "${action.title}". View it here: ${fullUrl}`;

    logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

    const publishResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message,
      correlationId: `note-complete-${noteId}`,
    });

    if (!publishResult.ok) {
      logger.warn(
        { actionId, userId: action.userId, error: publishResult.error.message },
        'Failed to send WhatsApp notification (non-fatal)'
      );
    } else {
      logger.info({ actionId }, 'WhatsApp completion notification sent');
    }

    logger.info(
      { actionId, noteId, resourceUrl, status: 'completed' },
      'Note action execution completed successfully'
    );

    return ok({
      status: 'completed',
      resource_url: resourceUrl,
    });
  };
}
