/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import type { Logger } from 'pino';
import { err, ok, type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  ApprovalReplyEvent,
  AudioStoredEvent,
  CommandIngestEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  WhatsAppError,
  MediaCleanupEvent,
  WebhookProcessEvent,
} from '../../domain/whatsapp/index.js';

export interface GcpPubSubPublisherConfig {
  projectId: string;
  mediaCleanupTopic: string;
  /**
   * Required: triggers srt-service to start audio transcription. Required at the type
   * level so misconfiguration is caught at construction, not silently no-op'd at runtime.
   */
  audioStoredTopic: string;
  /**
   * Required: triggers actions-agent to process approval/rejection of pending actions.
   */
  approvalReplyTopic: string;
  /** Optional: commands-agent integration; safe to leave unset in dev. */
  commandsIngestTopic?: string;
  /** Optional: webhook async-processing fanout; safe to leave unset in dev. */
  webhookProcessTopic?: string;
  logger: Logger;
}

/**
 * GCP Pub/Sub implementation of EventPublisherPort.
 */
export class GcpPubSubPublisher extends BasePubSubPublisher implements EventPublisherPort {
  private readonly mediaCleanupTopic: string;
  private readonly audioStoredTopic: string;
  private readonly approvalReplyTopic: string;
  private readonly commandsIngestTopic: string | null;
  private readonly webhookProcessTopic: string | null;

  constructor(config: GcpPubSubPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    // Belt-and-suspenders runtime guards: types enforce presence, but runtime
    // callers can still bypass them (e.g., tests using `as unknown as` casts,
    // JS callers, or empty-string env values that pass Zod at load time only
    // because an upstream step forgot `.min(1)`). The upstream has .min(1) —
    // this guard is the last line of defense.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- belt-and-suspenders runtime guard for callers that bypass the type system
    if (config.audioStoredTopic === undefined || config.audioStoredTopic === '') {
      throw new Error('audioStoredTopic is required');
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- belt-and-suspenders runtime guard for callers that bypass the type system
    if (config.approvalReplyTopic === undefined || config.approvalReplyTopic === '') {
      throw new Error('approvalReplyTopic is required');
    }
    this.mediaCleanupTopic = config.mediaCleanupTopic;
    this.audioStoredTopic = config.audioStoredTopic;
    this.approvalReplyTopic = config.approvalReplyTopic;
    this.commandsIngestTopic = config.commandsIngestTopic ?? null;
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

  async publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToOptionalTopic(
      this.commandsIngestTopic,
      event,
      { externalId: event.externalId },
      'command ingest'
    );
    return this.mapToWhatsAppError(result);
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

  async publishAudioStored(event: AudioStoredEvent): Promise<Result<void, WhatsAppError>> {
    const result = await this.publishToTopic(
      this.audioStoredTopic,
      event,
      { messageId: event.messageId },
      'audio stored'
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
