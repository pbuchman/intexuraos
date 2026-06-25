import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import {
  FakeEventPublisher,
  FakeMediaStorage,
  FakeOutboundMessageRepository,
  FakeThumbnailGeneratorPort,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
  FakeWhatsAppUserMappingRepository,
  FakeWhatsAppWebhookEventRepository,
} from '../fakes.js';
import {
  createAudioWebhookPayload,
  createButtonWebhookPayload,
  createWebhookPayload,
} from '../testUtils.js';
import { ProcessWebhookEventUseCase } from '../../domain/whatsapp/usecases/processWebhookEventUseCase.js';
import type { WhatsAppWebhookEvent } from '../../domain/whatsapp/ports/repositories.js';
import type { WebhookPayload } from '../../routes/schemas.js';

interface MutablePhoneMetadataPayload {
  object: 'whatsapp_business_account';
  entry: { changes: { value: { metadata: { phone_number_id?: string } } }[] }[];
}

interface Harness {
  savedEvent: WhatsAppWebhookEvent;
  useCase: ProcessWebhookEventUseCase;
  webhookEventRepository: FakeWhatsAppWebhookEventRepository;
  userMappingRepository: FakeWhatsAppUserMappingRepository;
  messageRepository: FakeWhatsAppMessageRepository;
  mediaStorage: FakeMediaStorage;
  whatsappCloudApi: FakeWhatsAppCloudApiPort;
  eventPublisher: FakeEventPublisher;
}

function asWebhookPayload(payload: object): WebhookPayload {
  return payload as WebhookPayload;
}

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

async function createHarness(): Promise<Harness> {
  const webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
  const userMappingRepository = new FakeWhatsAppUserMappingRepository();
  const messageRepository = new FakeWhatsAppMessageRepository();
  const mediaStorage = new FakeMediaStorage();
  const whatsappCloudApi = new FakeWhatsAppCloudApiPort();
  const eventPublisher = new FakeEventPublisher();

  const savedEventResult = await webhookEventRepository.saveEvent({
    payload: {},
    signatureValid: true,
    phoneNumberId: null,
    status: 'pending',
    receivedAt: new Date().toISOString(),
  });
  if (!savedEventResult.ok) {
    throw new Error(savedEventResult.error.message);
  }

  const useCase = new ProcessWebhookEventUseCase({
    webhookEventRepository,
    userMappingRepository,
    messageRepository,
    outboundMessageRepository: new FakeOutboundMessageRepository(),
    mediaStorage,
    whatsappCloudApi,
    thumbnailGenerator: new FakeThumbnailGeneratorPort(),
    eventPublisher,
  });

  return {
    savedEvent: savedEventResult.value,
    useCase,
    webhookEventRepository,
    userMappingRepository,
    messageRepository,
    mediaStorage,
    whatsappCloudApi,
    eventPublisher,
  };
}

function prepareAudioMedia(whatsappCloudApi: FakeWhatsAppCloudApiPort, mediaId: string): void {
  whatsappCloudApi.setMediaUrl(mediaId, {
    url: `https://cdn.example.com/${mediaId}.ogg`,
    mimeType: 'audio/ogg',
    fileSize: 2,
  });
  whatsappCloudApi.setMediaContent(
    `https://cdn.example.com/${mediaId}.ogg`,
    Buffer.from([0x00, 0x01])
  );
}

describe('ProcessWebhookEventUseCase text-only branches', () => {
  it('completes audio messages without sending a response when phoneNumberId is missing', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
    } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    prepareAudioMedia(whatsappCloudApi, 'media-audio-1');

    const payload = createAudioWebhookPayload({ mediaId: 'media-audio-1' }) as MutablePhoneMetadataPayload;
    delete payload.entry[0]?.changes[0]?.value.metadata.phone_number_id;

    await useCase.execute(payload as unknown as WebhookPayload, savedEvent, logger());

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('completed');
    expect(messageRepository.getAll()).toHaveLength(1);
    expect(messageRepository.getAll()[0]?.mediaType).toBe('audio');
    expect(mediaStorage.getAllFiles().size).toBe(1);
    expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
  });

  it('marks audio events failed when the unsupported voice response cannot be sent', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
    } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    prepareAudioMedia(whatsappCloudApi, 'media-audio-1');
    whatsappCloudApi.setFailSendMessage(true);

    await useCase.execute(
      asWebhookPayload(createAudioWebhookPayload({ mediaId: 'media-audio-1' })),
      savedEvent,
      logger()
    );

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('failed');
    expect(eventResult.ok && eventResult.value?.retryable).toBe(true);
    expect(eventResult.ok && eventResult.value?.failureDetails).toContain(
      'Failed to send unsupported voice response'
    );
    expect(messageRepository.getAll()).toHaveLength(1);
    expect(messageRepository.getAll()[0]?.mediaType).toBe('audio');
    expect(mediaStorage.getAllFiles().size).toBe(1);
  });

  it('returns after audio storage fails without sending an unsupported response', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
    } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    whatsappCloudApi.setFailGetMediaUrl(true);

    await useCase.execute(
      asWebhookPayload(createAudioWebhookPayload({ mediaId: 'media-audio-1' })),
      savedEvent,
      logger()
    );

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('failed');
    expect(eventResult.ok && eventResult.value?.failureDetails).toContain(
      'Failed to get audio URL'
    );
    expect(messageRepository.getAll()).toHaveLength(0);
    expect(mediaStorage.getAllFiles().size).toBe(0);
    expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
  });

  it('ignores button messages even when marking the source message as read fails', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, whatsappCloudApi } =
      await createHarness();
    const log = logger();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    whatsappCloudApi.setFailMarkAsRead(true);

    await useCase.execute(
      createButtonWebhookPayload({
        buttonId: 'approve:item-1',
        replyToWamid: 'wamid.original',
      }) as WebhookPayload,
      savedEvent,
      log
    );
    await new Promise((resolve) => setImmediate(resolve));

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('ignored');
    expect(eventResult.ok && eventResult.value?.ignoredReason?.code).toBe('BUTTON_NOT_SUPPORTED');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: expect.stringMatching(/^wamid\.button/) }),
      'Failed to mark button message as read with typing'
    );
  });

  it('ignores button messages without attempting read receipts when phoneNumberId is missing', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, whatsappCloudApi } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);

    const payload = createButtonWebhookPayload({
      buttonId: 'approve:item-1',
      replyToWamid: 'wamid.original',
    }) as MutablePhoneMetadataPayload;
    delete payload.entry[0]?.changes[0]?.value.metadata.phone_number_id;

    await useCase.execute(payload as unknown as WebhookPayload, savedEvent, logger());
    await new Promise((resolve) => setImmediate(resolve));

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('ignored');
    expect(eventResult.ok && eventResult.value?.ignoredReason?.code).toBe('BUTTON_NOT_SUPPORTED');
    expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toHaveLength(0);
  });

  it('reuses an existing text message for webhook replays', async () => {
    const { savedEvent, useCase, userMappingRepository, messageRepository, eventPublisher } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    await messageRepository.saveMessage({
      userId: 'user-1',
      waMessageId: 'wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA',
      fromNumber: '15551234567',
      toNumber: '15551234567',
      text: 'Hello, World!',
      mediaType: 'text',
      timestamp: '1234567890',
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    });

    await useCase.execute(asWebhookPayload(createWebhookPayload()), savedEvent, logger());

    expect(messageRepository.getAll()).toHaveLength(1);
    expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(1);
  });
});
