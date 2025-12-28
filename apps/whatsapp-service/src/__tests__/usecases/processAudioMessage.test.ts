/**
 * Tests for ProcessAudioMessageUseCase.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProcessAudioMessageUseCase,
  type ProcessAudioMessageInput,
  type ProcessAudioMessageDeps,
  type ProcessAudioMessageLogger,
} from '../../domain/inbox/index.js';
import {
  FakeWhatsAppWebhookEventRepository,
  FakeWhatsAppMessageRepository,
  FakeMediaStorage,
  FakeWhatsAppCloudApiPort,
} from '../fakes.js';
import type { WhatsAppWebhookEvent } from '../../domain/inbox/index.js';
function createTestLogger(): ProcessAudioMessageLogger {
  return {
    info: (): void => {
      // No-op: test logger
    },
    error: (): void => {
      // No-op: test logger
    },
  };
}
function createTestInput(overrides?: Partial<ProcessAudioMessageInput>): ProcessAudioMessageInput {
  return {
    eventId: 'test-event-id',
    userId: 'test-user-id',
    waMessageId: 'wamid.test123',
    fromNumber: '48123456789',
    toNumber: '48987654321',
    timestamp: '1703673600',
    senderName: 'Test User',
    phoneNumberId: '123456789012345',
    audioMedia: {
      id: 'audio-media-id-123',
      mimeType: 'audio/ogg',
      sha256: 'abc123',
    },
    ...overrides,
  };
}
function createTestWebhookEvent(eventId = 'test-event-id'): WhatsAppWebhookEvent {
  return {
    id: eventId,
    payload: {},
    signatureValid: true,
    receivedAt: new Date().toISOString(),
    phoneNumberId: '123456789012345',
    status: 'PENDING',
  };
}
describe('ProcessAudioMessageUseCase', () => {
  let webhookEventRepository: FakeWhatsAppWebhookEventRepository;
  let messageRepository: FakeWhatsAppMessageRepository;
  let mediaStorage: FakeMediaStorage;
  let whatsappCloudApi: FakeWhatsAppCloudApiPort;
  let usecase: ProcessAudioMessageUseCase;
  let deps: ProcessAudioMessageDeps;
  let logger: ProcessAudioMessageLogger;
  beforeEach(() => {
    webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
    messageRepository = new FakeWhatsAppMessageRepository();
    mediaStorage = new FakeMediaStorage();
    whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    logger = createTestLogger();
    deps = {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
    };
    usecase = new ProcessAudioMessageUseCase(deps);
    whatsappCloudApi.setMediaUrl('audio-media-id-123', {
      url: 'https://example.com/media/audio.ogg',
      mimeType: 'audio/ogg',
      fileSize: 5000,
    });
    whatsappCloudApi.setMediaContent(
      'https://example.com/media/audio.ogg',
      Buffer.from('fake-audio-content')
    );
  });
  describe('happy path', () => {
    it('processes audio message successfully', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      const input = createTestInput();
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messageId).toBeDefined();
        expect(result.value.gcsPath).toContain('whatsapp/');
        expect(result.value.mimeType).toBe('audio/ogg');
      }
      const messages = messageRepository.getAll();
      expect(messages).toHaveLength(1);
      const savedMessage = messages[0];
      expect(savedMessage?.userId).toBe('test-user-id');
      expect(savedMessage?.mediaType).toBe('audio');
      expect(savedMessage?.media?.mimeType).toBe('audio/ogg');
    });
    it('handles audio without sha256', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      const input = createTestInput({
        audioMedia: { id: 'audio-media-id-123', mimeType: 'audio/ogg' },
      });
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.media?.sha256).toBeUndefined();
    });
    it('handles audio without senderName and phoneNumberId', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      const input = createTestInput({ senderName: null, phoneNumberId: null });
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.metadata).toBeUndefined();
    });
    it('handles audio with only senderName (no phoneNumberId)', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      const input = createTestInput({ senderName: 'Test User', phoneNumberId: null });
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.metadata).toBeDefined();
      expect(messages[0]?.metadata?.senderName).toBe('Test User');
      expect(messages[0]?.metadata?.phoneNumberId).toBeUndefined();
    });
    it('handles audio with only phoneNumberId (no senderName)', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      const input = createTestInput({ senderName: null, phoneNumberId: '123456789012345' });
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.metadata).toBeDefined();
      expect(messages[0]?.metadata?.phoneNumberId).toBe('123456789012345');
      expect(messages[0]?.metadata?.senderName).toBeUndefined();
    });
    it('handles unsupported audio format with fallback extension', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      // Set up media for unsupported MIME type
      whatsappCloudApi.setMediaUrl('audio-media-id-123', {
        url: 'https://example.com/media/audio.webm',
        mimeType: 'audio/webm',
        fileSize: 5000,
      });
      whatsappCloudApi.setMediaContent(
        'https://example.com/media/audio.webm',
        Buffer.from('fake-webm-content')
      );
      const input = createTestInput({
        audioMedia: { id: 'audio-media-id-123', mimeType: 'audio/webm', sha256: 'abc123' },
      });
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // The GCS path should use 'bin' as fallback extension for unsupported format
        expect(result.value.gcsPath).toContain('.bin');
        expect(result.value.mimeType).toBe('audio/webm');
      }
      const messages = messageRepository.getAll();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.media?.mimeType).toBe('audio/webm');
    });
  });
  describe('error handling', () => {
    it('returns error when getMediaUrl fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      whatsappCloudApi.setFailGetMediaUrl(true);
      const input = createTestInput();
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('FAILED');
    });
    it('returns error when downloadMedia fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      whatsappCloudApi.setFailDownload(true);
      const input = createTestInput();
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(false);
      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('FAILED');
    });
    it('returns error when audio upload fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      mediaStorage.setFailUpload(true);
      const input = createTestInput();
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('FAILED');
    });
    it('returns error when message save fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      messageRepository.setFailSave(true);
      const input = createTestInput();
      const result = await usecase.execute(input, logger);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('FAILED');
    });
  });
});
