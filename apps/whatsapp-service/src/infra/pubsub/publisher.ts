/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  CommandIngestEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  InboxError,
  MediaCleanupEvent,
  TranscribeAudioEvent,
  WebhookProcessEvent,
} from '../../domain/inbox/index.js';

export interface GcpPubSubPublisherConfig {
  projectId: string;
  mediaCleanupTopic: string;
  commandsIngestTopic?: string;
  webhookProcessTopic?: string;
  transcriptionTopic?: string;
}

/**
 * GCP Pub/Sub implementation of EventPublisherPort.
 */
export class GcpPubSubPublisher extends BasePubSubPublisher implements EventPublisherPort {
  private readonly mediaCleanupTopic: string;
  private readonly commandsIngestTopic: string | null;
  private readonly webhookProcessTopic: string | null;
  private readonly transcriptionTopic: string | null;

  constructor(config: GcpPubSubPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'whatsapp-pubsub-publisher' });
    this.mediaCleanupTopic = config.mediaCleanupTopic;
    this.commandsIngestTopic = config.commandsIngestTopic ?? null;
    this.webhookProcessTopic = config.webhookProcessTopic ?? null;
    this.transcriptionTopic = config.transcriptionTopic ?? null;
  }

  async publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, InboxError>> {
    const result = await this.publishToTopic(
      this.mediaCleanupTopic,
      event,
      { messageId: event.messageId },
      'media cleanup'
    );
    return this.mapToInboxError(result);
  }

  async publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, InboxError>> {
    const result = await this.publishToTopic(
      this.commandsIngestTopic,
      event,
      { externalId: event.externalId },
      'command ingest'
    );
    return this.mapToInboxError(result);
  }

  async publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, InboxError>> {
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { eventId: event.eventId },
      'webhook process'
    );
    return this.mapToInboxError(result);
  }

  async publishTranscribeAudio(event: TranscribeAudioEvent): Promise<Result<void, InboxError>> {
    const result = await this.publishToTopic(
      this.transcriptionTopic,
      event,
      { messageId: event.messageId },
      'transcribe audio'
    );
    return this.mapToInboxError(result);
  }

  async publishExtractLinkPreviews(
    event: ExtractLinkPreviewsEvent
  ): Promise<Result<void, InboxError>> {
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { messageId: event.messageId },
      'extract link previews'
    );
    return this.mapToInboxError(result);
  }

  private mapToInboxError(result: Result<void, PublishError>): Result<void, InboxError> {
    if (result.ok) {
      return ok(undefined);
    }
    return err({
      code: 'INTERNAL_ERROR',
      message: result.error.message,
    });
  }
}
