/**
 * Tests for ProcessImageMessageUseCase.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ProcessImageMessageDeps,
  type ProcessImageMessageInput,
  type ProcessImageMessageLogger,
  ProcessImageMessageUseCase,
  type WhatsAppWebhookEvent,
} from '../../domain/whatsapp/index.js';
import {
  FakeMediaStorage,
  FakeThumbnailGeneratorPort,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
  FakeWhatsAppWebhookEventRepository,
} from '../fakes.js';

function createTestLogger(): ProcessImageMessageLogger {
  return {
    info: (): void => {
      // No-op: test logger
    },
    error: (): void => {
      // No-op: test logger
    },
  };
}

function createTestInput(overrides?: Partial<ProcessImageMessageInput>): ProcessImageMessageInput {
  return {
    eventId: 'test-event-id',
    userId: 'test-user-id',
    waMessageId: 'wamid.test123',
    fromNumber: '48123456789',
    toNumber: '48987654321',
    timestamp: '1703673600',
    senderName: 'Test User',
    phoneNumberId: '123456789012345',
    imageMedia: {
      id: 'media-id-123',
      mimeType: 'image/jpeg',
      sha256: 'abc123',
      caption: 'Test caption',
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
    status: 'pending',
  };
}

describe('ProcessImageMessageUseCase', () => {
  let webhookEventRepository: FakeWhatsAppWebhookEventRepository;
  let messageRepository: FakeWhatsAppMessageRepository;
  let mediaStorage: FakeMediaStorage;
  let whatsappCloudApi: FakeWhatsAppCloudApiPort;
  let thumbnailGenerator: FakeThumbnailGeneratorPort;
  let usecase: ProcessImageMessageUseCase;
  let deps: ProcessImageMessageDeps;
  let logger: ProcessImageMessageLogger;

  beforeEach(() => {
    webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
    messageRepository = new FakeWhatsAppMessageRepository();
    mediaStorage = new FakeMediaStorage();
    whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    thumbnailGenerator = new FakeThumbnailGeneratorPort();
    logger = createTestLogger();

    deps = {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      thumbnailGenerator,
    };

    usecase = new ProcessImageMessageUseCase(deps);

    whatsappCloudApi.setMediaUrl('media-id-123', {
      url: 'https://example.com/media/image.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1000,
    });
    whatsappCloudApi.setMediaContent(
      'https://example.com/media/image.jpg',
      Buffer.from('fake-image-content')
    );
  });

  describe('happy path', () => {
    it('processes image message successfully', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput();
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messageId).toBeDefined();
        expect(result.value.gcsPath).toContain('whatsapp/');
        expect(result.value.thumbnailGcsPath).toContain('_thumb');
      }

      const messages = messageRepository.getAll();
      expect(messages).toHaveLength(1);
      const savedMessage = messages[0];
      expect(savedMessage?.userId).toBe('test-user-id');
      expect(savedMessage?.mediaType).toBe('image');
      expect(savedMessage?.caption).toBe('Test caption');
      expect(savedMessage?.media?.mimeType).toBe('image/jpeg');
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
      expect(events[0]?.status).toBe('failed');
    });

    it('returns error when downloadMedia fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      whatsappCloudApi.setFailDownload(true);

      const input = createTestInput();
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }

      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('failed');
    });

    it('returns error when thumbnail generation fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      thumbnailGenerator.setFail(true);

      const input = createTestInput();
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(false);
      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('failed');
    });

    it('returns error when image upload fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      mediaStorage.setFailUpload(true);

      const input = createTestInput();
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }

      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('failed');
    });

    it('returns error when thumbnail upload fails', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      mediaStorage.setFailThumbnailUpload(true);

      const input = createTestInput();
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }

      const events = webhookEventRepository.getAll();
      expect(events[0]?.status).toBe('failed');
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
      expect(events[0]?.status).toBe('failed');
    });
  });

  describe('edge cases', () => {
    it('handles image without caption', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput({
        imageMedia: {
          id: 'media-id-123',
          mimeType: 'image/jpeg',
          sha256: 'abc123',
          // no caption
        },
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.caption).toBeUndefined();
      expect(messages[0]?.text).toBe('');
    });

    it('handles image without sha256', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput({
        imageMedia: {
          id: 'media-id-123',
          mimeType: 'image/jpeg',
          // no sha256
          caption: 'Test caption',
        },
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.media?.sha256).toBeUndefined();
    });

    it('handles null senderName and phoneNumberId', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput({
        senderName: null,
        phoneNumberId: null,
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.metadata).toBeUndefined();
    });

    it('handles only senderName without phoneNumberId', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput({
        senderName: 'Test User',
        phoneNumberId: null,
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.metadata?.senderName).toBe('Test User');
      expect(messages[0]?.metadata?.phoneNumberId).toBeUndefined();
    });

    it('handles only phoneNumberId without senderName', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput({
        senderName: null,
        phoneNumberId: '123456789012345',
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.metadata?.phoneNumberId).toBe('123456789012345');
      expect(messages[0]?.metadata?.senderName).toBeUndefined();
    });

    it('handles different image mime types', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());

      const input = createTestInput({
        imageMedia: {
          id: 'media-id-123',
          mimeType: 'image/png',
          sha256: 'abc123',
          caption: 'PNG image',
        },
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      const messages = messageRepository.getAll();
      expect(messages[0]?.media?.mimeType).toBe('image/png');
    });

    it('handles unknown image mime type with fallback extension', async () => {
      webhookEventRepository.setEvent(createTestWebhookEvent());
      whatsappCloudApi.setMediaUrl('media-id-unknown', {
        url: 'https://example.com/media/image.tiff',
        mimeType: 'image/tiff',
        fileSize: 1000,
      });
      whatsappCloudApi.setMediaContent(
        'https://example.com/media/image.tiff',
        Buffer.from('fake-tiff-content')
      );

      const input = createTestInput({
        imageMedia: {
          id: 'media-id-unknown',
          mimeType: 'image/tiff',
          sha256: 'abc123',
        },
      });
      const result = await usecase.execute(input, logger);

      expect(result.ok).toBe(true);
      // The unknown mime type should use 'bin' extension fallback
      if (result.ok) {
        expect(result.value.gcsPath).toContain('.bin');
      }
    });
  });
});
