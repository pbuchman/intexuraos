/**
 * Tests for GCP Pub/Sub Publisher adapter.
 * Mocks @intexuraos/infra-pubsub to test the publisher implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GcpPubSubPublisher, getLogLevel } from '../../infra/pubsub/index.js';

const mockPublishToTopic = vi.fn();

vi.mock('@intexuraos/infra-pubsub', () => ({
  BasePubSubPublisher: class {
    protected projectId: string;
    protected loggerName: string;

    constructor(config: { projectId: string; loggerName?: string }) {
      this.projectId = config.projectId;
      this.loggerName = config.loggerName ?? 'test';
    }

    async publishToTopic(
      topicName: string | null,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToTopic(topicName, data, attributes);
    }
  },
  getLogLevel: (env: string | undefined): string => (env === 'test' ? 'silent' : 'info'),
}));

describe('getLogLevel', () => {
  it('returns silent for test environment', () => {
    expect(getLogLevel('test')).toBe('silent');
  });

  it('returns info for non-test environments', () => {
    expect(getLogLevel('development')).toBe('info');
    expect(getLogLevel('production')).toBe('info');
    expect(getLogLevel(undefined)).toBe('info');
  });
});

describe('GcpPubSubPublisher', () => {
  let publisher: GcpPubSubPublisher;

  beforeEach(() => {
    mockPublishToTopic.mockReset();
    mockPublishToTopic.mockResolvedValue({ ok: true, value: undefined });
    publisher = new GcpPubSubPublisher({
      projectId: 'test-project',
      mediaCleanupTopic: 'media-cleanup-topic',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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
    it('skips publish when topic is not configured', async () => {
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
      expect(mockPublishToTopic).toHaveBeenCalledWith(null, event, { externalId: 'wamid.abc' });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        commandsIngestTopic: 'commands-ingest-topic',
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
        commandsIngestTopic: 'commands-ingest-topic',
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
      expect(mockPublishToTopic).toHaveBeenCalledWith(null, event, { eventId: 'event-123' });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        webhookProcessTopic: 'webhook-process-topic',
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
      expect(mockPublishToTopic).toHaveBeenCalledWith('webhook-process-topic', event, {
        eventId: 'event-123',
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        webhookProcessTopic: 'webhook-process-topic',
      });
      mockPublishToTopic.mockResolvedValue({
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

  describe('publishTranscribeAudio', () => {
    it('skips publish when topic is not configured', async () => {
      const event = {
        type: 'whatsapp.audio.transcribe' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        gcsPath: 'path/to/audio.ogg',
        mimeType: 'audio/ogg',
        userPhoneNumber: '+1234567890',
        originalWaMessageId: 'wamid.abc',
        phoneNumberId: 'phone-789',
      };

      const result = await publisher.publishTranscribeAudio(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith(null, event, { messageId: 'msg-123' });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        transcriptionTopic: 'transcription-topic',
      });

      const event = {
        type: 'whatsapp.audio.transcribe' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        gcsPath: 'path/to/audio.ogg',
        mimeType: 'audio/ogg',
        userPhoneNumber: '+1234567890',
        originalWaMessageId: 'wamid.abc',
        phoneNumberId: 'phone-789',
      };

      const result = await publisherWithTopic.publishTranscribeAudio(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('transcription-topic', event, {
        messageId: 'msg-123',
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        transcriptionTopic: 'transcription-topic',
      });
      mockPublishToTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Publish timeout' },
      });

      const result = await publisherWithTopic.publishTranscribeAudio({
        type: 'whatsapp.audio.transcribe',
        messageId: 'msg-fail',
        userId: 'user-456',
        gcsPath: 'path/to/audio.ogg',
        mimeType: 'audio/ogg',
        userPhoneNumber: '+1234567890',
        originalWaMessageId: 'wamid.xyz',
        phoneNumberId: 'phone-789',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Publish timeout');
      }
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
      expect(mockPublishToTopic).toHaveBeenCalledWith(null, event, { messageId: 'msg-123' });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        webhookProcessTopic: 'webhook-process-topic',
      });

      const event = {
        type: 'whatsapp.linkpreview.extract' as const,
        messageId: 'msg-123',
        userId: 'user-456',
        text: 'Check out https://example.com',
      };

      const result = await publisherWithTopic.publishExtractLinkPreviews(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('webhook-process-topic', event, {
        messageId: 'msg-123',
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        webhookProcessTopic: 'webhook-process-topic',
      });
      mockPublishToTopic.mockResolvedValue({
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
