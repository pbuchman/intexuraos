/**
 * WhatsApp Webhook Routes
 *
 * GET  /v1/webhooks/whatsapp - Webhook verification endpoint
 * POST /v1/webhooks/whatsapp - Webhook event receiver
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { type WebhookPayload, webhookVerifyQuerySchema } from './schemas.js';
import { SIGNATURE_HEADER, validateWebhookSignature } from '../../signature.js';
import { getServices } from '../../services.js';
import type { Config } from '../../config.js';
import type { InboxError, InboxNote, InboxNotesRepository } from '../../domain/inbox/index.js';
import { ProcessWhatsAppWebhookUseCase } from '../../domain/inbox/index.js';
import { createInboxNote } from '../../infra/notion/index.js';
import type { Result } from '@intexuraos/common';
import { sendWhatsAppMessage } from '../../whatsappClient.js';
import {
  extractMessageId,
  extractPhoneNumberId,
  extractSenderPhoneNumber,
  handleValidationError,
} from './shared.js';

/**
 * Creates webhook routes plugin with config.
 */
export function createWebhookRoutes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    // GET /v1/webhooks/whatsapp - Webhook verification endpoint
    fastify.get(
      '/v1/webhooks/whatsapp',
      {
        schema: {
          operationId: 'verifyWhatsAppWebhook',
          summary: 'Verify WhatsApp webhook',
          description:
            'WhatsApp webhook verification endpoint - returns hub.challenge as plain text',
          tags: ['webhooks'],
          querystring: {
            type: 'object',
            properties: {
              'hub.mode': { type: 'string', description: 'Must be "subscribe"' },
              'hub.verify_token': { type: 'string', description: 'Verify token to validate' },
              'hub.challenge': { type: 'string', description: 'Challenge to echo back' },
            },
          },
          response: {
            200: {
              description: 'Returns hub.challenge on successful verification',
              content: {
                'text/plain': {
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
            400: {
              description: 'Invalid request - missing required parameters',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: { $ref: 'ErrorBody#' },
                diagnostics: { $ref: 'Diagnostics#' },
              },
              required: ['success', 'error'],
            },
            403: {
              description: 'Invalid verify token',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: { $ref: 'ErrorBody#' },
                diagnostics: { $ref: 'Diagnostics#' },
              },
              required: ['success', 'error'],
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

    // POST /v1/webhooks/whatsapp - Webhook event receiver
    fastify.post(
      '/v1/webhooks/whatsapp',
      {
        schema: {
          operationId: 'receiveWhatsAppWebhook',
          summary: 'Receive WhatsApp webhook events',
          description: 'WhatsApp webhook event receiver - receives messages and status updates',
          tags: ['webhooks'],
          headers: {
            type: 'object',
            properties: {
              [SIGNATURE_HEADER]: {
                type: 'string',
                description: 'HMAC-SHA256 signature for payload validation',
              },
            },
          },
          response: {
            200: {
              description: 'Webhook received successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { $ref: 'WebhookReceivedResponse#' },
                diagnostics: { $ref: 'Diagnostics#' },
              },
              required: ['success', 'data'],
            },
            401: {
              description: 'Missing signature header',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: { $ref: 'ErrorBody#' },
                diagnostics: { $ref: 'Diagnostics#' },
              },
              required: ['success', 'error'],
            },
            403: {
              description: 'Invalid signature',
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: { $ref: 'ErrorBody#' },
                diagnostics: { $ref: 'Diagnostics#' },
              },
              required: ['success', 'error'],
            },
          },
        },
      },
      async (request: FastifyRequest<{ Body: WebhookPayload }>, reply: FastifyReply) => {
        // Get raw body for signature validation
        const rawBody =
          (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);

        try {
          const headersObj = { ...(request.headers as Record<string, unknown>) };
          if (typeof headersObj[SIGNATURE_HEADER] === 'string') {
            const sig = headersObj[SIGNATURE_HEADER];
            // Keep start and end visible, mask middle
            const visible = 8;
            if (sig.length > visible * 2) {
              headersObj[SIGNATURE_HEADER] = `${sig.substring(0, visible)}...${sig.substring(
                sig.length - visible
              )}`;
            } else {
              headersObj[SIGNATURE_HEADER] = `${sig.substring(0, Math.min(4, sig.length))}...`;
            }
          }

          request.log.info(
            { event: 'incoming_whatsapp_webhook', headers: headersObj, rawBody },
            'Received WhatsApp webhook POST'
          );
        } catch (logErr) {
          // Best-effort logging - should not interrupt processing
          request.log.debug({ error: logErr }, 'Failed to log incoming webhook');
        }

        // Get signature from header
        const signature = request.headers[SIGNATURE_HEADER];
        if (typeof signature !== 'string' || signature === '') {
          return await reply.fail('UNAUTHORIZED', 'Missing X-Hub-Signature-256 header');
        }
        // Log incoming request (mask signature for safety)

        // Validate signature
        const signatureValid = validateWebhookSignature(rawBody, signature, config.appSecret);

        if (!signatureValid) {
          return await reply.fail('FORBIDDEN', 'Invalid webhook signature');
        }

        // Extract phone number ID from payload
        const phoneNumberId = extractPhoneNumberId(request.body);

        // Persist webhook event with initial PENDING status
        const { webhookEventRepository } = getServices();
        const saveResult = await webhookEventRepository.saveEvent({
          payload: request.body,
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId,
          status: 'PENDING',
        });

        if (!saveResult.ok) {
          request.log.error({ error: saveResult.error }, 'Failed to persist webhook event');
          return await reply.ok({ received: true });
        }

        const savedEvent = saveResult.value;

        // Process webhook asynchronously (don't block the response)
        void processWebhookAsync(request, savedEvent, config);

        return await reply.ok({ received: true });
      }
    );

    done();
  };
}

/**
 * Process webhook asynchronously after returning 200 to Meta.
 */
async function processWebhookAsync(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config
): Promise<void> {
  try {
    const { webhookEventRepository, userMappingRepository, notionConnectionRepository } =
      getServices();

    // Find user by phone number to get their Notion config
    const fromNumber = extractSenderPhoneNumber(request.body);
    if (fromNumber === null) {
      request.log.debug({ eventId: savedEvent.id }, 'No sender phone number found');
    }

    // Get user mapping and Notion config
    let notionToken: string | undefined;
    let inboxNotesDbId: string | undefined;

    if (fromNumber !== null) {
      const userIdResult = await userMappingRepository.findUserByPhoneNumber(fromNumber);
      if (userIdResult.ok && userIdResult.value !== null) {
        const userId = userIdResult.value;

        const mappingResult = await userMappingRepository.getMapping(userId);
        if (mappingResult.ok && mappingResult.value !== null) {
          inboxNotesDbId = mappingResult.value.inboxNotesDbId;
        }

        const tokenResult = await notionConnectionRepository.getToken(userId);
        if (tokenResult.ok && tokenResult.value !== null) {
          notionToken = tokenResult.value;
        }
      }
    }

    // Create Notion repository adapter if we have the config
    let inboxNotesRepo: InboxNotesRepository | null = null;
    if (notionToken !== undefined && inboxNotesDbId !== undefined) {
      const token = notionToken;
      const dbId = inboxNotesDbId;
      inboxNotesRepo = {
        createNote: async (note: InboxNote): Promise<Result<InboxNote, InboxError>> => {
          const result = await createInboxNote(token, dbId, note);
          if (!result.ok) {
            return { ok: false, error: { code: 'INTERNAL_ERROR', message: result.error.message } };
          }
          return result;
        },
        getNote: (): Promise<Result<InboxNote | null, InboxError>> => {
          return Promise.reject(new Error('Not implemented'));
        },
        updateNote: (): Promise<Result<InboxNote, InboxError>> => {
          return Promise.reject(new Error('Not implemented'));
        },
      };
    }

    // Create and execute the use case
    const useCase = new ProcessWhatsAppWebhookUseCase(
      { allowedPhoneNumberIds: config.allowedPhoneNumberIds },
      webhookEventRepository,
      userMappingRepository,
      inboxNotesRepo as never
    );

    const result = await useCase.execute(
      savedEvent.id,
      request.body as unknown as Parameters<typeof useCase.execute>[1]
    );

    if (!result.ok) {
      request.log.error(
        { error: result.error, eventId: savedEvent.id },
        'Webhook processing failed'
      );
    } else {
      request.log.info(
        { status: result.value.status, eventId: savedEvent.id },
        'Webhook processed'
      );

      // Send confirmation message if successfully processed
      if (result.value.status === 'PROCESSED' && fromNumber !== null) {
        await sendConfirmationMessage(request, savedEvent, fromNumber, config);
      }
    }
  } catch (error) {
    request.log.error(
      { error, eventId: savedEvent.id },
      'Unexpected error during webhook processing'
    );
  }
}

/**
 * Send confirmation message back to the sender.
 */
async function sendConfirmationMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  fromNumber: string,
  config: Config
): Promise<void> {
  const originalMessageId = extractMessageId(request.body);
  const phoneNumberId = extractPhoneNumberId(request.body);

  if (phoneNumberId !== null) {
    const sendResult = await sendWhatsAppMessage(
      phoneNumberId,
      fromNumber,
      'Message added to the processing queue',
      config.accessToken,
      originalMessageId ?? undefined
    );

    if (sendResult.success) {
      request.log.info(
        { eventId: savedEvent.id, messageId: sendResult.messageId, recipient: fromNumber },
        'Sent confirmation message'
      );
    } else {
      request.log.error(
        { eventId: savedEvent.id, error: sendResult.error, recipient: fromNumber },
        'Failed to send confirmation message'
      );
    }
  }
}
