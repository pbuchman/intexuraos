import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ClassifierFactory } from '../ports/classifier.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { ActionsAgentClient } from '../ports/actionsAgentClient.js';
import {
  classifyCommand,
  createActionFromClassification,
  publishActionEvent,
  finalizeClassifiedCommand,
} from './processCommand.js';

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

        const llmClientResult = await userServiceClient.getLlmClient(command.userId);

        if (!llmClientResult.ok) {
          logger.debug(
            { commandId: command.id, userId: command.userId, errorCode: llmClientResult.error.code },
            'Failed to fetch LLM client, skipping command'
          );
          skipped++;
          skipReasons['llm_client_fetch_failed'] = (skipReasons['llm_client_fetch_failed'] ?? 0) + 1;
          continue;
        }

        try {
          const classification = await classifyCommand({
            classifierFactory,
            llmClient: llmClientResult.value,
            text: command.text,
            logger,
          });

          logger.info(
            {
              commandId: command.id,
              classificationType: classification.type,
              confidence: classification.confidence,
            },
            'Classification completed'
          );

          const actionResult = await createActionFromClassification({
            actionsAgentClient,
            userId: command.userId,
            commandId: command.id,
            classification,
            text: command.text,
            summary: command.summary,
            logger,
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

          await publishActionEvent({
            eventPublisher,
            action,
            userId: command.userId,
            commandId: command.id,
            classification,
            text: command.text,
            summary: command.summary,
            logger,
          });

          finalizeClassifiedCommand(command, classification, action.id);

          logger.info(
            { commandId: command.id, actionId: action.id },
            'Action created and event published'
          );

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
