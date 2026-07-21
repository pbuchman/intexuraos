/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import { createHash } from 'node:crypto';

import type { Logger } from 'pino';
import { err, ok, type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  AudioStoredEvent,
  ConversationAssistantPreparationRequestedEvent,
  ConversationAssistantContextAttachmentPreparationRequestedEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  IntexMessageIngestEvent,
  MatrixCorpusSignedIngestEvent,
  MatrixCorpusPublishReceipt,
  WhatsAppError,
  MediaCleanupEvent,
  MediaTranscriptionRequestedEvent,
  PrivateWhatsAppErasurePublisher,
  PrivateWhatsAppErasureWorkItem,
  WebhookProcessEvent,
} from '../../domain/whatsapp/index.js';

export interface GcpPubSubPublisherConfig {
  projectId: string;
  mediaCleanupTopic: string;
  /**
   * Required: transcription worker consumes stored WhatsApp audio.
   */
  audioStoredTopic: string;
  /**
   * Required: intex-agent handles realtime WhatsApp Assistant conversations.
   */
  intexMessageIngestTopic: string;
  /** Optional: webhook async-processing fanout; safe to leave unset in dev. */
  webhookProcessTopic?: string;
  logger: Logger;
}

/**
 * GCP Pub/Sub implementation of EventPublisherPort.
 */
export class GcpPubSubPublisher
  extends BasePubSubPublisher
  implements EventPublisherPort, PrivateWhatsAppErasurePublisher
{
  private readonly mediaCleanupTopic: string;
  private readonly audioStoredTopic: string;
  private readonly intexMessageIngestTopic: string;
  private readonly webhookProcessTopic: string | null;

  constructor(config: GcpPubSubPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- belt-and-suspenders runtime guard for callers that bypass the type system
    if (config.intexMessageIngestTopic === undefined || config.intexMessageIngestTopic === '') {
      throw new Error('intexMessageIngestTopic is required');
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- belt-and-suspenders runtime guard for callers that bypass the type system
    if (config.audioStoredTopic === undefined || config.audioStoredTopic === '') {
      throw new Error('audioStoredTopic is required');
    }
    this.mediaCleanupTopic = config.mediaCleanupTopic;
    this.audioStoredTopic = config.audioStoredTopic;
    this.intexMessageIngestTopic = config.intexMessageIngestTopic;
    this.webhookProcessTopic = config.webhookProcessTopic ?? null;
  }

  async publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.mediaCleanupTopic,
      event,
      { messageId: event.messageId },
      'media cleanup'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishAudioStored(event: AudioStoredEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.audioStoredTopic,
      event,
      { messageId: event.messageId },
      'audio stored'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishMediaTranscriptionRequested(
    event: MediaTranscriptionRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.audioStoredTopic,
      event,
      { messageId: event.messageId },
      'media transcription requested'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishIntexMessageIngest(
    event: IntexMessageIngestEvent
  ): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.intexMessageIngestTopic,
      event,
      { messageId: event.messageId },
      'intex message ingest'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishMatrixCorpusIngest(
    event: MatrixCorpusSignedIngestEvent
  ): Promise<Result<MatrixCorpusPublishReceipt, WhatsAppError>> {
    const result = await this.publishToTopicWithSafeReceipt(
      this.intexMessageIngestTopic,
      event,
      { eventKind: 'matrix_corpus_ingest' },
      'Matrix corpus ingest'
    );
    if (!result.ok)
      return err({
        code: 'INTERNAL_ERROR' as const,
        message: 'Matrix corpus ingest publication failed',
      });
    return ok({
      publisherReceiptDigest: createHash('sha256').update(result.value, 'utf8').digest('hex'),
    });
  }

  async publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToOptionalTopic(
      this.webhookProcessTopic,
      event,
      { eventId: event.eventId },
      'webhook process'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishExtractLinkPreviews(
    event: ExtractLinkPreviewsEvent
  ): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToOptionalTopic(
      this.webhookProcessTopic,
      event,
      { messageId: event.messageId },
      'extract link previews'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishConversationAssistantPreparation(
    event: ConversationAssistantPreparationRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    if (this.webhookProcessTopic === null) {
      return err({
        code: 'INTERNAL_ERROR',
        message: 'Conversation Assistant preparation topic is not configured',
      });
    }
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { sessionId: event.sessionId, userId: event.userId, attempt: String(event.attempt) },
      'conversation assistant preparation'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishConversationAssistantContextAttachmentPreparation(
    event: ConversationAssistantContextAttachmentPreparationRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    if (this.webhookProcessTopic === null) {
      return err({
        code: 'INTERNAL_ERROR',
        message:
          'Conversation Assistant context attachment preparation topic is not configured',
      });
    }
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { attempt: String(event.attempt) },
      'conversation assistant context attachment preparation'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishPrivateWhatsAppErasure(
    event: PrivateWhatsAppErasureWorkItem
  ): Promise<Result<void, WhatsAppError>> {
    if (this.webhookProcessTopic === null) {
      return err({
        code: 'INTERNAL_ERROR',
        message: 'Private WhatsApp erasure topic is not configured',
      });
    }
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { attempt: String(event.attempt) },
      'private WhatsApp erasure'
    );
    return this.mapToWhatsAppError(result);
  }

  private mapToWhatsAppError(result: Result<void, PublishError>): Result<void, WhatsAppError> {
    if (result.ok) {
      return ok(undefined);
    }
    return err({
      code: 'INTERNAL_ERROR',
      message: result.error.message,
    });
  }
}
