/**
 * Parser for GitHub `push` webhook events.
 */

/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/dot-notation */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CreateGitHubPREventInput,
  GitHubEventType,
} from '../../../domain/models/gitHubPREvent.js';
import { extractSender } from './shared.js';

/**
 * Parse a push event payload.
 * Push events are optional for context, so we return null if not PR-related.
 */
export function parsePushEvent(
  payload: unknown
): Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Payload is not an object' });
  }

  const p = payload as Record<string, unknown>;

  const senderResult = extractSender(payload);
  if (!senderResult.ok) {
    return senderResult;
  }

  const repository = p['repository'];
  const ref = p['ref'];

  if (!repository || typeof repository !== 'object') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Missing repository' });
  }

  const repo = repository as Record<string, unknown>;
  const repoName = repo['full_name'];
  const repoId = repo['id'];

  if (typeof repoName !== 'string' || typeof repoId !== 'number') {
    return err({ code: 'INVALID_PAYLOAD', message: 'Invalid repository data' });
  }

  // Push events don't have a PR number, use 0 as placeholder
  // These are stored for context but won't appear in PR-specific queries
  const createdAt = p['created_at'] ?? new Date().toISOString();

  return ok({
    githubEventId: (p as { id?: number })['id'] ?? Date.now(),
    deliveryId: null,
    repository: repoName,
    repositoryId: repoId,
    pullRequestNumber: 0, // Push events are not PR-specific
    pullRequestId: 0,
    eventType: 'push' as GitHubEventType,
    action: null,
    senderLogin: senderResult.value.login,
    senderId: senderResult.value.id,
    senderType: senderResult.value.type,
    prAuthorLogin: null,
    title: `Push to ${typeof ref === 'string' ? ref.replace('refs/heads/', '') : 'unknown'}`,
    body: null,
    state: null,
    isDraft: null,
    baseBranch: null,
    mergedAt: null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    payload,
  });
}
