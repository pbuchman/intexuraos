/**
 * Port for event publishing.
 * Abstracts Pub/Sub-specific operations for the domain layer.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from './repositories.js';
import type {
  ApprovalReplyEvent,
  CommandIngestEvent,
  ExtractLinkPreviewsEvent,
  MediaCleanupEvent,
  TranscribeAudioEvent,
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
   * Publish a command ingest event.
   * Triggers command classification in commands-agent.
   */
  publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a webhook process event.
   * Triggers async webhook processing after returning 200 to Meta.
   */
  publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a transcribe audio event.
   * Triggers async audio transcription (up to 5 min polling).
   */
  publishTranscribeAudio(event: TranscribeAudioEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish a link preview extraction event.
   * Triggers async Open Graph metadata fetching.
   */
  publishExtractLinkPreviews(event: ExtractLinkPreviewsEvent): Promise<Result<void, WhatsAppError>>;

  /**
   * Publish an approval reply event.
   * Triggers actions-agent to process approval/rejection of an action.
   */
  publishApprovalReply(event: ApprovalReplyEvent): Promise<Result<void, WhatsAppError>>;
}
