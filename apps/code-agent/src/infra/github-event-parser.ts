/**
 * GitHub webhook event parser — thin dispatcher.
 *
 * Per-event parsing lives in `./github/event-handlers/*.ts`. This module
 * handles repository filtering and routes incoming events to the correct
 * handler via the `gitHubEventHandlers` registry.
 */

import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { CreateGitHubPREventInput } from '../domain/models/gitHubPREvent.js';
import { gitHubEventHandlers } from './github/event-handlers/index.js';

// Supported GitHub repositories
const ALLOWED_REPOS = /^[\w-]+\/intexuraos$/;
const INT_EXURAOS_ORG_REPOS = /^intexuraos\/[\w-]+$/;

/**
 * Check if a repository should be processed.
 * Only processes intexuraos/* repositories.
 */
export function shouldProcessRepository(repositoryFullName: string): boolean {
  return (
    INT_EXURAOS_ORG_REPOS.test(repositoryFullName) ||
    ALLOWED_REPOS.test(repositoryFullName)
  );
}

// Re-export per-event handlers so existing consumers that import from
// this module path continue to work.
export {
  parseCheckSuiteEvent,
  parseIssueCommentEvent,
  parsePullRequestEvent,
  parsePullRequestReviewCommentEvent,
  parsePullRequestReviewEvent,
  parsePushEvent,
} from './github/event-handlers/index.js';

/**
 * Parse a GitHub webhook event based on the event type.
 *
 * - `ping` events are always acknowledged with `ok(null)`.
 * - Unknown event types are ignored with `ok(null)`.
 */
export function parseGitHubWebhookEvent(
  eventType: string,
  payload: unknown
): Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (eventType === 'ping') {
    // Ping events don't need to be stored
    return ok(null);
  }
  const handler = gitHubEventHandlers[eventType];
  if (!handler) {
    // Unknown event type, ignore
    return ok(null);
  }
  return handler(payload);
}
