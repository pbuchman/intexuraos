/**
 * Use case for processing WhatsApp webhook events asynchronously.
 *
 * Handles the complete flow:
 * 1. Extract message details from payload
 * 2. Validate user mapping
 * 3. Route to appropriate handler (image, audio, button, text)
 * 4. Update webhook event status
 */
import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '../utils/logger.js';
import type {
  WhatsAppMessageRepository,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEventRepository,
} from '../ports/repositories.js';
import type { MediaStoragePort } from '../ports/mediaStorage.js';
import type { WhatsAppCloudApiPort } from '../ports/whatsappCloudApi.js';
import type { ThumbnailGeneratorPort } from '../ports/thumbnailGenerator.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { OutboundMessageRepository } from '../ports/outboundMessageRepository.js';
import type { IntexMessageReplyContext } from '../events/index.js';
import type { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import { ProcessImageMessageUseCase } from './processImageMessage.js';
import { ProcessAudioMessageUseCase } from './processAudioMessage.js';
import { ProcessVideoMessageUseCase } from './processVideoMessage.js';
import { parseMatrixCorpusVisibleMessage } from '../../matrixCorpus/visibleHeader.js';
import {
  matrixCorpusReservedIngressResultSchema,
  notReadyMatrixCorpusIngress,
  type MatrixCorpusIngressPort,
} from '../../matrixCorpus/ports/matrixCorpusIngress.js';
import type { WebhookPayload } from '../../../routes/schemas.js';
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
  extractVideoMedia,
} from '../../../routes/shared.js';

const MAX_REPLY_CONTEXT_TEXT_LENGTH = 1200;

/**
 * Dependencies for ProcessWebhookEventUseCase.
 */
export interface ProcessWebhookEventDeps {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  userMappingRepository: WhatsAppUserMappingRepository;
  messageRepository: WhatsAppMessageRepository;
  outboundMessageRepository: OutboundMessageRepository;
  mediaStorage: MediaStoragePort;
  whatsappCloudApi: WhatsAppCloudApiPort;
  thumbnailGenerator: ThumbnailGeneratorPort;
  eventPublisher: EventPublisherPort;
  matrixCorpusIngress?: MatrixCorpusIngressPort;
}

export interface ProcessWebhookEventFailure {
  ok: false;
  retryable: boolean;
  failureDetails: string;
}

export type ProcessWebhookEventResult = ProcessWebhookEventFailure | undefined;

class RetryableWebhookProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableWebhookProcessingError';
  }
}

/**
 * Use case for processing WhatsApp webhook events asynchronously.
 */
export class ProcessWebhookEventUseCase {
  constructor(private readonly deps: ProcessWebhookEventDeps) {}

  /**
   * Process webhook event synchronously.
   * Validates user mapping and routes to appropriate usecase.
   */
  async execute(
    payload: WebhookPayload,
    savedEvent: { id: string },
    logger: Logger
  ): Promise<ProcessWebhookEventResult> {
    const { webhookEventRepository, userMappingRepository } = this.deps;
    let isMatrixCorpusReserved = false;

    logger.info({ eventId: savedEvent.id }, 'Starting asynchronous webhook processing');

    try {
      // Find user by phone number
      const fromNumber = extractSenderPhoneNumber(payload);
      if (fromNumber === null) {
        logger.info(
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
      const messageText = extractMessageText(payload);
      const messageType = extractMessageType(payload);
      const imageMedia = extractImageMedia(payload);
      const audioMedia = extractAudioMedia(payload);
      const videoMedia = extractVideoMedia(payload);
      const reactionData = extractReactionData(payload);
      const buttonResponse = extractButtonResponse(payload);
      isMatrixCorpusReserved =
        messageType === 'text' &&
        messageText !== null &&
        parseMatrixCorpusVisibleMessage(messageText).kind !== 'ordinary';

      logger.info(
        {
          eventId: savedEvent.id,
          ...(isMatrixCorpusReserved ? { matrixCorpusReserved: true } : { hasSender: true }),
          messageType,
          hasText: messageText !== null,
          hasImage: imageMedia !== null,
          hasAudio: audioMedia !== null,
          hasVideo: videoMedia !== null,
          hasReaction: reactionData !== null,
          reactionEmoji: reactionData?.emoji,
          hasButton: buttonResponse !== null,
          buttonId: buttonResponse?.buttonId,
        },
        'Extracted message details from webhook payload'
      );

      // Validate message type
      const supportedTypes = ['text', 'image', 'audio', 'video', 'reaction', 'button', 'interactive'];
      if (messageType === null || !supportedTypes.includes(messageType)) {
        logger.info(
          { eventId: savedEvent.id, messageType },
          'Ignoring unsupported message type'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'UNSUPPORTED_MESSAGE_TYPE',
            message: `Only text, image, audio, video, reaction, button, and interactive messages are supported. Received: ${messageType ?? 'unknown'}`,
            details: { messageType },
          },
        });
        return;
      }

      // Validate message content
      if (messageType === 'text' && messageText === null) {
        logger.info({ eventId: savedEvent.id }, 'Ignoring text message without body');
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'EMPTY_TEXT_MESSAGE',
            message: 'Text message has no body',
          },
        });
        return;
      }

      if (messageType === 'image' && imageMedia === null) {
        logger.info({ eventId: savedEvent.id }, 'Ignoring image message without media info');
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'NO_IMAGE_MEDIA',
            message: 'Image message has no media info',
          },
        });
        return;
      }

      if (messageType === 'audio' && audioMedia === null) {
        logger.info({ eventId: savedEvent.id }, 'Ignoring audio message without media info');
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'NO_AUDIO_MEDIA',
            message: 'Audio message has no media info',
          },
        });
        return;
      }

      if (messageType === 'video' && videoMedia === null) {
        logger.info({ eventId: savedEvent.id }, 'Ignoring video message without media info');
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'NO_VIDEO_MEDIA',
            message: 'Video message has no media info',
          },
        });
        return;
      }

      if (messageType === 'reaction' && reactionData === null) {
        logger.info({ eventId: savedEvent.id }, 'Ignoring reaction message without data');
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'NO_REACTION_DATA',
            message: 'Reaction message has no data',
          },
        });
        return;
      }

      if ((messageType === 'button' || messageType === 'interactive') && buttonResponse === null) {
        logger.info(
          { eventId: savedEvent.id, messageType },
          'Ignoring button/interactive message without data'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'NO_BUTTON_DATA',
            /* v8 ignore start -- ts-type: ternary branch within covered line not tracked by v8 coverage @preserve */
            message: `${messageType === 'interactive' ? 'Interactive' : 'Button'} message has no button_reply data`,
            /* v8 ignore stop @preserve */
          },
        });
        return;
      }

      // Look up user by phone number
      logger.info(
        {
          eventId: savedEvent.id,
          ...(isMatrixCorpusReserved ? { matrixCorpusReserved: true } : { hasSender: true }),
        },
        'Looking up user by phone number'
      );

      const userIdResult = await userMappingRepository.findUserByPhoneNumber(fromNumber);
      if (!userIdResult.ok) {
        logger.error(
          isMatrixCorpusReserved
            ? {
                eventId: savedEvent.id,
                matrixCorpusReserved: true,
                reason: 'mapping_lookup_failed',
              }
            : { eventId: savedEvent.id, error: userIdResult.error },
          'Failed to look up user by phone number'
        );
        const failureDetails = isMatrixCorpusReserved
          ? 'Matrix corpus user mapping lookup failed'
          : userIdResult.error.message;
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
          failureDetails,
          retryable: true,
        });
        return { ok: false, retryable: true, failureDetails };
      }

      if (userIdResult.value === null) {
        logger.info(
          {
            eventId: savedEvent.id,
            ...(isMatrixCorpusReserved ? { matrixCorpusReserved: true } : { hasSender: true }),
          },
          'No user mapping found for phone number'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'user_unmapped', {
          ignoredReason: isMatrixCorpusReserved
            ? {
                code: 'user_unmapped',
                message: 'No user mapping found for Matrix corpus transport',
              }
            : {
                code: 'user_unmapped',
                message: `No user mapping found for phone number: ${fromNumber}`,
                details: { phoneNumber: fromNumber },
              },
        });
        return;
      }

      const userId = userIdResult.value;

      logger.info(
        {
          eventId: savedEvent.id,
          ...(isMatrixCorpusReserved
            ? { matrixCorpusReserved: true }
            : { hasSender: true, userId }),
        },
        'User mapping found for phone number'
      );

      // Check if user mapping is connected
      let mappingResult: Awaited<ReturnType<typeof userMappingRepository.getMapping>>;
      try {
        mappingResult = await userMappingRepository.getMapping(userId);
      } catch (error) {
        const failureDetails = isMatrixCorpusReserved
          ? 'Matrix corpus user mapping lookup failed'
          : getErrorMessage(error);
        logger.error(
          isMatrixCorpusReserved
            ? {
                eventId: savedEvent.id,
                matrixCorpusReserved: true,
                reason: 'mapping_load_failed',
              }
            : { eventId: savedEvent.id, userId, error },
          'Failed to load user mapping'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
          failureDetails,
          retryable: true,
        });
        return { ok: false, retryable: true, failureDetails };
      }

      if (!mappingResult.ok) {
        const failureDetails = isMatrixCorpusReserved
          ? 'Matrix corpus user mapping lookup failed'
          : mappingResult.error.message;
        logger.error(
          isMatrixCorpusReserved
            ? {
                eventId: savedEvent.id,
                matrixCorpusReserved: true,
                reason: 'mapping_load_failed',
              }
            : { eventId: savedEvent.id, userId, error: mappingResult.error },
          'Failed to load user mapping'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
          failureDetails,
          retryable: true,
        });
        return { ok: false, retryable: true, failureDetails };
      }

      if (mappingResult.value?.connected !== true) {
        logger.info(
          {
            eventId: savedEvent.id,
            ...(isMatrixCorpusReserved ? { matrixCorpusReserved: true } : { userId }),
          },
          'User mapping exists but is disconnected'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'user_unmapped', {
          ignoredReason: {
            code: 'USER_DISCONNECTED',
            message: 'User mapping exists but is disconnected',
            ...(isMatrixCorpusReserved ? {} : { details: { userId } }),
          },
        });
        return;
      }

      // Extract common message details
      const waMessageId = extractMessageId(payload) ?? `unknown-${savedEvent.id}`;
      const toNumber = extractDisplayPhoneNumber(payload) ?? '';
      const timestamp = extractMessageTimestamp(payload) ?? '';
      const senderName = extractSenderName(payload);
      const phoneNumberId = extractPhoneNumberId(payload);

      // Route to appropriate handler
      logger.info(
        {
          eventId: savedEvent.id,
          messageType,
          ...(isMatrixCorpusReserved
            ? { matrixCorpusReserved: true }
            : { userId, waMessageId }),
        },
        'Routing message to handler'
      );

      if (messageType === 'image' && imageMedia !== null) {
        await this.handleImageMessage(
          payload,
          savedEvent,
          userId,
          waMessageId,
          fromNumber,
          toNumber,
          timestamp,
          senderName,
          phoneNumberId,
          imageMedia,
          logger
        );
        return;
      }

      if (messageType === 'audio' && audioMedia !== null) {
        await this.handleAudioMessage(
          payload,
          savedEvent,
          userId,
          waMessageId,
          fromNumber,
          toNumber,
          timestamp,
          senderName,
          phoneNumberId,
          audioMedia,
          logger
        );
        return;
      }

      if (messageType === 'video' && videoMedia !== null) {
        await this.handleVideoMessage(
          payload,
          savedEvent,
          userId,
          waMessageId,
          fromNumber,
          toNumber,
          timestamp,
          senderName,
          phoneNumberId,
          videoMedia,
          logger
        );
        return;
      }

      if (messageType === 'reaction' && reactionData !== null) {
        logger.info(
          { eventId: savedEvent.id, emoji: reactionData.emoji },
          'Ignoring reaction message because Intex supports text messages only'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'REACTION_NOT_SUPPORTED',
            message: 'Reactions are not supported by Intex yet. Please send text for now.',
            details: { emoji: reactionData.emoji },
          },
        });
        return;
      }

      if ((messageType === 'button' || messageType === 'interactive') && buttonResponse !== null) {
        await this.handleButtonMessage(
          payload,
          savedEvent,
          userId,
          waMessageId,
          fromNumber,
          timestamp,
          buttonResponse,
          logger
        );
        return;
      }

      // Handle text message
      await this.handleTextMessage(
        payload,
        savedEvent,
        userId,
        waMessageId,
        fromNumber,
        toNumber,
        timestamp,
        senderName,
        phoneNumberId,
        /* v8 ignore start -- ts-type: nullish coalescing fallback unreachable because prior check guarantees messageText is defined @preserve */
        messageText ?? '',
        /* v8 ignore stop @preserve */
        logger
      );
    } catch (error) {
      if (error instanceof RetryableWebhookProcessingError) {
        logger.error(
          {
            eventId: savedEvent.id,
            error: error.message,
          },
          'Retryable webhook processing failure'
        );
        return { ok: false, retryable: true, failureDetails: error.message };
      }

      const failureDetails = isMatrixCorpusReserved
        ? 'Unexpected Matrix corpus webhook processing failure'
        : `Unexpected error: ${getErrorMessage(error)}`;
      logger.error(
        isMatrixCorpusReserved
          ? {
              eventId: savedEvent.id,
              matrixCorpusReserved: true,
              reason: 'unexpected_processing_failure',
            }
          : {
              eventId: savedEvent.id,
              error: getErrorMessage(error),
            },
        'Unexpected error during asynchronous webhook processing'
      );
      // Update event status so it's not stuck in 'pending' forever
      await this.deps.webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails,
        retryable: false,
      });
      return {
        ok: false,
        retryable: false,
        failureDetails,
      };
    }
    return undefined;
  }

  /**
   * Handle image message using ProcessImageMessageUseCase.
   */
  private async handleImageMessage(
    payload: WebhookPayload,
    savedEvent: { id: string },
    userId: string,
    waMessageId: string,
    fromNumber: string,
    toNumber: string,
    timestamp: string,
    senderName: string | null,
    phoneNumberId: string | null,
    imageMedia: { id: string; mimeType: string; sha256?: string; caption?: string },
    logger: Logger
  ): Promise<void> {
    const {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      thumbnailGenerator,
      eventPublisher,
    } = this.deps;

    const usecase = new ProcessImageMessageUseCase({
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      thumbnailGenerator,
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
      logger
    );

    if (!result.ok) {
      return;
    }

    const sourceUrlResult = await mediaStorage.getSignedUrl(result.value.gcsPath);
    if (!sourceUrlResult.ok) {
      const failureDetails = `Failed to create image source URL for intex ingest: ${sourceUrlResult.error.message}`;
      logger.error(
        { eventId: savedEvent.id, error: sourceUrlResult.error },
        'Failed to create image source URL for intex ingest'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails,
        retryable: true,
      });
      throw new RetryableWebhookProcessingError(failureDetails);
    }

    const ingestPublishResult = await eventPublisher.publishIntexMessageIngest({
      type: 'intex.message.ingest',
      userId,
      messageId: waMessageId,
      sourceType: 'whatsapp_image',
      text: imageMedia.caption ?? '',
      whatsappSender: fromNumber,
      sourceUrl: sourceUrlResult.value,
      timestamp,
    });

    if (!ingestPublishResult.ok) {
      const failureDetails = `Failed to publish intex image ingest: ${ingestPublishResult.error.message}`;
      logger.error(
        { eventId: savedEvent.id, error: ingestPublishResult.error },
        'Failed to publish intex.message.ingest image event'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails,
        retryable: true,
      });
      throw new RetryableWebhookProcessingError(failureDetails);
    }

    await this.markMessageAsReadWithTyping(payload, savedEvent, logger);
  }

  /**
   * Handle audio/voice messages by storing media and handing it to transcription.
   */
  private async handleAudioMessage(
    payload: WebhookPayload,
    savedEvent: { id: string },
    userId: string,
    waMessageId: string,
    fromNumber: string,
    toNumber: string,
    timestamp: string,
    senderName: string | null,
    phoneNumberId: string | null,
    audioMedia: { id: string; mimeType: string; sha256?: string },
    logger: Logger
  ): Promise<void> {
    const {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    } = this.deps;

    const usecase = new ProcessAudioMessageUseCase({
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    });

    const processResult = await usecase.execute(
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
      logger
    );

    if (!processResult.ok) {
      return;
    }

    if (phoneNumberId !== null) {
      await this.markMessageAsReadWithTyping(payload, savedEvent, logger);
    } else {
      logger.info(
        { eventId: savedEvent.id },
        'Cannot mark audio message as read with typing because phoneNumberId is missing'
      );
    }
  }

  /**
   * Handle video messages by storing media and handing it to transcription.
   */
  private async handleVideoMessage(
    payload: WebhookPayload,
    savedEvent: { id: string },
    userId: string,
    waMessageId: string,
    fromNumber: string,
    toNumber: string,
    timestamp: string,
    senderName: string | null,
    phoneNumberId: string | null,
    videoMedia: { id: string; mimeType: string; sha256?: string; caption?: string },
    logger: Logger
  ): Promise<void> {
    const {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    } = this.deps;

    const usecase = new ProcessVideoMessageUseCase({
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    });

    const processResult = await usecase.execute(
      {
        eventId: savedEvent.id,
        userId,
        waMessageId,
        fromNumber,
        toNumber,
        timestamp,
        senderName,
        phoneNumberId,
        videoMedia,
      },
      logger
    );

    if (!processResult.ok) {
      return;
    }

    if (phoneNumberId !== null) {
      await this.markMessageAsReadWithTyping(payload, savedEvent, logger);
    } else {
      logger.info(
        { eventId: savedEvent.id },
        'Cannot mark video message as read with typing because phoneNumberId is missing'
      );
    }
  }

  /**
   * Handle button messages while Intex is text-only.
   */
  private async handleButtonMessage(
    payload: WebhookPayload,
    savedEvent: { id: string },
    userId: string,
    waMessageId: string,
    fromNumber: string,
    timestamp: string,
    buttonResponse: { buttonId: string; buttonTitle: string; replyToWamid: string },
    logger: Logger
  ): Promise<void> {
    const { webhookEventRepository, eventPublisher } = this.deps;

    if (buttonResponse.buttonId.startsWith('intex_confirm:')) {
      logger.info(
        {
          eventId: savedEvent.id,
          userId,
          buttonId: buttonResponse.buttonId,
          buttonTitle: buttonResponse.buttonTitle,
          replyToWamid: buttonResponse.replyToWamid,
        },
        'Publishing Intex confirmation button response'
      );

      const ingestPublishResult = await eventPublisher.publishIntexMessageIngest({
        type: 'intex.message.ingest',
        userId,
        messageId: waMessageId,
        sourceType: 'whatsapp_button',
        text: '',
        whatsappSender: fromNumber,
        buttonResponse,
        timestamp,
      });

      if (!ingestPublishResult.ok) {
        const failureDetails = `Failed to publish intex message ingest: ${ingestPublishResult.error.message}`;
        logger.error(
          { eventId: savedEvent.id, error: ingestPublishResult.error },
          'Failed to publish intex.message.ingest button event'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
          failureDetails,
          retryable: true,
        });
        throw new RetryableWebhookProcessingError(failureDetails);
      }

      await this.markMessageAsReadWithTyping(payload, savedEvent, logger);
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {});
      return;
    }

    logger.info(
      {
        eventId: savedEvent.id,
        userId,
        buttonId: buttonResponse.buttonId,
        buttonTitle: buttonResponse.buttonTitle,
        replyToWamid: buttonResponse.replyToWamid,
      },
      'Ignoring button message because Intex is text-only'
    );
    await this.markMessageAsReadOnly(payload, savedEvent, logger);
    await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
      ignoredReason: {
        code: 'BUTTON_NOT_SUPPORTED',
        message: 'Interactive button replies are not supported by Intex yet. Please send text for now.',
        details: { userId, buttonId: buttonResponse.buttonId },
      },
    });
  }

  /**
   * Handle text message (direct save without usecase - simple enough).
   */
  private async handleTextMessage(
    payload: WebhookPayload,
    savedEvent: { id: string },
    userId: string,
    waMessageId: string,
    fromNumber: string,
    toNumber: string,
    timestamp: string,
    senderName: string | null,
    phoneNumberId: string | null,
    messageText: string,
    logger: Logger
  ): Promise<void> {
    const { webhookEventRepository, messageRepository, eventPublisher } = this.deps;

    const matrixCorpusMessage = parseMatrixCorpusVisibleMessage(messageText);
    if (matrixCorpusMessage.kind === 'reserved_malformed') {
      const statusResult = await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'MATRIX_CORPUS_RESERVED_HEADER_REJECTED',
          message: 'Reserved Matrix corpus header rejected',
        },
      });
      if (!statusResult.ok) {
        throw new RetryableWebhookProcessingError('Failed to record Matrix corpus terminal status');
      }
      return;
    }
    if (matrixCorpusMessage.kind === 'matrix_corpus') {
      const matrixCorpusIngress = this.deps.matrixCorpusIngress ?? notReadyMatrixCorpusIngress;
      let ingressResult: unknown;
      try {
        ingressResult = await matrixCorpusIngress.consumeReservedMessage({
          message: matrixCorpusMessage,
          userId,
          transportMessageId: waMessageId,
          webhookEventId: savedEvent.id,
          senderPhoneNumber: fromNumber,
          recipientPhoneNumber: toNumber,
          whatsappAccountId: phoneNumberId,
          timestamp,
        });
      } catch {
        throw new RetryableWebhookProcessingError('Matrix corpus ingress failed');
      }
      const parsedIngressResult = matrixCorpusReservedIngressResultSchema.safeParse(ingressResult);
      if (!parsedIngressResult.success) {
        throw new RetryableWebhookProcessingError('Matrix corpus ingress returned invalid state');
      }
      const accepted =
        parsedIngressResult.data.code === 'INGEST_ENQUEUED' ||
        parsedIngressResult.data.code === 'ALREADY_APPLIED';
      const statusResult = accepted
        ? await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {})
        : await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
            ignoredReason:
              parsedIngressResult.data.code === 'NOT_READY'
                ? {
                    code: 'MATRIX_CORPUS_CONTROL_PLANE_NOT_READY',
                    message: 'Matrix corpus control plane is not ready',
                  }
                : {
                    code: 'MATRIX_CORPUS_INGRESS_REJECTED',
                    message: 'Matrix corpus ingress rejected',
                  },
          });
      if (!statusResult.ok) {
        throw new RetryableWebhookProcessingError('Failed to record Matrix corpus terminal status');
      }
      return;
    }

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
    /* v8 ignore start -- ts-type: webhook payloads always include contacts with senderName and phoneNumberId @preserve */
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
    /* v8 ignore stop @preserve */

    const existingMessageResult = await messageRepository.findByWaMessageId(userId, waMessageId);
    if (!existingMessageResult.ok) {
      logger.error(
        { error: existingMessageResult.error, eventId: savedEvent.id, waMessageId },
        'Failed to look up existing message by WhatsApp message ID'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails: `Failed to look up existing message: ${existingMessageResult.error.message}`,
        retryable: true,
      });
      throw new RetryableWebhookProcessingError(
        `Failed to look up existing message: ${existingMessageResult.error.message}`
      );
    }

    let savedMessage = existingMessageResult.value;

    if (savedMessage === null) {
      const saveResult = await messageRepository.saveMessage(messageToSave);

      if (!saveResult.ok) {
        logger.error(
          { error: saveResult.error, eventId: savedEvent.id },
          'Failed to save message'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
          failureDetails: `Failed to save message: ${saveResult.error.message}`,
          retryable: true,
        });
        throw new RetryableWebhookProcessingError(
          `Failed to save message: ${saveResult.error.message}`
        );
      }

      savedMessage = saveResult.value;
    } else {
      logger.info(
        { eventId: savedEvent.id, userId, messageId: savedMessage.id, waMessageId },
        'Reusing existing text message for webhook replay'
      );
    }

    logger.info(
      { eventId: savedEvent.id, userId, messageId: savedMessage.id },
      'Text message saved to database'
    );

    logger.info(
      { eventId: savedEvent.id, userId, messageId: savedMessage.id },
      'Publishing intex.message.ingest event'
    );

    const replyContext = await this.resolveReplyContext(payload, savedEvent.id, userId, logger);
    const ingestPublishResult = await eventPublisher.publishIntexMessageIngest({
      type: 'intex.message.ingest',
      userId,
      messageId: waMessageId,
      sourceType: 'whatsapp_text',
      text: messageText,
      whatsappSender: fromNumber,
      ...(replyContext !== undefined ? { replyContext } : {}),
      timestamp,
    });

    if (!ingestPublishResult.ok) {
      const failureDetails = `Failed to publish intex message ingest: ${ingestPublishResult.error.message}`;
      logger.error(
        { eventId: savedEvent.id, error: ingestPublishResult.error },
        'Failed to publish intex.message.ingest event'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails,
        retryable: true,
      });
      throw new RetryableWebhookProcessingError(failureDetails);
    }

    await this.markMessageAsReadWithTyping(payload, savedEvent, logger);

    // Publish link preview extraction event to Pub/Sub
    const linkPreviewPublishResult = await eventPublisher.publishExtractLinkPreviews({
      type: 'whatsapp.linkpreview.extract',
      messageId: savedMessage.id,
      userId,
      text: messageText,
    });

    if (!linkPreviewPublishResult.ok) {
      logger.error(
        { eventId: savedEvent.id, error: linkPreviewPublishResult.error },
        'Failed to publish link preview extraction event'
      );
    }

    logger.info(
      { eventId: savedEvent.id, userId, messageId: savedMessage.id },
      'Text message processing completed successfully'
    );

    await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {});
  }

  private async resolveReplyContext(
    payload: WebhookPayload,
    eventId: string,
    userId: string,
    logger: Logger
  ): Promise<IntexMessageReplyContext | undefined> {
    const context = extractReplyContext(payload);
    if (context === null) {
      return undefined;
    }

    const { messageRepository, outboundMessageRepository } = this.deps;
    const inboundResult = await messageRepository.findByWaMessageId(userId, context.replyToWamid);
    if (inboundResult.ok) {
      const inboundContextText =
        inboundResult.value === null ? undefined : getInboundReplyContextText(inboundResult.value);
      if (inboundContextText !== undefined) {
        return buildReplyContext(
          context.replyToWamid,
          'inbound_user_message',
          inboundContextText
        );
      }
    } else {
      logger.info(
        { eventId, error: inboundResult.error, replyToWamid: context.replyToWamid },
        'Failed to resolve inbound WhatsApp reply context'
      );
    }

    const outboundResult = await outboundMessageRepository.findByWamid(context.replyToWamid);
    if (outboundResult.ok) {
      const outbound = outboundResult.value;
      const outboundMessageText = outbound?.messageText;
      if (
        outbound?.userId === userId &&
        typeof outboundMessageText === 'string' &&
        outboundMessageText.trim() !== ''
      ) {
        return buildReplyContext(
          context.replyToWamid,
          'outbound_assistant_message',
          outboundMessageText
        );
      }
    } else {
      logger.info(
        { eventId, error: outboundResult.error, replyToWamid: context.replyToWamid },
        'Failed to resolve outbound WhatsApp reply context'
      );
    }

    return undefined;
  }

  /** Mark an ignored message as read without suggesting that Intex will answer it. */
  private async markMessageAsReadOnly(
    payload: WebhookPayload,
    savedEvent: { id: string },
    logger: Logger
  ): Promise<void> {
    const originalMessageId = extractMessageId(payload);
    const phoneNumberId = extractPhoneNumberId(payload);

    if (phoneNumberId !== null && originalMessageId !== null) {
      const markResult = await this.deps.whatsappCloudApi.markAsRead(
        phoneNumberId,
        originalMessageId
      );

      if (markResult.ok) {
        logger.info(
          { eventId: savedEvent.id, messageId: originalMessageId },
          'Marked message as read'
        );
      } else {
        logger.error(
          { eventId: savedEvent.id, error: markResult.error, messageId: originalMessageId },
          'Failed to mark message as read'
        );
      }
    }
  }

  /**
   * Mark an accepted message as read and show the typing indicator while Intex prepares a reply.
   */
  private async markMessageAsReadWithTyping(
    payload: WebhookPayload,
    savedEvent: { id: string },
    logger: Logger
  ): Promise<void> {
    const originalMessageId = extractMessageId(payload);
    const phoneNumberId = extractPhoneNumberId(payload);

    if (phoneNumberId !== null && originalMessageId !== null) {
      const { whatsappCloudApi } = this.deps;

      const markResult = await whatsappCloudApi.markAsReadWithTyping(
        phoneNumberId,
        originalMessageId
      );

      if (markResult.ok) {
        logger.info(
          { eventId: savedEvent.id, messageId: originalMessageId },
          'Marked message as read with typing indicator'
        );
      } else {
        logger.error(
          { eventId: savedEvent.id, error: markResult.error, messageId: originalMessageId },
          'Failed to mark message as read with typing indicator'
        );
      }
    }
  }
}

function getInboundReplyContextText(message: WhatsAppMessage): string | undefined {
  if (message.text.trim() !== '') {
    return message.text;
  }

  if (
    message.mediaType === 'audio' &&
    message.transcription?.status === 'completed' &&
    message.transcription.text?.trim() !== ''
  ) {
    return message.transcription.text;
  }

  return undefined;
}

function buildReplyContext(
  replyToWamid: string,
  source: IntexMessageReplyContext['source'],
  text: string
): IntexMessageReplyContext {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= MAX_REPLY_CONTEXT_TEXT_LENGTH) {
    return { replyToWamid, source, text: normalized, truncated: false };
  }

  return {
    replyToWamid,
    source,
    text: `${normalized.slice(0, MAX_REPLY_CONTEXT_TEXT_LENGTH - 3)}...`,
    truncated: true,
  };
}
