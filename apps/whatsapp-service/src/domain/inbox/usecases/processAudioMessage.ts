/**
 * Use case for processing audio messages from WhatsApp.
 *
 * Handles the complete flow:
 * 1. Get media URL from WhatsApp
 * 2. Download audio
 * 3. Upload to GCS
 * 4. Save message to Firestore
 * 5. Update webhook event status
 *
 * Note: Transcription is handled separately by TranscribeAudioUseCase.
 */
import { ok, err, type Result } from '@intexuraos/common';
import type { InboxError } from '../models/InboxNote.js';
import type { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppMessageRepository,
} from '../ports/repositories.js';
import type { MediaStoragePort } from '../ports/mediaStorage.js';
import type { WhatsAppCloudApiPort } from '../ports/whatsappCloudApi.js';

/**
 * Audio media information from webhook payload.
 */
export interface AudioMediaInfo {
  id: string;
  mimeType: string;
  sha256?: string;
}

/**
 * Input for processing an audio message.
 */
export interface ProcessAudioMessageInput {
  eventId: string;
  userId: string;
  waMessageId: string;
  fromNumber: string;
  toNumber: string;
  timestamp: string;
  senderName: string | null;
  phoneNumberId: string | null;
  audioMedia: AudioMediaInfo;
}

/**
 * Result of processing an audio message.
 */
export interface ProcessAudioMessageResult {
  messageId: string;
  gcsPath: string;
  mimeType: string;
}

/**
 * Logger interface for the use case.
 */
export interface ProcessAudioMessageLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

/**
 * Dependencies for ProcessAudioMessageUseCase.
 */
export interface ProcessAudioMessageDeps {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  messageRepository: WhatsAppMessageRepository;
  mediaStorage: MediaStoragePort;
  whatsappCloudApi: WhatsAppCloudApiPort;
}

/**
 * Get file extension from MIME type.
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
  };
  return mimeToExt[mimeType] ?? 'bin';
}

/**
 * Use case for processing audio messages.
 */
export class ProcessAudioMessageUseCase {
  constructor(private readonly deps: ProcessAudioMessageDeps) {}

  /**
   * Process an audio message.
   *
   * @param input - Audio message details
   * @param logger - Logger for tracking progress
   * @returns Processed message info or error
   */
  async execute(
    input: ProcessAudioMessageInput,
    logger: ProcessAudioMessageLogger
  ): Promise<Result<ProcessAudioMessageResult, InboxError>> {
    const { webhookEventRepository, messageRepository, mediaStorage, whatsappCloudApi } = this.deps;

    const {
      eventId,
      userId,
      waMessageId,
      fromNumber,
      toNumber,
      timestamp,
      senderName,
      phoneNumberId,
      audioMedia,
    } = input;

    // Step 1: Get media URL from WhatsApp
    logger.info(
      { event: 'audio_get_url', eventId, mediaId: audioMedia.id },
      'Fetching audio URL from WhatsApp'
    );

    const mediaUrlResult = await whatsappCloudApi.getMediaUrl(audioMedia.id);
    if (!mediaUrlResult.ok) {
      const failureDetails = `Failed to get audio URL: ${mediaUrlResult.error.message}`;
      logger.error(
        {
          event: 'audio_get_url_failed',
          error: mediaUrlResult.error,
          eventId,
          mediaId: audioMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(mediaUrlResult.error);
    }

    // Step 2: Download the audio
    logger.info(
      { event: 'audio_download', eventId, mediaId: audioMedia.id },
      'Downloading audio from WhatsApp'
    );

    const downloadResult = await whatsappCloudApi.downloadMedia(mediaUrlResult.value.url);
    if (!downloadResult.ok) {
      const failureDetails = `Failed to download audio: ${downloadResult.error.message}`;
      logger.error(
        {
          event: 'audio_download_failed',
          error: downloadResult.error,
          eventId,
          mediaId: audioMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(downloadResult.error);
    }

    const audioBuffer = downloadResult.value;
    const extension = getExtensionFromMimeType(audioMedia.mimeType);

    // Step 3: Upload audio to GCS
    logger.info(
      { event: 'audio_upload', eventId, mediaId: audioMedia.id },
      'Uploading audio to GCS'
    );

    const uploadResult = await mediaStorage.upload(
      userId,
      waMessageId,
      audioMedia.id,
      extension,
      audioBuffer,
      audioMedia.mimeType
    );

    if (!uploadResult.ok) {
      const failureDetails = `Failed to upload audio: ${uploadResult.error.message}`;
      logger.error(
        {
          event: 'audio_upload_failed',
          error: uploadResult.error,
          eventId,
          mediaId: audioMedia.id,
        },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(uploadResult.error);
    }

    // Step 4: Save message to Firestore
    const messageToSave: Omit<WhatsAppMessage, 'id'> = {
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
      webhookEventId: eventId,
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
      const failureDetails = `Failed to save message: ${saveResult.error.message}`;
      logger.error(
        { event: 'audio_save_failed', error: saveResult.error, eventId },
        failureDetails
      );
      await webhookEventRepository.updateEventStatus(eventId, 'FAILED', { failureDetails });
      return err(saveResult.error);
    }

    // Update webhook event status to PROCESSED
    await webhookEventRepository.updateEventStatus(eventId, 'PROCESSED', {});

    logger.info(
      {
        event: 'audio_processed',
        eventId,
        userId,
        messageId: saveResult.value.id,
        gcsPath: uploadResult.value.gcsPath,
      },
      'Audio message saved successfully'
    );

    return ok({
      messageId: saveResult.value.id,
      gcsPath: uploadResult.value.gcsPath,
      mimeType: audioMedia.mimeType,
    });
  }
}
