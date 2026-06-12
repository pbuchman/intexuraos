/**
 * Shared best-effort Linear announcement helper used by both dispatch paths.
 *
 * Sets an issue to `in_progress` and posts a markdown comment. All failures
 * are logged at `warn` and swallowed — Linear communication is never allowed
 * to fail the primary dispatch flow.
 *
 * Log message templates are supplied by the caller so the two dispatch paths
 * can preserve their distinct wording without forcing the helper to encode
 * copy-specific strings.
 */

import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../../ports/linearAgentClient.js';

export interface AnnounceInLinearDeps {
  logger: Logger;
  linearAgentClient: LinearAgentClient;
}

export interface AnnounceInLinearInput {
  userId: string;
  issueId: string;
  /** Markdown body of the announcement comment. */
  body: string;
  /** Log message for a failed updateIssueState call. */
  stateFailureMessage: string;
  /** Log message for a failed addComment call. */
  commentFailureMessage: string;
}

export async function announceInLinear(
  deps: AnnounceInLinearDeps,
  input: AnnounceInLinearInput,
): Promise<void> {
  const { logger, linearAgentClient } = deps;
  const { userId, issueId, body, stateFailureMessage, commentFailureMessage } = input;

  const updateIssueResult = await linearAgentClient.updateIssueState({
    userId,
    issueId,
    state: 'in_progress',
  });
  if (!updateIssueResult.ok) {
    logger.warn({ linearIssueId: issueId, error: updateIssueResult.error }, stateFailureMessage);
  }

  const commentResult = await linearAgentClient.addComment({ userId, issueId, body });
  if (!commentResult.ok) {
    logger.warn({ linearIssueId: issueId, error: commentResult.error }, commentFailureMessage);
  }
}
