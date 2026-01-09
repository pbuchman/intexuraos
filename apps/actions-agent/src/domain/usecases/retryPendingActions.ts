import type { Logger } from 'pino';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ActionEventPublisher } from '../../infra/pubsub/actionEventPublisher.js';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import { getHandlerForType, type ActionHandlerRegistry } from './actionHandlerRegistry.js';

const DEFAULT_RETRY_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface RetryResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  skipReasons: Record<string, number>;
}

export interface RetryPendingActionsUseCase {
  execute(): Promise<RetryResult>;
}

export function createRetryPendingActionsUseCase(deps: {
  actionRepository: ActionRepository;
  actionEventPublisher: ActionEventPublisher;
  actionHandlerRegistry: ActionHandlerRegistry;
  logger: Logger;
  retryThresholdMs?: number;
}): RetryPendingActionsUseCase {
  const { actionRepository, actionEventPublisher, actionHandlerRegistry, logger } = deps;
  const retryThresholdMs = deps.retryThresholdMs ?? DEFAULT_RETRY_THRESHOLD_MS;

  return {
    async execute(): Promise<RetryResult> {
      logger.info('Starting retry of pending actions');

      const pendingActions = await actionRepository.listByStatus('pending');

      logger.info({ count: pendingActions.length }, 'Found pending actions');

      let processed = 0;
      let skipped = 0;
      let failed = 0;
      const skipReasons: Record<string, number> = {};

      for (const action of pendingActions) {
        const actionAge = Date.now() - new Date(action.createdAt).getTime();

        if (actionAge < retryThresholdMs) {
          logger.debug(
            { actionId: action.id, ageMs: actionAge },
            'Action too recent, skipping retry'
          );
          skipped++;
          skipReasons['too_recent'] = (skipReasons['too_recent'] ?? 0) + 1;
          continue;
        }

        logger.info(
          { actionId: action.id, userId: action.userId, actionType: action.type },
          'Processing pending action'
        );

        const handler = getHandlerForType(actionHandlerRegistry, action.type);

        if (handler === undefined) {
          logger.debug(
            { actionId: action.id, actionType: action.type },
            'No handler for action type, skipping'
          );
          skipped++;
          skipReasons['no_handler_registered'] = (skipReasons['no_handler_registered'] ?? 0) + 1;
          continue;
        }

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

        const publishResult = await actionEventPublisher.publishActionCreated(event);

        if (!publishResult.ok) {
          logger.error(
            { actionId: action.id, error: publishResult.error.message },
            'Failed to publish action.created event'
          );
          failed++;
          continue;
        }

        logger.info({ actionId: action.id, actionType: action.type }, 'Action event re-published');
        processed++;
      }

      const result: RetryResult = {
        processed,
        skipped,
        failed,
        total: pendingActions.length,
        skipReasons,
      };

      logger.info(result, 'Retry of pending actions completed');

      return result;
    },
  };
}
