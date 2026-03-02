/**
 * GitHub webhook route handler.
 *
 * Receives GitHub webhook events for pull requests.
 * Validates signatures using HMAC-SHA256.
 * Stores events in Firestore for historical queries.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { verifyGitHubSignature } from '../../infra/github-webhook-auth.js';
import { loadConfig } from '../../config.js';
import {
  parseGitHubWebhookEvent,
  shouldProcessRepository,
} from '../../infra/github-event-parser.js';
import { sendTaskMessage } from '../../domain/usecases/sendTaskMessage.js';
import { createTaskForPR } from '../../domain/usecases/createTaskForPR.js';
import { enrichReviewWithComments, formatEnrichedReview } from '../../domain/usecases/enrichReviewWithComments.js';
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';
import type { UpsertGitHubPRSummaryInput } from '../../domain/models/gitHubPRSummary.js';
import type { Logger } from 'pino';

const ALLOWED_BOTS = new Set([
  'claude[bot]',
  'chatgpt-codex-connector[bot]',
]);

/**
 * Check if a sender is allowed to trigger dispatch.
 * Allowed: whitelisted bots OR the repository owner (extracted from payload).
 */
function isAllowedSender(event: GitHubPREvent): boolean {
  if (ALLOWED_BOTS.has(event.senderLogin)) return true;

  const payload = event.payload;
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'repository' in payload
  ) {
    const repo = (payload as Record<string, unknown>)['repository'];
    if (typeof repo === 'object' && repo !== null && 'owner' in repo) {
      const owner = (repo as Record<string, unknown>)['owner'];
      /* v8 ignore start -- ts-type: defensive narrowing of untyped webhook owner object @preserve */
      if (typeof owner === 'object' && owner !== null && 'login' in owner) {
        const login = (owner as Record<string, unknown>)['login'];
        if (typeof login === 'string') {
        /* v8 ignore stop @preserve */
          return event.senderLogin === login;
        }
      }
    }
  }

  return false;
}

/**
 * Dispatch a PR comment to the task that owns this PR via sendTaskMessage.
 * Fire-and-forget — webhook returns immediately.
 * Only whitelisted bots and the repository owner can trigger dispatch.
 */
async function dispatchPRCommentToTask(event: GitHubPREvent, logger: Logger): Promise<void> {
  try {
    if (!isAllowedSender(event)) {
      logger.debug(
        { senderLogin: event.senderLogin, repository: event.repository, prNumber: event.pullRequestNumber },
        'Sender not in allowed list, skipping dispatch'
      );
      return;
    }

    const services = getServices();

    /* v8 ignore start -- test-infra: fire-and-forget enrichment path, only reachable via pull_request_review dispatch which is not testable via route integration tests @preserve */
    let enrichedComment = event.body ?? '';
    if (event.eventType === 'pull_request_review') {
      const reviewId = extractReviewId(event.payload);
      if (reviewId !== null) {
        const enrichResult = await enrichReviewWithComments(
          { logger, gitHubPREventRepo: services.gitHubPREventRepo },
          { repository: event.repository, pullRequestNumber: event.pullRequestNumber, reviewId, reviewBody: event.body }
        );
        if (enrichResult.ok) {
          enrichedComment = formatEnrichedReview(enrichResult.value); // @allow-result-access -- narrowed by enrichResult.ok
        } else {
          logger.warn({ error: enrichResult.error, reviewId, repository: event.repository, prNumber: event.pullRequestNumber }, 'Review enrichment failed, using raw body'); // @allow-result-access -- narrowed by !enrichResult.ok
        }
      }
    }
    /* v8 ignore stop @preserve */

    const taskResult = await services.codeTaskRepo.findByPR(event.repository, event.pullRequestNumber);

    /* v8 ignore start -- upstream: Firestore error path in fire-and-forget dispatch @preserve */
    if (!taskResult.ok) {
      logger.error(
        { repository: event.repository, prNumber: event.pullRequestNumber, error: taskResult.error },
        'Failed to find task for PR comment dispatch'
      );
      return;
    }
    /* v8 ignore stop @preserve */

    const task = taskResult.value; // @allow-result-access -- narrowed by !taskResult.ok above

    /* v8 ignore start -- test-infra: fire-and-forget dispatch path, null-task branch not reachable via route integration tests @preserve */
    if (task === null) {
      // UserLookupService not configured - skip task creation
      if (!services.userLookupService) {
        logger.warn(
          { repository: event.repository, prNumber: event.pullRequestNumber },
          'UserLookupService not configured, skipping task creation'
        );
        return;
      }

      // Create new task for PR comment
      const createResult = await createTaskForPR(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          userLookupService: services.userLookupService,
          linearIssueService: services.linearIssueService,
          taskDispatcher: services.taskDispatcher,
          orchestratorSecret: loadConfig().orchestratorSecret,
          serviceUrl: loadConfig().serviceUrl,
          firestore: services.firestore,
        },
        {
          repository: event.repository,
          prNumber: event.pullRequestNumber,
          ...(event.title !== null && { prTitle: event.title }),
          senderLogin: event.senderLogin,
          comment: enrichedComment,
          eventId: event.id,
        }
      );

      if (!createResult.ok) {
        // Route comment to existing task if dedup found one
        if (createResult.error.existingTaskId !== undefined) {
          const existingTaskId = createResult.error.existingTaskId;
          const existingTaskResult = await services.codeTaskRepo.findById(existingTaskId);

          if (existingTaskResult.ok) {
            const existingTask = existingTaskResult.value; // @allow-result-access -- narrowed by existingTaskResult.ok above
            const payload = event.payload as Record<string, unknown> | undefined;
            const message = buildDispatchMessage(event, payload, enrichedComment);

            const sendResult = await sendTaskMessage(
              {
                logger: services.logger,
                codeTaskRepo: services.codeTaskRepo,
                logLineRepo: services.logLineRepo,
                taskDispatcher: services.taskDispatcher,
                workerSettingsRepo: services.workerSettingsRepo,
                statusMirrorService: services.statusMirrorService,
                whatsappNotifier: services.whatsappNotifier,
              },
              { taskId: existingTaskId, userId: existingTask.userId, message }
            );

            if (sendResult.ok) {
              const updateResult = await services.codeTaskRepo.update(existingTaskId, { prNumber: event.pullRequestNumber });
              if (updateResult.ok) {
                logger.info(
                  { taskId: existingTaskId, prNumber: event.pullRequestNumber },
                  'Routed PR comment to existing task (dedup ACTIVE_TASK_EXISTS)'
                );
              } else {
                logger.warn(
                  { taskId: existingTaskId, prNumber: event.pullRequestNumber, error: updateResult.error },
                  'Routed PR comment but failed to persist prNumber — future comments may not auto-route'
                );
              }
            } else {
              logger.error(
                { taskId: existingTaskId, error: sendResult.error, prNumber: event.pullRequestNumber },
                'Failed to route PR comment to existing task'
              );
            }
            return;
          }

          logger.error(
            { existingTaskId, errorCode: existingTaskResult.error.code, error: existingTaskResult.error },
            existingTaskResult.error.code === 'NOT_FOUND'
              ? 'Existing task not found for comment routing (possible race condition — task may have been deleted)'
              : 'Failed to fetch existing task for comment routing (Firestore error)'
          );
        }

        logger.error(
          { repository: event.repository, prNumber: event.pullRequestNumber, error: createResult.error },
          'Failed to create task from PR comment'
        );
        // TODO: INT-618 Post failure comment to GitHub PR when GitHub write client is available
        return;
      }

      logger.info(
        { taskId: createResult.value.taskId, repository: event.repository, prNumber: event.pullRequestNumber },
        'Created new task from PR comment'
      );
      return;
    }
    /* v8 ignore stop @preserve */

    const payload = event.payload as Record<string, unknown> | undefined;
    const message = buildDispatchMessage(event, payload, enrichedComment);

    const sendResult = await sendTaskMessage(
      {
        logger: services.logger,
        codeTaskRepo: services.codeTaskRepo,
        logLineRepo: services.logLineRepo,
        taskDispatcher: services.taskDispatcher,
        workerSettingsRepo: services.workerSettingsRepo,
        statusMirrorService: services.statusMirrorService,
        whatsappNotifier: services.whatsappNotifier,
      },
      { taskId: task.id, userId: task.userId, message }
    );

    /* v8 ignore start -- test-infra: fire-and-forget dispatch, sendTaskMessage error paths covered by unit tests @preserve */
    if (!sendResult.ok) {
      logger.error(
        { taskId: task.id, error: sendResult.error, prNumber: event.pullRequestNumber },
        'Failed to dispatch PR comment to task'
      );
      return;
    }
    /* v8 ignore stop @preserve */

    const { action } = sendResult.value; // @allow-result-access -- narrowed by !sendResult.ok above
    logger.info(
      { taskId: task.id, action, prNumber: event.pullRequestNumber, senderLogin: event.senderLogin },
      'PR comment dispatched to task'
    );
  } catch (error) {
    logger.error(
      { error, repository: event.repository, prNumber: event.pullRequestNumber },
      'Unexpected error dispatching PR comment to task'
    );
  }
}

/* v8 ignore start -- test-infra: fire-and-forget helpers only reachable when findByPR returns a task, not testable via route integration tests @preserve */
function extractReviewId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const review = p['review'] as Record<string, unknown> | undefined;
  if (review === undefined) return null;
  const id = review['id'];
  return typeof id === 'number' ? id : null;
}

function extractId(payload: Record<string, unknown> | undefined, key: string): string {
  if (payload === undefined) return 'unknown';
  const obj = payload[key] as Record<string, unknown> | undefined;
  if (obj === undefined) return 'unknown';
  const id = obj['id'];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : 'unknown';
}

function extractReviewState(payload: Record<string, unknown> | undefined): string {
  if (payload === undefined) return 'unknown';
  const review = payload['review'] as Record<string, unknown> | undefined;
  if (review === undefined) return 'unknown';
  const state = review['state'];
  return typeof state === 'string' ? state : 'unknown';
}
/* v8 ignore stop @preserve */

/* v8 ignore start -- test-infra: fire-and-forget message builder only reachable when findByPR returns a task @preserve */
function buildDispatchMessage(event: GitHubPREvent, payload: Record<string, unknown> | undefined, enrichedBody?: string): string {
  const { repository, pullRequestNumber: prNumber, senderLogin, body } = event;

  if (event.eventType === 'pull_request_review') {
    const reviewId = extractId(payload, 'review');
    const reviewState = extractReviewState(payload);
    const reviewContent = enrichedBody ?? event.body ?? '(empty)';
    return [
      `[PR Review] New review on PR #${String(prNumber)} in ${repository}`,
      `From: @${senderLogin}`,
      `Review ID: ${reviewId}`,
      `Review state: ${reviewState}`,
      '',
      reviewContent,
      '',
      'Instructions:',
      `1. Check PR state: gh pr view ${String(prNumber)} --json state,mergedAt`,
      `2. React with rocket to each inline comment: gh api /repos/${repository}/pulls/comments/{id}/reactions -f content=rocket`,
      '3. Read all comments above and understand the full context',
      '4. For questions: investigate codebase, reply with answer',
      '5. For fix requests: make changes, commit, reply with reasoning',
      `6. Reply to each comment: gh api /repos/${repository}/pulls/${String(prNumber)}/comments -f body="..." -F in_reply_to={id}`,
      '7. If review body exists, react with rocket and reply to the review as well',
    ].join('\n');
  }

  if (event.action === 'edited' && ALLOWED_BOTS.has(event.senderLogin)) {
    const commentId = extractId(payload, 'comment');
    return [
      `[PR Comment — Bot Review Edit] Comment updated on PR #${String(prNumber)} in ${repository}`,
      `From: @${senderLogin}`,
      `Comment ID: ${commentId}`,
      'Type: issue_comment (edited)',
      '',
      'Full comment body:',
      body ?? '(empty)',
      '',
      'Instructions:',
      '1. CHECK IF REVIEW IS STILL IN PROGRESS:',
      '   Look for indicators that the review is NOT finished:',
      '   - Body contains "is working" / "working..." / spinner image',
      '   - Body is very short (< 200 chars) with no findings',
      '   - Checklist items are unchecked ([ ] without [x])',
      '',
      '   If the review appears to still be in progress → do nothing, stop here.',
      '',
      '2. IF REVIEW IS FINALIZED — process it as a code review:',
      `   a. React with rocket: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=rocket`,
      '   b. Read the full review body and extract EVERY finding/issue/suggestion',
      '   c. For EACH finding, decide: FIX or SKIP',
      '      - FIX: Clear actionable feedback, code change with clear intent, specific bug or gap',
      '      - SKIP: Discussion/question, intentional design disagreement, out of PR scope, pure status report',
      '   d. Post a response comment with a triage table:',
      '      - One row per finding',
      '      - Columns: # | Finding | Verdict (FIX/SKIP) | Reasoning | Action',
      '      - For SKIP items: explain why in the Reasoning column',
      '      - For FIX items: write "Will fix" in the Action column',
      '',
      '   ⚠ MANDATORY — DO NOT STOP AFTER POSTING THE TABLE ⚠',
      '   e. IMMEDIATELY after posting the triage comment, implement ALL fixes',
      '      marked as FIX in the table. This is not optional. Do not end your turn',
      '      until every FIX item has been implemented, committed, and pushed.',
      '      Skipping implementation after posting the table is a contract violation.',
      '   f. After all fixes: commit, push, verify CI passes',
      `   g. Update your triage comment (gh api PATCH /repos/${repository}/issues/comments/{your-comment-id})`,
      '      to replace "Will fix" with the actual commit SHA for each implemented fix',
    ].join('\n');
  }

  const commentId = extractId(payload, 'comment');
  return [
    `[PR Comment] New comment on PR #${String(prNumber)} in ${repository}`,
    `From: @${senderLogin}`,
    `Comment ID: ${commentId}`,
    'Type: issue_comment',
    '',
    'The commenter said:',
    body ?? '(empty)',
    '',
    'Instructions:',
    `1. React with rocket to the comment: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=rocket`,
    '2. Read the comment and decide if it needs a response',
    `3. If actionable: investigate, then reply via gh api /repos/${repository}/issues/${String(prNumber)}/comments -f body="..."`,
    '4. If not actionable (e.g. coverage report, "+1", bot noise): do nothing',
  ].join('\n');
}
/* v8 ignore stop @preserve */

export interface GitHubWebhookHeaders {
  'x-hub-signature-256': string;
  'x-github-event': string;
}

export interface GitHubWebhookBody {
  action?: string;
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
  };
  pull_request?: {
    id: number;
    number: number;
    title?: string;
    body?: string | null;
    state?: string;
    merged_at?: string | null;
  };
  sender?: {
    login: string;
    id: number;
    type?: string;
  };
}

export const githubWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /webhooks/github - Receive GitHub webhook events
  fastify.post<{
    Headers: GitHubWebhookHeaders;
    Body: GitHubWebhookBody;
  }>(
    '/webhooks/github',
    {
      schema: {
        operationId: 'githubWebhook',
        summary: 'Receive GitHub webhook events',
        description: 'Receives and processes GitHub webhook events for pull requests. Requires HMAC-SHA256 signature.',
        tags: ['webhooks', 'github'],
        response: {
          200: {
            description: 'Event processed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                },
              },
            },
          },
          401: {
            description: 'Invalid signature',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Headers: GitHubWebhookHeaders; Body: GitHubWebhookBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received GitHub webhook event',
      });

      // Get GitHub webhook secret from config
      const config = loadConfig();
      const { gitHubPREventRepo, gitHubPRSummaryRepo, logger } = getServices();

      const signatureHeader = request.headers['x-hub-signature-256'];
      const eventType = request.headers['x-github-event'];

      // Get raw request body for signature verification
      // Fastify parses JSON, so we need to get the raw body
      const rawBody = Buffer.from(JSON.stringify(request.body), 'utf-8');

      // Verify signature
      if (!signatureHeader || !verifyGitHubSignature(rawBody, signatureHeader, config.githubWebhookSecret)) {
        // Log only the first 20 chars of signature for security (or undefined if missing)
        const sigPreview = signatureHeader ? signatureHeader.slice(0, 20) : undefined;
        logger.warn({ signature: sigPreview }, 'Invalid GitHub webhook signature');
        return await reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
      }

      logger.debug(
        { eventType, hasSignature: !!signatureHeader },
        'GitHub webhook signature verified'
      );

      // Handle ping event (GitHub test)
      if (eventType === 'ping') {
        logger.info('Received GitHub ping event');
        return await reply.ok({ message: 'pong' });
      }

      // Check repository scope - only process intexuraos/* repositories
      const repository = request.body.repository;
      /* v8 ignore start -- upstream: optional chaining for external GitHub webhook data @preserve */
      const repositoryFullName = repository?.full_name ?? '';
      /* v8 ignore stop @preserve */

      if (!shouldProcessRepository(repositoryFullName)) {
        logger.info(
          { repository: repositoryFullName },
          'Ignoring event from non-IntexuraOS repository'
        );
        return await reply.ok({ message: 'ignored' });
      }

      // Parse the event
      const parseResult = parseGitHubWebhookEvent(eventType, request.body);

      /* v8 ignore start -- upstream: error handling for malformed GitHub webhook payloads @preserve */
      if (!parseResult.ok) {
        logger.warn({ error: parseResult.error }, 'Failed to parse GitHub webhook event'); // @allow-result-access -- narrowed by !parseResult.ok
        // Don't fail - just acknowledge receipt
        return await reply.ok({ message: 'acknowledged' });
      }
      /* v8 ignore stop @preserve */

      const parsedEvent = parseResult.value; // @allow-result-access -- narrowed by !parseResult.ok

      /* v8 ignore start -- upstream: null check for unhandled GitHub event types @preserve */
      // Null means event type is not stored (e.g., unknown events)
      if (parsedEvent === null) {
        logger.info({ eventType }, 'Unhandled GitHub event type, acknowledging');
        return await reply.ok({ message: 'acknowledged' });
      }
      /* v8 ignore stop @preserve */

      // Save to Firestore
      const saveResult = await gitHubPREventRepo.save(parsedEvent);

      /* v8 ignore start -- upstream: error handling for Firestore save failures @preserve */
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save GitHub PR event'); // @allow-result-access -- narrowed by !saveResult.ok
        // Still return 200 to prevent GitHub from retrying on transient errors
        return await reply.ok({ message: 'acknowledged' });
      }
      /* v8 ignore stop @preserve */

      const savedEvent = saveResult.value; // @allow-result-access -- narrowed by !saveResult.ok above

      // Upsert PR summary — skip push/ping events (pullRequestNumber === 0)
      if (parsedEvent.pullRequestNumber !== 0) {
        const summaryInput: UpsertGitHubPRSummaryInput = {
          repository: parsedEvent.repository,
          pullRequestNumber: parsedEvent.pullRequestNumber,
          lastActivityAt: parsedEvent.createdAt,
          firstSeenAt: parsedEvent.createdAt,
          ...(parsedEvent.eventType === 'pull_request' && {
            title: parsedEvent.title,
            state: parsedEvent.state,
            mergedAt: parsedEvent.mergedAt ?? null,
          }),
        };
        /* v8 ignore start -- upstream: non-critical summary upsert, does not affect webhook response @preserve */
        const summaryResult = await gitHubPRSummaryRepo.upsert(summaryInput);
        if (!summaryResult.ok) {
          logger.warn({ error: summaryResult.error.message }, 'Failed to upsert PR summary'); // @allow-result-access -- narrowed by !summaryResult.ok
        }
        /* v8 ignore stop @preserve */
      }

      logger.info(
        {
          eventId: savedEvent.id,
          eventType: parsedEvent.eventType,
          repository: parsedEvent.repository,
          pullRequestNumber: parsedEvent.pullRequestNumber,
        },
        'GitHub PR event saved'
      );

      const isEditedByAllowedBot =
        parsedEvent.eventType === 'issue_comment' &&
        parsedEvent.action === 'edited' &&
        ALLOWED_BOTS.has(parsedEvent.senderLogin);

      const isActionablePRCommentEvent =
        (parsedEvent.eventType === 'issue_comment' && parsedEvent.action === 'created') ||
        (parsedEvent.eventType === 'pull_request_review' && parsedEvent.action === 'submitted') ||
        isEditedByAllowedBot;

      if (isActionablePRCommentEvent) {
        void dispatchPRCommentToTask(savedEvent, logger);
      }

      return await reply.ok({ message: 'processed' });
    }
  );

  done();
};
