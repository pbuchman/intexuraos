/**
 * Use case for connecting Notion integration.
 *
 * Business rules:
 * 1. Validate that the page is accessible before saving connection
 * 2. Map Notion error codes to appropriate domain errors
 * 3. Return connection details with page preview on success
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { ConnectionRepository, NotionApi, NotionError } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the ConnectNotion use case.
 */
export interface ConnectNotionInput {
  userId: string;
  notionToken: string;
}

/**
 * Dependencies for the ConnectNotion use case.
 */
export interface ConnectNotionDeps {
  logger: Logger;
}

/**
 * Error codes specific to this use case.
 */
export type ConnectNotionErrorCode = 'INVALID_TOKEN' | 'DOWNSTREAM_ERROR' | 'VALIDATION_ERROR';

export interface ConnectNotionError {
  code: ConnectNotionErrorCode;
  message: string;
  details?: {
    notionError?: string;
  };
}

/**
 * Result of successful connection.
 */
export interface ConnectNotionResult {
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Execute the ConnectNotion use case.
 *
 * Steps:
 * 1. Validate token using Notion API
 * 2. Map Notion errors to domain errors
 * 3. Save connection to repository
 * 4. Return result
 */
export async function connectNotion(
  connectionRepository: ConnectionRepository,
  notionApi: NotionApi,
  input: ConnectNotionInput,
  deps: ConnectNotionDeps
): Promise<Result<ConnectNotionResult, ConnectNotionError>> {
  const { userId, notionToken } = input;
  const { logger } = deps;

  logger.info({ userId }, 'Validating Notion token for connection');

  // Step 1: Validate token BEFORE saving connection
  const tokenValidation = await notionApi.validateToken(notionToken);

  if (!tokenValidation.ok) {
    // Step 2: Map Notion error codes to domain errors
    logger.warn(
      { userId, errorCode: tokenValidation.error.code },
      'Notion token validation failed'
    );
    return mapNotionErrorToConnectError(tokenValidation.error);
  }

  if (!tokenValidation.value) {
    logger.warn({ userId }, 'Notion token validation returned false');
    return err({
      code: 'INVALID_TOKEN',
      message: 'Invalid Notion token. Please check your integration token.',
    });
  }

  // Step 3: Token is valid - save the connection
  const saveResult = await connectionRepository.saveConnection(userId, notionToken);

  if (!saveResult.ok) {
    logger.error({ userId, errorMessage: saveResult.error.message }, 'Failed to save Notion connection');
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: saveResult.error.message,
    });
  }

  // Step 4: Return result
  const config = saveResult.value;
  logger.info({ userId, connected: config.connected }, 'Notion connection saved successfully');
  return ok({
    connected: config.connected,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  });
}

/**
 * Map Notion API errors to domain-specific ConnectNotion errors.
 */
function mapNotionErrorToConnectError(notionError: NotionError): Result<never, ConnectNotionError> {
  const { code, message } = notionError;

  if (code === 'UNAUTHORIZED') {
    return err({
      code: 'INVALID_TOKEN',
      message: 'Invalid Notion token. Please check your integration token.',
      details: {
        notionError: message,
      },
    });
  }

  return err({
    code: 'DOWNSTREAM_ERROR',
    message,
    details: {
      notionError: code,
    },
  });
}

/**
 * Factory to create a bound ConnectNotion use case.
 */
export function createConnectNotionUseCase(
  connectionRepository: ConnectionRepository,
  notionApi: NotionApi,
  logger: Logger
): (input: ConnectNotionInput) => Promise<Result<ConnectNotionResult, ConnectNotionError>> {
  return async (input) => await connectNotion(connectionRepository, notionApi, input, { logger });
}
