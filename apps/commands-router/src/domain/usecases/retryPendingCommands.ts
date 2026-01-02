import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { CommandClassification } from '../models/command.js';
import { createAction } from '../models/action.js';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ClassifierFactory } from '../ports/classifier.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';
import type { UserServiceClient } from '../../infra/user/index.js';

export interface RetryResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
}

export interface RetryPendingCommandsUseCase {
  execute(): Promise<RetryResult>;
}

export function createRetryPendingCommandsUseCase(deps: {
  commandRepository: CommandRepository;
  actionRepository: ActionRepository;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  eventPublisher: EventPublisherPort;
  logger: Logger;
}): RetryPendingCommandsUseCase {
  const {
    commandRepository,
    actionRepository,
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
          continue;
        }

        if (apiKeysResult.value.google === undefined) {
          logger.debug(
            { commandId: command.id, userId: command.userId },
            'User still has no Google API key, skipping'
          );
          skipped++;
          continue;
        }

        const apiKey = apiKeysResult.value.google;

        try {
          const classifier = classifierFactory(apiKey);
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
            const action = createAction({
              userId: command.userId,
              commandId: command.id,
              type: classification.type,
              confidence: classification.confidence,
              title: classification.title,
            });

            await actionRepository.save(action);

            const eventPayload: ActionCreatedEvent['payload'] = {
              prompt: command.text,
              confidence: classification.confidence,
            };
            if (classification.selectedLlms !== undefined) {
              eventPayload.selectedLlms = classification.selectedLlms;
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

          const commandClassification: CommandClassification = {
            type: classification.type,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
            classifiedAt: new Date().toISOString(),
          };
          command.classification = commandClassification;
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

      const result: RetryResult = { processed, skipped, failed, total: pendingCommands.length };

      logger.info(result, 'Retry of pending classifications completed');

      return result;
    },
  };
}
