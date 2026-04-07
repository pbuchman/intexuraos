import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';
import { isReviewCommandComment } from '../utils/reviewTriage.js';

/** Checks for @claude / @codex prefixes only. The @review prefix is handled
 *  separately by `isReviewCommandComment` (from reviewTriage.ts) because that
 *  function already exists for broader review-command classification. */
function startsWithCommandPrefix(body: string): boolean {
  const normalized = body.trimStart().toLowerCase();
  return normalized.startsWith('@claude') || normalized.startsWith('@codex');
}

export function isUnauthorizedHumanCommandAttempt(
  event: Pick<GitHubPREvent, 'eventType' | 'senderType' | 'body'>,
): boolean {
  if (event.eventType !== 'issue_comment') return false;
  if (event.senderType !== 'User') return false;
  if (event.body === null) return false;

  return startsWithCommandPrefix(event.body) || isReviewCommandComment(event.body);
}

export function buildUnauthorizedSenderComment(senderLogin: string): string {
  return `@ignore\n\n⚠️ Only the repository owner and authorized bots can trigger worker commands. This event from \`${senderLogin}\` has been ignored.`;
}

export function createUnauthorizedSenderCommentHandler(deps: {
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  logger: Logger;
}): (event: GitHubPREvent) => Promise<void> {
  const { gitHubPRClient, userServiceClient, logger } = deps;

  return async (event: GitHubPREvent): Promise<void> => {
    if (!isUnauthorizedHumanCommandAttempt(event)) return;

    const parsed = parseOwnerRepo(event.repository);
    if (parsed === null) return;

    const ownerUserResult = await userServiceClient.resolveGitHubUsername(parsed.owner);
    if (!ownerUserResult.ok) return;

    const ownerUser = ownerUserResult.value; // @allow-result-access -- narrowed by !ownerUserResult.ok
    if (ownerUser === null) return;

    const token = await fetchGitHubToken(userServiceClient, ownerUser.userId, logger);
    if (token === null) return;

    await gitHubPRClient.postPRComment(
      token,
      parsed.owner,
      parsed.repo,
      event.pullRequestNumber,
      buildUnauthorizedSenderComment(event.senderLogin),
    );
  };
}
