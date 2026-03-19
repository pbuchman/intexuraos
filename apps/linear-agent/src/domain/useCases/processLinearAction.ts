/**
 * Process Linear Action Use Case
 *
 * Handles natural language Linear issue creation by:
 * 1. Extracting issue data from text using LLM
 * 2. Creating the issue in Linear if valid
 * 3. Saving failed extractions for manual review
 */

import { err, ok, type Result, ServiceErrorCodes } from '@intexuraos/common-core';
import type { Logger, ServiceFeedback } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearApiClient,
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearActionExtractionService,
  ProcessedActionRepository,
} from '../index.js';
import { buildIssueDescription } from '../descriptionBuilder.js';
import { checkProcessedAction } from './checkIdempotency.js';

export interface ProcessLinearActionDeps {
  linearApiClient: LinearApiClient;
  connectionRepository: LinearConnectionRepository;
  failedIssueRepository: FailedIssueRepository;
  extractionService: LinearActionExtractionService;
  processedActionRepository: ProcessedActionRepository;
  logger?: Logger;
}

export interface ProcessLinearActionRequest {
  actionId: string;
  userId: string;
  text: string;
  summary?: string;
}

export type ProcessLinearActionResponse = ServiceFeedback;

export async function processLinearAction(
  request: ProcessLinearActionRequest,
  deps: ProcessLinearActionDeps
): Promise<Result<ProcessLinearActionResponse, LinearError>> {
  const { actionId, userId, text, summary } = request;
  const {
    linearApiClient,
    connectionRepository,
    failedIssueRepository,
    extractionService,
    processedActionRepository,
    logger,
  } = deps;

  // Provide a noop logger if none is provided (logger is optional in ProcessLinearActionDeps)
  const effectiveLogger =
    logger ??
    ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      // Safe: all Logger methods implemented as noops
    } as Logger);

  effectiveLogger.info({ userId, actionId, textLength: text.length }, 'processLinearAction: entry');

  // Idempotency check: return existing result if action was already processed
  const idempotencyResult = await checkProcessedAction(actionId, {
    repository: processedActionRepository,
    logger: effectiveLogger,
  });
  if (!idempotencyResult.ok) {
    return err(idempotencyResult.error);
  }
  if (idempotencyResult.value !== null) {
    return ok(idempotencyResult.value);
  }

  // Get user's connection
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    effectiveLogger.error({ userId, actionId, error: connectionResult.error }, 'Failed to get connection');
    return err(connectionResult.error);
  }

  const connection = connectionResult.value;
  if (connection === null) {
    effectiveLogger.warn({ userId, actionId }, 'User not connected to Linear');
    return err({
      code: 'NOT_CONNECTED',
      message: 'Linear not connected. Please configure in settings.',
    });
  }

  // Extract issue data using LLM
  const extractResult = await extractionService.extractIssue(userId, text);
  if (!extractResult.ok) {
    effectiveLogger.error({ userId, actionId, error: extractResult.error }, 'Extraction failed');

    // Save as failed issue for review
    await failedIssueRepository.create({
      userId,
      actionId,
      originalText: text,
      extractedTitle: null,
      extractedPriority: null,
      error: extractResult.error.message,
      reasoning: null,
    });

    return ok({
      status: 'failed',
      message: extractResult.error.message,
      errorCode: ServiceErrorCodes.EXTRACTION_FAILED,
    });
  }

  const extracted = extractResult.value;
  logger?.info(
    { userId, actionId, title: extracted.title, valid: extracted.valid },
    'Extraction complete'
  );

  // Handle invalid extraction
  if (!extracted.valid) {
    const errorMessage = extracted.error ?? 'Could not extract valid issue from message';
    effectiveLogger.info({ userId, actionId, error: errorMessage }, 'Invalid extraction');

    await failedIssueRepository.create({
      userId,
      actionId,
      originalText: text,
      extractedTitle: extracted.title,
      extractedPriority: extracted.priority,
      error: errorMessage,
      reasoning: extracted.reasoning,
    });

    return ok({
      status: 'failed',
      message: errorMessage,
      errorCode: ServiceErrorCodes.EXTRACTION_FAILED,
    });
  }

  // Build description from extracted sections (with Key Points from summary if available)
  const description = buildIssueDescription(extracted, text, summary);

  // Create issue in Linear
  logger?.info({ userId, actionId, title: extracted.title }, 'Creating Linear issue');

  const createResult = await linearApiClient.createIssue(connection.apiKey, {
    title: extracted.title,
    description,
    priority: extracted.priority,
    teamId: connection.teamId,
  });

  if (!createResult.ok) {
    effectiveLogger.error({ userId, actionId, error: createResult.error }, 'Linear API creation failed');

    await failedIssueRepository.create({
      userId,
      actionId,
      originalText: text,
      extractedTitle: extracted.title,
      extractedPriority: extracted.priority,
      error: createResult.error.message,
      reasoning: extracted.reasoning,
    });

    return ok({
      status: 'failed',
      message: createResult.error.message,
      errorCode: ServiceErrorCodes.EXTERNAL_API_ERROR,
    });
  }

  const createdIssue = createResult.value;
  logger?.info(
    { userId, actionId, issueId: createdIssue.id, identifier: createdIssue.identifier },
    'Issue created successfully'
  );

  // Save processed action for idempotency
  const saveResult = await processedActionRepository.create({
    actionId,
    userId,
    issueId: createdIssue.id,
    issueIdentifier: createdIssue.identifier,
    resourceUrl: createdIssue.url,
  });

  if (!saveResult.ok) {
    effectiveLogger.warn(
      { actionId, error: saveResult.error },
      'Failed to save processed action (issue was created successfully)'
    );
  }

  return ok({
    status: 'completed',
    message: `Issue ${createdIssue.identifier} created successfully`,
    resourceUrl: createdIssue.url,
  });
}
