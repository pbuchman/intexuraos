/**
 * Tests for ProcessVideoMessageUseCase.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { WhatsAppWebhookEvent } from '../../domain/whatsapp/index.js';
import {
  type ProcessVideoMessageDeps,
  type ProcessVideoMessageInput,
  type ProcessVideoMessageLogger,
  ProcessVideoMessageUseCase,
} from '../../domain/whatsapp/index.js';
import {
  FakeEventPublisher,
  FakeMediaStorage,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
  FakeWhatsAppWebhookEventRepository,
} from '../fakes.js';

function createTestLogger(): ProcessVideoMessageLogger {
  return {
    info: (): void => {
      // No-op: test logger
    },
    error: (): void => {
      // No-op: test logger
    },
  };
}

function createTestInput(overrides?: Partial<ProcessVideoMessageInput>): ProcessVideoMessageInput {
  return {
    eventId: 'test-event-id',
    userId: 'test-user-id',
    waMessageId: 'wamid.video123',
    fromNumber: '48123456789',
    toNumber: '48987654321',
    timestamp: '1703673600',
    senderName: 'Test User',
    phoneNumberId: '123456789012345',
    videoMedia: {
      id: 'video-media-id-123',
      mimeType: 'video/mp4',
      sha256: 'video-sha',
      caption: 'Video caption',
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

describe('ProcessVideoMessageUseCase', () => {
  let webhookEventRepository: FakeWhatsAppWebhookEventRepository;
  let messageRepository: FakeWhatsAppMessageRepository;
  let mediaStorage: FakeMediaStorage;
  let whatsappCloudApi: FakeWhatsAppCloudApiPort;
  let eventPublisher: FakeEventPublisher;
  let usecase: ProcessVideoMessageUseCase;
  let deps: ProcessVideoMessageDeps;
  let logger: ProcessVideoMessageLogger;

  beforeEach(() => {
    webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
    messageRepository = new FakeWhatsAppMessageRepository();
    mediaStorage = new FakeMediaStorage();
    whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    eventPublisher = new FakeEventPublisher();
    logger = createTestLogger();
    deps = {
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    };
    usecase = new ProcessVideoMessageUseCase(deps);
    whatsappCloudApi.setMediaUrl('video-media-id-123', {
      url: 'https://example.com/media/video.mp4',
      mimeType: 'video/mp4',
      fileSize: 7000,
    });
    whatsappCloudApi.setMediaContent(
      'https://example.com/media/video.mp4',
      Buffer.from('fake-video-content')
    );
  });

  it('stores video media and publishes a video transcription request', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    const input = createTestInput();

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.messageId).toBeDefined();
    expect(result.value.gcsPath).toContain('whatsapp/');
    expect(result.value.gcsPath).toContain('.mp4');
    expect(result.value.mimeType).toBe('video/mp4');

    const messages = messageRepository.getAll();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      userId: 'test-user-id',
      mediaType: 'video',
      text: 'Video caption',
      caption: 'Video caption',
      media: {
        id: 'video-media-id-123',
        mimeType: 'video/mp4',
        sha256: 'video-sha',
      },
    });

    const events = webhookEventRepository.getAll();
    expect(events[0]?.status).toBe('completed');

    expect(eventPublisher.getMediaTranscriptionRequestedEvents()).toEqual([
      {
        type: 'whatsapp.media.transcription.requested',
        mediaKind: 'video',
        messageSource: 'public_whatsapp',
        userId: 'test-user-id',
        messageId: result.value.messageId,
        mediaId: 'video-media-id-123',
        gcsPath: result.value.gcsPath,
        mimeType: 'video/mp4',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('handles video without caption, sha256, senderName, and phoneNumberId', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    const input = createTestInput({
      senderName: null,
      phoneNumberId: null,
      videoMedia: {
        id: 'video-media-id-123',
        mimeType: 'video/mp4',
      },
    });

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(true);
    const messages = messageRepository.getAll();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('');
    expect(messages[0]?.caption).toBeUndefined();
    expect(messages[0]?.media?.sha256).toBeUndefined();
    expect(messages[0]?.metadata).toBeUndefined();
  });

  it('handles video with only senderName metadata', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    const input = createTestInput({ senderName: 'Test User', phoneNumberId: null });

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(true);
    const messages = messageRepository.getAll();
    expect(messages[0]?.metadata).toEqual({ senderName: 'Test User' });
  });

  it('handles video with only phoneNumberId metadata', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    const input = createTestInput({ senderName: null, phoneNumberId: '123456789012345' });

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(true);
    const messages = messageRepository.getAll();
    expect(messages[0]?.metadata).toEqual({ phoneNumberId: '123456789012345' });
  });

  it('marks the webhook event failed when getting the video URL fails', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    whatsappCloudApi.setFailGetMediaUrl(true);
    const input = createTestInput();

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(false);
    const events = webhookEventRepository.getAll();
    expect(events[0]?.status).toBe('failed');
    expect(events[0]?.failureDetails).toContain('Failed to get video URL');
  });

  it('marks the webhook event failed when downloading video media fails', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    whatsappCloudApi.setFailDownload(true);
    const input = createTestInput();

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(false);
    const events = webhookEventRepository.getAll();
    expect(events[0]?.status).toBe('failed');
    expect(events[0]?.failureDetails).toContain('Failed to download video');
  });

  it('marks the webhook event failed when uploading video media fails', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    mediaStorage.setFailUpload(true);
    const input = createTestInput();

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(false);
    const events = webhookEventRepository.getAll();
    expect(events[0]?.status).toBe('failed');
    expect(events[0]?.failureDetails).toContain('Failed to upload video');
  });

  it('marks the webhook event failed when saving the video message fails', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    messageRepository.setFailSave(true);
    const input = createTestInput();

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(false);
    const events = webhookEventRepository.getAll();
    expect(events[0]?.status).toBe('failed');
    expect(events[0]?.failureDetails).toContain('Failed to save message');
  });

  it('marks the webhook event failed when publishing the transcription request fails', async () => {
    webhookEventRepository.setEvent(createTestWebhookEvent());
    eventPublisher.setMediaTranscriptionRequestedFailure('Pub/Sub unavailable');
    const input = createTestInput();

    const result = await usecase.execute(input, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Pub/Sub unavailable');
    }
    const events = webhookEventRepository.getAll();
    expect(events[0]?.status).toBe('failed');
    expect(events[0]?.failureDetails).toContain('Failed to publish media transcription request');
  });
});
