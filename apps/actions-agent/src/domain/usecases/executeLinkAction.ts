import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { BookmarksServiceClient } from '../ports/bookmarksServiceClient.js';
import type { CommandsAgentClient } from '../ports/commandsAgentClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';

export interface ExecuteLinkActionDeps {
  actionRepository: ActionRepository;
  bookmarksServiceClient: BookmarksServiceClient;
  commandsAgentClient: CommandsAgentClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface ExecuteLinkActionResult {
  status: 'completed' | 'failed';
  resource_url?: string;
  error?: string;
}

export type ExecuteLinkActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteLinkActionResult>>;

// Matches http/https URLs, excluding characters that are:
// - Whitespace (\s) - URL terminator
// - HTML/XML delimiters (<>) - prevents matching into markup
// - Quotes ("") - prevents matching into quoted attributes
// - URI unsafe chars ({}|\\^`[]) - per RFC 3986, these must be percent-encoded
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function extractUrl(text: string): string | null {
  const matches = text.match(URL_REGEX);
  return matches?.[0] ?? null;
}

export function createExecuteLinkActionUseCase(
  deps: ExecuteLinkActionDeps
): ExecuteLinkActionUseCase {
  const {
    actionRepository,
    bookmarksServiceClient,
    commandsAgentClient,
    whatsappPublisher,
    webAppUrl,
    logger,
  } = deps;

  return async (actionId: string): Promise<Result<ExecuteLinkActionResult>> => {
    logger.info({ actionId }, 'Executing link action');

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

    const validStatuses = ['pending', 'awaiting_approval', 'failed'];
    if (!validStatuses.includes(action.status)) {
      logger.error(
        { actionId, status: action.status },
        'Cannot execute action with invalid status'
      );
      return err(new Error(`Cannot execute action with status: ${action.status}`));
    }

    const urlFromPayload = typeof action.payload['url'] === 'string' ? action.payload['url'] : null;
    const urlFromPrompt =
      typeof action.payload['prompt'] === 'string' ? extractUrl(action.payload['prompt']) : null;
    const urlFromTitle = extractUrl(action.title);
    const url = urlFromPayload ?? urlFromPrompt ?? urlFromTitle;

    logger.info(
      {
        actionId,
        urlFromPayload: urlFromPayload !== null,
        urlFromPrompt: urlFromPrompt !== null,
        urlFromTitle: urlFromTitle !== null,
        urlResolved: url !== null,
      },
      'URL extraction attempted'
    );

    if (url === null) {
      logger.error({ actionId, title: action.title }, 'No URL found in action');
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          error: 'No URL found in action',
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      logger.info({ actionId, status: 'failed' }, 'Action marked as failed due to missing URL');
      return ok({
        status: 'failed',
        error: 'No URL found in action',
      });
    }

    logger.info({ actionId }, 'Setting action to processing');
    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    const command = await commandsAgentClient.getCommand(action.commandId);
    const source = command?.sourceType ?? 'actions-agent';

    logger.info(
      { actionId, userId: action.userId, url, commandId: action.commandId, source },
      'Creating bookmark via bookmarks-agent'
    );

    const result = await bookmarksServiceClient.createBookmark({
      userId: action.userId,
      url,
      title: action.title,
      tags: [],
      source,
      sourceId: action.id,
    });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to create bookmark via bookmarks-agent'
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

    const bookmarkId = result.value.id;
    const resourceUrl = `/#/bookmarks/${bookmarkId}`;

    logger.info({ actionId, bookmarkId }, 'Bookmark created successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        bookmarkId,
        resource_url: resourceUrl,
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, bookmarkId, status: 'completed' }, 'Action marked as completed');

    const fullUrl = `${webAppUrl}${resourceUrl}`;
    const message = `Bookmark saved: "${action.title}". View it here: ${fullUrl}`;

    logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

    const publishResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message,
      correlationId: `bookmark-complete-${bookmarkId}`,
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
      { actionId, bookmarkId, resourceUrl, status: 'completed' },
      'Link action execution completed successfully'
    );

    return ok({
      status: 'completed',
      resource_url: resourceUrl,
    });
  };
}
