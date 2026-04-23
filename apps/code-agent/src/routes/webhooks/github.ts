/**
 * GitHub webhook route handler.
 *
 * Thin HTTP adapter: parses the incoming Fastify request, delegates all
 * business logic to the `processGitHubWebhook` use case, and maps the
 * discriminated result back to an HTTP response. All processing logic,
 * signature verification, audit persistence, idempotency, triage publishing
 * and close/push side effects live in the use case.
 *
 * Re-exports `ALLOWED_BOTS`, `CODE_WORKER_BOTS`, `resolvePrCloseSourceTimestamp`,
 * `GitHubWebhookBody`, and `GitHubWebhookHeaders` from their new canonical
 * homes in `domain/` so existing callers keep working.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { loadConfig } from '../../config.js';
import { processGitHubWebhook } from '../../domain/usecases/processGitHubWebhook.js';
import type { GitHubWebhookBody, GitHubWebhookHeaders } from '../../domain/models/gitHubWebhookHttp.js';

export { ALLOWED_BOTS, CODE_WORKER_BOTS } from '../../domain/constants/gitHubBots.js';
export { resolvePrCloseSourceTimestamp } from '../../domain/utils/prCloseTimestamp.js';
export type { GitHubWebhookBody, GitHubWebhookHeaders } from '../../domain/models/gitHubWebhookHttp.js';

const webhookResponseSchema = {
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
        data: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
    401: {
      description: 'Invalid signature',
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: {
          type: 'object',
          properties: { code: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const githubWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Headers: GitHubWebhookHeaders; Body: GitHubWebhookBody }>(
    '/webhooks/github',
    { schema: webhookResponseSchema },
    async (
      request: FastifyRequest<{ Headers: GitHubWebhookHeaders; Body: GitHubWebhookBody }>,
      reply: FastifyReply,
    ) => {
      logIncomingRequest(request, { message: 'Received GitHub webhook event' });

      const config = loadConfig();
      const { logger } = getServices();
      const deliveryHeader = request.headers['x-github-delivery'];

      const result = await processGitHubWebhook({
        rawBody: Buffer.from(JSON.stringify(request.body), 'utf-8'),
        signatureHeader: request.headers['x-hub-signature-256'],
        eventType: request.headers['x-github-event'],
        deliveryId: typeof deliveryHeader === 'string' ? deliveryHeader : undefined,
        body: request.body,
        logger,
        webhookSecret: config.githubWebhookSecret,
      });

      if (!result.ok) {
        if (result.reason === 'invalid_signature') {
          return await reply.fail('UNAUTHORIZED', result.message);
        }
        return await reply.fail('INTERNAL_ERROR', result.message);
      }
      return await reply.ok({ message: result.message });
    },
  );

  done();
};
