import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { Command, CommandSourceType } from '../models/command.js';
import { createCommand, createCommandId } from '../models/command.js';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ClassifierFactory } from '../ports/classifier.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';
import type { UserServiceClient } from '../ports/userServiceClient.js';
import type { ActionsAgentClient } from '../ports/actionsAgentClient.js';

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
  actionsAgentClient: ActionsAgentClient;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  eventPublisher: EventPublisherPort;
  logger: Logger;
}): ProcessCommandUseCase {
  const {
    commandRepository,
    actionsAgentClient,
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

      logger.info({ commandId: command.id, userId: input.userId }, 'Fetching LLM client');

      const llmClientResult = await userServiceClient.getLlmClient(input.userId);

      if (!llmClientResult.ok) {
        logger.warn(
          {
            commandId: command.id,
            userId: input.userId,
            reason: 'fetch_failed',
            errorCode: llmClientResult.error.code,
            errorMessage: llmClientResult.error.message,
          },
          'Failed to fetch LLM client from user-service'
        );
        command.status = 'pending_classification';
        await commandRepository.update(command);
        return { command, isNew: true };
      }

      logger.info(
        { commandId: command.id, textLength: input.text.length },
        'Starting LLM classification'
      );

      try {
        const classifier = classifierFactory(llmClientResult.value);
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

        logger.info(
          {
            commandId: command.id,
            actionType: classification.type,
            title: classification.title,
          },
          'Creating action via actions-agent'
        );

        const actionResult = await actionsAgentClient.createAction({
          userId: input.userId,
          commandId: command.id,
          type: classification.type,
          confidence: classification.confidence,
          title: classification.title,
          payload: { prompt: input.text },
        });

        if (!actionResult.ok) {
          logger.error(
            {
              commandId: command.id,
              error: actionResult.error.message,
            },
            'Failed to create action via actions-agent'
          );
          command.status = 'failed';
          command.failureReason = actionResult.error.message;
          await commandRepository.update(command);
          return { command, isNew: true };
        }

        const action = actionResult.value;

        logger.info(
          { commandId: command.id, actionId: action.id },
          'Action created via actions-agent successfully'
        );

        const eventPayload: ActionCreatedEvent['payload'] = {
          prompt: input.text,
          confidence: classification.confidence,
        };
        if (classification.selectedModels !== undefined) {
          eventPayload.selectedModels = classification.selectedModels;
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

        const publishResult = await eventPublisher.publishActionCreated(event);

        if (!publishResult.ok) {
          logger.error(
            {
              commandId: command.id,
              actionId: action.id,
              error: publishResult.error.message,
            },
            'Failed to publish action.created event'
          );
        } else {
          logger.info(
            { commandId: command.id, actionId: action.id },
            'Action event published successfully'
          );
        }

        command.classification = {
          type: classification.type,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          classifiedAt: new Date().toISOString(),
        };
        command.actionId = action.id;
        command.status = 'classified';

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
            actionId: command.actionId,
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
