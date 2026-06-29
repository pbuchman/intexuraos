/**
 * Use case for processing video messages from WhatsApp.
 *
 * Handles the complete flow:
 * 1. Get media URL from WhatsApp
 * 2. Download video
 * 3. Upload video to GCS
 * 4. Save message to Firestore
 * 5. Publish media transcription request
 * 6. Update webhook event status
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import type {
  WhatsAppMessageRepository,
  WhatsAppWebhookEventRepository,
} from '../ports/repositories.js';
import type { MediaStoragePort } from '../ports/mediaStorage.js';
import type { WhatsAppCloudApiPort } from '../ports/whatsappCloudApi.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { Logger } from '../utils/logger.js';
import { getExtensionFromMimeType } from '../utils/mimeType.js';

/**
 * Video media information from webhook payload.
 */
export interface VideoMediaInfo {
  id: string;
  mimeType: string;
  sha256?: string;
  caption?: string;
}

/**
 * Input for processing a video message.
 */
export interface ProcessVideoMessageInput {
  eventId: string;
  userId: string;
  waMessageId: string;
  fromNumber: string;
  toNumber: string;
  timestamp: string;
  senderName: string | null;
  phoneNumberId: string | null;
  videoMedia: VideoMediaInfo;
}

/**
 * Result of processing a video message.
 */
export interface ProcessVideoMessageResult {
  messageId: string;
  gcsPath: string;
  mimeType: string;
  mediaId: string;
}

/**
 * Logger for the use case.
 */
export type ProcessVideoMessageLogger = Logger;

/**
 * Dependencies for ProcessVideoMessageUseCase.
 */
export interface ProcessVideoMessageDeps {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  messageRepository: WhatsAppMessageRepository;
  mediaStorage: MediaStoragePort;
  whatsappCloudApi: WhatsAppCloudApiPort;
  eventPublisher: EventPublisherPort;
}

/**
 * Use case for processing video messages.
 */
export class ProcessVideoMessageUseCase {
  constructor(private readonly deps: ProcessVideoMessageDeps) {}

  async execute(
    input: ProcessVideoMessageInput,
    logger: ProcessVideoMessageLogger
  ): Promise<Result<ProcessVideoMessageResult, WhatsAppError>> {
    const {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    } = this.deps;

    const {
      eventId,
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      timestamp,
      senderName,
      phoneNumberId,
      videoMedia,
    } = input;

    logger.info(
      { event: 'video_get_url', eventId, mediaId: videoMedia.id },
      'Fetching video URL from WhatsApp'
    );

    const mediaUrlResult = await whatsappCloudApi.getMediaUrl(videoMedia.id);
    if (!mediaUrlResult.ok) {
      const failureDetails = `Failed to get video URL: ${mediaUrlResult.error.message}`;
      logger.error(
        {
          event: 'video_get_url_failed',
          error: mediaUrlResult.error,
          eventId,
          mediaId: videoMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'failed', { failureDetails });
      return err(mediaUrlResult.error);
    }

    logger.info(
      { event: 'video_download', eventId, mediaId: videoMedia.id },
      'Downloading video from WhatsApp'
    );

    const downloadResult = await whatsappCloudApi.downloadMedia(mediaUrlResult.value.url);
    if (!downloadResult.ok) {
      const failureDetails = `Failed to download video: ${downloadResult.error.message}`;
      logger.error(
        {
          event: 'video_download_failed',
          error: downloadResult.error,
          eventId,
          mediaId: videoMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'failed', { failureDetails });
      return err(downloadResult.error);
    }

    const videoBuffer = downloadResult.value;
    const extension = getExtensionFromMimeType(videoMedia.mimeType);

    logger.info(
      { event: 'video_upload', eventId, mediaId: videoMedia.id },
      'Uploading video to GCS'
    );

    const uploadResult = await mediaStorage.upload(
      userId,
      waMessageId,
      videoMedia.id,
      extension,
      videoBuffer,
      videoMedia.mimeType
    );

    if (!uploadResult.ok) {
      const failureDetails = `Failed to upload video: ${uploadResult.error.message}`;
      logger.error(
        {
          event: 'video_upload_failed',
          error: uploadResult.error,
          eventId,
          mediaId: videoMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'failed', { failureDetails });
      return err(uploadResult.error);
    }

    const messageToSave: Omit<WhatsAppMessage, 'id'> = {
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      text: videoMedia.caption ?? '',
      mediaType: 'video',
      media: {
        id: videoMedia.id,
        mimeType: videoMedia.mimeType,
        fileSize: videoBuffer.length,
      },
      gcsPath: uploadResult.value.gcsPath,
      timestamp,
      receivedAt: new Date().toISOString(),
      webhookEventId: eventId,
    };

    if (videoMedia.sha256 !== undefined && messageToSave.media !== undefined) {
      messageToSave.media.sha256 = videoMedia.sha256;
    }

    if (videoMedia.caption !== undefined) {
      messageToSave.caption = videoMedia.caption;
    }

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
      const failureDetails = `Failed to save message: ${saveResult.error.message}`;
      logger.error(
        { event: 'video_save_failed', error: saveResult.error, eventId },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'failed', { failureDetails });
      return err(saveResult.error);
    }

    const publishResult = await eventPublisher.publishMediaTranscriptionRequested({
      type: 'whatsapp.media.transcription.requested',
      messageSource: 'public_whatsapp',
      mediaKind: 'video',
      userId,
      messageId: saveResult.value.id,
      mediaId: videoMedia.id,
      gcsPath: uploadResult.value.gcsPath,
      mimeType: videoMedia.mimeType,
      timestamp: new Date().toISOString(),
    });

    if (!publishResult.ok) {
      const failureDetails = `Failed to publish media transcription request: ${publishResult.error.message}`;
      logger.error(
        { event: 'media_transcription_request_publish_failed', error: publishResult.error, eventId },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'failed', {
        failureDetails,
        retryable: true,
      });
      return err(publishResult.error);
    }

    await webhookEventRepository.updateEventStatus(eventId, 'completed', {});

    logger.info(
      {
        event: 'video_processed',
        eventId,
        userId,
        messageId: saveResult.value.id,
        gcsPath: uploadResult.value.gcsPath,
      },
      'Video message saved successfully'
    );

    return ok({
      messageId: saveResult.value.id,
      gcsPath: uploadResult.value.gcsPath,
      mimeType: videoMedia.mimeType,
      mediaId: videoMedia.id,
    });
  }
}
