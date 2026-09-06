/**
 * Tests for GCP Pub/Sub Publisher adapter.
 * Mocks @intexuraos/infra-pubsub to test the publisher implementation.
 */
import pino from 'pino';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GcpPubSubPublisher } from '../../infra/pubsub/index.js';

const mockPublishToTopic = vi.fn();
const mockPublishToTopicSafely = vi.fn();
const mockPublishToTopicWithSafeReceipt = vi.fn();
const mockPublishToOptionalTopic = vi.fn();
const mockPublishToOptionalTopicSafely = vi.fn();

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

    async publishToTopicSafely(
      topicName: string,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToTopicSafely(topicName, data, attributes);
    }

    async publishToOptionalTopicSafely(
      topicName: string | null,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToOptionalTopicSafely(topicName, data, attributes);
    }

    async publishToTopicWithSafeReceipt(
      topicName: string,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: string } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToTopicWithSafeReceipt(topicName, data, attributes);
    }
  },
}));

describe('GcpPubSubPublisher', () => {
  let publisher: GcpPubSubPublisher;

  beforeEach(() => {
    mockPublishToTopic.mockReset();
    mockPublishToTopicSafely.mockReset();
    mockPublishToTopicWithSafeReceipt.mockReset();
    mockPublishToOptionalTopic.mockReset();
    mockPublishToOptionalTopicSafely.mockReset();
    mockPublishToTopic.mockResolvedValue({ ok: true, value: undefined });
    mockPublishToTopicSafely.mockResolvedValue({ ok: true, value: undefined });
    mockPublishToTopicWithSafeReceipt.mockResolvedValue({
      ok: true,
      value: 'provider-receipt-private',
    });
    mockPublishToOptionalTopic.mockResolvedValue({ ok: true, value: undefined });
    mockPublishToOptionalTopicSafely.mockResolvedValue({ ok: true, value: undefined });
    publisher = new GcpPubSubPublisher({
      projectId: 'test-project',
      mediaCleanupTopic: 'media-cleanup-topic',
      audioStoredTopic: 'audio-stored-topic',
      intexMessageIngestTopic: 'intex-message-ingest-topic',
      logger: pino({ name: 'test', level: 'silent' }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws when intexMessageIngestTopic is missing', () => {
      expect(
        () =>
          new GcpPubSubPublisher({
            projectId: 'test-project',
            mediaCleanupTopic: 'media-cleanup-topic',
            audioStoredTopic: 'audio-stored-topic',
            logger: pino({ name: 'test', level: 'silent' }),
            // Cast: testing the runtime guard for callers that bypass the type system
          } as unknown as ConstructorParameters<typeof GcpPubSubPublisher>[0])
      ).toThrow('intexMessageIngestTopic is required');
    });

    it('throws when audioStoredTopic is missing', () => {
      expect(
        () =>
          new GcpPubSubPublisher({
            projectId: 'test-project',
            mediaCleanupTopic: 'media-cleanup-topic',
            intexMessageIngestTopic: 'intex-message-ingest-topic',
            logger: pino({ name: 'test', level: 'silent' }),
            // Cast: testing the runtime guard for callers that bypass the type system
          } as unknown as ConstructorParameters<typeof GcpPubSubPublisher>[0])
      ).toThrow('audioStoredTopic is required');
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
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith('media-cleanup-topic', event, {
        eventKind: 'media_cleanup',
      });
    });

    it('returns error when publish fails', async () => {
      mockPublishToTopicSafely.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Pub/Sub publication failed' },
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
        expect(result.error.message).toBe('Pub/Sub publication failed');
      }
    });
  });

  describe('publishAudioStored', () => {
    it('publishes to the required audio stored topic', async () => {
      const event = {
        type: 'whatsapp.audio.stored' as const,
        messageId: 'stored-audio-1',
        userId: 'user-456',
        mediaId: 'media-audio-1',
        gcsPath: 'whatsapp/user-456/wamid.voice/media-audio-1.ogg',
        mimeType: 'audio/ogg',
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishAudioStored(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith('audio-stored-topic', event, {
        eventKind: 'audio_stored',
      });
    });
  });

  describe('publishMediaTranscriptionRequested', () => {
    it('publishes to the audio topic with content-free logging context', async () => {
      const event = {
        type: 'whatsapp.media.transcription.requested' as const,
        messageId: 'private-message-id',
        userId: 'private-user-id',
        mediaId: 'private-media-id',
        gcsPath: 'whatsapp/private-user-id/private-message-id/audio.ogg',
        mimeType: 'audio/ogg',
        mediaKind: 'audio' as const,
        timestamp: new Date().toISOString(),
      };

      const result = await publisher.publishMediaTranscriptionRequested(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith('audio-stored-topic', event, {
        eventKind: 'media_transcription_requested',
      });
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
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith('intex-message-ingest-topic', event, {
        eventKind: 'intex_message_ingest',
      });
      expect(mockPublishToOptionalTopicSafely).not.toHaveBeenCalled();
    });
  });

  describe('publishMatrixCorpusIngest', () => {
    const event = {
      version: 1 as const,
      kind: 'matrix_corpus_ingest' as const,
      ingestReceiptId: 'receipt_1',
      leaseFence: '7',
      payloadDigest: '1'.repeat(64),
      attestation: 'e30.e30.AA',
    };

    it('publishes on the existing Intex topic and returns only a digest of the provider receipt', async () => {
      const result = await publisher.publishMatrixCorpusIngest(event);

      expect(result).toEqual({
        ok: true,
        value: {
          publisherReceiptDigest: createHash('sha256')
            .update('provider-receipt-private', 'utf8')
            .digest('hex'),
        },
      });
      expect(mockPublishToTopicWithSafeReceipt).toHaveBeenCalledWith(
        'intex-message-ingest-topic',
        event,
        { eventKind: 'matrix_corpus_ingest' }
      );
      expect(mockPublishToTopic).not.toHaveBeenCalled();
    });

    it('returns one static safe error when the provider publish fails', async () => {
      mockPublishToTopicWithSafeReceipt.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'private-provider-error-fixture' },
      });

      const result = await publisher.publishMatrixCorpusIngest(event);

      expect(result).toEqual({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Matrix corpus ingest publication failed' },
      });
      expect(JSON.stringify(result)).not.toContain('private-provider-error-fixture');
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
      expect(mockPublishToOptionalTopicSafely).toHaveBeenCalledWith(null, event, {
        eventKind: 'webhook_process',
      });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
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
      expect(mockPublishToOptionalTopicSafely).toHaveBeenCalledWith(
        'webhook-process-topic',
        event,
        { eventKind: 'webhook_process' }
      );
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      mockPublishToOptionalTopicSafely.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Pub/Sub publication failed' },
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
        expect(result.error.message).toBe('Pub/Sub publication failed');
      }
    });
  });

  describe('publishConversationAssistantPreparation', () => {
    it('publishes preparation work to the configured process topic', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      const event = {
        type: 'whatsapp.conversation-assistant.prepare' as const,
        sessionId: 'whatsapp-conv-session-123',
        userId: 'user-456',
        attempt: 2,
      };

      const result = await publisherWithTopic.publishConversationAssistantPreparation(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith('webhook-process-topic', event, {
        eventKind: 'conversation_assistant_preparation',
        attempt: '2',
      });
    });

    it('returns an explicit error when the process topic is not configured', async () => {
      const result = await publisher.publishConversationAssistantPreparation({
        type: 'whatsapp.conversation-assistant.prepare',
        sessionId: 'whatsapp-conv-session-123',
        userId: 'user-456',
        attempt: 1,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Conversation Assistant preparation topic is not configured',
        },
      });
      expect(mockPublishToTopicSafely).not.toHaveBeenCalled();
    });
  });

  describe('publishConversationAssistantContextAttachmentPreparation', () => {
    it('publishes content-free attachment preparation work to the existing process topic', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      const event = {
        type: 'whatsapp.conversation-assistant.context-attachment.prepare' as const,
        userId: 'user-456',
        sessionId: 'whatsapp-conv-session-123',
        sessionGenerationId: 'generation-789',
        attachmentId: 'attachment-321',
        attempt: 2,
      };

      const result =
        await publisherWithTopic.publishConversationAssistantContextAttachmentPreparation(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith(
        'webhook-process-topic',
        event,
        {
          eventKind: 'conversation_assistant_context_attachment_preparation',
          attempt: '2',
        }
      );
    });

    it('returns an explicit error when attachment preparation has no process topic', async () => {
      const result = await publisher.publishConversationAssistantContextAttachmentPreparation({
        type: 'whatsapp.conversation-assistant.context-attachment.prepare',
        userId: 'user-456',
        sessionId: 'whatsapp-conv-session-123',
        sessionGenerationId: 'generation-789',
        attachmentId: 'attachment-321',
        attempt: 1,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Conversation Assistant context attachment preparation topic is not configured',
        },
      });
      expect(mockPublishToTopicSafely).not.toHaveBeenCalled();
    });
  });

  describe('publishPrivateWhatsAppErasure', () => {
    const event = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-secret',
      userId: 'user-secret',
      erasureRequestId: 'request-secret',
      attempt: 3,
    };

    it('publishes erasure work to the existing process topic with content-free attributes', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });

      const result = await publisherWithTopic.publishPrivateWhatsAppErasure(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopicSafely).toHaveBeenCalledWith(
        'webhook-process-topic',
        event,
        { eventKind: 'private_whatsapp_erasure', attempt: '3' }
      );
      expect(JSON.stringify(mockPublishToTopicSafely.mock.calls[0]?.[2])).not.toContain('secret');
    });

    it('returns an explicit retryable error when the process topic is not configured', async () => {
      const result = await publisher.publishPrivateWhatsAppErasure(event);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Private WhatsApp erasure topic is not configured',
        },
      });
      expect(mockPublishToTopicSafely).not.toHaveBeenCalled();
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
      expect(mockPublishToOptionalTopicSafely).toHaveBeenCalledWith(null, event, {
        eventKind: 'extract_link_previews',
      });
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
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
      expect(mockPublishToOptionalTopicSafely).toHaveBeenCalledWith(
        'webhook-process-topic',
        event,
        { eventKind: 'extract_link_previews' }
      );
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher({
        projectId: 'test-project',
        mediaCleanupTopic: 'media-cleanup-topic',
        audioStoredTopic: 'audio-stored-topic',
        intexMessageIngestTopic: 'intex-message-ingest-topic',
        webhookProcessTopic: 'webhook-process-topic',
        logger: pino({ name: 'test', level: 'silent' }),
      });
      mockPublishToOptionalTopicSafely.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Pub/Sub publication failed' },
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
        expect(result.error.message).toBe('Pub/Sub publication failed');
      }
    });
  });
});
