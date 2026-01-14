/**
 * Use case for disconnecting Notion integration.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { ConnectionRepository } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the DisconnectNotion use case.
 */
export interface DisconnectNotionInput {
  userId: string;
}

/**
 * Dependencies for the DisconnectNotion use case.
 */
export interface DisconnectNotionDeps {
  logger: Logger;
}

/**
 * Error for disconnect operation.
 */
export interface DisconnectNotionError {
  code: 'DOWNSTREAM_ERROR';
  message: string;
}

/**
 * Result of disconnect operation.
 */
export interface DisconnectNotionResult {
  connected: boolean;
  updatedAt: string;
}

/**
 * Execute the DisconnectNotion use case.
 */
export async function disconnectNotion(
  connectionRepository: ConnectionRepository,
  input: DisconnectNotionInput,
  deps: DisconnectNotionDeps
): Promise<Result<DisconnectNotionResult, DisconnectNotionError>> {
  const { logger } = deps;

  logger.info({ userId: input.userId }, 'Disconnecting Notion integration');

  const result = await connectionRepository.disconnectConnection(input.userId);

  if (!result.ok) {
    logger.error(
      { userId: input.userId, errorMessage: result.error.message },
      'Failed to disconnect Notion integration'
    );
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: result.error.message,
    });
  }

  const config = result.value;
  logger.info({ userId: input.userId, connected: config.connected }, 'Notion integration disconnected successfully');
  return ok({
    connected: config.connected,
    updatedAt: config.updatedAt,
  });
}

/**
 * Factory to create a bound DisconnectNotion use case.
 */
export function createDisconnectNotionUseCase(
  connectionRepository: ConnectionRepository,
  logger: Logger
): (
  input: DisconnectNotionInput
) => Promise<Result<DisconnectNotionResult, DisconnectNotionError>> {
  return async (input) => await disconnectNotion(connectionRepository, input, { logger });
}
