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
  type WhatsAppCloudApiPort,
} from '../domain/whatsapp/index.js';
import {
  extractAudioMedia,
  extractButtonResponse,
  extractDisplayPhoneNumber,
  extractImageMedia,
  extractMessageId,
  extractMessageText,
  extractMessageTimestamp,
  extractMessageType,
  extractPhoneNumberId,
  extractReactionData,
  extractReplyContext,
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
          // Return 500 so WhatsApp retries the webhook delivery
          reply.status(500);
          return await reply.send({ success: false, error: 'Failed to persist webhook event' });
        }

        const savedEvent = saveResult.value;

        // Publish to Pub/Sub for async processing
        const publishResult = await eventPublisher.publishWebhookProcess({
          type: 'whatsapp.webhook.process',
          eventId: savedEvent.id,
          payload: JSON.stringify(request.body),
          phoneNumberId,
          receivedAt,
        });

        if (!publishResult.ok) {
          request.log.error(
            { error: publishResult.error, eventId: savedEvent.id },
            'Failed to publish webhook for processing'
          );
          // Update event status to failed since it won't be processed
          await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
            failureDetails: `Pub/Sub publish failed: ${publishResult.error.message}`,
          });
          // Return 500 so WhatsApp retries
          reply.status(500);
          return await reply.send({
            success: false,
            error: 'Failed to queue webhook for processing',
          });
        }

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
    const reactionData = extractReactionData(request.body);
    const buttonResponse = extractButtonResponse(request.body);

    request.log.info(
      {
        eventId: savedEvent.id,
        fromNumber,
        messageType,
        hasText: messageText !== null,
        hasImage: imageMedia !== null,
        hasAudio: audioMedia !== null,
        hasReaction: reactionData !== null,
        reactionEmoji: reactionData?.emoji,
        hasButton: buttonResponse !== null,
        buttonId: buttonResponse?.buttonId,
      },
      'Extracted message details from webhook payload'
    );

    // Validate message type
    const supportedTypes = ['text', 'image', 'audio', 'reaction', 'button'];
    if (messageType === null || !supportedTypes.includes(messageType)) {
      request.log.info(
        { eventId: savedEvent.id, messageType },
        'Ignoring unsupported message type'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'UNSUPPORTED_MESSAGE_TYPE',
          message: `Only text, image, audio, reaction, and button messages are supported. Received: ${messageType ?? 'unknown'}`,
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

    if (messageType === 'reaction' && reactionData === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring reaction message without data');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'NO_REACTION_DATA',
          message: 'Reaction message has no data',
        },
      });
      return;
    }

    if (messageType === 'button' && buttonResponse === null) {
      request.log.info({ eventId: savedEvent.id }, 'Ignoring button message without data');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'NO_BUTTON_DATA',
          message: 'Button message has no data',
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

    if (messageType === 'reaction' && reactionData !== null) {
      await handleReactionMessage(request, savedEvent, services, userId, reactionData);
      return;
    }

    if (messageType === 'button' && buttonResponse !== null) {
      await handleButtonMessage(request, savedEvent, services, userId, buttonResponse);
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
    // Update event status so it's not stuck in 'pending' forever
    const { webhookEventRepository } = getServices();
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
      failureDetails: `Unexpected error: ${getErrorMessage(error)}`,
    });
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
    await markMessageAsRead(request, savedEvent);
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
      const publishResult = await services.eventPublisher.publishTranscribeAudio({
        type: 'whatsapp.audio.transcribe',
        messageId: result.value.messageId,
        userId,
        gcsPath: result.value.gcsPath,
        mimeType: result.value.mimeType,
        userPhoneNumber: fromNumber,
        originalWaMessageId: waMessageId,
        phoneNumberId: transcriptionPhoneNumberId,
      });
      if (!publishResult.ok) {
        request.log.error(
          { error: publishResult.error, messageId: result.value.messageId },
          'Failed to publish audio transcription event'
        );
      }
    }

    // Mark as read with typing indicator (shows user something is happening)
    await markAudioAsReadWithTyping(request, savedEvent, services.whatsappCloudApi);
  }
}

/**
 * Handle reaction message for action approval/rejection.
 *
 * Reactions are used for quick approval responses:
 * - 👍 (thumbs up) → approve
 * - 👎 (thumbs down) → reject
 * - Other emojis → ignored
 */
async function handleReactionMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  services: ReturnType<typeof getServices>,
  userId: string,
  reactionData: { emoji: string; messageId: string }
): Promise<void> {
  const { webhookEventRepository, outboundMessageRepository, eventPublisher } = services;

  request.log.info(
    {
      eventId: savedEvent.id,
      userId,
      reactionEmoji: reactionData.emoji,
      messageId: reactionData.messageId,
    },
    'Processing reaction message'
  );

  // Map emoji to intent
  let intent: 'approve' | 'reject' | null = null;
  if (reactionData.emoji === '👍') {
    intent = 'approve';
  } else if (reactionData.emoji === '👎') {
    intent = 'reject';
  }

  if (intent === null) {
    request.log.info(
      { eventId: savedEvent.id, emoji: reactionData.emoji },
      'Ignoring unsupported reaction emoji'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'UNSUPPORTED_REACTION',
        message: `Only 👍 and 👎 reactions are supported. Received: ${reactionData.emoji}`,
        details: { emoji: reactionData.emoji },
      },
    });
    return;
  }

  // Look up the original message being reacted to
  const outboundResult = await outboundMessageRepository.findByWamid(reactionData.messageId);

  if (!outboundResult.ok) {
    request.log.error(
      { eventId: savedEvent.id, messageId: reactionData.messageId, error: outboundResult.error },
      'Failed to look up outbound message'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
      failureDetails: `Failed to look up outbound message: ${outboundResult.error.message}`,
    });
    return;
  }

  if (outboundResult.value === null) {
    request.log.info(
      { eventId: savedEvent.id, messageId: reactionData.messageId },
      'No outbound message found for reaction (may not be an approval message)'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'NO_OUTBOUND_MESSAGE',
        message: 'No outbound message found for this reaction',
        details: { messageId: reactionData.messageId },
      },
    });
    return;
  }

  const correlationId = outboundResult.value.correlationId;
  // Extract actionId from correlationId (format: action-{type}-approval-{actionId})
  const match = /action-[^-]+-approval-(.+)$/.exec(correlationId);

  if (match === null) {
    request.log.info(
      { eventId: savedEvent.id, correlationId },
      'Reaction is not for an approval message, ignoring'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'NOT_APPROVAL_MESSAGE',
        message: 'Reaction is not for an approval message',
        details: { correlationId },
      },
    });
    return;
  }

  // match[1] is guaranteed to exist and be non-empty because:
  // 1. We returned early if match === null
  // 2. The regex uses (.+) which requires at least one character
  // TypeScript doesn't know this, so we need the fallback for type safety
  const actionId = match[1] ?? '';
  request.log.info(
    { eventId: savedEvent.id, correlationId, actionId, intent },
    'Reaction is for approval message, publishing reply event'
  );

  // Publish approval reply event with the intent from the reaction
  const replyText = intent === 'approve' ? 'yes' : 'no';
  const approvalReplyEvent: Parameters<typeof eventPublisher.publishApprovalReply>[0] = {
    type: 'action.approval.reply',
    replyToWamid: reactionData.messageId,
    replyText,
    userId,
    timestamp: new Date().toISOString(),
    actionId,
  };

  const approvalPublishResult = await eventPublisher.publishApprovalReply(approvalReplyEvent);

  if (!approvalPublishResult.ok) {
    request.log.error(
      {
        eventId: savedEvent.id,
        error: approvalPublishResult.error,
        replyToWamid: reactionData.messageId,
      },
      'Failed to publish approval reply event'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
      failureDetails: `Failed to publish approval reply: ${approvalPublishResult.error.message}`,
    });
    return;
  }

  request.log.info(
    {
      eventId: savedEvent.id,
      userId,
      replyToWamid: reactionData.messageId,
      actionId,
      intent,
    },
    'Published approval reply event from reaction'
  );

  await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {});
}

/**
 * Handle button message for action approval/rejection.
 *
 * Button responses come from interactive messages with action-specific nonces.
 * Button ID format: "approve:{actionId}:{nonce}" | "cancel:{actionId}" | "convert:{actionId}"
 */
async function handleButtonMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  services: ReturnType<typeof getServices>,
  userId: string,
  buttonResponse: { buttonId: string; buttonTitle: string; replyToWamid: string }
): Promise<void> {
  const { webhookEventRepository, eventPublisher } = services;

  request.log.info(
    {
      eventId: savedEvent.id,
      userId,
      buttonId: buttonResponse.buttonId,
      buttonTitle: buttonResponse.buttonTitle,
      replyToWamid: buttonResponse.replyToWamid,
    },
    'Processing button message'
  );

  // Parse button ID to extract action and intent
  // Format: "approve:{actionId}:{nonce}" | "cancel:{actionId}" | "convert:{actionId}"
  const parts = buttonResponse.buttonId.split(':');

  if (parts.length < 2) {
    request.log.warn(
      { eventId: savedEvent.id, buttonId: buttonResponse.buttonId },
      'Invalid button ID format'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'INVALID_BUTTON_FORMAT',
        message: 'Button ID does not match expected format',
        details: { buttonId: buttonResponse.buttonId },
      },
    });
    return;
  }

  const [intent, actionId, nonce] = parts;

  // Validate intent
  if (intent !== 'approve' && intent !== 'cancel' && intent !== 'convert') {
    request.log.warn(
      { eventId: savedEvent.id, intent },
      'Unknown button intent'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'UNKNOWN_BUTTON_INTENT',
        message: `Unknown button intent: ${String(intent)}`,
        details: { intent, buttonId: buttonResponse.buttonId },
      },
    });
    return;
  }

  // Approve intent requires a nonce for security
  if (intent === 'approve' && nonce === undefined) {
    request.log.warn(
      { eventId: savedEvent.id, buttonId: buttonResponse.buttonId },
      'Approve button missing nonce'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'MISSING_NONCE',
        message: 'Approve button requires nonce for security',
        details: { buttonId: buttonResponse.buttonId },
      },
    });
    return;
  }

  request.log.info(
    {
      eventId: savedEvent.id,
      userId,
      actionId,
      intent,
      hasNonce: nonce !== undefined,
    },
    'Button response parsed successfully, publishing approval reply event'
  );

  // Publish approval reply event with button data
  const approvalReplyEvent: Parameters<typeof eventPublisher.publishApprovalReply>[0] = {
    type: 'action.approval.reply',
    replyToWamid: buttonResponse.replyToWamid,
    replyText: intent === 'approve' ? 'yes' : intent === 'cancel' ? 'no' : 'convert',
    userId,
    timestamp: new Date().toISOString(),
    actionId: actionId ?? '', // actionId is guaranteed to be defined after parsing above
    buttonId: buttonResponse.buttonId,
    buttonTitle: buttonResponse.buttonTitle,
  };

  const approvalPublishResult = await eventPublisher.publishApprovalReply(approvalReplyEvent);

  if (!approvalPublishResult.ok) {
    request.log.error(
      {
        eventId: savedEvent.id,
        error: approvalPublishResult.error,
        replyToWamid: buttonResponse.replyToWamid,
      },
      'Failed to publish approval reply event'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
      failureDetails: `Failed to publish approval reply: ${approvalPublishResult.error.message}`,
    });
    return;
  }

  request.log.info(
    {
      eventId: savedEvent.id,
      userId,
      replyToWamid: buttonResponse.replyToWamid,
      actionId,
      intent,
    },
    'Published approval reply event from button response'
  );

  await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {});
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
  const services = getServices();
  const { webhookEventRepository, messageRepository, outboundMessageRepository, eventPublisher } =
    services;

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

  await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {});

  // Check if this is a reply to another message (potential approval response)
  const replyContext = extractReplyContext(request.body);

  // Declare actionId outside the if block so it's accessible later
  // If actionId is defined, this is a confirmed approval reply and we should skip command.ingest
  let actionId: string | undefined;

  if (replyContext !== null) {
    // This message is a reply - look up the original message to get correlationId
    request.log.info(
      {
        eventId: savedEvent.id,
        userId,
        replyToWamid: replyContext.replyToWamid,
      },
      'Message is a reply, looking up outbound message'
    );

    // Try to find the original outbound message to extract actionId
    const outboundResult = await outboundMessageRepository.findByWamid(replyContext.replyToWamid);

    if (outboundResult.ok && outboundResult.value !== null) {
      const correlationId = outboundResult.value.correlationId;
      // Extract actionId from correlationId (format: action-{type}-approval-{actionId})
      const match = /action-[^-]+-approval-(.+)$/.exec(correlationId);
      if (match !== null) {
        actionId = match[1];
        request.log.info(
          { correlationId, actionId },
          'Extracted actionId from correlationId'
        );
      } else {
        request.log.info(
          { correlationId, replyToWamid: replyContext.replyToWamid },
          'Outbound message found but correlationId does not match approval pattern'
        );
      }
    } else if (outboundResult.ok) {
      request.log.info(
        { replyToWamid: replyContext.replyToWamid },
        'No outbound message found for this wamid (may not be an approval message)'
      );
    } else {
      request.log.warn(
        { replyToWamid: replyContext.replyToWamid, error: outboundResult.error.message },
        'Failed to look up outbound message'
      );
    }

    // Only publish approval reply event if we found an actionId
    // If no actionId was extracted, this is not a reply to an approval message
    if (actionId !== undefined) {
      const approvalReplyEvent: Parameters<typeof eventPublisher.publishApprovalReply>[0] = {
        type: 'action.approval.reply',
        replyToWamid: replyContext.replyToWamid,
        replyText: messageText,
        userId,
        actionId,
        timestamp: new Date().toISOString(),
      };

      const approvalPublishResult = await eventPublisher.publishApprovalReply(approvalReplyEvent);

      if (!approvalPublishResult.ok) {
        request.log.error(
          {
            eventId: savedEvent.id,
            error: approvalPublishResult.error,
            replyToWamid: replyContext.replyToWamid,
          },
          'Failed to publish approval reply event'
        );
      } else {
        request.log.info(
          {
            eventId: savedEvent.id,
            userId,
            replyToWamid: replyContext.replyToWamid,
            actionId,
          },
          'Published approval reply event'
        );
      }
    }
  }

  // Only publish command.ingest if this is NOT a confirmed approval reply
  // If actionId is defined, we've already handled this via approval reply event
  if (actionId !== undefined) {
    request.log.info(
      { eventId: savedEvent.id, actionId, userId },
      'Skipping command.ingest for approval reply with known actionId'
    );
  } else {
    request.log.info(
      { eventId: savedEvent.id, userId, messageId: savedMessage.id },
      'Publishing command.ingest event'
    );

    const commandPublishResult = await eventPublisher.publishCommandIngest({
      type: 'command.ingest',
      userId,
      sourceType: 'whatsapp_text',
      externalId: waMessageId,
      text: messageText,
      timestamp,
    });

    if (!commandPublishResult.ok) {
      request.log.error(
        { eventId: savedEvent.id, error: commandPublishResult.error },
        'Failed to publish command ingest event'
      );
    }
  }

  // Publish link preview extraction event to Pub/Sub
  const linkPreviewPublishResult = await eventPublisher.publishExtractLinkPreviews({
    type: 'whatsapp.linkpreview.extract',
    messageId: savedMessage.id,
    userId,
    text: messageText,
  });

  if (!linkPreviewPublishResult.ok) {
    request.log.error(
      { eventId: savedEvent.id, error: linkPreviewPublishResult.error },
      'Failed to publish link preview extraction event'
    );
  }

  request.log.info(
    { eventId: savedEvent.id, userId, messageId: savedMessage.id },
    'Text message processing completed successfully'
  );

  await markMessageAsRead(request, savedEvent);
}

/**
 * Mark the incoming message as read (displays two blue check marks).
 * Used for text and image messages instead of sending a confirmation message.
 */
async function markMessageAsRead(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string }
): Promise<void> {
  const originalMessageId = extractMessageId(request.body);
  const phoneNumberId = extractPhoneNumberId(request.body);

  if (phoneNumberId !== null && originalMessageId !== null) {
    const { whatsappCloudApi } = getServices();

    const markResult = await whatsappCloudApi.markAsRead(phoneNumberId, originalMessageId);

    if (markResult.ok) {
      request.log.info(
        { eventId: savedEvent.id, messageId: originalMessageId },
        'Marked message as read'
      );
    } else {
      request.log.error(
        { eventId: savedEvent.id, error: markResult.error, messageId: originalMessageId },
        'Failed to mark message as read'
      );
    }
  }
}

/**
 * Mark audio message as read with typing indicator.
 * This shows the user something is happening (typing indicator shows for up to 25s
 * or until the next message is sent).
 */
async function markAudioAsReadWithTyping(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  whatsappCloudApi: WhatsAppCloudApiPort
): Promise<void> {
  const originalMessageId = extractMessageId(request.body);
  const phoneNumberId = extractPhoneNumberId(request.body);

  if (phoneNumberId !== null && originalMessageId !== null) {
    const result = await whatsappCloudApi.markAsReadWithTyping(phoneNumberId, originalMessageId);

    if (result.ok) {
      request.log.info(
        { eventId: savedEvent.id, messageId: originalMessageId },
        'Marked audio message as read with typing indicator'
      );
    } else {
      request.log.error(
        { eventId: savedEvent.id, error: result.error, messageId: originalMessageId },
        'Failed to mark audio message as read with typing indicator'
      );
    }
  }
}
