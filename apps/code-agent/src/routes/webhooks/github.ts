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
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';
import type { UpsertGitHubPRSummaryInput } from '../../domain/models/gitHubPRSummary.js';
import type { Logger } from 'pino';

const BOT_LOGIN = 'intexuraos-code-worker[bot]';
const EXTERNAL_AGENT_MENTIONS = ['@claude', '@codex'];
const CLAUDE_BOT_LOGIN = 'claude[bot]';

/**
 * Dispatch a PR comment to the task that owns this PR via sendTaskMessage.
 * Fire-and-forget — webhook returns immediately.
 * Filters: skip our own bot (infinite loop) and external agent mentions like @claude/@codex (handled by GitHub Actions workflow).
 * The worker decides what deserves a response for everything else.
 */
async function dispatchPRCommentToTask(event: GitHubPREvent, logger: Logger): Promise<void> {
  try {
    if (event.senderLogin === BOT_LOGIN) {
      logger.debug(
        { repository: event.repository, prNumber: event.pullRequestNumber },
        'Skipping own bot comment to prevent loop'
      );
      return;
    }

    if (EXTERNAL_AGENT_MENTIONS.some((mention) => event.body?.includes(mention) === true)) {
      logger.debug(
        { repository: event.repository, prNumber: event.pullRequestNumber },
        'Skipping external agent mention — handled by GitHub Actions workflow'
      );
      return;
    }

    const services = getServices();
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
      logger.info(
        { repository: event.repository, prNumber: event.pullRequestNumber },
        'No task found for PR, ignoring comment'
      );
      return;
    }
    /* v8 ignore stop @preserve */

    const payload = event.payload as Record<string, unknown> | undefined;
    const message = buildDispatchMessage(event, payload);

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
function buildDispatchMessage(event: GitHubPREvent, payload: Record<string, unknown> | undefined): string {
  const { repository, pullRequestNumber: prNumber, senderLogin, body } = event;

  if (event.eventType === 'pull_request_review') {
    const reviewId = extractId(payload, 'review');
    const reviewState = extractReviewState(payload);
    return [
      `[PR Review] New review on PR #${String(prNumber)} in ${repository}`,
      `From: @${senderLogin}`,
      `Review ID: ${reviewId}`,
      `Review state: ${reviewState}`,
      '',
      'Review body:',
      body ?? '(empty)',
      '',
      'Instructions:',
      `1. Check PR state: gh pr view ${String(prNumber)} --json state,merged`,
      `2. Fetch inline comments for this review: gh api /repos/${repository}/pulls/${String(prNumber)}/reviews/${reviewId}/comments`,
      '3. React with eyes to each inline comment: gh api /repos/${repository}/pulls/comments/{id}/reactions -f content=eyes',
      '4. Read all comments and understand the full context',
      '5. For questions: investigate codebase, reply with answer',
      '6. For fix requests: make changes, commit, reply with reasoning',
      '7. Reply to each comment: gh api /repos/${repository}/pulls/${prNumber}/comments -f body="..." -F in_reply_to={id}',
      '8. If review body exists, react with eyes and reply to the review as well',
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
    `1. React with eyes to the comment: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=eyes`,
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

      const isEditedClaudeBotComment =
        parsedEvent.eventType === 'issue_comment' &&
        parsedEvent.action === 'edited' &&
        parsedEvent.senderLogin === CLAUDE_BOT_LOGIN;

      const isActionablePRCommentEvent =
        (parsedEvent.eventType === 'issue_comment' && parsedEvent.action === 'created') ||
        (parsedEvent.eventType === 'pull_request_review' && parsedEvent.action === 'submitted') ||
        isEditedClaudeBotComment;

      if (isActionablePRCommentEvent) {
        void dispatchPRCommentToTask(savedEvent, logger);
      }

      return await reply.ok({ message: 'processed' });
    }
  );

  done();
};
