import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  PrivateWhatsAppMediaInfo,
  PrivateWhatsAppMessageType,
} from '../models/PrivateWhatsApp.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { Logger } from '../utils/logger.js';

export interface PublishPrivateStoredMediaTranscriptionInput {
  sourceAccountId: string;
  userId: string;
  messageId: string;
  matrixEventId?: string;
  messageType: PrivateWhatsAppMessageType;
  media: PrivateWhatsAppMediaInfo | undefined;
  chatTranscriptionEnabled: boolean;
  eventPublisher: EventPublisherPort;
  logger: Logger;
}

export async function publishPrivateStoredMediaTranscriptionRequest(
  input: PublishPrivateStoredMediaTranscriptionInput
): Promise<Result<boolean, WhatsAppError>> {
  if (!input.chatTranscriptionEnabled) {
    return ok(false);
  }
  if (input.messageType !== 'audio' && input.messageType !== 'video') {
    return ok(false);
  }
  const media = input.media;
  const gcsPath = media?.gcsPath;
  const mimeType = media?.storedMimeType ?? media?.mimeType;
  if (media?.storageStatus !== 'stored' || gcsPath === undefined || mimeType === undefined) {
    return ok(false);
  }

  const timestamp = new Date().toISOString();
  const publishResult =
    input.messageType === 'audio'
      ? await input.eventPublisher.publishAudioStored({
          type: 'whatsapp.audio.stored',
          messageSource: 'private_whatsapp',
          userId: input.userId,
          messageId: input.messageId,
          mediaId: media.mxcUri,
          gcsPath,
          mimeType,
          timestamp,
        })
      : await input.eventPublisher.publishMediaTranscriptionRequested({
          type: 'whatsapp.media.transcription.requested',
          messageSource: 'private_whatsapp',
          mediaKind: 'video',
          userId: input.userId,
          messageId: input.messageId,
          mediaId: media.mxcUri,
          gcsPath,
          mimeType,
          timestamp,
        });
  if (!publishResult.ok) {
    input.logger.error(
      {
        matrixEventId: input.matrixEventId,
        sourceAccountId: input.sourceAccountId,
        messageId: input.messageId,
        mediaKind: input.messageType,
        error: publishResult.error,
      },
      'Failed to publish private WhatsApp media transcription event'
    );
    return err(publishResult.error);
  }

  return ok(true);
}
