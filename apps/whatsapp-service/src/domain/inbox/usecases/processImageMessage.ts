/**
 * Use case for processing image messages from WhatsApp.
 *
 * Handles the complete flow:
 * 1. Get media URL from WhatsApp
 * 2. Download image
 * 3. Generate thumbnail
 * 4. Upload original and thumbnail to GCS
 * 5. Save message to Firestore
 * 6. Update webhook event status
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { InboxError } from '../models/InboxNote.js';
import type { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import type {
  WhatsAppMessageRepository,
  WhatsAppWebhookEventRepository,
} from '../ports/repositories.js';
import type { MediaStoragePort } from '../ports/mediaStorage.js';
import type { WhatsAppCloudApiPort } from '../ports/whatsappCloudApi.js';
import type { ThumbnailGeneratorPort } from '../ports/thumbnailGenerator.js';

/**
 * Image media information from webhook payload.
 */
export interface ImageMediaInfo {
  id: string;
  mimeType: string;
  sha256?: string;
  caption?: string;
}

/**
 * Input for processing an image message.
 */
export interface ProcessImageMessageInput {
  eventId: string;
  userId: string;
  waMessageId: string;
  fromNumber: string;
  toNumber: string;
  timestamp: string;
  senderName: string | null;
  phoneNumberId: string | null;
  imageMedia: ImageMediaInfo;
}

/**
 * Result of processing an image message.
 */
export interface ProcessImageMessageResult {
  messageId: string;
  gcsPath: string;
  thumbnailGcsPath: string;
}

/**
 * Logger interface for the use case.
 */
export interface ProcessImageMessageLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

/**
 * Dependencies for ProcessImageMessageUseCase.
 */
export interface ProcessImageMessageDeps {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  messageRepository: WhatsAppMessageRepository;
  mediaStorage: MediaStoragePort;
  whatsappCloudApi: WhatsAppCloudApiPort;
  thumbnailGenerator: ThumbnailGeneratorPort;
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
  };
  return mimeToExt[mimeType] ?? 'bin';
}

/**
 * Use case for processing image messages.
 */
export class ProcessImageMessageUseCase {
  constructor(private readonly deps: ProcessImageMessageDeps) {}

  /**
   * Process an image message.
   *
   * @param input - Image message details
   * @param logger - Logger for tracking progress
   * @returns Processed message info or error
   */
  async execute(
    input: ProcessImageMessageInput,
    logger: ProcessImageMessageLogger
  ): Promise<Result<ProcessImageMessageResult, InboxError>> {
    const {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      thumbnailGenerator,
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
      imageMedia,
    } = input;

    // Step 1: Get media URL from WhatsApp
    logger.info(
      { event: 'image_get_url', eventId, mediaId: imageMedia.id },
      'Fetching image URL from WhatsApp'
    );

    const mediaUrlResult = await whatsappCloudApi.getMediaUrl(imageMedia.id);
    if (!mediaUrlResult.ok) {
      const failureDetails = `Failed to get media URL: ${mediaUrlResult.error.message}`;
      logger.error(
        {
          event: 'image_get_url_failed',
          error: mediaUrlResult.error,
          eventId,
          mediaId: imageMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(mediaUrlResult.error);
    }

    // Step 2: Download the image
    logger.info(
      { event: 'image_download', eventId, mediaId: imageMedia.id },
      'Downloading image from WhatsApp'
    );

    const downloadResult = await whatsappCloudApi.downloadMedia(mediaUrlResult.value.url);
    if (!downloadResult.ok) {
      const failureDetails = `Failed to download media: ${downloadResult.error.message}`;
      logger.error(
        {
          event: 'image_download_failed',
          error: downloadResult.error,
          eventId,
          mediaId: imageMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(downloadResult.error);
    }

    const imageBuffer = downloadResult.value;
    const extension = getExtensionFromMimeType(imageMedia.mimeType);

    // Step 3: Generate thumbnail
    logger.info(
      { event: 'image_thumbnail', eventId, mediaId: imageMedia.id },
      'Generating thumbnail'
    );

    const thumbnailResult = await thumbnailGenerator.generate(imageBuffer);
    if (!thumbnailResult.ok) {
      const failureDetails = `Failed to generate thumbnail: ${thumbnailResult.error.message}`;
      logger.error(
        {
          event: 'image_thumbnail_failed',
          error: thumbnailResult.error,
          eventId,
          mediaId: imageMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(thumbnailResult.error);
    }

    // Step 4: Upload original image to GCS
    logger.info(
      { event: 'image_upload', eventId, mediaId: imageMedia.id },
      'Uploading image to GCS'
    );

    const uploadResult = await mediaStorage.upload(
      userId,
      waMessageId,
      imageMedia.id,
      extension,
      imageBuffer,
      imageMedia.mimeType
    );

    if (!uploadResult.ok) {
      const failureDetails = `Failed to upload image: ${uploadResult.error.message}`;
      logger.error(
        {
          event: 'image_upload_failed',
          error: uploadResult.error,
          eventId,
          mediaId: imageMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(uploadResult.error);
    }

    // Step 5: Upload thumbnail to GCS
    logger.info(
      { event: 'image_thumbnail_upload', eventId, mediaId: imageMedia.id },
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
      const failureDetails = `Failed to upload thumbnail: ${thumbnailUploadResult.error.message}`;
      logger.error(
        {
          event: 'image_thumbnail_upload_failed',
          error: thumbnailUploadResult.error,
          eventId,
          mediaId: imageMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(thumbnailUploadResult.error);
    }

    // Step 6: Save message to Firestore
    const messageToSave: Omit<WhatsAppMessage, 'id'> = {
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
      webhookEventId: eventId,
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
      const failureDetails = `Failed to save message: ${saveResult.error.message}`;
      logger.error(
        { event: 'image_save_failed', error: saveResult.error, eventId },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(saveResult.error);
    }

    // Update webhook event status to PROCESSED
    await webhookEventRepository.updateEventStatus(eventId, 'PROCESSED', {});

    logger.info(
      {
        event: 'image_processed',
        eventId,
        userId,
        messageId: saveResult.value.id,
        gcsPath: uploadResult.value.gcsPath,
        thumbnailGcsPath: thumbnailUploadResult.value.gcsPath,
      },
      'Image message saved successfully'
    );

    return ok({
      messageId: saveResult.value.id,
      gcsPath: uploadResult.value.gcsPath,
      thumbnailGcsPath: thumbnailUploadResult.value.gcsPath,
    });
  }
}
