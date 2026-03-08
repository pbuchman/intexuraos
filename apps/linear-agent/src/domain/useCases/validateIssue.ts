/**
 * Validate Issue Use Case
 *
 * Validates that a Linear issue exists and belongs to the user's configured team.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LinearApiClient, LinearConnectionRepository, LinearLabel } from '../index.js';

export interface ValidateIssueDeps {
  linearApiClient: LinearApiClient;
  connectionRepository: LinearConnectionRepository;
  logger: Logger;
}

export interface ValidateIssueRequest {
  identifier: string;
  userId: string;
}

export interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  /** Labels from the Linear issue */
  labels: LinearLabel[];
  /** Number of child issues */
  childCount: number;
  /** Parent issue UUID (null for top-level issues) */
  parentId: string | null;
}

export interface ValidateIssueError {
  code: 'NOT_CONNECTED' | 'INVALID_FORMAT' | 'NOT_FOUND' | 'WRONG_TEAM' | 'API_ERROR';
  message: string;
}

const IDENTIFIER_PATTERN = /^[A-Z]+-\d+$/;

export async function validateIssue(
  request: ValidateIssueRequest,
  deps: ValidateIssueDeps
): Promise<Result<ValidatedIssue, ValidateIssueError>> {
  const { identifier, userId } = request;
  const { linearApiClient, connectionRepository, logger } = deps;

  if (!IDENTIFIER_PATTERN.test(identifier)) {
    return err({
      code: 'INVALID_FORMAT',
      message: `Invalid issue identifier format: ${identifier}. Expected format: XXX-123`,
    });
  }

  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    logger.error({ userId, error: connectionResult.error }, 'Failed to get connection');
    return err({
      code: 'API_ERROR',
      message: connectionResult.error.message,
    });
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'Linear not connected' });
  }

  const issueResult = await linearApiClient.getIssueByIdentifier(connection.apiKey, identifier);

  if (!issueResult.ok) {
    logger.warn({ identifier, error: issueResult.error }, 'Failed to fetch issue');
    return err({
      code: 'API_ERROR',
      message: issueResult.error.message,
    });
  }

  const issue = issueResult.value;
  if (issue === null) {
    logger.warn({ identifier }, 'Issue not found');
    return err({
      code: 'NOT_FOUND',
      message: `Issue ${identifier} not found in your Linear workspace`,
    });
  }

  if (issue.teamId !== connection.teamId) {
    logger.warn(
      { identifier, issueTeamId: issue.teamId, userTeamId: connection.teamId },
      'Issue belongs to different team'
    );
    return err({
      code: 'WRONG_TEAM',
      message: `Issue ${identifier} belongs to a different team`,
    });
  }

  logger.info({ identifier, issueId: issue.id }, 'Issue validated successfully');

  return ok({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    labels: issue.labels,
    childCount: issue.childCount,
    parentId: issue.parentId ?? null,
  });
}
