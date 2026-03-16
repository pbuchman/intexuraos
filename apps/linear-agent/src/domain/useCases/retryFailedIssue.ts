/**
 * Retry Failed Issue Use Case
 *
 * Retries creating a previously failed Linear issue.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearApiClient,
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearIssue,
} from '../index.js';

export interface RetryFailedIssueDeps {
  failedIssueRepository: FailedIssueRepository;
  linearApiClient: LinearApiClient;
  connectionRepository: LinearConnectionRepository;
  logger?: Logger;
}

export interface RetryFailedIssueRequest {
  failedIssueId: string;
  userId: string;
}

export type RetryFailedIssueResult =
  | { status: 'success'; issue: LinearIssue }
  | { status: 'not_found' }
  | { status: 'not_connected' }
  | { status: 'creation_failed'; errorMessage: string };

export async function retryFailedIssue(
  request: RetryFailedIssueRequest,
  deps: RetryFailedIssueDeps
): Promise<Result<RetryFailedIssueResult, LinearError>> {
  const { failedIssueId, userId } = request;
  const { failedIssueRepository, linearApiClient, connectionRepository, logger } = deps;

  logger?.info({ failedIssueId, userId }, 'retryFailedIssue: entry');

  // Get the failed issue - any error means not found (treat as 404)
  const failedIssueResult = await failedIssueRepository.getById(failedIssueId);
  if (!failedIssueResult.ok) {
    logger?.warn({ error: failedIssueResult.error, failedIssueId, userId }, 'Failed issue not found');
    return ok({ status: 'not_found' });
  }

  const failedIssue = failedIssueResult.value;

  // Check ownership
  if (failedIssue.userId !== userId) {
    logger?.warn({ failedIssueId, userId, ownerUserId: failedIssue.userId }, 'Ownership mismatch');
    return ok({ status: 'not_found' });
  }

  // Get API key for retrying the Linear creation
  const apiKeyResult = await connectionRepository.getApiKey(userId);
  if (!apiKeyResult.ok) {
    logger?.error({ error: apiKeyResult.error, userId }, 'Failed to get API key');
    return err(apiKeyResult.error);
  }

  if (apiKeyResult.value === null) {
    logger?.warn({ userId }, 'User not connected to Linear');
    return ok({ status: 'not_connected' });
  }

  // Get connection to retrieve teamId
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    logger?.error({ error: connectionResult.error, userId }, 'Failed to get connection');
    return err(connectionResult.error);
  }

  if (connectionResult.value === null) {
    logger?.warn({ userId }, 'User not connected to Linear');
    return ok({ status: 'not_connected' });
  }

  // Retry Linear creation with fallback values
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces ?? branches on optional extracted fields that cannot be undefined at runtime @preserve */
  const createResult = await linearApiClient.createIssue(apiKeyResult.value, {
    title: failedIssue.extractedTitle ?? 'Untitled Issue',
    description: failedIssue.reasoning ?? null,
    priority: failedIssue.extractedPriority ?? 3,
    teamId: connectionResult.value.teamId,
  });
  /* v8 ignore stop @preserve */

  if (!createResult.ok) {
    // Update error in Firestore - log if this fails but don't block response
    const updateResult = await failedIssueRepository.update(failedIssueId, {
      error: createResult.error.message,
      lastRetryAt: new Date().toISOString(),
    });
    if (!updateResult.ok) {
      logger?.error(
        { error: updateResult.error, failedIssueId },
        'Failed to update retry metadata in Firestore'
      );
    }
    logger?.warn({ error: createResult.error.message, failedIssueId }, 'Retry creation failed');
    return ok({ status: 'creation_failed', errorMessage: createResult.error.message });
  }

  // Success - delete the failed issue
  const deleteResult = await failedIssueRepository.delete(failedIssueId);
  if (!deleteResult.ok) {
    logger?.error(
      { error: deleteResult.error, failedIssueId, createdLinearIssueId: createResult.value.id },
      'Failed to delete resolved failed issue from Firestore'
    );
    // Still return success - the issue was created in Linear
  }

  logger?.info({ failedIssueId, createdIssueId: createResult.value.id }, 'Retry successful');

  return ok({ status: 'success', issue: createResult.value });
}
