/**
 * Linear webhook routes.
 *
 * Handles incoming webhooks from Linear for issue synchronization.
 * Thin HTTP adapter - delegates all domain logic to processWebhook use case.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { FastifySchema } from 'fastify';
import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { validateLinearWebhookSignature } from '../infra/linearWebhookValidation.js';
import { processWebhook, type WebhookPayload } from '../domain/index.js';
import type { LinearWebhookUpdatedFrom } from '../domain/webhookTypes.js';

// Augment Fastify types to include rawBody for webhook signature validation
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }

  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}

interface LinearWebhookBody {
  action: string;
  type: string;
  data: unknown;
  updatedFrom?: LinearWebhookUpdatedFrom;
  webhookTimestamp: number;
  webhookId: string;
}

/**
 * Adapter function to validate webhook signature using the request's signature header.
 */
function createSignatureValidator(
  request: FastifyRequest
): (rawBody: string, secret: string) => Result<void, string> {
  return (rawBody: string, secret: string): Result<void, string> => {
    // Create a minimal request-like object with the rawBody for validation
    // Must explicitly include headers since spreading may not preserve getters
    const validationRequest = {
      headers: request.headers,
      rawBody,
    } as FastifyRequest;
    const result = validateLinearWebhookSignature(validationRequest, secret);
    if (!result.ok) {
      // Map LinearWebhookError to string message
      return { ok: false, error: result.error.message };
    }
    return { ok: true, value: undefined };
  };
}

/**
 * Adapter to convert Fastify request/response to domain use case.
 */
async function handleLinearWebhook(
  request: FastifyRequest<{ Body: LinearWebhookBody }>,
  reply: FastifyReply
): Promise<unknown> {
  try {
    logIncomingRequest(request);

    const services = getServices();

    // Extract data from webhook payload
    const { data, action, type, updatedFrom, webhookTimestamp, webhookId } = request.body;
    const rawBody = request.rawBody;

    /* v8 ignore start -- upstream: Fastify with rawBody config always provides rawBody; defensive check for misconfiguration @preserve */
    if (rawBody === undefined) {
      request.log.error('Missing raw body for webhook signature validation');
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Missing raw body');
    }
    /* v8 ignore stop @preserve */

    // Build payload for use case
    const payload: WebhookPayload = {
      action,
      type,
      data,
      ...(updatedFrom !== undefined && { updatedFrom }),
      webhookTimestamp,
      webhookId,
      rawBody,
    };

    // Call domain use case
    const result = await processWebhook(payload, {
      connectionRepository: services.connectionRepository,
      issueRepository: services.issueRepository,
      commentRepository: services.commentRepository,
      codeAgentClient: services.codeAgentClient,
      validateSignature: createSignatureValidator(request),
      logger: request.log as unknown as Logger,
    });

    // Map result to HTTP response
    switch (result.outcome) {
      case 'ignored':
        return await reply.ok({ message: result.message, action: 'ignored' });

      case 'processed': {
        const response: { message: string; action: string; issueId?: string; commentId?: string } = {
          message: 'Webhook processed',
          action: result.action,
        };
        if (result.issueId !== undefined) {
          response.issueId = result.issueId;
        }
        if (result.commentId !== undefined) {
          response.commentId = result.commentId;
        }
        return await reply.ok(response);
      }

      case 'unauthorized':
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', result.message);

      case 'error':
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.message);
    }
  } catch (error) {
    request.log.error({ error }, 'Unhandled error in webhook handler');
    reply.status(500);
    return await reply.fail('INTERNAL_ERROR', String(error));
  }
}

const webhookSchema: FastifySchema = {
  description: 'Linear webhook endpoint for issue and comment synchronization',
  tags: ['webhooks'],
  headers: {
    type: 'object',
    properties: {
      'linear-signature': {
        type: 'string',
        description: 'Linear webhook signature for verification (HMAC-SHA256)',
      },
      'linear-delivery': {
        type: 'string',
        description: 'Unique delivery identifier for idempotency',
      },
    },
  },
  body: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      type: { type: 'string' },
      data: { type: 'object', description: 'Issue or Comment data (discriminated at runtime)' },
      webhookTimestamp: { type: 'number' },
      webhookId: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            action: { type: 'string', enum: ['created', 'updated', 'deleted', 'skipped'] },
            issueId: { type: 'string' },
            commentId: { type: 'string' },
          },
        },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
    401: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
    500: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
  },
};

export const linearWebhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: LinearWebhookBody }>(
    '/linear/webhook',
    {
      schema: webhookSchema,
      // Configure raw body parser for signature validation
      config: {
        rawBody: true,
      },
    },
    handleLinearWebhook
  );

  done();
};
