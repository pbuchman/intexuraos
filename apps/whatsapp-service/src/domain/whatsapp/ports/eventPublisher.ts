/**
 * Port for event publishing.
 * Abstracts Pub/Sub-specific operations for the domain layer.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from './repositories.js';
import type {
  AudioStoredEvent,
  ConversationAssistantPreparationRequestedEvent,
  ExtractLinkPreviewsEvent,
  IntexMessageIngestEvent,
  MediaCleanupEvent,
  MediaTranscriptionRequestedEvent,
  WebhookProcessEvent,
} from '../events/index.js';

/**
 * Port for publishing events to external systems.
 */
export interface EventPublisherPort {
  /**
   * Publish a media cleanup event.
   * Triggers async media deletion.
   */
  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish an audio stored event.
   * Triggers async transcription.
   */
  publishAudioStored(event: AudioStoredEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a media transcription request event.
   * Triggers async transcription for stored audio/video.
   */
  publishMediaTranscriptionRequested(
    event: MediaTranscriptionRequestedEvent
  ): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a WhatsApp Assistant message ingest event.
   * Triggers intex-agent realtime session handling.
   */
  publishIntexMessageIngest(event: IntexMessageIngestEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a webhook process event.
   * Triggers async webhook processing after returning 200 to Meta.
   */
  publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a link preview extraction event.
   * Triggers async Open Graph metadata fetching.
   */
  publishExtractLinkPreviews(event: ExtractLinkPreviewsEvent): Promise<Result<void, WhatsAppError>>;

  /** Queue durable preparation of a frozen Conversation Assistant context. */
  publishConversationAssistantPreparation(
    event: ConversationAssistantPreparationRequestedEvent
  ): Promise<Result<void, WhatsAppError>>;
}
