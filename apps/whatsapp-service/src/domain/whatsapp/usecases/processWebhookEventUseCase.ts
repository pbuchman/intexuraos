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
import { ProcessImageMessageUseCase } from './processImageMessage.js';
import { ProcessAudioMessageUseCase } from './processAudioMessage.js';
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
} from '../../../routes/shared.js';

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
  async execute(payload: WebhookPayload, savedEvent: { id: string }, logger: Logger): Promise<void> {
    const { webhookEventRepository, userMappingRepository } = this.deps;

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
      const reactionData = extractReactionData(payload);
      const buttonResponse = extractButtonResponse(payload);

      logger.info(
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
      const supportedTypes = ['text', 'image', 'audio', 'reaction', 'button', 'interactive'];
      if (messageType === null || !supportedTypes.includes(messageType)) {
        logger.info(
          { eventId: savedEvent.id, messageType },
          'Ignoring unsupported message type'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'UNSUPPORTED_MESSAGE_TYPE',
            message: `Only text, image, audio, reaction, button, and interactive messages are supported. Received: ${messageType ?? 'unknown'}`,
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
      logger.info({ eventId: savedEvent.id, fromNumber }, 'Looking up user by phone number');

      const userIdResult = await userMappingRepository.findUserByPhoneNumber(fromNumber);
      if (!userIdResult.ok) {
        logger.error(
          { eventId: savedEvent.id, fromNumber, error: userIdResult.error },
          'Failed to look up user by phone number'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
          failureDetails: userIdResult.error.message,
        });
        return;
      }

      if (userIdResult.value === null) {
        logger.info(
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

      logger.info(
        { eventId: savedEvent.id, fromNumber, userId },
        'User mapping found for phone number'
      );

      // Check if user mapping is connected
      const mappingResult = await userMappingRepository.getMapping(userId);
      if (!mappingResult.ok || mappingResult.value?.connected !== true) {
        logger.info(
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
      const waMessageId = extractMessageId(payload) ?? `unknown-${savedEvent.id}`;
      const toNumber = extractDisplayPhoneNumber(payload) ?? '';
      const timestamp = extractMessageTimestamp(payload) ?? '';
      const senderName = extractSenderName(payload);
      const phoneNumberId = extractPhoneNumberId(payload);

      // Route to appropriate handler
      logger.info(
        {
          eventId: savedEvent.id,
          userId,
          messageType,
          waMessageId,
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

      if (messageType === 'reaction' && reactionData !== null) {
        logger.info(
          { eventId: savedEvent.id, emoji: reactionData.emoji },
          'Ignoring reaction message (approval via buttons only)'
        );
        await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
          ignoredReason: {
            code: 'REACTION_NOT_SUPPORTED',
            message: 'Reactions are no longer used for approvals. Use interactive buttons instead.',
            details: { emoji: reactionData.emoji },
          },
        });
        return;
      }

      if ((messageType === 'button' || messageType === 'interactive') && buttonResponse !== null) {
        await this.handleButtonMessage(payload, savedEvent, userId, buttonResponse, logger);
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
      logger.error(
        {
          eventId: savedEvent.id,
          error: getErrorMessage(error),
        },
        'Unexpected error during asynchronous webhook processing'
      );
      // Update event status so it's not stuck in 'pending' forever
      await this.deps.webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails: `Unexpected error: ${getErrorMessage(error)}`,
      });
    }
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
    const { webhookEventRepository, messageRepository, mediaStorage, whatsappCloudApi, thumbnailGenerator } = this.deps;

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

    if (result.ok) {
      await this.markMessageAsRead(payload, savedEvent, logger);
    }
  }

  /**
   * Handle audio message using ProcessAudioMessageUseCase.
   * Transcription is triggered via Pub/Sub event.
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
    const { webhookEventRepository, messageRepository, mediaStorage, whatsappCloudApi, eventPublisher } = this.deps;

    const usecase = new ProcessAudioMessageUseCase({
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
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
      logger
    );

    if (result.ok) {
      // Publish audio stored event to Pub/Sub for async transcription by srt-service
      const publishResult = await eventPublisher.publishAudioStored({
        type: 'whatsapp.audio.stored',
        userId,
        messageId: result.value.messageId,
        mediaId: result.value.mediaId,
        gcsPath: result.value.gcsPath,
        mimeType: result.value.mimeType,
        timestamp: new Date().toISOString(),
      });

      if (!publishResult.ok) {
        logger.error(
          { error: publishResult.error, messageId: result.value.messageId },
          'Failed to publish audio stored event'
        );
      }

      // Mark as read with typing indicator (shows user something is happening)
      await this.markAudioAsReadWithTyping(payload, savedEvent, whatsappCloudApi, logger);
    }
  }

  /**
   * Handle button message for action approval/rejection.
   *
   * Button responses come from interactive messages with action-specific nonces.
   * Button ID format: "approve:{actionId}:{nonce}" | "cancel:{actionId}" | "convert:{actionId}"
   */
  private async handleButtonMessage(
    payload: WebhookPayload,
    savedEvent: { id: string },
    userId: string,
    buttonResponse: { buttonId: string; buttonTitle: string; replyToWamid: string },
    logger: Logger
  ): Promise<void> {
    const { webhookEventRepository, eventPublisher, whatsappCloudApi } = this.deps;

    // Fire-and-forget: mark as read + show typing indicator
    const originalMessageId = extractMessageId(payload);
    const phoneNumberId = extractPhoneNumberId(payload);
    if (phoneNumberId !== null && originalMessageId !== null) {
      whatsappCloudApi.markAsReadWithTyping(phoneNumberId, originalMessageId).then(
        (result) => {
          if (!result.ok) {
            logger.error(
              { eventId: savedEvent.id, error: result.error, messageId: originalMessageId },
              'Failed to mark button message as read with typing'
            );
          }
        },
        (error: unknown) => {
          logger.error({ error }, 'markAsReadWithTyping threw unexpectedly');
        }
      );
    }

    logger.info(
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
      logger.error(
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
    // Action approval intents: approve, cancel, convert
    // Code task intents: cancel-task (INT-379), view-task (INT-379)
    // Execution intents: proceed-implementation (INT-678)
    const validIntents = [
      'approve',
      'cancel',
      'reject',
      'convert',
      'cancel-task',
      'view-task',
      'proceed-implementation',
    ];
    /* v8 ignore start -- ts-type: intent and validIntents.includes null-coalescing branch unreachable after split @preserve */
    if (!validIntents.includes(intent ?? '')) {
      /* v8 ignore stop @preserve */
      logger.error({ eventId: savedEvent.id, intent }, 'Unknown button intent');
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'ignored', {
        ignoredReason: {
          code: 'UNKNOWN_BUTTON_INTENT',
          message: `Unknown button intent: ${String(intent)}`,
          details: { intent, buttonId: buttonResponse.buttonId },
        },
      });
      return;
    }

    logger.info(
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
    // replyText is a human-readable indicator of the intent
    const intentToReplyText: Record<string, string> = {
      approve: 'yes',
      cancel: 'no',
      reject: 'no',
      convert: 'convert',
      'cancel-task': 'cancel-task',
      'view-task': 'view-task',
      'proceed-implementation': 'proceed-implementation',
    };
    const approvalReplyEvent: Parameters<typeof eventPublisher.publishApprovalReply>[0] = {
      type: 'action.approval.reply',
      replyToWamid: buttonResponse.replyToWamid,
      /* v8 ignore start -- ts-type: intent always defined after Array.split with length >= 2 @preserve */
      replyText: intentToReplyText[intent ?? ''] ?? (intent ?? ''),
      /* v8 ignore stop @preserve */
      userId,
      timestamp: new Date().toISOString(),
      /* v8 ignore start -- ts-type: actionId always defined after Array.split with length >= 2 @preserve */
      actionId: actionId ?? '', // For cancel-task/view-task, this is the taskId
      /* v8 ignore stop @preserve */
      buttonId: buttonResponse.buttonId,
      buttonTitle: buttonResponse.buttonTitle,
    };

    const approvalPublishResult = await eventPublisher.publishApprovalReply(approvalReplyEvent);

    if (!approvalPublishResult.ok) {
      logger.error(
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

    logger.info(
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
    const { webhookEventRepository, messageRepository, outboundMessageRepository, eventPublisher } =
      this.deps;

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

    // Save message to Firestore
    const saveResult = await messageRepository.saveMessage(messageToSave);

    if (!saveResult.ok) {
      logger.error(
        { error: saveResult.error, eventId: savedEvent.id },
        'Failed to save message'
      );
      await webhookEventRepository.updateEventStatus(savedEvent.id, 'failed', {
        failureDetails: `Failed to save message: ${saveResult.error.message}`,
      });
      return;
    }

    const savedMessage = saveResult.value;

    logger.info(
      { eventId: savedEvent.id, userId, messageId: savedMessage.id },
      'Text message saved to database'
    );

    await webhookEventRepository.updateEventStatus(savedEvent.id, 'completed', {});

    // Check if this is a reply to another message (potential approval response)
    const replyContext = extractReplyContext(payload);

    // Declare actionId outside the if block so it's accessible later
    // If actionId is defined, this is a confirmed approval reply and we should skip command.ingest
    let actionId: string | undefined;

    if (replyContext !== null) {
      // This message is a reply - look up the original message to get correlationId
      logger.info(
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
          logger.info(
            { correlationId, actionId },
            'Extracted actionId from correlationId'
          );
        } else {
          logger.info(
            { correlationId, replyToWamid: replyContext.replyToWamid },
            'Outbound message found but correlationId does not match approval pattern'
          );
        }
      } else if (outboundResult.ok) {
        logger.info(
          { replyToWamid: replyContext.replyToWamid },
          'No outbound message found for this wamid (may not be an approval message)'
        );
      } else {
        logger.error(
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
          logger.error(
            {
              eventId: savedEvent.id,
              error: approvalPublishResult.error,
              replyToWamid: replyContext.replyToWamid,
            },
            'Failed to publish approval reply event'
          );
        } else {
          logger.info(
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
      logger.info(
        { eventId: savedEvent.id, actionId, userId },
        'Skipping command.ingest for approval reply with known actionId'
      );
    } else {
      logger.info(
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
        logger.error(
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
      logger.error(
        { eventId: savedEvent.id, error: linkPreviewPublishResult.error },
        'Failed to publish link preview extraction event'
      );
    }

    logger.info(
      { eventId: savedEvent.id, userId, messageId: savedMessage.id },
      'Text message processing completed successfully'
    );

    await this.markMessageAsRead(payload, savedEvent, logger);
  }

  /**
   * Mark the incoming message as read (displays two blue check marks).
   * Used for text and image messages instead of sending a confirmation message.
   */
  private async markMessageAsRead(
    payload: WebhookPayload,
    savedEvent: { id: string },
    logger: Logger
  ): Promise<void> {
    const originalMessageId = extractMessageId(payload);
    const phoneNumberId = extractPhoneNumberId(payload);

    if (phoneNumberId !== null && originalMessageId !== null) {
      const { whatsappCloudApi } = this.deps;

      const markResult = await whatsappCloudApi.markAsRead(phoneNumberId, originalMessageId);

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
   * Mark audio message as read with typing indicator.
   * This shows the user something is happening (typing indicator shows for up to 25s
   * or until the next message is sent).
   */
  private async markAudioAsReadWithTyping(
    payload: WebhookPayload,
    savedEvent: { id: string },
    whatsappCloudApi: WhatsAppCloudApiPort,
    logger: Logger
  ): Promise<void> {
    const originalMessageId = extractMessageId(payload);
    const phoneNumberId = extractPhoneNumberId(payload);

    /* v8 ignore start -- ts-type: audio webhook payloads always include phoneNumberId and messageId @preserve */
    if (phoneNumberId !== null && originalMessageId !== null) {
      /* v8 ignore stop @preserve */
      const result = await whatsappCloudApi.markAsReadWithTyping(phoneNumberId, originalMessageId);

      if (result.ok) {
        logger.info(
          { eventId: savedEvent.id, messageId: originalMessageId },
          'Marked audio message as read with typing indicator'
        );
      } else {
        logger.error(
          { eventId: savedEvent.id, error: result.error, messageId: originalMessageId },
          'Failed to mark audio message as read with typing indicator'
        );
      }
    }
  }
}
