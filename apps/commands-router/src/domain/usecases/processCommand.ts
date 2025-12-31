import { getErrorMessage } from '@intexuraos/common-core';
import type { Command, CommandSourceType } from '../models/command.js';
import { createCommand, createCommandId } from '../models/command.js';
import { createAction } from '../models/action.js';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ClassifierFactory } from '../ports/classifier.js';
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
}): ProcessCommandUseCase {
  const { commandRepository, actionRepository, classifierFactory, userServiceClient } = deps;

  return {
    async execute(input: ProcessCommandInput): Promise<ProcessCommandResult> {
      const commandId = createCommandId(input.sourceType, input.externalId);

      const existingCommand = await commandRepository.getById(commandId);
      if (existingCommand !== null) {
        return { command: existingCommand, isNew: false };
      }

      const command = createCommand({
        sourceType: input.sourceType,
        externalId: input.externalId,
        userId: input.userId,
        text: input.text,
        timestamp: input.timestamp,
      });

      await commandRepository.save(command);

      const apiKeysResult = await userServiceClient.getApiKeys(input.userId);

      if (!apiKeysResult.ok || apiKeysResult.value.google === undefined) {
        command.status = 'pending_classification';
        await commandRepository.update(command);
        return { command, isNew: true };
      }

      const apiKey = apiKeysResult.value.google;

      try {
        const classifier = classifierFactory(apiKey);
        const classification = await classifier.classify(input.text);

        if (classification.type !== 'unclassified') {
          const action = createAction({
            userId: input.userId,
            commandId: command.id,
            type: classification.type,
            confidence: classification.confidence,
            title: classification.title,
          });

          await actionRepository.save(action);

          command.classification = {
            type: classification.type,
            confidence: classification.confidence,
            classifiedAt: new Date().toISOString(),
          };
          command.actionId = action.id;
          command.status = 'classified';
        } else {
          command.classification = {
            type: 'unclassified',
            confidence: classification.confidence,
            classifiedAt: new Date().toISOString(),
          };
          command.status = 'classified';
        }

        await commandRepository.update(command);
      } catch (error) {
        command.status = 'failed';
        command.failureReason = getErrorMessage(error, 'Unknown classification error');
        await commandRepository.update(command);
      }

      return { command, isNew: true };
    },
  };
}
