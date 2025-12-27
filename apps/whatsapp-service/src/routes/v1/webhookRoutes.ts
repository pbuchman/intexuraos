/**
 * WhatsApp Webhook Routes
 *
 * GET  /v1/webhooks/whatsapp - Webhook verification endpoint
 * POST /v1/webhooks/whatsapp - Webhook event receiver
 *
 * This file handles HTTP transport concerns (validation, signature, response).
 * Business logic is delegated to domain usecases.
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { type WebhookPayload, webhookVerifyQuerySchema } from './schemas.js';
import { SIGNATURE_HEADER, validateWebhookSignature } from '../../signature.js';
import { getServices } from '../../services.js';
import type { Config } from '../../config.js';
import {
  ProcessImageMessageUseCase,
  ProcessAudioMessageUseCase,
  TranscribeAudioUseCase,
} from '../../domain/inbox/index.js';
import {
  extractDisplayPhoneNumber,
  extractMessageId,
  extractPhoneNumberId,
  extractSenderPhoneNumber,
  extractWabaId,
  extractMessageText,
  extractMessageTimestamp,
  extractSenderName,
  extractMessageType,
  extractImageMedia,
  extractAudioMedia,
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
 * Validates user mapping and routes to appropriate usecase.
 */
async function processWebhookAsync(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config
): Promise<void> {
  const services = getServices();
  const { webhookEventRepository, userMappingRepository } = services;

  try {
    // Find user by phone number
    const fromNumber = extractSenderPhoneNumber(request.body);
    if (fromNumber === null) {
      request.log.debug({ eventId: savedEvent.id }, 'No sender phone number found');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'IGNORED', {
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

    // Validate message type
    const supportedTypes = ['text', 'image', 'audio'];
    if (messageType === null || !supportedTypes.includes(messageType)) {
      request.log.info(
        { eventId: savedEvent.id, messageType },
        'Ignoring unsupported message type'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'IGNORED', {
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
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'IGNORED', {
        ignoredReason: {
          code: 'EMPTY_TEXT_MESSAGE',
          message: 'Text message has no body',
        },
      });
      return;
    }

    if (messageType === 'image' && imageMedia === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring image message without media info');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'IGNORED', {
        ignoredReason: {
          code: 'NO_IMAGE_MEDIA',
          message: 'Image message has no media info',
        },
      });
      return;
    }

    if (messageType === 'audio' && audioMedia === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring audio message without media info');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'IGNORED', {
        ignoredReason: {
          code: 'NO_AUDIO_MEDIA',
          message: 'Audio message has no media info',
        },
      });
      return;
    }

    // Look up user by phone number
    const userIdResult = await userMappingRepository.findUserByPhoneNumber(fromNumber);
    if (!userIdResult.ok) {
      request.log.error(
        { error: userIdResult.error, eventId: savedEvent.id },
        'Failed to look up user by phone number'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: userIdResult.error.message,
      });
      return;
    }

    if (userIdResult.value === null) {
      request.log.info(
        { eventId: savedEvent.id, fromNumber },
        'No user mapping found for phone number'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'USER_UNMAPPED', {
        ignoredReason: {
          code: 'USER_UNMAPPED',
          message: `No user mapping found for phone number: ${fromNumber}`,
          details: { phoneNumber: fromNumber },
        },
      });
      return;
    }

    const userId = userIdResult.value;

    // Check if user mapping is connected
    const mappingResult = await userMappingRepository.getMapping(userId);
    if (!mappingResult.ok || mappingResult.value?.connected !== true) {
      request.log.info(
        { eventId: savedEvent.id, userId },
        'User mapping exists but is disconnected'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'USER_UNMAPPED', {
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
      { error, eventId: savedEvent.id },
      'Unexpected error during webhook processing'
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
 * Handle audio message using ProcessAudioMessageUseCase and TranscribeAudioUseCase.
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
    // Start transcription in background (fire-and-forget)
    const transcribeUsecase = new TranscribeAudioUseCase({
      messageRepository: services.messageRepository,
      mediaStorage: services.mediaStorage,
      transcriptionService: services.transcriptionService,
      whatsappCloudApi: services.whatsappCloudApi,
    });

    // Get first phone number ID for sending transcription results
    const transcriptionPhoneNumberId = config.allowedPhoneNumberIds[0];
    if (transcriptionPhoneNumberId !== undefined) {
      void transcribeUsecase.execute(
        {
          messageId: result.value.messageId,
          userId,
          gcsPath: result.value.gcsPath,
          mimeType: result.value.mimeType,
          userPhoneNumber: fromNumber,
          originalWaMessageId: waMessageId,
          phoneNumberId: transcriptionPhoneNumberId,
        },
        request.log
      );
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
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
      failureDetails: `Failed to save message: ${saveResult.error.message}`,
    });
    return;
  }

  const savedMessage = saveResult.value;

  await webhookEventRepository.updateEventStatus(savedEvent.id, 'PROCESSED', {});

  request.log.info(
    { eventId: savedEvent.id, userId, messageId: savedMessage.id },
    'Message saved successfully'
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
