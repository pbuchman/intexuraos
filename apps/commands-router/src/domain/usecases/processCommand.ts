import type { Command, CommandSourceType } from '../models/command.js';
import { createCommand, createCommandId } from '../models/command.js';
import { createAction } from '../models/action.js';
import type { CommandRepository } from '../ports/commandRepository.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { Classifier } from '../ports/classifier.js';

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
  classifier: Classifier;
}): ProcessCommandUseCase {
  const { commandRepository, actionRepository, classifier } = deps;

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

      try {
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
      } catch {
        command.status = 'failed';
        await commandRepository.update(command);
      }

      return { command, isNew: true };
    },
  };
}
