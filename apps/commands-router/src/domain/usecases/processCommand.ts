import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { Command, CommandSourceType } from '../models/command.js';
import { createCommand, createCommandId } from '../models/command.js';
import { createAction } from '../models/action.js';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ClassifierFactory } from '../ports/classifier.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';
import type { UserServiceClient } from '../../infra/user/index.js';

export interface ProcessCommandInput {
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  timestamp: string;
}

export interface ProcessCommandResult {
  command: Command;
  isNew: boolean;
}

export interface ProcessCommandUseCase {
  execute(input: ProcessCommandInput): Promise<ProcessCommandResult>;
}

export function createProcessCommandUseCase(deps: {
  commandRepository: CommandRepository;
  actionRepository: ActionRepository;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  eventPublisher: EventPublisherPort;
  logger: Logger;
}): ProcessCommandUseCase {
  const {
    commandRepository,
    actionRepository,
    classifierFactory,
    userServiceClient,
    eventPublisher,
    logger,
  } = deps;

  return {
    async execute(input: ProcessCommandInput): Promise<ProcessCommandResult> {
      const commandId = createCommandId(input.sourceType, input.externalId);

      logger.info(
        {
          commandId,
          userId: input.userId,
          sourceType: input.sourceType,
          externalId: input.externalId,
          textPreview: input.text.substring(0, 100),
        },
        'Starting command processing'
      );

      const existingCommand = await commandRepository.getById(commandId);
      if (existingCommand !== null) {
        logger.info(
          {
            commandId,
            status: existingCommand.status,
            classification: existingCommand.classification,
          },
          'Command already exists, skipping processing'
        );
        return { command: existingCommand, isNew: false };
      }

      const command = createCommand({
        sourceType: input.sourceType,
        externalId: input.externalId,
        userId: input.userId,
        text: input.text,
        timestamp: input.timestamp,
      });

      logger.info(
        { commandId: command.id, status: command.status },
        'Created new command, saving to repository'
      );

      await commandRepository.save(command);

      logger.info({ commandId: command.id, userId: input.userId }, 'Fetching user API keys');

      const apiKeysResult = await userServiceClient.getApiKeys(input.userId);

      if (!apiKeysResult.ok || apiKeysResult.value.google === undefined) {
        logger.warn(
          {
            commandId: command.id,
            userId: input.userId,
            reason: !apiKeysResult.ok ? 'fetch_failed' : 'no_google_key',
          },
          'User has no Google API key, marking command as pending_classification'
        );
        command.status = 'pending_classification';
        await commandRepository.update(command);
        return { command, isNew: true };
      }

      const apiKey = apiKeysResult.value.google;

      logger.info(
        { commandId: command.id, textLength: input.text.length },
        'Starting LLM classification'
      );

      try {
        const classifier = classifierFactory(apiKey);
        const classification = await classifier.classify(input.text);

        logger.info(
          {
            commandId: command.id,
            classificationType: classification.type,
            confidence: classification.confidence,
            title: classification.title,
          },
          'Classification completed'
        );

        if (classification.type !== 'unclassified') {
          const action = createAction({
            userId: input.userId,
            commandId: command.id,
            type: classification.type,
            confidence: classification.confidence,
            title: classification.title,
          });

          logger.info(
            {
              commandId: command.id,
              actionId: action.id,
              actionType: action.type,
              title: action.title,
            },
            'Created action from classification'
          );

          await actionRepository.save(action);

          const eventPayload: ActionCreatedEvent['payload'] = {
            prompt: input.text,
            confidence: classification.confidence,
          };
          if (classification.selectedLlms !== undefined) {
            eventPayload.selectedLlms = classification.selectedLlms;
          }

          const event: ActionCreatedEvent = {
            type: 'action.created',
            actionId: action.id,
            userId: input.userId,
            commandId: command.id,
            actionType: classification.type,
            title: classification.title,
            payload: eventPayload,
            timestamp: new Date().toISOString(),
          };

          logger.info(
            {
              commandId: command.id,
              actionId: action.id,
              actionType: classification.type,
            },
            'Publishing action.created event to PubSub'
          );

          await eventPublisher.publishActionCreated(event);

          logger.info(
            { commandId: command.id, actionId: action.id },
            'Action event published successfully'
          );

          command.classification = {
            type: classification.type,
            confidence: classification.confidence,
            classifiedAt: new Date().toISOString(),
          };
          command.actionId = action.id;
          command.status = 'classified';
        } else {
          logger.info(
            {
              commandId: command.id,
              confidence: classification.confidence,
            },
            'Command classified as unclassified (no actionable intent detected)'
          );
          command.classification = {
            type: 'unclassified',
            confidence: classification.confidence,
            classifiedAt: new Date().toISOString(),
          };
          command.status = 'classified';
        }

        logger.info(
          { commandId: command.id, status: command.status },
          'Updating command with classification result'
        );

        await commandRepository.update(command);

        logger.info(
          {
            commandId: command.id,
            status: command.status,
            classificationType: classification.type,
            hasAction: command.actionId !== undefined,
          },
          'Command processing completed successfully'
        );
      } catch (error) {
        logger.error(
          {
            commandId: command.id,
            error: getErrorMessage(error),
          },
          'Classification failed'
        );
        command.status = 'failed';
        command.failureReason = getErrorMessage(error, 'Unknown classification error');
        await commandRepository.update(command);
      }

      return { command, isNew: true };
    },
  };
}
