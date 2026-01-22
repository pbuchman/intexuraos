/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import type { Logger } from 'pino';
import { err, ok, type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  ApprovalReplyEvent,
  CommandIngestEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  WhatsAppError,
  MediaCleanupEvent,
  TranscribeAudioEvent,
  WebhookProcessEvent,
} from '../../domain/whatsapp/index.js';

export interface GcpPubSubPublisherConfig {
  projectId: string;
  mediaCleanupTopic: string;
  commandsIngestTopic?: string;
  webhookProcessTopic?: string;
  transcriptionTopic?: string;
  approvalReplyTopic?: string;
  logger: Logger;
}

/**
 * GCP Pub/Sub implementation of EventPublisherPort.
 */
export class GcpPubSubPublisher extends BasePubSubPublisher implements EventPublisherPort {
  private readonly mediaCleanupTopic: string;
  private readonly commandsIngestTopic: string | null;
  private readonly webhookProcessTopic: string | null;
  private readonly transcriptionTopic: string | null;
  private readonly approvalReplyTopic: string | null;

  constructor(config: GcpPubSubPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.mediaCleanupTopic = config.mediaCleanupTopic;
    this.commandsIngestTopic = config.commandsIngestTopic ?? null;
    this.webhookProcessTopic = config.webhookProcessTopic ?? null;
    this.transcriptionTopic = config.transcriptionTopic ?? null;
    this.approvalReplyTopic = config.approvalReplyTopic ?? null;
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

  async publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.commandsIngestTopic,
      event,
      { externalId: event.externalId },
      'command ingest'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { eventId: event.eventId },
      'webhook process'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishTranscribeAudio(event: TranscribeAudioEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.transcriptionTopic,
      event,
      { messageId: event.messageId },
      'transcribe audio'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishExtractLinkPreviews(
    event: ExtractLinkPreviewsEvent
  ): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.webhookProcessTopic,
      event,
      { messageId: event.messageId },
      'extract link previews'
    );
    return this.mapToWhatsAppError(result);
  }

  async publishApprovalReply(event: ApprovalReplyEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.approvalReplyTopic,
      event,
      { replyToWamid: event.replyToWamid },
      'approval reply'
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
