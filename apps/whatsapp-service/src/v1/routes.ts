import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { webhookVerifyQuerySchema, type WebhookPayload } from './schemas.js';
import { validateWebhookSignature, SIGNATURE_HEADER } from '../signature.js';
import { getServices } from '../services.js';
import type { Config } from '../config.js';

/**
 * Handle Zod validation errors.
 */
function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
    errors: details,
  });
}

/**
 * Extract phone number ID from webhook payload if available.
 */
function extractPhoneNumberId(payload: unknown): string | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'entry' in payload &&
    Array.isArray((payload as { entry: unknown }).entry)
  ) {
    const entry = (payload as { entry: unknown[] }).entry[0];
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'changes' in entry &&
      Array.isArray((entry as { changes: unknown }).changes)
    ) {
      const change = (entry as { changes: unknown[] }).changes[0];
      if (
        typeof change === 'object' &&
        change !== null &&
        'value' in change &&
        typeof (change as { value: unknown }).value === 'object' &&
        (change as { value: unknown }).value !== null
      ) {
        const value = (change as { value: { metadata?: { phone_number_id?: string } } }).value;
        if (value.metadata?.phone_number_id !== undefined) {
          return value.metadata.phone_number_id;
        }
      }
    }
  }
  return null;
}

/**
 * V1 routes plugin factory.
 * Creates webhook endpoints for WhatsApp Business Cloud API.
 */
export function createV1Routes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    /**
     * GET /webhooks/whatsapp - Webhook verification endpoint.
     * Meta sends this request to verify webhook URL during setup.
     */
    fastify.get(
      '/webhooks/whatsapp',
      {
        schema: {
          description: 'WhatsApp webhook verification endpoint',
          tags: ['webhooks'],
          querystring: {
            type: 'object',
            properties: {
              'hub.mode': { type: 'string' },
              'hub.verify_token': { type: 'string' },
              'hub.challenge': { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'string',
              description: 'Returns hub.challenge on successful verification',
            },
            403: {
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
      async (request: FastifyRequest, reply: FastifyReply) => {
        const parseResult = webhookVerifyQuerySchema.safeParse(request.query);

        if (!parseResult.success) {
          return await handleValidationError(parseResult.error, reply);
        }

        const { 'hub.verify_token': verifyToken, 'hub.challenge': challenge } = parseResult.data;

        if (verifyToken !== config.verifyToken) {
          return await reply.fail('FORBIDDEN', 'Invalid verify token');
        }

        // Return challenge as plain text (not JSON wrapped)
        return await reply.type('text/plain').send(challenge);
      }
    );

    /**
     * POST /webhooks/whatsapp - Webhook event receiver.
     * Receives incoming messages and status updates from Meta.
     */
    fastify.post(
      '/webhooks/whatsapp',
      {
        config: {
          // Disable default body parsing so we can access raw body for signature validation
          rawBody: true,
        },
        schema: {
          description: 'WhatsApp webhook event receiver',
          tags: ['webhooks'],
          headers: {
            type: 'object',
            properties: {
              [SIGNATURE_HEADER]: { type: 'string' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                data: {
                  type: 'object',
                  properties: {
                    received: { type: 'boolean' },
                  },
                },
              },
            },
            401: {
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
      async (request: FastifyRequest<{ Body: WebhookPayload }>, reply: FastifyReply) => {
        // Get signature from header
        const signature = request.headers[SIGNATURE_HEADER];

        if (typeof signature !== 'string' || signature === '') {
          return await reply.fail('UNAUTHORIZED', 'Missing X-Hub-Signature-256 header');
        }

        // Get raw body for signature validation
        // Fastify stores raw body when rawBody option is enabled
        const rawBody =
          (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);

        // Validate signature
        const signatureValid = validateWebhookSignature(rawBody, signature, config.appSecret);

        if (!signatureValid) {
          return await reply.fail('FORBIDDEN', 'Invalid webhook signature');
        }

        // Extract phone number ID from payload
        const phoneNumberId = extractPhoneNumberId(request.body);

        // Persist webhook event
        const { webhookEventRepository } = getServices();
        const saveResult = await webhookEventRepository.saveEvent({
          payload: request.body,
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId,
        });

        if (!saveResult.ok) {
          // Log error but still return 200 to prevent Meta retries
          request.log.error({ error: saveResult.error }, 'Failed to persist webhook event');
        }

        return await reply.ok({ received: true });
      }
    );

    done();
  };
}
