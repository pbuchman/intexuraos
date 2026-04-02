/**
 * Process webhook use case - orchestrates Linear webhook handling.
 *
 * Extracts type guards, connection lookups, signature validation, fan-out sync,
 * code task triggering, and comment processing from the HTTP route layer.
 */

import type { Result } from '@intexuraos/common-core';
// @allow-pino-import -- type-only import for Logger interface @preserve
import type { Logger } from 'pino';
import type { LinearConnectionRepository, LinearIssueRepository, LinearCommentRepository, CodeAgentClient } from '../ports.js';
import type { LinearWebhookUpdatedFrom } from '../webhookTypes.js';
import { WEBHOOK_TYPES } from '../webhookTypes.js';
import type { WebhookAction } from '../webhookTypes.js';
import { isIssueWebhookData, isCommentWebhookData } from '../webhookTypeGuards.js';
import { syncSingleIssue, shouldTriggerCodeTask, triggerCodeTaskFromAssignment } from '../index.js';
import { syncCommentFromWebhook } from './syncCommentFromWebhook.js';

export interface ProcessWebhookDeps {
  connectionRepository: LinearConnectionRepository;
  issueRepository: LinearIssueRepository;
  commentRepository: LinearCommentRepository;
  codeAgentClient: CodeAgentClient;
  /** Validate webhook signature (rawBody, secret) => Result<void, string> */
  validateSignature: (rawBody: string, secret: string) => Result<void, string>;
  logger: Logger;
}

export interface WebhookPayload {
  action: string;
  type: string;
  data: unknown;
  updatedFrom?: LinearWebhookUpdatedFrom;
  webhookTimestamp: number;
  webhookId: string;
  rawBody: string;
}

export type ProcessWebhookResult =
  | { outcome: 'ignored'; message: string }
  | { outcome: 'processed'; action: string; issueId?: string; commentId?: string }
  | { outcome: 'unauthorized'; message: string }
  | { outcome: 'error'; message: string };

/**
 * Process a Linear webhook event.
 *
 * Handles type checking, connection lookup, signature validation,
 * fan-out sync, code task triggering, and comment processing.
 */
export async function processWebhook(
  payload: WebhookPayload,
  deps: ProcessWebhookDeps
): Promise<ProcessWebhookResult> {
  const { connectionRepository, issueRepository, commentRepository, codeAgentClient, validateSignature, logger } = deps;
  const { action, type, data, updatedFrom, webhookTimestamp, webhookId, rawBody } = payload;

  // 1. For non-Issue and non-Comment events, skip processing early
  if (type !== WEBHOOK_TYPES.ISSUE && type !== WEBHOOK_TYPES.COMMENT) {
    logger.info({ type }, 'Ignoring non-Issue/non-Comment webhook event');
    return { outcome: 'ignored', message: 'Ignored' };
  }

  // 2. Process based on event type
  if (isIssueWebhookData(data)) {
    // === ISSUE EVENT ===

    // Validate team.id first (needed for connection lookup)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, team may not have correct shape at runtime
    const teamId = data.team?.id;
    if (typeof teamId !== 'string' || teamId === '') {
      logger.warn({ type, teamId }, 'Missing or invalid team.id in issue webhook data');
      return { outcome: 'ignored', message: 'Invalid data structure' };
    }

    // Look up ALL user connections AND webhook secret by team ID concurrently
    // (any user's secret works — they share the same Linear webhook)
    const [connectionResult, secretResult] = await Promise.all([
      connectionRepository.findUserIdsByTeamId(teamId),
      connectionRepository.findWebhookSecretByTeamId(teamId),
    ]);

    if (!connectionResult.ok) {
      logger.error({ error: connectionResult.error, teamId }, 'Failed to lookup connections');
      return { outcome: 'error', message: 'Failed to lookup connection' };
    }

    const userIds = connectionResult.value;
    if (userIds.length === 0) {
      logger.warn({ teamId }, 'No connected users found for team');
      return { outcome: 'ignored', message: 'Team not connected' };
    }

    if (!secretResult.ok) {
      logger.error({ error: secretResult.error, teamId }, 'Failed to lookup webhook secret');
      return { outcome: 'error', message: 'Failed to lookup connection' };
    }

    if (secretResult.value === null) {
      logger.warn({ teamId }, 'Webhook secret not configured for team');
      return { outcome: 'ignored', message: 'Webhook not configured' };
    }

    const { webhookSecret } = secretResult.value;

    const signatureResult = validateSignature(rawBody, webhookSecret);
    if (!signatureResult.ok) {
      logger.warn({ error: signatureResult.error }, 'Linear webhook signature validation failed');
      return { outcome: 'unauthorized', message: 'Invalid webhook signature' };
    }

    // Validate required fields after signature validation
    if (typeof data.id !== 'string' || typeof data.identifier !== 'string' || typeof data.title !== 'string') {
      logger.warn(
        { type, hasId: typeof data.id, hasIdentifier: typeof data.identifier, hasTitle: typeof data.title },
        'Missing required fields in issue webhook data'
      );
      return { outcome: 'ignored', message: 'Invalid data structure' };
    }

    // Build event once (shared across all users)
    // Use safe defaults for optional fields that might be missing
    const now = new Date().toISOString();
    const event = {
      action: action as WebhookAction,
      type,
      data: {
        id: data.id,
        identifier: data.identifier,
        title: data.title,
        description: data.description ?? null,
        priority: typeof data.priority === 'number' ? data.priority : 0,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        url: data.url ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        createdAt: data.createdAt ?? now,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        updatedAt: data.updatedAt ?? now,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        state: data.state ?? { id: '', name: '', type: 'backlog' },
        assignee: data.assignee ?? null,
        labels: Array.isArray(data.labels) ? data.labels : [],
        team: data.team,
        ...(data.parent !== undefined && { parent: data.parent }),
      },
      ...(updatedFrom !== undefined && { updatedFrom }),
      webhookTimestamp,
      webhookId,
    };

    // Fan out sync to ALL connected users concurrently
    const syncResults = await Promise.allSettled(
      userIds.map((uid) =>
        syncSingleIssue(event, uid, {
          issueRepo: issueRepository,
          logger,
        })
      )
    );

    // Log per-user results, find first success for response
    let firstSuccessAction: string | null = null;
    let firstSuccessIssueId: string | null = null;
    for (let i = 0; i < syncResults.length; i++) {
      const result = syncResults[i];
      const uid = userIds[i];
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces undefined check on syncResults[i] and userIds[i] despite length-guarded loop @preserve */
      if (result === undefined || uid === undefined) continue;
      /* v8 ignore stop @preserve */

      if (result.status === 'fulfilled' && result.value.ok) {
        logger.info(
          { action: result.value.value.action, issueId: data.id, identifier: data.identifier, userId: uid }, // @allow-result-access -- guarded by result.value.ok
          'Issue synced from webhook'
        );
        if (firstSuccessAction === null) {
          firstSuccessAction = result.value.value.action; // @allow-result-access -- guarded by result.value.ok
          firstSuccessIssueId = result.value.value.issueId; // @allow-result-access -- guarded by result.value.ok
        }

        void deps.codeAgentClient.notifyGroupSummaryRecompute({
          userId: uid,
          linearIssueId: event.data.identifier,
          labels: event.data.labels.map((l) => ({ id: l.id, name: l.name })),
        }).catch((e: unknown) => {
          deps.logger.warn({ error: e, linearIssueId: event.data.identifier }, 'Failed to notify code-agent of label change');
        });
      } else {
        /* v8 ignore start -- upstream: FakeLinearIssueRepository's syncSingleIssue always returns a resolved Result, so Promise.allSettled never produces a 'rejected' entry; the inner ok===true ternary branch is also unreachable because the else branch only executes when result.value.ok is false @preserve */
        const error = result.status === 'rejected' ? String(result.reason) : (result.value.ok ? '' : result.value.error);
        /* v8 ignore stop @preserve */
        logger.error({ error, issueId: data.id, userId: uid }, 'Failed to sync issue from webhook for user');
      }
    }

    if (firstSuccessAction === null) {
      return { outcome: 'error', message: 'Failed to sync issue for all users' };
    }

    // Trigger code task only for the first user (avoid duplicate tasks)
    if (shouldTriggerCodeTask(event)) {
      const firstUserId = userIds[0];
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces undefined check on userIds[0] despite length check above @preserve */
      if (firstUserId !== undefined) {
      /* v8 ignore stop @preserve */
        void triggerCodeTaskFromAssignment(event, firstUserId, {
          codeAgentClient,
          logger,
        });
      }
    }

    // Build result with optional issueId
    const result: ProcessWebhookResult = {
      outcome: 'processed',
      action: firstSuccessAction,
    };
    /* v8 ignore start -- ts-type: firstSuccessIssueId can be null when sync succeeds but returns no issueId; unreachable in practice due to syncSingleIssue always returning issueId on success @preserve */
    if (firstSuccessIssueId !== null) {
      result.issueId = firstSuccessIssueId;
    }
    /* v8 ignore stop @preserve */
    return result;
  } else if (isCommentWebhookData(data)) {
    // === COMMENT EVENT ===

    // Validate required fields
    if (typeof data.issueId !== 'string' || data.issueId === '') {
      logger.warn({ type, issueId: data.issueId }, 'Missing or invalid issueId in comment webhook data');
      return { outcome: 'ignored', message: 'Invalid data structure' };
    }

    // Look up issue to get teamId for signature validation
    const issueResult = await issueRepository.findById(data.issueId);
    if (!issueResult.ok) {
      logger.error({ error: issueResult.error, issueId: data.issueId }, 'Failed to lookup issue for comment');
      return { outcome: 'error', message: 'Failed to lookup issue' };
    }

    const issue = issueResult.value;
    if (!issue) {
      logger.warn({ issueId: data.issueId }, 'Issue not found for comment');
      return { outcome: 'ignored', message: 'Issue not found' };
    }

    // Validate webhook signature using teamId from the issue
    /* v8 ignore start -- ts-type: cannot trigger empty teamId in tests; legacy issues synced before teamId field added always have teamId in test fixtures @preserve */
    if (issue.teamId === '') {
      // Issues synced before teamId was added have empty string — cannot validate signature
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, id may be missing at runtime
      logger.warn({ issueId: data.issueId, commentId: data.id ?? 'unknown' }, 'Comment webhook skipped: issue has no teamId for signature validation');
      return { outcome: 'ignored', message: 'Webhook not configured' };
    }
    /* v8 ignore stop @preserve */

    const secretResult = await connectionRepository.findWebhookSecretByTeamId(issue.teamId);
    if (!secretResult.ok) {
      logger.error({ error: secretResult.error, teamId: issue.teamId }, 'Failed to lookup webhook secret for comment');
      return { outcome: 'error', message: 'Failed to lookup connection' };
    }

    if (secretResult.value === null) {
      logger.warn({ teamId: issue.teamId }, 'Webhook secret not configured for comment');
      return { outcome: 'ignored', message: 'Webhook not configured' };
    }

    const { webhookSecret } = secretResult.value;
    const signatureResult = validateSignature(rawBody, webhookSecret);
    if (!signatureResult.ok) {
      logger.warn({ error: signatureResult.error }, 'Comment webhook signature validation failed');
      return { outcome: 'unauthorized', message: 'Invalid webhook signature' };
    }

    // Find all users who have this issue synced
    const userIdsResult = await issueRepository.findUserIdsByIssueId(data.issueId);
    const userIds = userIdsResult.ok ? userIdsResult.value : [];
    const commentUserId = userIds[0] ?? issue.userId;

    if (!userIdsResult.ok) {
      logger.warn({ error: userIdsResult.error, issueId: data.issueId }, 'Failed to find users by issue ID, falling back to issue.userId');
    }

    // Process Comment webhook
    // Comments are stored by Linear UUID (not user-scoped), so syncing once is sufficient
    const commentNow = new Date().toISOString();
    const commentEvent = {
      action: action as WebhookAction,
      type,
      data: {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        id: data.id ?? '',
        issueId: data.issueId,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        issueIdentifier: data.issueIdentifier ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        user: data.user ?? { id: '', name: '' },
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        body: data.body ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        createdAt: data.createdAt ?? commentNow,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, fields may be missing at runtime
        updatedAt: data.updatedAt ?? commentNow,
      },
      webhookTimestamp,
      webhookId,
    };

    const syncResult = await syncCommentFromWebhook(commentEvent, commentUserId, {
      commentRepo: commentRepository,
      logger,
    });

    if (!syncResult.ok) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, id may be missing at runtime
      logger.error({ error: syncResult.error, commentId: data.id ?? 'unknown', userId: commentUserId }, 'Failed to sync comment from webhook');
      return { outcome: 'error', message: 'Failed to sync comment' };
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Type guard is lenient, id may be missing at runtime
    logger.info({ action: syncResult.value.action, commentId: data.id ?? 'unknown', issueId: data.issueId, userId: commentUserId }, 'Comment synced from webhook');

    return {
      outcome: 'processed',
      action: syncResult.value.action,
      commentId: syncResult.value.commentId,
    };
  }

  logger.warn({ type }, 'Unknown webhook data structure');
  return { outcome: 'ignored', message: 'Unknown data structure' };
}
