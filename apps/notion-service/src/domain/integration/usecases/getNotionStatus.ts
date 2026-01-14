/**
 * Use case for getting Notion integration status.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { ConnectionRepository } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the GetNotionStatus use case.
 */
export interface GetNotionStatusInput {
  userId: string;
}

/**
 * Dependencies for the GetNotionStatus use case.
 */
export interface GetNotionStatusDeps {
  logger: Logger;
}

/**
 * Error for status retrieval.
 */
export interface GetNotionStatusError {
  code: 'DOWNSTREAM_ERROR';
  message: string;
}

/**
 * Result of status check.
 */
export interface NotionStatus {
  configured: boolean;
  connected: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Execute the GetNotionStatus use case.
 */
export async function getNotionStatus(
  connectionRepository: ConnectionRepository,
  input: GetNotionStatusInput,
  deps: GetNotionStatusDeps
): Promise<Result<NotionStatus, GetNotionStatusError>> {
  const { logger } = deps;

  logger.debug({ userId: input.userId }, 'Checking Notion integration status');

  const result = await connectionRepository.getConnection(input.userId);

  if (!result.ok) {
    logger.error(
      { userId: input.userId, errorMessage: result.error.message },
      'Failed to get Notion connection status'
    );
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: result.error.message,
    });
  }

  const config = result.value;
  const status = {
    configured: config !== null,
    connected: config?.connected ?? false,
    createdAt: config?.createdAt ?? null,
    updatedAt: config?.updatedAt ?? null,
  };

  logger.debug(
    { userId: input.userId, configured: status.configured, connected: status.connected },
    'Notion integration status retrieved'
  );

  return ok(status);
}

/**
 * Factory to create a bound GetNotionStatus use case.
 */
export function createGetNotionStatusUseCase(
  connectionRepository: ConnectionRepository,
  logger: Logger
): (input: GetNotionStatusInput) => Promise<Result<NotionStatus, GetNotionStatusError>> {
  return async (input) => await getNotionStatus(connectionRepository, input, { logger });
}
