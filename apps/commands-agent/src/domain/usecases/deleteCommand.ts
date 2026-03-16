import type { Logger } from 'pino';
import type { CommandStatus } from '../models/command.js';
import type { CommandRepository } from '../ports/commandRepository.js';

const DELETABLE_STATUSES: readonly CommandStatus[] = ['received', 'pending_classification', 'failed'];

export type DeleteCommandResult =
  | { success: true }
  | { success: false; error: 'NOT_FOUND' | 'INVALID_STATUS'; message: string };

export interface DeleteCommandUseCase {
  execute(commandId: string, userId: string): Promise<DeleteCommandResult>;
}

export function createDeleteCommandUseCase(deps: {
  commandRepository: CommandRepository;
  logger: Logger;
}): DeleteCommandUseCase {
  const { commandRepository, logger } = deps;

  return {
    async execute(commandId: string, userId: string): Promise<DeleteCommandResult> {
      logger.info({ commandId, userId }, 'Deleting command');

      const command = await commandRepository.getById(commandId);

      if (command?.userId !== userId) {
        return { success: false, error: 'NOT_FOUND', message: 'Command not found' };
      }

      if (!DELETABLE_STATUSES.includes(command.status)) {
        return {
          success: false,
          error: 'INVALID_STATUS',
          message: 'Cannot delete classified command. Use archive instead.',
        };
      }

      await commandRepository.delete(commandId);

      return { success: true };
    },
  };
}
