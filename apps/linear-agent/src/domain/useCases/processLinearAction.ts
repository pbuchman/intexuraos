/**
 * Process Linear Action Use Case
 *
 * Handles natural language Linear issue creation by:
 * 1. Extracting issue data from text using LLM
 * 2. Creating the issue in Linear if valid
 * 3. Saving failed extractions for manual review
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearApiClient,
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearActionExtractionService,
  ExtractedIssueData,
  ProcessedActionRepository,
} from '../index.js';

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

export interface ProcessLinearActionResponse {
  status: 'completed' | 'failed';
  resourceUrl?: string;
  issueIdentifier?: string;
  error?: string;
}

/**
 * Build structured markdown description from extracted data.
 */
function buildDescription(extracted: ExtractedIssueData, summary?: string): string | null {
  const sections: string[] = [];

  if (summary !== undefined) {
    sections.push(`## Key Points\n\n${summary}`);
  }

  if (extracted.functionalRequirements !== null) {
    sections.push(`## Functional Requirements\n\n${extracted.functionalRequirements}`);
  }

  if (extracted.technicalDetails !== null) {
    sections.push(`## Technical Details\n\n${extracted.technicalDetails}`);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join('\n\n');
}

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

  logger?.info({ userId, actionId, textLength: text.length }, 'processLinearAction: entry');

  // Idempotency check: return existing result if action was already processed
  const existingResult = await processedActionRepository.getByActionId(actionId);
  if (!existingResult.ok) {
    logger?.error({ actionId, error: existingResult.error }, 'Failed to check processed action');
    return err(existingResult.error);
  }

  if (existingResult.value !== null) {
    const existing = existingResult.value;
    logger?.info(
      { actionId, issueIdentifier: existing.issueIdentifier },
      'Action already processed, returning existing result'
    );
    return ok({
      status: 'completed',
      resourceUrl: existing.resourceUrl,
      issueIdentifier: existing.issueIdentifier,
    });
  }

  // Get user's connection
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    logger?.error({ userId, actionId, error: connectionResult.error }, 'Failed to get connection');
    return err(connectionResult.error);
  }

  const connection = connectionResult.value;
  if (connection === null) {
    logger?.warn({ userId, actionId }, 'User not connected to Linear');
    return err({
      code: 'NOT_CONNECTED',
      message: 'Linear not connected. Please configure in settings.',
    });
  }

  // Extract issue data using LLM
  const extractResult = await extractionService.extractIssue(userId, text);
  if (!extractResult.ok) {
    logger?.error({ userId, actionId, error: extractResult.error }, 'Extraction failed');

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
      error: extractResult.error.message,
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
    logger?.info({ userId, actionId, error: errorMessage }, 'Invalid extraction');

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
      error: errorMessage,
    });
  }

  // Build description from extracted sections (with Key Points from summary if available)
  const description = buildDescription(extracted, summary);

  // Create issue in Linear
  logger?.info({ userId, actionId, title: extracted.title }, 'Creating Linear issue');

  const createResult = await linearApiClient.createIssue(connection.apiKey, {
    title: extracted.title,
    description,
    priority: extracted.priority,
    teamId: connection.teamId,
  });

  if (!createResult.ok) {
    logger?.error({ userId, actionId, error: createResult.error }, 'Linear API creation failed');

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
      error: createResult.error.message,
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
    logger?.warn(
      { actionId, error: saveResult.error },
      'Failed to save processed action (issue was created successfully)'
    );
  }

  return ok({
    status: 'completed',
    resourceUrl: createdIssue.url,
    issueIdentifier: createdIssue.identifier,
  });
}
