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
    await sendConfirmationMessage(request, savedEvent, fromNumber, config);
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
    await sendConfirmationMessage(request, savedEvent, fromNumber, config);
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

    // Step 5: Create transcription job via SRT service API
    const { srtClient } = getServices();

    const createJobResult = await srtClient.createJob({
      messageId: saveResult.value.id,
      mediaId: audioMedia.id,
      userId,
      gcsPath: uploadResult.value.gcsPath,
      mimeType: audioMedia.mimeType,
    });

    if (!createJobResult.ok) {
      request.log.error(
        { error: createJobResult.error, eventId: savedEvent.id },
        'Failed to create transcription job'
      );
      // Note: We don't fail the webhook here since the message is already saved
      // The job can be created manually if needed
    } else {
      request.log.info(
        { eventId: savedEvent.id, messageId: saveResult.value.id, jobId: createJobResult.value.id },
        'Created transcription job'
      );

      // Step 6: Submit job to Speechmatics
      const submitResult = await srtClient.submitJob(createJobResult.value.id);

      if (!submitResult.ok) {
        request.log.error(
          { error: submitResult.error, jobId: createJobResult.value.id },
          'Failed to submit transcription job to Speechmatics'
        );
        // Job created but not submitted - will be picked up by polling
      } else {
        request.log.info(
          {
            jobId: createJobResult.value.id,
            speechmaticsJobId: submitResult.value.speechmaticsJobId,
          },
          'Transcription job submitted to Speechmatics'
        );
      }
    }

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
    await sendConfirmationMessage(request, savedEvent, fromNumber, config);
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
