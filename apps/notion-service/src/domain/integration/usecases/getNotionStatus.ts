/**
 * Use case for getting Notion integration status.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { ConnectionRepository } from '../ports/index.js';

/**
 * Input for the GetNotionStatus use case.
 */
export interface GetNotionStatusInput {
  userId: string;
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
  input: GetNotionStatusInput
): Promise<Result<NotionStatus, GetNotionStatusError>> {
  const result = await connectionRepository.getConnection(input.userId);

  if (!result.ok) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: result.error.message,
    });
  }

  const config = result.value;
  return ok({
    configured: config !== null,
    connected: config?.connected ?? false,
    createdAt: config?.createdAt ?? null,
    updatedAt: config?.updatedAt ?? null,
  });
}

/**
 * Factory to create a bound GetNotionStatus use case.
 */
export function createGetNotionStatusUseCase(
  connectionRepository: ConnectionRepository
): (input: GetNotionStatusInput) => Promise<Result<NotionStatus, GetNotionStatusError>> {
  return async (input) => await getNotionStatus(connectionRepository, input);
}
