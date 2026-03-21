import type { Logger } from 'pino';
import type { Command } from '../models/command.js';
import type { CommandRepository } from '../ports/commandRepository.js';

export interface ListCommandsResult {
  commands: Command[];
}

export interface ListCommandsUseCase {
  execute(userId: string): Promise<ListCommandsResult>;
}

export function createListCommandsUseCase(deps: {
  commandRepository: CommandRepository;
  logger: Logger;
}): ListCommandsUseCase {
  const { commandRepository, logger } = deps;

  return {
    async execute(userId: string): Promise<ListCommandsResult> {
      logger.info({ userId }, 'Listing commands for user');
      const commands = await commandRepository.listByUserId(userId);
      return { commands };
    },
  };
}
