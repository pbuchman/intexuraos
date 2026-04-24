/**
 * Shared helpers and types for GitHub webhook event handlers.
 */

/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CreateGitHubPREventInput,
  GitHubPRAction,
} from '../../../domain/models/gitHubPREvent.js';

/**
 * Event handler signature — parses a GitHub webhook payload into a
 * `CreateGitHubPREventInput` (or `null` when the payload is not relevant)
 * or returns an `INVALID_PAYLOAD` error.
 */
export type EventHandler = (
  payload: unknown
) => Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }>;

/**
 * Extract sender information from a GitHub webhook payload.
 */
export function extractSender(payload: unknown): Result<
  { login: string; id: number; type: string },
  { code: 'INVALID_PAYLOAD'; message: string }
> {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('sender' in payload) ||
    !payload.sender ||
    typeof payload.sender !== 'object'
  ) {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing or invalid sender' });
  }

  const sender = payload.sender as Record<string, unknown>;

  const login = sender['login'];
  const id = sender['id'];
  const type = sender['type'] ?? 'User';

  if (typeof login !== 'string') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid sender login' });
  }

  if (typeof id !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid sender id' });
  }

  return ok({ login, id, type: String(type) });
}

/**
 * Extract base branch from a pull_request object's base.ref field.
 */
export function extractBaseBranch(pr: Record<string, unknown>): string | null {
  const prBase = pr['base'];
  const baseBranchRef = prBase !== null && typeof prBase === 'object'
    ? (prBase as Record<string, unknown>)['ref']
    : undefined;
  return typeof baseBranchRef === 'string' ? baseBranchRef : null;
}

/**
 * Type guard to check if a string is a valid GitHubPRAction.
 */
export function isValidGitHubPRAction(value: string): value is GitHubPRAction {
  const validActions: GitHubPRAction[] = [
    // pull_request actions
    'opened',
    'closed',
    'edited',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'assigned',
    'unassigned',
    'labeled',
    'unlabeled',
    'locked',
    'unlocked',
    'review_requested',
    'review_request_removed',
    'milestoned',
    'demilestoned',
    'enqueued',
    'dequeued',
    'auto_merge_enabled',
    'auto_merge_disabled',
    // pull_request_review actions
    'submitted',
    'dismissed',
    // pull_request_review_comment actions
    'created',
    'deleted',
  ];
  return validActions.includes(value as GitHubPRAction);
}
