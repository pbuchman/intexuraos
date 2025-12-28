/**
 * Use case for connecting Notion integration.
 *
 * Business rules:
 * 1. Validate that the page is accessible before saving connection
 * 2. Map Notion error codes to appropriate domain errors
 * 3. Return connection details with page preview on success
 */
import { err, ok, type Result } from '@intexuraos/common';
import type { ConnectionRepository, NotionApi, NotionError } from '../ports/index.js';

/**
 * Input for the ConnectNotion use case.
 */
export interface ConnectNotionInput {
  userId: string;
  notionToken: string;
  promptVaultPageId: string;
}

/**
 * Error codes specific to this use case.
 */
export type ConnectNotionErrorCode =
  | 'PAGE_NOT_ACCESSIBLE'
  | 'INVALID_TOKEN'
  | 'DOWNSTREAM_ERROR'
  | 'VALIDATION_ERROR';

export interface ConnectNotionError {
  code: ConnectNotionErrorCode;
  message: string;
  details?: {
    pageId?: string;
    notionError?: string;
  };
}

/**
 * Result of successful connection.
 */
export interface ConnectNotionResult {
  connected: boolean;
  promptVaultPageId: string;
  createdAt: string;
  updatedAt: string;
  pageTitle: string;
  pageUrl: string;
}

/**
 * Execute the ConnectNotion use case.
 *
 * Steps:
 * 1. Validate page access using Notion API
 * 2. Map Notion errors to domain errors
 * 3. Save connection to repository
 * 4. Return combined result with page details
 */
export async function connectNotion(
  connectionRepository: ConnectionRepository,
  notionApi: NotionApi,
  input: ConnectNotionInput
): Promise<Result<ConnectNotionResult, ConnectNotionError>> {
  const { userId, notionToken, promptVaultPageId } = input;

  // Step 1: Validate page access BEFORE saving connection
  const pageValidation = await notionApi.getPageWithPreview(notionToken, promptVaultPageId);

  if (!pageValidation.ok) {
    // Step 2: Map Notion error codes to domain errors
    return mapNotionErrorToConnectError(pageValidation.error, promptVaultPageId);
  }

  // Step 3: Page is accessible - save the connection
  const saveResult = await connectionRepository.saveConnection(
    userId,
    promptVaultPageId,
    notionToken
  );

  if (!saveResult.ok) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: saveResult.error.message,
    });
  }

  // Step 4: Return combined result
  const config = saveResult.value;
  return ok({
    connected: config.connected,
    promptVaultPageId: config.promptVaultPageId,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    pageTitle: pageValidation.value.page.title,
    pageUrl: pageValidation.value.page.url,
  });
}

/**
 * Map Notion API errors to domain-specific ConnectNotion errors.
 */
function mapNotionErrorToConnectError(
  notionError: NotionError,
  pageId: string
): Result<never, ConnectNotionError> {
  const { code, message } = notionError;

  if (code === 'NOT_FOUND') {
    return err({
      code: 'PAGE_NOT_ACCESSIBLE',
      message:
        `Could not access page with ID "${pageId}". ` +
        'Make sure the page exists and is shared with your Notion integration. ' +
        'You can share a page by clicking "..." menu → "Add connections" → select your integration.',
      details: {
        pageId,
        notionError: message,
      },
    });
  }

  if (code === 'UNAUTHORIZED') {
    return err({
      code: 'INVALID_TOKEN',
      message: 'Invalid Notion token. Please reconnect your Notion integration.',
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
  notionApi: NotionApi
): (input: ConnectNotionInput) => Promise<Result<ConnectNotionResult, ConnectNotionError>> {
  return async (input) => await connectNotion(connectionRepository, notionApi, input);
}
