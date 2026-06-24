/**
 * Tests for GCP Pub/Sub Publisher adapter.
 * Mocks @intexuraos/infra-pubsub to test the publisher implementation.
 */
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GcpPubSubPublisher } from '../../infra/pubsub/index.js';

const mockPublishToTopic = vi.fn();
const mockPublishToOptionalTopic = vi.fn();

vi.mock('@intexuraos/infra-pubsub', () => ({
  BasePubSubPublisher: class {
    protected projectId: string;

    constructor(config: { projectId: string; logger: { level: string } }) {
      this.projectId = config.projectId;
    }

    async publishToTopic(
      topicName: string,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToTopic(topicName, data, attributes);
    }

    async publishToOptionalTopic(
      topicName: string | null,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToOptionalTopic(topicName, data, attributes);
    }
  },
}));

describe('GcpPubSubPublisher', () => {
  let publisher: GcpPubSubPublisher;

  beforeEach(() => {
    mockPublishToTopic.mockReset();
    mockPublishToOptionalTopic.mockReset();
    mockPublishToTopic.mockResolvedValue({ ok: true, value: undefined });
    mockPublishToOptionalTopic.mockResolvedValue({ ok: true, value: undefined });
    publisher = new GcpPubSubPublisher({
      projectId: 'test-project',
      mediaCleanupTopic: 'media-cleanup-topic',
      audioStoredTopic: 'audio-stored-topic',
      approvalReplyTopic: 'approval-reply-topic',
      commandsIngestTopic: 'commands-ingest-topic',
      intexMessageIngestTopic: 'intex-message-ingest-topic',
      logger: pino({ name: 'test', level: 'silent' }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws when audioStoredTopic is missing', () => {
      expect(
        () =>
          new GcpPubSubPublisher({
            projectId: 'test-project',
            mediaCleanupTopic: 'media-cleanup-topic',
            approvalReplyTopic: 'approval-reply-topic',
            commandsIngestTopic: 'commands-ingest-topic',
            intexMessageIngestTopic: 'intex-message-ingest-topic',
            logger: pino({ name: 'test', level: 'silent' }),
            // Cast: testing the runtime guard for callers that bypass the type system
          } as unknown as ConstructorParameters<typeof GcpPubSubPublisher>[0])
      ).toThrow('audioStoredTopic is required');
    });

    it('throws when approvalReplyTopic is missing', () => {
      expect(
        () =>
          new GcpPubSubPublisher({
            projectId: 'test-project',
            mediaCleanupTopic: 'media-cleanup-topic',
            audioStoredTopic: 'audio-stored-topic',
            commandsIngestTopic: 'commands-ingest-topic',
            intexMessageIngestTopic: 'intex-message-ingest-topic',
            logger: pino({ name: 'test', level: 'silent' }),
            // Cast: testing the runtime guard for callers that bypass the type system
          } as unknown as ConstructorParameters<typeof GcpPubSubPublisher>[0])
      ).toThrow('approvalReplyTopic is required');
    });

    it('throws when commandsIngestTopic is missing', () => {
      expect(
        () =>
          new GcpPubSubPublisher({
            projectId: 'test-project',
            mediaCleanupTopic: 'media-cleanup-topic',
            audioStoredTopic: 'audio-stored-topic',
            approvalReplyTopic: 'approval-reply-topic',
            intexMessageIngestTopic: 'intex-message-ingest-topic',
            logger: pino({ name: 'test', level: 'silent' }),
            // Cast: testing the runtime guard for callers that bypass the type system
          } as unknown as ConstructorParameters<typeof GcpPubSubPublisher>[0])
      ).toThrow('commandsIngestTopic is required');
    });

    it('throws when intexMessageIngestTopic is missing', () => {
      expect(
        () =>
          new GcpPubSubPublisher({
            projectId: 'test-project',
            mediaCleanupTopic: 'media-cleanup-topic',
            audioStoredTopic: 'audio-stored-topic',
            approvalReplyTopic: 'approval-reply-topic',
            commandsIngestTopic: 'commands-ingest-topic',
            logger: pino({ name: 'test', level: 'silent' }),
            // Cast: testing the runtime guard for callers that bypass the type system
          } as unknown as ConstructorParameters<typeof GcpPubSubPublisher>[0])
      ).toThrow('intexMessageIngestTopic is required');
    });
  });

  describe('publishMediaCleanup', () => {
    it('publishes event successfully', async () => {
      const event = {
        type: 'whatsapp.media.cleanup' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        gcsPaths: ['whatsapp/user-456/msg-123/media.ogg'],
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishMediaCleanup(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('media-cleanup-topic', event, {
        messageId: 'msg-123',
      });
    });

    it('returns error when publish fails', async () => {
      mockPublishToTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Pub/Sub unavailable' },
      });

      const result = await publisher.publishMediaCleanup({
        type: 'whatsapp.media.cleanup',
        messageId: 'msg-123',
        userId: 'user-456',
        gcsPaths: ['path/to/file'],
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Pub/Sub unavailable');
      }
    });
  });

  describe('publishCommandIngest', () => {
    it('publishes to the required command ingest topic', async () => {
      const event = {
        type: 'command.ingest' as const,
        userId: 'user-123',
        sourceType: 'whatsapp_text' as const,
        externalId: 'wamid.abc',
        text: 'Test command',
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishCommandIngest(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('commands-ingest-topic', event, {
        externalId: 'wamid.abc',
      });
      expect(mockPublishToOptionalTopic).not.toHaveBeenCalled();
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        approvalReplyTopic: 'approval-reply-topic',
        commandsIngestTopic: 'commands-ingest-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });

      const event = {
        type: 'command.ingest' as const,
        userId: 'user-123',
        sourceType: 'whatsapp_voice' as const,
        externalId: 'wamid.voice123',
        text: 'Voice transcription text',
        timestamp: new Date().toISOString(),
      };

      const result = await publisherWithTopic.publishCommandIngest(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('commands-ingest-topic', event, {
        externalId: 'wamid.voice123',
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        approvalReplyTopic: 'approval-reply-topic',
        commandsIngestTopic: 'commands-ingest-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      mockPublishToTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Topic unavailable' },
      });

      const result = await publisherWithTopic.publishCommandIngest({
        type: 'command.ingest',
        userId: 'user-789',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.fail',
        text: 'Test',
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Topic unavailable');
      }
    });
  });

  describe('publishIntexMessageIngest', () => {
    it('publishes to the required intex message ingest topic', async () => {
      const event = {
        type: 'intex.message.ingest' as const,
        userId: 'user-123',
        messageId: 'wamid.abc',
        text: 'Remember the garage code',
        sourceType: 'whatsapp_text' as const,
        whatsappSender: '+15551234567',
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishIntexMessageIngest(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('intex-message-ingest-topic', event, {
        messageId: 'wamid.abc',
      });
      expect(mockPublishToOptionalTopic).not.toHaveBeenCalled();
    });
  });

  describe('publishWebhookProcess', () => {
    it('skips publish when topic is not configured', async () => {
      const event = {
        type: 'whatsapp.webhook.process' as const,
        eventId: 'event-123',
        payload: '{}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      };

      const result = await publisher.publishWebhookProcess(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToOptionalTopic).toHaveBeenCalledWith(null, event, {
        eventId: 'event-123',
      });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        approvalReplyTopic: 'approval-reply-topic',
        commandsIngestTopic: 'commands-ingest-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });

      const event = {
        type: 'whatsapp.webhook.process' as const,
        eventId: 'event-123',
        payload: '{"test": true}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      };

      const result = await publisherWithTopic.publishWebhookProcess(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToOptionalTopic).toHaveBeenCalledWith('webhook-process-topic', event, {
        eventId: 'event-123',
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        approvalReplyTopic: 'approval-reply-topic',
        commandsIngestTopic: 'commands-ingest-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      mockPublishToOptionalTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Connection failed' },
      });

      const result = await publisherWithTopic.publishWebhookProcess({
        type: 'whatsapp.webhook.process',
        eventId: 'event-fail',
        payload: '{}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Connection failed');
      }
    });
  });

  describe('publishAudioStored', () => {
    it('publishes event when topic is configured', async () => {
      const event = {
        type: 'whatsapp.audio.stored' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        mediaId: 'media-789',
        gcsPath: 'path/to/audio.ogg',
        mimeType: 'audio/ogg',
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishAudioStored(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('audio-stored-topic', event, {
        messageId: 'msg-123',
      });
    });

    it('returns error when publish fails', async () => {
      mockPublishToTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Publish timeout' },
      });

      const result = await publisher.publishAudioStored({
        type: 'whatsapp.audio.stored',
        messageId: 'msg-fail',
        userId: 'user-456',
        mediaId: 'media-xyz',
        gcsPath: 'path/to/audio.ogg',
        mimeType: 'audio/ogg',
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Publish timeout');
      }
    });
  });

  describe('publishApprovalReply', () => {
    it('publishes event when topic is configured', async () => {
      const event = {
        type: 'action.approval.reply' as const,
        replyToWamid: 'wamid.reply123',
        replyText: 'yes',
        userId: 'user-456',
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishApprovalReply(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('approval-reply-topic', event, {
        replyToWamid: 'wamid.reply123',
      });
    });
  });

  describe('publishExtractLinkPreviews', () => {
    it('skips publish when topic is not configured', async () => {
      const event = {
        type: 'whatsapp.linkpreview.extract' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        text: 'Check out https://example.com',
      };

      const result = await publisher.publishExtractLinkPreviews(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToOptionalTopic).toHaveBeenCalledWith(null, event, {
        messageId: 'msg-123',
      });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        approvalReplyTopic: 'approval-reply-topic',
        commandsIngestTopic: 'commands-ingest-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });

      const event = {
        type: 'whatsapp.linkpreview.extract' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        text: 'Check out https://example.com',
      };

      const result = await publisherWithTopic.publishExtractLinkPreviews(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToOptionalTopic).toHaveBeenCalledWith('webhook-process-topic', event, {
        messageId: 'msg-123',
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        approvalReplyTopic: 'approval-reply-topic',
        commandsIngestTopic: 'commands-ingest-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      mockPublishToOptionalTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Network error' },
      });

      const result = await publisherWithTopic.publishExtractLinkPreviews({
        type: 'whatsapp.linkpreview.extract',
        messageId: 'msg-fail',
        userId: 'user-456',
        text: 'https://example.com/fail',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Network error');
      }
    });
  });
});
