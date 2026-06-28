/**
 * Sentry webhook route handler.
 *
 * Thin HTTP adapter: verifies Sentry webhook deliveries and delegates issue
 * automation to `processSentryWebhook`.
 */

import { PassThrough } from 'node:stream';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { loadConfig } from '../../config.js';
import { processSentryWebhook } from '../../domain/usecases/processSentryWebhook.js';
import { verifySentrySignature } from '../../infra/sentry-webhook-auth.js';
import { parseSentryIssueEvent } from '../../infra/sentry-event-parser.js';

interface SentryWebhookHeaders {
  'sentry-hook-resource'?: string;
  'sentry-hook-signature'?: string;
}

const sentryWebhookResponseSchema = {
  operationId: 'sentryWebhook',
  summary: 'Receive Sentry issue webhook events',
  description: 'Receives Sentry issue and event_alert webhook events and creates a Sentry code task.',
  tags: ['webhooks', 'sentry'],
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

export function readRawBody(request: FastifyRequest): Buffer {
  const attachedRaw = (request as unknown as { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(attachedRaw)) {
    return attachedRaw;
  }
  if (typeof attachedRaw === 'string') {
    return Buffer.from(attachedRaw, 'utf-8');
  }
  return Buffer.alloc(0);
}

export function normalizeRawBodyChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), 'utf-8');
}

export const sentryWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(normalizeRawBodyChunk(chunk));
    }
    const rawBody = Buffer.concat(chunks);
    (request as unknown as { rawBody: Buffer }).rawBody = rawBody;
    const replay = new PassThrough() as PassThrough & { receivedEncodedLength?: number };
    replay.receivedEncodedLength = rawBody.length;
    replay.end(rawBody);
    return replay;
  });

  fastify.post<{ Headers: SentryWebhookHeaders; Body: unknown }>(
    '/webhooks/sentry',
    { schema: sentryWebhookResponseSchema },
    async (
      request: FastifyRequest<{ Headers: SentryWebhookHeaders; Body: unknown }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { message: 'Received Sentry webhook event' });

      const config = loadConfig();
      const { logger } = getServices();
      const result = await processSentryWebhook({
        rawBody: readRawBody(request),
        signatureHeader: request.headers['sentry-hook-signature'],
        resourceHeader: request.headers['sentry-hook-resource'],
        body: request.body,
        logger,
        webhookSecret: config.sentryWebhookSecret,
        orchestratorSecret: config.orchestratorSecret,
        automationUserId: config.sentryAutomationUserId,
        repository: config.sentryCodeTaskRepository,
        baseBranch: config.sentryCodeTaskBaseBranch,
        verifySignature: verifySentrySignature,
        parseIssueEvent: parseSentryIssueEvent,
      });

      if (!result.ok) {
        if (result.reason === 'invalid_signature') {
          return await reply.fail('UNAUTHORIZED', result.message);
        }
        if (result.reason === 'invalid_payload') {
          return await reply.fail('INVALID_REQUEST', result.message);
        }
        return await reply.fail('INTERNAL_ERROR', result.message);
      }

      return await reply.ok({ message: result.message });
    }
  );

  done();
};
