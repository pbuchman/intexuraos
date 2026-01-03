/**
 * WhatsApp Webhook Routes
 *
 * GET  /whatsapp/webhooks - Webhook verification endpoint
 * POST /whatsapp/webhooks - Webhook event receiver
 *
 * This file handles HTTP transport concerns (validation, signature, response).
 * Business logic is delegated to domain usecases.
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { handleValidationError, logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import { type WebhookPayload, webhookVerifyQuerySchema } from './schemas.js';
import { SIGNATURE_HEADER, validateWebhookSignature } from '../signature.js';
import { getServices } from '../services.js';
import type { Config } from '../config.js';
import {
  ProcessAudioMessageUseCase,
  ProcessImageMessageUseCase,
} from '../domain/whatsapp/index.js';
import {
  extractAudioMedia,
  extractDisplayPhoneNumber,
  extractImageMedia,
  extractMessageId,
  extractMessageText,
  extractMessageTimestamp,
  extractMessageType,
  extractPhoneNumberId,
  extractSenderName,
  extractSenderPhoneNumber,
  extractWabaId,
} from './shared.js';

/**
 * Creates webhook routes plugin with config.
 */
export function createWebhookRoutes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    // GET /whatsapp/webhooks - Webhook verification endpoint
    fastify.get(
      '/whatsapp/webhooks',
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

    // POST /whatsapp/webhooks - Webhook event receiver
    fastify.post(
      '/whatsapp/webhooks',
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
        // Log incoming request (before validation for debugging)
        logIncomingRequest(request, {
          message: 'Received WhatsApp webhook POST',
          bodyPreviewLength: 500,
        });

        // Get raw body for signature validation
        const rawBody =
          (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);

        // Get signature from header
        const signature = request.headers[SIGNATURE_HEADER];
        if (typeof signature !== 'string' || signature === '') {
          request.log.warn(
            { reason: 'missing_signature' },
            'Webhook rejected: missing X-Hub-Signature-256 header'
          );
          return await reply.fail('UNAUTHORIZED', 'Missing X-Hub-Signature-256 header');
        }

        // Validate signature
        const signatureValid = validateWebhookSignature(rawBody, signature, config.appSecret);

        if (!signatureValid) {
          request.log.warn(
            { reason: 'invalid_signature', signatureReceived: signature },
            'Webhook rejected: invalid signature'
          );
          return await reply.fail('FORBIDDEN', 'Invalid webhook signature');
        }

        // Extract identifiers from payload
        const wabaId = extractWabaId(request.body);
        const phoneNumberId = extractPhoneNumberId(request.body);
        const displayPhoneNumber = extractDisplayPhoneNumber(request.body);

        // Validate WABA ID
        if (wabaId === null || !config.allowedWabaIds.includes(wabaId)) {
          request.log.warn(
            {
              reason: 'waba_id_mismatch',
              receivedWabaId: wabaId,
              receivedPhoneNumberId: phoneNumberId,
              receivedDisplayPhoneNumber: displayPhoneNumber,
              allowedWabaIds: config.allowedWabaIds,
            },
            'Webhook rejected: waba_id not in allowed list'
          );
          return await reply.fail(
            'FORBIDDEN',
            `Webhook rejected: waba_id "${wabaId ?? 'null'}" not allowed`
          );
        }

        // Validate phone number ID
        if (phoneNumberId === null || !config.allowedPhoneNumberIds.includes(phoneNumberId)) {
          request.log.warn(
            {
              reason: 'phone_number_id_mismatch',
              receivedWabaId: wabaId,
              receivedPhoneNumberId: phoneNumberId,
              receivedDisplayPhoneNumber: displayPhoneNumber,
              allowedPhoneNumberIds: config.allowedPhoneNumberIds,
            },
            'Webhook rejected: phone_number_id not in allowed list'
          );
          return await reply.fail(
            'FORBIDDEN',
            `Webhook rejected: phone_number_id "${phoneNumberId ?? 'null'}" not allowed`
          );
        }

        // Persist webhook event with initial PENDING status
        const { webhookEventRepository, eventPublisher } = getServices();
        const receivedAt = new Date().toISOString();
        const saveResult = await webhookEventRepository.saveEvent({
          payload: request.body,
          signatureValid: true,
          receivedAt,
          phoneNumberId,
          status: 'pending',
        });

        if (!saveResult.ok) {
          request.log.error({ error: saveResult.error }, 'Failed to persist webhook event');
          return await reply.ok({ received: true });
        }

        const savedEvent = saveResult.value;

        // Publish to Pub/Sub for async processing
        await eventPublisher.publishWebhookProcess({
          type: 'whatsapp.webhook.process',
          eventId: savedEvent.id,
          payload: JSON.stringify(request.body),
          phoneNumberId,
          receivedAt,
        });

        return await reply.ok({ received: true });
      }
    );

    done();
  };
}

/**
 * Process webhook event synchronously.
 * Validates user mapping and routes to appropriate usecase.
 *
 * Exported for use by Pub/Sub endpoint /internal/whatsapp/pubsub/process-webhook.
 * TODO: Refactor to accept payload directly (not FastifyRequest) for cleaner Pub/Sub integration.
 */
export async function processWebhookEvent(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config
): Promise<void> {
  const services = getServices();
  const { webhookEventRepository, userMappingRepository } = services;

  request.log.info({ eventId: savedEvent.id }, 'Starting asynchronous webhook processing');

  try {
    // Find user by phone number
    const fromNumber = extractSenderPhoneNumber(request.body);
    if (fromNumber === null) {
      request.log.info(
        { eventId: savedEvent.id, reason: 'no_sender' },
        'No sender phone number found in payload'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'NO_SENDER',
          message: 'No sender phone number in webhook payload',
        },
      });
      return;
    }

    // Extract message details
    const messageText = extractMessageText(request.body);
    const messageType = extractMessageType(request.body);
    const imageMedia = extractImageMedia(request.body);
    const audioMedia = extractAudioMedia(request.body);

    request.log.info(
      {
        eventId: savedEvent.id,
        fromNumber,
        messageType,
        hasText: messageText !== null,
        hasImage: imageMedia !== null,
        hasAudio: audioMedia !== null,
      },
      'Extracted message details from webhook payload'
    );

    // Validate message type
    const supportedTypes = ['text', 'image', 'audio'];
    if (messageType === null || !supportedTypes.includes(messageType)) {
      request.log.info(
        { eventId: savedEvent.id, messageType },
        'Ignoring unsupported message type'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'UNSUPPORTED_MESSAGE_TYPE',
          message: `Only text, image, and audio messages are supported. Received: ${messageType ?? 'unknown'}`,
          details: { messageType },
        },
      });
      return;
    }

    // Validate message content
    if (messageType === 'text' && messageText === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring text message without body');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'EMPTY_TEXT_MESSAGE',
          message: 'Text message has no body',
        },
      });
      return;
    }

    if (messageType === 'image' && imageMedia === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring image message without media info');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'NO_IMAGE_MEDIA',
          message: 'Image message has no media info',
        },
      });
      return;
    }

    if (messageType === 'audio' && audioMedia === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring audio message without media info');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'NO_AUDIO_MEDIA',
          message: 'Audio message has no media info',
        },
      });
      return;
    }

    // Look up user by phone number
    request.log.info({ eventId: savedEvent.id, fromNumber }, 'Looking up user by phone number');

    const userIdResult = await userMappingRepository.findUserByPhoneNumber(fromNumber);
    if (!userIdResult.ok) {
      request.log.error(
        { eventId: savedEvent.id, fromNumber, error: userIdResult.error },
        'Failed to look up user by phone number'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails: userIdResult.error.message,
      });
      return;
    }

    if (userIdResult.value === null) {
      request.log.info(
        { eventId: savedEvent.id, fromNumber },
        'No user mapping found for phone number'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'user_unmapped', {
        ignoredReason: {
          code: 'user_unmapped',
          message: `No user mapping found for phone number: ${fromNumber}`,
          details: { phoneNumber: fromNumber },
        },
      });
      return;
    }

    const userId = userIdResult.value;

    request.log.info(
      { eventId: savedEvent.id, fromNumber, userId },
      'User mapping found for phone number'
    );

    // Check if user mapping is connected
    const mappingResult = await userMappingRepository.getMapping(userId);
    if (!mappingResult.ok || mappingResult.value?.connected !== true) {
      request.log.info(
        { eventId: savedEvent.id, userId },
        'User mapping exists but is disconnected'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'user_unmapped', {
        ignoredReason: {
          code: 'USER_DISCONNECTED',
          message: 'User mapping exists but is disconnected',
          details: { userId },
        },
      });
      return;
    }

    // Extract common message details
    const waMessageId = extractMessageId(request.body) ?? `unknown-${savedEvent.id}`;
    const toNumber = extractDisplayPhoneNumber(request.body) ?? '';
    const timestamp = extractMessageTimestamp(request.body) ?? '';
    const senderName = extractSenderName(request.body);
    const phoneNumberId = extractPhoneNumberId(request.body);

    // Route to appropriate handler
    request.log.info(
      {
        eventId: savedEvent.id,
        userId,
        messageType,
        waMessageId,
      },
      'Routing message to handler'
    );

    if (messageType === 'image' && imageMedia !== null) {
      await handleImageMessage(
        request,
        savedEvent,
        services,
        userId,
        waMessageId,
        fromNumber,
        toNumber,
        timestamp,
        senderName,
        phoneNumberId,
        imageMedia
      );
      return;
    }

    if (messageType === 'audio' && audioMedia !== null) {
      await handleAudioMessage(
        request,
        savedEvent,
        config,
        services,
        userId,
        waMessageId,
        fromNumber,
        toNumber,
        timestamp,
        senderName,
        phoneNumberId,
        audioMedia
      );
      return;
    }

    // Handle text message
    await handleTextMessage(
      request,
      savedEvent,
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      timestamp,
      senderName,
      phoneNumberId,
      messageText ?? ''
    );
  } catch (error) {
    request.log.error(
      {
        eventId: savedEvent.id,
        error: getErrorMessage(error),
      },
      'Unexpected error during asynchronous webhook processing'
    );
  }
}

/**
 * Handle image message using ProcessImageMessageUseCase.
 */
async function handleImageMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  services: ReturnType<typeof getServices>,
  userId: string,
  waMessageId: string,
  fromNumber: string,
  toNumber: string,
  timestamp: string,
  senderName: string | null,
  phoneNumberId: string | null,
  imageMedia: { id: string; mimeType: string; sha256?: string; caption?: string }
): Promise<void> {
  const usecase = new ProcessImageMessageUseCase({
    webhookEventRepository: services.webhookEventRepository,
    messageRepository: services.messageRepository,
    mediaStorage: services.mediaStorage,
    whatsappCloudApi: services.whatsappCloudApi,
    thumbnailGenerator: services.thumbnailGenerator,
  });

  const result = await usecase.execute(
    {
      eventId: savedEvent.id,
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      timestamp,
      senderName,
      phoneNumberId,
      imageMedia,
    },
    request.log
  );

  if (result.ok) {
    await sendConfirmationMessage(request, savedEvent, fromNumber, 'image');
  }
}

/**
 * Handle audio message using ProcessAudioMessageUseCase.
 * Transcription is triggered via Pub/Sub event.
 */
async function handleAudioMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config,
  services: ReturnType<typeof getServices>,
  userId: string,
  waMessageId: string,
  fromNumber: string,
  toNumber: string,
  timestamp: string,
  senderName: string | null,
  phoneNumberId: string | null,
  audioMedia: { id: string; mimeType: string; sha256?: string }
): Promise<void> {
  const usecase = new ProcessAudioMessageUseCase({
    webhookEventRepository: services.webhookEventRepository,
    messageRepository: services.messageRepository,
    mediaStorage: services.mediaStorage,
    whatsappCloudApi: services.whatsappCloudApi,
  });

  const result = await usecase.execute(
    {
      eventId: savedEvent.id,
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      timestamp,
      senderName,
      phoneNumberId,
      audioMedia,
    },
    request.log
  );

  if (result.ok) {
    // Publish transcription event to Pub/Sub for async processing
    const transcriptionPhoneNumberId = config.allowedPhoneNumberIds[0];
    if (transcriptionPhoneNumberId !== undefined) {
      await services.eventPublisher.publishTranscribeAudio({
        type: 'whatsapp.audio.transcribe',
        messageId: result.value.messageId,
        userId,
        gcsPath: result.value.gcsPath,
        mimeType: result.value.mimeType,
        userPhoneNumber: fromNumber,
        originalWaMessageId: waMessageId,
        phoneNumberId: transcriptionPhoneNumberId,
      });
    }

    await sendConfirmationMessage(request, savedEvent, fromNumber, 'audio');
  }
}

/**
 * Handle text message (direct save without usecase - simple enough).
 */
async function handleTextMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  userId: string,
  waMessageId: string,
  fromNumber: string,
  toNumber: string,
  timestamp: string,
  senderName: string | null,
  phoneNumberId: string | null,
  messageText: string
): Promise<void> {
  const { webhookEventRepository, messageRepository } = getServices();

  // Build text message object
  const messageToSave: Parameters<typeof messageRepository.saveMessage>[0] = {
    userId,
    waMessageId,
    fromNumber,
    toNumber,
    text: messageText,
    mediaType: 'text',
    timestamp,
    receivedAt: new Date().toISOString(),
    webhookEventId: savedEvent.id,
  };

  // Add metadata only if we have any values
  if (senderName !== null || phoneNumberId !== null) {
    const metadata: { senderName?: string; phoneNumberId?: string } = {};
    if (senderName !== null) {
      metadata.senderName = senderName;
    }
    if (phoneNumberId !== null) {
      metadata.phoneNumberId = phoneNumberId;
    }
    messageToSave.metadata = metadata;
  }

  // Save message to Firestore
  const saveResult = await messageRepository.saveMessage(messageToSave);

  if (!saveResult.ok) {
    request.log.error(
      { error: saveResult.error, eventId: savedEvent.id },
      'Failed to save message'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
      failureDetails: `Failed to save message: ${saveResult.error.message}`,
    });
    return;
  }

  const savedMessage = saveResult.value;

  request.log.info(
    { eventId: savedEvent.id, userId, messageId: savedMessage.id },
    'Text message saved to database'
  );

  await webhookEventRepository.updateEventStatus(savedEvent.id, 'processed', {});

  // Publish command ingest event for text message
  const services = getServices();
  request.log.info(
    { eventId: savedEvent.id, userId, messageId: savedMessage.id },
    'Publishing command.ingest event'
  );

  await services.eventPublisher.publishCommandIngest({
    type: 'command.ingest',
    userId,
    sourceType: 'whatsapp_text',
    externalId: waMessageId,
    text: messageText,
    timestamp,
  });

  // Publish link preview extraction event to Pub/Sub
  await services.eventPublisher.publishExtractLinkPreviews({
    type: 'whatsapp.linkpreview.extract',
    messageId: savedMessage.id,
    userId,
    text: messageText,
  });

  request.log.info(
    { eventId: savedEvent.id, userId, messageId: savedMessage.id },
    'Text message processing completed successfully'
  );

  await sendConfirmationMessage(request, savedEvent, fromNumber, 'text');
}

/**
 * Message types for confirmation messages.
 */
type ConfirmationMessageType = 'text' | 'image' | 'audio';

/**
 * Get confirmation message text based on message type.
 */
function getConfirmationMessageText(messageType: ConfirmationMessageType): string {
  switch (messageType) {
    case 'audio':
      return '✅ Voice message saved. Transcription in progress...';
    case 'image':
      return '✅ Image saved.';
    case 'text':
      return '✅ Message saved.';
  }
}

/**
 * Send confirmation message back to the sender.
 */
async function sendConfirmationMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  fromNumber: string,
  messageType: ConfirmationMessageType
): Promise<void> {
  const originalMessageId = extractMessageId(request.body);
  const phoneNumberId = extractPhoneNumberId(request.body);

  if (phoneNumberId !== null) {
    const { whatsappCloudApi } = getServices();
    const confirmationText = getConfirmationMessageText(messageType);

    const sendResult = await whatsappCloudApi.sendMessage(
      phoneNumberId,
      fromNumber,
      confirmationText,
      originalMessageId ?? undefined
    );

    if (sendResult.ok) {
      request.log.info(
        { eventId: savedEvent.id, messageId: sendResult.value.messageId, recipient: fromNumber },
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
