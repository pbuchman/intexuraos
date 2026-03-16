import type { Logger } from 'pino';
import type { Command } from '../models/command.js';
import type { CommandRepository } from '../ports/commandRepository.js';

export type ArchiveCommandResult =
  | { success: true; command: Command }
  | { success: false; error: 'NOT_FOUND' | 'INVALID_STATUS'; message: string };

export interface ArchiveCommandUseCase {
  execute(commandId: string, userId: string): Promise<ArchiveCommandResult>;
}

export function createArchiveCommandUseCase(deps: {
  commandRepository: CommandRepository;
  logger: Logger;
}): ArchiveCommandUseCase {
  const { commandRepository, logger } = deps;

  return {
    async execute(commandId: string, userId: string): Promise<ArchiveCommandResult> {
      logger.info({ commandId, userId }, 'Archiving command');

      const command = await commandRepository.getById(commandId);

      if (command?.userId !== userId) {
        return { success: false, error: 'NOT_FOUND', message: 'Command not found' };
      }

      if (command.status !== 'classified') {
        return {
          success: false,
          error: 'INVALID_STATUS',
          message: 'Can only archive classified commands',
        };
      }

      command.status = 'archived';
      command.updatedAt = new Date().toISOString();
      await commandRepository.update(command);

      return { success: true, command };
    },
  };
}
