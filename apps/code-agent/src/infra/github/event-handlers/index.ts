/**
 * Registry of GitHub webhook event handlers, keyed by event type.
 *
 * The dispatcher in `github-event-parser.ts` looks up the handler for
 * an incoming event type in this record and delegates parsing to it.
 */

import type { EventHandler } from './shared.js';
import { parseCheckSuiteEvent } from './check-suite-handler.js';
import { parseIssueCommentEvent } from './issue-comment-handler.js';
import { parsePullRequestEvent } from './pull-request-handler.js';
import { parsePullRequestReviewCommentEvent } from './pull-request-review-comment-handler.js';
import { parsePullRequestReviewEvent } from './pull-request-review-handler.js';
import { parsePushEvent } from './push-handler.js';

export const gitHubEventHandlers: Record<string, EventHandler> = {
  pull_request: parsePullRequestEvent,
  pull_request_review: parsePullRequestReviewEvent,
  pull_request_review_comment: parsePullRequestReviewCommentEvent,
  issue_comment: parseIssueCommentEvent,
  push: parsePushEvent,
  check_suite: parseCheckSuiteEvent,
};

// Re-export handlers and shared types for public use
export * from './shared.js';
export { parseCheckSuiteEvent } from './check-suite-handler.js';
export { parseIssueCommentEvent } from './issue-comment-handler.js';
export { parsePullRequestEvent } from './pull-request-handler.js';
export { parsePullRequestReviewCommentEvent } from './pull-request-review-comment-handler.js';
export { parsePullRequestReviewEvent } from './pull-request-review-handler.js';
export { parsePushEvent } from './push-handler.js';
