import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ClassifierFactory } from '../ports/classifier.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';
import type { UserServiceClient } from '../../infra/user/index.js';
import type { ActionsAgentClient } from '../../infra/actionsAgent/client.js';

export interface RetryResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  skipReasons: Record<string, number>;
}

export interface RetryPendingCommandsUseCase {
  execute(): Promise<RetryResult>;
}

export function createRetryPendingCommandsUseCase(deps: {
  commandRepository: CommandRepository;
  actionsAgentClient: ActionsAgentClient;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  eventPublisher: EventPublisherPort;
  logger: Logger;
}): RetryPendingCommandsUseCase {
  const {
    commandRepository,
    actionsAgentClient,
    classifierFactory,
    userServiceClient,
    eventPublisher,
    logger,
  } = deps;

  return {
    async execute(): Promise<RetryResult> {
      logger.info('Starting retry of pending classifications');

      const pendingCommands = await commandRepository.listByStatus('pending_classification');

      logger.info({ count: pendingCommands.length }, 'Found pending commands');

      let processed = 0;
      let skipped = 0;
      let failed = 0;
      const skipReasons: Record<string, number> = {};

      for (const command of pendingCommands) {
        logger.info(
          { commandId: command.id, userId: command.userId },
          'Processing pending command'
        );

        const apiKeysResult = await userServiceClient.getApiKeys(command.userId);

        if (!apiKeysResult.ok) {
          logger.debug(
            { commandId: command.id, userId: command.userId, errorCode: apiKeysResult.error.code },
            'Failed to fetch API keys, skipping command'
          );
          skipped++;
          skipReasons['api_keys_fetch_failed'] = (skipReasons['api_keys_fetch_failed'] ?? 0) + 1;
          continue;
        }

        if (apiKeysResult.value.google === undefined) {
          logger.debug(
            { commandId: command.id, userId: command.userId },
            'User still has no Google API key, skipping'
          );
          skipped++;
          skipReasons['no_google_api_key'] = (skipReasons['no_google_api_key'] ?? 0) + 1;
          continue;
        }

        const apiKey = apiKeysResult.value.google;

        try {
          const classifier = classifierFactory(apiKey, command.userId);
          const classification = await classifier.classify(command.text);

          logger.info(
            {
              commandId: command.id,
              classificationType: classification.type,
              confidence: classification.confidence,
            },
            'Classification completed'
          );

          if (classification.type !== 'unclassified') {
            const actionResult = await actionsAgentClient.createAction({
              userId: command.userId,
              commandId: command.id,
              type: classification.type,
              confidence: classification.confidence,
              title: classification.title,
              payload: { prompt: command.text },
            });

            if (!actionResult.ok) {
              logger.error(
                {
                  commandId: command.id,
                  error: actionResult.error.message,
                },
                'Failed to create action via actions-agent'
              );
              failed++;
              continue;
            }

            const action = actionResult.value;

            const eventPayload: ActionCreatedEvent['payload'] = {
              prompt: command.text,
              confidence: classification.confidence,
            };
            if (classification.selectedModels !== undefined) {
              eventPayload.selectedModels = classification.selectedModels;
            }

            const event: ActionCreatedEvent = {
              type: 'action.created',
              actionId: action.id,
              userId: command.userId,
              commandId: command.id,
              actionType: classification.type,
              title: classification.title,
              payload: eventPayload,
              timestamp: new Date().toISOString(),
            };

            await eventPublisher.publishActionCreated(event);

            command.actionId = action.id;

            logger.info(
              { commandId: command.id, actionId: action.id },
              'Action created and event published'
            );
          }

          command.classification = {
            type: classification.type,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
            classifiedAt: new Date().toISOString(),
          };
          command.status = 'classified';

          await commandRepository.update(command);
          processed++;

          logger.info(
            { commandId: command.id, status: 'classified' },
            'Command successfully classified'
          );
        } catch (error) {
          logger.error(
            { commandId: command.id, error: getErrorMessage(error) },
            'Classification failed'
          );

          command.status = 'failed';
          command.failureReason = getErrorMessage(
            error,
            'Unknown classification error during retry'
          );
          await commandRepository.update(command);
          failed++;
        }
      }

      const result: RetryResult = {
        processed,
        skipped,
        failed,
        total: pendingCommands.length,
        skipReasons,
      };

      logger.info(result, 'Retry of pending classifications completed');

      return result;
    },
  };
}
