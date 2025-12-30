/**
 * Use case for disconnecting Notion integration.
 */
import { ok, err, type Result } from '@intexuraos/common-core';
import type { ConnectionRepository } from '../ports/index.js';

/**
 * Input for the DisconnectNotion use case.
 */
export interface DisconnectNotionInput {
  userId: string;
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
  input: DisconnectNotionInput
): Promise<Result<DisconnectNotionResult, DisconnectNotionError>> {
  const result = await connectionRepository.disconnectConnection(input.userId);

  if (!result.ok) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: result.error.message,
    });
  }

  const config = result.value;
  return ok({
    connected: config.connected,
    updatedAt: config.updatedAt,
  });
}

/**
 * Factory to create a bound DisconnectNotion use case.
 */
export function createDisconnectNotionUseCase(
  connectionRepository: ConnectionRepository
): (
  input: DisconnectNotionInput
) => Promise<Result<DisconnectNotionResult, DisconnectNotionError>> {
  return async (input) => await disconnectNotion(connectionRepository, input);
}
