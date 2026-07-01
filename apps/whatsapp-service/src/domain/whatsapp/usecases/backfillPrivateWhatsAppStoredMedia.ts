import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type { PrivateWhatsAppMediaInfo } from '../models/PrivateWhatsApp.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import type { PrivateWhatsAppRepository } from '../ports/privateWhatsAppRepository.js';
import type { Logger } from '../utils/logger.js';
import { publishPrivateStoredMediaTranscriptionRequest } from './privateStoredMediaTranscription.js';

export interface BackfillPrivateWhatsAppStoredMediaInput {
  sourceAccountId: string;
  messageId: string;
  media: PrivateWhatsAppMediaInfo;
}

export interface BackfillPrivateWhatsAppStoredMediaResult {
  status: 'updated' | 'already_stored';
  transcriptionPublished: boolean;
}

export interface BackfillPrivateWhatsAppStoredMediaDeps {
  privateWhatsAppRepository: PrivateWhatsAppRepository;
  eventPublisher: EventPublisherPort;
}

export class BackfillPrivateWhatsAppStoredMediaUseCase {
  constructor(private readonly deps: BackfillPrivateWhatsAppStoredMediaDeps) {}

  async execute(
    input: BackfillPrivateWhatsAppStoredMediaInput,
    logger: Logger
  ): Promise<Result<BackfillPrivateWhatsAppStoredMediaResult, WhatsAppError>> {
    if (input.media.storageStatus !== 'stored' || input.media.gcsPath === undefined) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'Stored private WhatsApp media backfill requires a GCS path',
      });
    }

    const updateResult = await this.deps.privateWhatsAppRepository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId: input.messageId,
      media: input.media,
      now: new Date().toISOString(),
    });
    if (!updateResult.ok) {
      return err(updateResult.error);
    }

    if (updateResult.value.status === 'already_stored') {
      return ok({
        status: 'already_stored',
        transcriptionPublished: false,
      });
    }

    const { message, chat } = updateResult.value;
    const publishResult = await publishPrivateStoredMediaTranscriptionRequest({
      sourceAccountId: input.sourceAccountId,
      userId: message.userId,
      messageId: message.id,
      matrixEventId: message.matrixEventId,
      messageType: message.messageType,
      media: message.media,
      chatTranscriptionEnabled: chat.transcriptionEnabled === true,
      eventPublisher: this.deps.eventPublisher,
      logger,
    });
    if (!publishResult.ok) {
      return err(publishResult.error);
    }

    return ok({
      status: 'updated',
      transcriptionPublished: publishResult.value,
    });
  }
}
