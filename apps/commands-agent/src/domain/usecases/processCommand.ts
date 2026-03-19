import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { Command, CommandSourceType } from '../models/command.js';
import { createCommand, createCommandId } from '../models/command.js';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ClassifierFactory, ClassificationResult } from '../ports/classifier.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { ActionsAgentClient } from '../ports/actionsAgentClient.js';
import type { Action } from '../models/action.js';
import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

export interface ProcessCommandInput {
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  summary?: string;
  timestamp: string;
}

export interface ProcessCommandResult {
  command: Command;
  isNew: boolean;
}

export interface ProcessCommandUseCase {
  execute(input: ProcessCommandInput): Promise<ProcessCommandResult>;
}

export async function classifyCommand(deps: {
  classifierFactory: ClassifierFactory;
  llmClient: LlmGenerateClient;
  text: string;
  sourceType?: CommandSourceType;
  logger: Logger;
}): Promise<ClassificationResult> {
  const classifier = deps.classifierFactory(deps.llmClient, deps.logger);
  const options = deps.sourceType !== undefined ? { sourceType: deps.sourceType } : undefined;
  return await classifier.classify(deps.text, options);
}

export async function createActionFromClassification(deps: {
  actionsAgentClient: ActionsAgentClient;
  userId: string;
  commandId: string;
  classification: ClassificationResult;
  text: string;
  summary: string | undefined; // @allow-undefined-type -- CA-3 introduced this pattern, preserving for consistency
  logger: Logger;
}): Promise<Result<Action>> {
  return await deps.actionsAgentClient.createAction({
    userId: deps.userId,
    commandId: deps.commandId,
    type: deps.classification.type,
    confidence: deps.classification.confidence,
    title: deps.classification.title,
    payload: {
      prompt: deps.text,
      ...(deps.summary !== undefined && { summary: deps.summary }),
    },
  });
}

export async function publishActionEvent(deps: {
  eventPublisher: EventPublisherPort;
  action: Action;
  userId: string;
  commandId: string;
  classification: ClassificationResult;
  text: string;
  summary: string | undefined; // @allow-undefined-type -- CA-3 introduced this pattern, preserving for consistency
  logger: Logger;
}): Promise<void> {
  const eventPayload: ActionCreatedEvent['payload'] = {
    prompt: deps.text,
    confidence: deps.classification.confidence,
  };
  if (deps.summary !== undefined) {
    eventPayload.summary = deps.summary;
  }

  const event: ActionCreatedEvent = {
    type: 'action.created',
    actionId: deps.action.id,
    userId: deps.userId,
    commandId: deps.commandId,
    actionType: deps.classification.type,
    title: deps.classification.title,
    payload: eventPayload,
    timestamp: new Date().toISOString(),
  };

  deps.logger.info(
    {
      commandId: deps.commandId,
      actionId: deps.action.id,
      actionType: deps.classification.type,
    },
    'Publishing action.created event to PubSub'
  );

  const publishResult = await deps.eventPublisher.publishActionCreated(event);

  if (!publishResult.ok) {
    deps.logger.error(
      {
        commandId: deps.commandId,
        actionId: deps.action.id,
        error: publishResult.error.message,
      },
      'Failed to publish action.created event'
    );
  } else {
    deps.logger.info(
      { commandId: deps.commandId, actionId: deps.action.id },
      'Action event published successfully'
    );
  }
}

export function finalizeClassifiedCommand(
  command: Command,
  classification: ClassificationResult,
  actionId: string
): void {
  command.classification = {
    type: classification.type,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    promptVersion: classification.promptVersion,
    classifiedAt: new Date().toISOString(),
  };
  command.actionId = actionId;
  command.status = 'classified';
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
        ...(input.summary !== undefined && { summary: input.summary }),
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
        const classification = await classifyCommand({
          classifierFactory,
          llmClient: llmClientResult.value,
          text: input.text,
          sourceType: input.sourceType,
          logger,
        });

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

        const actionResult = await createActionFromClassification({
          actionsAgentClient,
          userId: input.userId,
          commandId: command.id,
          classification,
          text: input.text,
          summary: input.summary,
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

        await publishActionEvent({
          eventPublisher,
          action,
          userId: input.userId,
          commandId: command.id,
          classification,
          text: input.text,
          summary: input.summary,
          logger,
        });

        finalizeClassifiedCommand(command, classification, action.id);

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
