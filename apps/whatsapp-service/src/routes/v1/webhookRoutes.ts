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
import { generateThumbnail } from '../../infra/media/index.js';
import type { Config } from '../../config.js';
import type { TranscriptionState } from '../../domain/inbox/index.js';
import { sendWhatsAppMessage, getMediaUrl, downloadMedia } from '../../whatsappClient.js';
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
  type ImageMediaInfo,
  type AudioMediaInfo,
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
        // See: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
        const wabaId = extractWabaId(request.body);
        const phoneNumberId = extractPhoneNumberId(request.body);
        const displayPhoneNumber = extractDisplayPhoneNumber(request.body);

        // Validate WABA ID (entry[].id) matches configured allowed IDs
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

        // Validate phone number ID (metadata.phone_number_id) matches configured allowed IDs
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
 * Validates user mapping and saves message to Firestore.
 */
async function processWebhookAsync(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config
): Promise<void> {
  try {
    const { webhookEventRepository, userMappingRepository, messageRepository } = getServices();

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

    // Extract message text (only support text messages)
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

    // Extract message details
    const waMessageId = extractMessageId(request.body) ?? `unknown-${savedEvent.id}`;
    const toNumber = extractDisplayPhoneNumber(request.body) ?? '';
    const timestamp = extractMessageTimestamp(request.body) ?? '';
    const senderName = extractSenderName(request.body);
    const phoneNumberId = extractPhoneNumberId(request.body);

    // Handle image message processing
    if (messageType === 'image' && imageMedia !== null) {
      await processImageMessage(
        request,
        savedEvent,
        config,
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

    // Handle audio message processing
    if (messageType === 'audio' && audioMedia !== null) {
      await processAudioMessage(
        request,
        savedEvent,
        config,
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

    // Build text message object
    const messageToSave: Parameters<typeof messageRepository.saveMessage>[0] = {
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      text: messageText ?? '',
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

    // Send confirmation message
    await sendConfirmationMessage(request, savedEvent, fromNumber, config, 'text');
  } catch (error) {
    request.log.error(
      { error, eventId: savedEvent.id },
      'Unexpected error during webhook processing'
    );
  }
}

/**
 * Get file extension from MIME type.
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
  };
  return mimeToExt[mimeType] ?? 'bin';
}

/**
 * Process image message: download, generate thumbnail, upload to GCS, save to Firestore.
 */
async function processImageMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config,
  userId: string,
  waMessageId: string,
  fromNumber: string,
  toNumber: string,
  timestamp: string,
  senderName: string | null,
  phoneNumberId: string | null,
  imageMedia: ImageMediaInfo
): Promise<void> {
  const { webhookEventRepository, messageRepository, mediaStorage } = getServices();

  try {
    // Step 1: Get media URL from WhatsApp
    request.log.info(
      { eventId: savedEvent.id, mediaId: imageMedia.id },
      'Fetching image URL from WhatsApp'
    );

    const mediaUrlResult = await getMediaUrl(imageMedia.id, config.accessToken);
    if (!mediaUrlResult.success || mediaUrlResult.data === undefined) {
      request.log.error(
        { error: mediaUrlResult.error, eventId: savedEvent.id, mediaId: imageMedia.id },
        'Failed to get media URL'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to get media URL: ${mediaUrlResult.error ?? 'unknown error'}`,
      });
      return;
    }

    // Step 2: Download the image
    request.log.info(
      { eventId: savedEvent.id, mediaId: imageMedia.id },
      'Downloading image from WhatsApp'
    );

    const downloadResult = await downloadMedia(mediaUrlResult.data.url, config.accessToken);
    if (!downloadResult.success || downloadResult.buffer === undefined) {
      request.log.error(
        { error: downloadResult.error, eventId: savedEvent.id, mediaId: imageMedia.id },
        'Failed to download media'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to download media: ${downloadResult.error ?? 'unknown error'}`,
      });
      return;
    }

    const imageBuffer = downloadResult.buffer;
    const extension = getExtensionFromMimeType(imageMedia.mimeType);

    // Step 3: Generate thumbnail
    request.log.info({ eventId: savedEvent.id, mediaId: imageMedia.id }, 'Generating thumbnail');

    const thumbnailResult = await generateThumbnail(imageBuffer);
    if (!thumbnailResult.ok) {
      request.log.error(
        { error: thumbnailResult.error, eventId: savedEvent.id, mediaId: imageMedia.id },
        'Failed to generate thumbnail'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to generate thumbnail: ${thumbnailResult.error.message}`,
      });
      return;
    }

    // Step 4: Upload original image to GCS
    request.log.info({ eventId: savedEvent.id, mediaId: imageMedia.id }, 'Uploading image to GCS');

    const uploadResult = await mediaStorage.upload(
      userId,
      waMessageId,
      imageMedia.id,
      extension,
      imageBuffer,
      imageMedia.mimeType
    );

    if (!uploadResult.ok) {
      request.log.error(
        { error: uploadResult.error, eventId: savedEvent.id, mediaId: imageMedia.id },
        'Failed to upload image to GCS'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to upload image: ${uploadResult.error.message}`,
      });
      return;
    }

    // Step 5: Upload thumbnail to GCS
    request.log.info(
      { eventId: savedEvent.id, mediaId: imageMedia.id },
      'Uploading thumbnail to GCS'
    );

    const thumbnailUploadResult = await mediaStorage.uploadThumbnail(
      userId,
      waMessageId,
      imageMedia.id,
      'jpg', // Thumbnails are always JPEG
      thumbnailResult.value.buffer,
      thumbnailResult.value.mimeType
    );

    if (!thumbnailUploadResult.ok) {
      request.log.error(
        { error: thumbnailUploadResult.error, eventId: savedEvent.id, mediaId: imageMedia.id },
        'Failed to upload thumbnail to GCS'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to upload thumbnail: ${thumbnailUploadResult.error.message}`,
      });
      return;
    }

    // Step 6: Save message to Firestore
    const messageToSave: Parameters<typeof messageRepository.saveMessage>[0] = {
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      text: imageMedia.caption ?? '',
      mediaType: 'image',
      media: {
        id: imageMedia.id,
        mimeType: imageMedia.mimeType,
        fileSize: imageBuffer.length,
      },
      gcsPath: uploadResult.value.gcsPath,
      thumbnailGcsPath: thumbnailUploadResult.value.gcsPath,
      timestamp,
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    };

    // Add optional media sha256
    if (imageMedia.sha256 !== undefined && messageToSave.media !== undefined) {
      messageToSave.media.sha256 = imageMedia.sha256;
    }

    // Add caption if present
    if (imageMedia.caption !== undefined) {
      messageToSave.caption = imageMedia.caption;
    }

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

    const saveResult = await messageRepository.saveMessage(messageToSave);

    if (!saveResult.ok) {
      request.log.error(
        { error: saveResult.error, eventId: savedEvent.id },
        'Failed to save image message'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to save message: ${saveResult.error.message}`,
      });
      return;
    }

    await webhookEventRepository.updateEventStatus(savedEvent.id, 'PROCESSED', {});

    request.log.info(
      {
        eventId: savedEvent.id,
        userId,
        messageId: saveResult.value.id,
        gcsPath: uploadResult.value.gcsPath,
        thumbnailGcsPath: thumbnailUploadResult.value.gcsPath,
      },
      'Image message saved successfully'
    );

    // Send confirmation message
    await sendConfirmationMessage(request, savedEvent, fromNumber, config, 'image');
  } catch (error) {
    request.log.error(
      { error, eventId: savedEvent.id },
      'Unexpected error during image message processing'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
      failureDetails: 'Unexpected error during image processing',
    });
  }
}

/**
 * Process audio message: download, upload to GCS, save to Firestore, publish event.
 */
async function processAudioMessage(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config,
  userId: string,
  waMessageId: string,
  fromNumber: string,
  toNumber: string,
  timestamp: string,
  senderName: string | null,
  phoneNumberId: string | null,
  audioMedia: AudioMediaInfo
): Promise<void> {
  const { webhookEventRepository, messageRepository, mediaStorage } = getServices();

  try {
    // Step 1: Get media URL from WhatsApp
    request.log.info(
      { eventId: savedEvent.id, mediaId: audioMedia.id },
      'Fetching audio URL from WhatsApp'
    );

    const mediaUrlResult = await getMediaUrl(audioMedia.id, config.accessToken);
    if (!mediaUrlResult.success || mediaUrlResult.data === undefined) {
      request.log.error(
        { error: mediaUrlResult.error, eventId: savedEvent.id, mediaId: audioMedia.id },
        'Failed to get audio URL'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to get audio URL: ${mediaUrlResult.error ?? 'unknown error'}`,
      });
      return;
    }

    // Step 2: Download the audio
    request.log.info(
      { eventId: savedEvent.id, mediaId: audioMedia.id },
      'Downloading audio from WhatsApp'
    );

    const downloadResult = await downloadMedia(mediaUrlResult.data.url, config.accessToken);
    if (!downloadResult.success || downloadResult.buffer === undefined) {
      request.log.error(
        { error: downloadResult.error, eventId: savedEvent.id, mediaId: audioMedia.id },
        'Failed to download audio'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to download audio: ${downloadResult.error ?? 'unknown error'}`,
      });
      return;
    }

    const audioBuffer = downloadResult.buffer;
    const extension = getExtensionFromMimeType(audioMedia.mimeType);

    // Step 3: Upload audio to GCS
    request.log.info({ eventId: savedEvent.id, mediaId: audioMedia.id }, 'Uploading audio to GCS');

    const uploadResult = await mediaStorage.upload(
      userId,
      waMessageId,
      audioMedia.id,
      extension,
      audioBuffer,
      audioMedia.mimeType
    );

    if (!uploadResult.ok) {
      request.log.error(
        { error: uploadResult.error, eventId: savedEvent.id, mediaId: audioMedia.id },
        'Failed to upload audio to GCS'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to upload audio: ${uploadResult.error.message}`,
      });
      return;
    }

    // Step 4: Save message to Firestore
    const messageToSave: Parameters<typeof messageRepository.saveMessage>[0] = {
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      text: '',
      mediaType: 'audio',
      media: {
        id: audioMedia.id,
        mimeType: audioMedia.mimeType,
        fileSize: audioBuffer.length,
      },
      gcsPath: uploadResult.value.gcsPath,
      timestamp,
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    };

    // Add optional media sha256
    if (audioMedia.sha256 !== undefined && messageToSave.media !== undefined) {
      messageToSave.media.sha256 = audioMedia.sha256;
    }

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

    const saveResult = await messageRepository.saveMessage(messageToSave);

    if (!saveResult.ok) {
      request.log.error(
        { error: saveResult.error, eventId: savedEvent.id },
        'Failed to save audio message'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
        failureDetails: `Failed to save message: ${saveResult.error.message}`,
      });
      return;
    }

    const savedMessage = saveResult.value;

    // Step 5: Start in-process async transcription (fire-and-forget)
    // This runs in the background after webhook returns 200
    void transcribeAudioAsync(
      request.log,
      savedMessage.id,
      userId,
      uploadResult.value.gcsPath,
      audioMedia.mimeType,
      fromNumber,
      savedMessage.waMessageId,
      config
    );

    await webhookEventRepository.updateEventStatus(savedEvent.id, 'PROCESSED', {});

    request.log.info(
      {
        eventId: savedEvent.id,
        userId,
        messageId: saveResult.value.id,
        gcsPath: uploadResult.value.gcsPath,
      },
      'Audio message saved successfully'
    );

    // Send confirmation message
    await sendConfirmationMessage(request, savedEvent, fromNumber, config, 'audio');
  } catch (error) {
    request.log.error(
      { error, eventId: savedEvent.id },
      'Unexpected error during audio message processing'
    );
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'FAILED', {
      failureDetails: 'Unexpected error during audio processing',
    });
  }
}

/**
 * Logger interface for transcription async function.
 */
interface TranscriptionLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

/**
 * Polling configuration for transcription jobs.
 */
const TRANSCRIPTION_POLL_CONFIG = {
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 1.5,
  maxAttempts: 60, // ~5 minutes max with backoff
};

/**
 * In-process async transcription handler.
 *
 * IMPORTANT: Cloud Run Considerations
 * This function runs in the background after the webhook returns 200.
 * Risks:
 * - Container may be killed before transcription completes
 * - Long audio files (>5 min) are at higher risk
 * - Consider setting min_scale=1 for whatsapp-service for reliability
 *
 * Future improvement: Use Cloud Tasks for guaranteed delivery.
 */
async function transcribeAudioAsync(
  logger: TranscriptionLogger,
  messageId: string,
  userId: string,
  gcsPath: string,
  mimeType: string,
  userPhoneNumber: string,
  originalWaMessageId: string,
  config: Config
): Promise<void> {
  const { transcriptionService, messageRepository, mediaStorage } = getServices();
  const startedAt = new Date().toISOString();

  logger.info(
    { event: 'transcription_start', messageId, userId, gcsPath },
    'Starting in-process audio transcription'
  );

  // Initialize transcription state as pending
  const initialState: TranscriptionState = {
    status: 'pending',
    startedAt,
  };
  await messageRepository.updateTranscription(userId, messageId, initialState);

  try {
    // Step 1: Get signed URL for audio file
    logger.info(
      { event: 'transcription_get_signed_url', messageId },
      'Getting signed URL for audio file'
    );

    const signedUrlResult = await mediaStorage.getSignedUrl(gcsPath, 3600); // 1 hour expiry
    if (!signedUrlResult.ok) {
      const errorState: TranscriptionState = {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: {
          code: 'SIGNED_URL_ERROR',
          message: signedUrlResult.error.message,
        },
      };
      await messageRepository.updateTranscription(userId, messageId, errorState);
      await sendTranscriptionFailureMessage(
        userPhoneNumber,
        originalWaMessageId,
        'Failed to access audio file',
        config
      );
      logger.error(
        { event: 'transcription_signed_url_error', messageId, error: signedUrlResult.error },
        'Failed to get signed URL'
      );
      return;
    }

    // Step 2: Submit job to Speechmatics
    logger.info(
      { event: 'transcription_submit', messageId },
      'Submitting transcription job to Speechmatics'
    );

    const submitResult = await transcriptionService.submitJob({
      audioUrl: signedUrlResult.value,
      mimeType,
    });

    if (!submitResult.ok) {
      const errorState: TranscriptionState = {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: {
          code: submitResult.error.code,
          message: submitResult.error.message,
        },
      };
      if (submitResult.error.apiCall !== undefined) {
        errorState.lastApiCall = submitResult.error.apiCall;
      }
      await messageRepository.updateTranscription(userId, messageId, errorState);
      await sendTranscriptionFailureMessage(
        userPhoneNumber,
        originalWaMessageId,
        `Transcription submission failed: ${submitResult.error.message}`,
        config
      );
      logger.error(
        { event: 'transcription_submit_error', messageId, error: submitResult.error },
        'Failed to submit transcription job'
      );
      return;
    }

    const jobId = submitResult.value.jobId;

    // Update state to processing
    const processingState: TranscriptionState = {
      status: 'processing',
      jobId,
      startedAt,
      lastApiCall: submitResult.value.apiCall,
    };
    await messageRepository.updateTranscription(userId, messageId, processingState);

    logger.info(
      { event: 'transcription_submitted', messageId, jobId },
      'Transcription job submitted, starting poll'
    );

    // Step 3: Poll until completion
    let delayMs = TRANSCRIPTION_POLL_CONFIG.initialDelayMs;
    let attempts = 0;
    let lastPollApiCall = submitResult.value.apiCall;

    while (attempts < TRANSCRIPTION_POLL_CONFIG.maxAttempts) {
      attempts++;
      await sleep(delayMs);

      logger.info(
        { event: 'transcription_poll', messageId, jobId, attempt: attempts, delayMs },
        'Polling transcription job status'
      );

      const pollResult = await transcriptionService.pollJob(jobId);

      if (!pollResult.ok) {
        logger.error(
          { event: 'transcription_poll_error', messageId, jobId, error: pollResult.error },
          'Failed to poll transcription status'
        );
        // Continue polling on transient errors
        delayMs = Math.min(
          delayMs * TRANSCRIPTION_POLL_CONFIG.backoffMultiplier,
          TRANSCRIPTION_POLL_CONFIG.maxDelayMs
        );
        continue;
      }

      lastPollApiCall = pollResult.value.apiCall;

      if (pollResult.value.status === 'done') {
        logger.info(
          { event: 'transcription_done', messageId, jobId },
          'Transcription job completed'
        );
        break;
      }

      if (pollResult.value.status === 'rejected') {
        const errorState: TranscriptionState = {
          status: 'failed',
          jobId,
          startedAt,
          completedAt: new Date().toISOString(),
          error: pollResult.value.error ?? { code: 'JOB_REJECTED', message: 'Job was rejected' },
          lastApiCall: pollResult.value.apiCall,
        };
        await messageRepository.updateTranscription(userId, messageId, errorState);
        await sendTranscriptionFailureMessage(
          userPhoneNumber,
          originalWaMessageId,
          `Transcription failed: ${pollResult.value.error?.message ?? 'Job was rejected'}`,
          config
        );
        logger.error(
          { event: 'transcription_rejected', messageId, jobId, error: pollResult.value.error },
          'Transcription job was rejected'
        );
        return;
      }

      // Exponential backoff
      delayMs = Math.min(
        delayMs * TRANSCRIPTION_POLL_CONFIG.backoffMultiplier,
        TRANSCRIPTION_POLL_CONFIG.maxDelayMs
      );
    }

    if (attempts >= TRANSCRIPTION_POLL_CONFIG.maxAttempts) {
      const errorState: TranscriptionState = {
        status: 'failed',
        jobId,
        startedAt,
        completedAt: new Date().toISOString(),
        error: { code: 'POLL_TIMEOUT', message: 'Transcription polling timed out' },
        lastApiCall: lastPollApiCall,
      };
      await messageRepository.updateTranscription(userId, messageId, errorState);
      await sendTranscriptionFailureMessage(
        userPhoneNumber,
        originalWaMessageId,
        'Transcription timed out',
        config
      );
      logger.error(
        { event: 'transcription_timeout', messageId, jobId, attempts },
        'Transcription polling timed out'
      );
      return;
    }

    // Step 4: Fetch transcript
    logger.info(
      { event: 'transcription_fetch', messageId, jobId },
      'Fetching transcription result'
    );

    const transcriptResult = await transcriptionService.getTranscript(jobId);

    if (!transcriptResult.ok) {
      const errorState: TranscriptionState = {
        status: 'failed',
        jobId,
        startedAt,
        completedAt: new Date().toISOString(),
        error: {
          code: transcriptResult.error.code,
          message: transcriptResult.error.message,
        },
      };
      if (transcriptResult.error.apiCall !== undefined) {
        errorState.lastApiCall = transcriptResult.error.apiCall;
      }
      await messageRepository.updateTranscription(userId, messageId, errorState);
      await sendTranscriptionFailureMessage(
        userPhoneNumber,
        originalWaMessageId,
        `Failed to fetch transcript: ${transcriptResult.error.message}`,
        config
      );
      logger.error(
        { event: 'transcription_fetch_error', messageId, jobId, error: transcriptResult.error },
        'Failed to fetch transcription result'
      );
      return;
    }

    const transcript = transcriptResult.value.text;

    // Step 5: Update message with completed transcription
    const completedState: TranscriptionState = {
      status: 'completed',
      jobId,
      text: transcript,
      startedAt,
      completedAt: new Date().toISOString(),
      lastApiCall: transcriptResult.value.apiCall,
    };
    await messageRepository.updateTranscription(userId, messageId, completedState);

    logger.info(
      {
        event: 'transcription_completed',
        messageId,
        jobId,
        transcriptLength: transcript.length,
      },
      'Transcription completed successfully'
    );

    // Step 6: Send transcript to user via WhatsApp (quoting original message)
    await sendTranscriptionSuccessMessage(userPhoneNumber, originalWaMessageId, transcript, config);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorState: TranscriptionState = {
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      error: { code: 'UNEXPECTED_ERROR', message: errorMessage },
    };
    await messageRepository.updateTranscription(userId, messageId, errorState);
    await sendTranscriptionFailureMessage(
      userPhoneNumber,
      originalWaMessageId,
      `Unexpected error: ${errorMessage}`,
      config
    );
    logger.error(
      { event: 'transcription_unexpected_error', messageId, error: errorMessage },
      'Unexpected error during transcription'
    );
  }
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send transcription success message to user.
 */
async function sendTranscriptionSuccessMessage(
  phoneNumber: string,
  originalMessageId: string,
  transcript: string,
  config: Config
): Promise<void> {
  // Get the first phone number ID from config
  const phoneNumberId = config.allowedPhoneNumberIds[0];
  if (phoneNumberId === undefined) {
    return;
  }

  const message = `🎙️ *Transcription:*\n\n${transcript}`;

  await sendWhatsAppMessage(
    phoneNumberId,
    phoneNumber,
    message,
    config.accessToken,
    originalMessageId
  );
}

/**
 * Send transcription failure message to user.
 */
async function sendTranscriptionFailureMessage(
  phoneNumber: string,
  originalMessageId: string,
  errorDetails: string,
  config: Config
): Promise<void> {
  // Get the first phone number ID from config
  const phoneNumberId = config.allowedPhoneNumberIds[0];
  if (phoneNumberId === undefined) {
    return;
  }

  const message = `❌ *Transcription failed:*\n\n${errorDetails}`;

  await sendWhatsAppMessage(
    phoneNumberId,
    phoneNumber,
    message,
    config.accessToken,
    originalMessageId
  );
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
  config: Config,
  messageType: ConfirmationMessageType
): Promise<void> {
  const originalMessageId = extractMessageId(request.body);
  const phoneNumberId = extractPhoneNumberId(request.body);

  if (phoneNumberId !== null) {
    const confirmationText = getConfirmationMessageText(messageType);
    const sendResult = await sendWhatsAppMessage(
      phoneNumberId,
      fromNumber,
      confirmationText,
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
