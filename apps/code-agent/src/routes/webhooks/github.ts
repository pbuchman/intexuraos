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
import type { UpsertGitHubPRSummaryInput } from '../../domain/models/gitHubPRSummary.js';
import { isGitHubAgentEvent, evaluatePREvent } from '../../domain/usecases/githubAgent.js';

export const ALLOWED_BOTS = new Set([
  'claude[bot]',
  'chatgpt-codex-connector[bot]',
]);

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

      // Evaluate actionability using domain rules (enforced)
      const rules = getServices().webhookRules;
      const decision = rules.evaluate(savedEvent);

      if (decision.shouldDispatch) {
        const dispatcher = getServices().dispatchService;
        void dispatcher.dispatch({
          event: savedEvent,
          decision,
          logger
        });
      }

      // GitHub Agent: evaluate PR opened/synchronize events via tool-calling LLM
      if (isGitHubAgentEvent(savedEvent)) {
        const { toolCallingClient, gitHubPRClient, userServiceClient } = getServices();
        if (toolCallingClient === undefined) {
          logger.warn('GitHub Agent disabled — missing Gemini API key');
        } else {
          void evaluatePREvent(
            { logger, gitHubPRClient, toolCallingClient, userServiceClient },
            savedEvent
          ).catch((err: unknown) => {
            logger.error({ err }, 'Unhandled error in GitHub Agent evaluation');
          });
        }
      }

      return await reply.ok({ message: 'processed' });
    }
  );

  done();
};
