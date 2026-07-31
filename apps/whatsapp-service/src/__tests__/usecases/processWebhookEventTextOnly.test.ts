import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Logger } from '@intexuraos/common-core';
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
  createVideoWebhookPayload,
  createReplyWebhookPayload,
  createWebhookPayload,
} from '../testUtils.js';
import { ProcessWebhookEventUseCase } from '../../domain/whatsapp/usecases/processWebhookEventUseCase.js';
import type { MatrixCorpusIngressPort } from '../../domain/matrixCorpus/ports/matrixCorpusIngress.js';
import type { WhatsAppWebhookEvent } from '../../domain/whatsapp/ports/repositories.js';
import type { WebhookPayload } from '../../routes/schemas.js';
import type { OutboundMessage } from '../../domain/whatsapp/index.js';

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
  outboundMessageRepository: FakeOutboundMessageRepository;
}

function asWebhookPayload(payload: object): WebhookPayload {
  return payload as WebhookPayload;
}

function createTextPayload(body: string): WebhookPayload {
  const payload = createWebhookPayload() as {
    entry: { changes: { value: { messages: { text: { body: string } }[] } }[] }[];
  };
  const message = payload.entry[0]?.changes[0]?.value.messages[0];
  if (message === undefined) {
    throw new Error('Test payload is missing its text message');
  }
  message.text.body = body;
  return payload as unknown as WebhookPayload;
}

function matrixCorpusText(): string {
  return `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · imc1_${'A'.repeat(43)}\n\nbody`;
}

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

async function createHarness(matrixCorpusIngress?: MatrixCorpusIngressPort): Promise<Harness> {
  const webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
  const userMappingRepository = new FakeWhatsAppUserMappingRepository();
  const messageRepository = new FakeWhatsAppMessageRepository();
  const mediaStorage = new FakeMediaStorage();
  const whatsappCloudApi = new FakeWhatsAppCloudApiPort();
  const eventPublisher = new FakeEventPublisher();
  const outboundMessageRepository = new FakeOutboundMessageRepository();

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
    outboundMessageRepository,
    mediaStorage,
    whatsappCloudApi,
    thumbnailGenerator: new FakeThumbnailGeneratorPort(),
    eventPublisher,
    ...(matrixCorpusIngress === undefined ? {} : { matrixCorpusIngress }),
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
    outboundMessageRepository,
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

function prepareVideoMedia(whatsappCloudApi: FakeWhatsAppCloudApiPort, mediaId: string): void {
  whatsappCloudApi.setMediaUrl(mediaId, {
    url: `https://cdn.example.com/${mediaId}.mp4`,
    mimeType: 'video/mp4',
    fileSize: 3,
  });
  whatsappCloudApi.setMediaContent(
    `https://cdn.example.com/${mediaId}.mp4`,
    Buffer.from([0x00, 0x01, 0x02])
  );
}

describe('ProcessWebhookEventUseCase text-only branches', () => {
  it('consumes a mapped valid Matrix corpus header before ordinary side effects', async () => {
    const matrixCorpusIngress = {
      consumeReservedMessage: vi.fn().mockResolvedValue({ code: 'INGEST_ENQUEUED' }),
    };
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, messageRepository, eventPublisher, whatsappCloudApi } = await createHarness(matrixCorpusIngress);
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    const capability = `imc1_${'A'.repeat(43)}`;
    const capturedLogger = logger();

    await useCase.execute(
      createTextPayload(`new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${capability}\n\nbody`),
      savedEvent,
      capturedLogger
    );

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value).toMatchObject({
      status: 'completed',
    });
    expect(matrixCorpusIngress.consumeReservedMessage).toHaveBeenCalledTimes(1);
    expect(matrixCorpusIngress.consumeReservedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        transportMessageId: expect.any(String),
        webhookEventId: savedEvent.id,
        message: expect.objectContaining({ kind: 'matrix_corpus', phase: 'start' }),
      })
    );
    expect(messageRepository.getAll()).toHaveLength(0);
    expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    expect(eventPublisher.getExtractLinkPreviewsEvents()).toHaveLength(0);
    expect(whatsappCloudApi.getMarkedAsReadMessages()).toHaveLength(0);
    const logBytes = JSON.stringify([
      vi.mocked(capturedLogger.info).mock.calls,
      vi.mocked(capturedLogger.warn).mock.calls,
      vi.mocked(capturedLogger.error).mock.calls,
      vi.mocked(capturedLogger.debug).mock.calls,
    ]);
    expect(logBytes).not.toContain(capability);
    expect(logBytes).not.toContain('15551234567');
    expect(logBytes).not.toContain('user-1');
  });

  it('records closed Matrix mapping failures without leaking transport identity', async () => {
    const cases = [
      {
        configure: (repository: FakeWhatsAppUserMappingRepository): void => {
          repository.setFailFindUserByPhoneNumber(true);
        },
        status: 'failed',
        expected: 'Matrix corpus user mapping lookup failed',
      },
      {
        configure: (): void => undefined,
        status: 'user_unmapped',
        expected: 'No user mapping found for Matrix corpus transport',
      },
      {
        configure: (repository: FakeWhatsAppUserMappingRepository): void => {
          repository.setMappingForPhone('15551234567', 'user-1', { connected: false });
        },
        status: 'user_unmapped',
        expected: 'User mapping exists but is disconnected',
      },
    ] as const;

    for (const testCase of cases) {
      const current = await createHarness({
        consumeReservedMessage: vi.fn().mockResolvedValue({ code: 'INGEST_ENQUEUED' }),
      });
      testCase.configure(current.userMappingRepository);
      const capturedLogger = logger();

      await current.useCase.execute(createTextPayload(matrixCorpusText()), current.savedEvent, capturedLogger);

      const eventResult = await current.webhookEventRepository.getEvent(current.savedEvent.id);
      expect(eventResult.ok && eventResult.value?.status).toBe(testCase.status);
      expect(JSON.stringify(eventResult.ok && eventResult.value)).toContain(testCase.expected);
      expect(JSON.stringify(vi.mocked(capturedLogger.info).mock.calls)).not.toContain(
        '15551234567'
      );
    }
  });

  it('returns a static failure when reserved Matrix processing throws unexpectedly', async () => {
    const current = await createHarness({
      consumeReservedMessage: vi.fn().mockResolvedValue({ code: 'INGEST_ENQUEUED' }),
    });
    current.userMappingRepository.setMappingForPhone('15551234567', 'user-1');
    current.userMappingRepository.setThrowOnGetMapping(true);

    await expect(
      current.useCase.execute(createTextPayload(matrixCorpusText()), current.savedEvent, logger())
    ).resolves.toEqual({
      ok: false,
      retryable: false,
      failureDetails: 'Unexpected Matrix corpus webhook processing failure',
    });
  });

  it('rejects malformed and closed-rejection Matrix ingress results without ordinary side effects', async () => {
    for (const [ingressResult, expected] of [
      [{ invalid: true }, 'Matrix corpus ingress returned invalid state'],
      [{ code: 'NOT_READY' }, 'MATRIX_CORPUS_CONTROL_PLANE_NOT_READY'],
      [{ code: 'CAPABILITY_REPLAY' }, 'MATRIX_CORPUS_INGRESS_REJECTED'],
    ] as const) {
      const current = await createHarness({
        consumeReservedMessage: vi.fn().mockResolvedValue(ingressResult),
      } as unknown as MatrixCorpusIngressPort);
      await current.userMappingRepository.saveMapping('user-1', ['15551234567']);

      const result = await current.useCase.execute(
        createTextPayload(matrixCorpusText()),
        current.savedEvent,
        logger()
      );
      const eventResult = await current.webhookEventRepository.getEvent(current.savedEvent.id);
      if ('invalid' in ingressResult) {
        expect(result).toEqual({
          ok: false,
          retryable: true,
          failureDetails: expected,
        });
      } else {
        expect(result).toBeUndefined();
        expect(JSON.stringify(eventResult.ok && eventResult.value?.ignoredReason)).toContain(
          expected
        );
      }
      expect(current.messageRepository.getAll()).toHaveLength(0);
      expect(current.eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    }
  });

  it('rejects a mapped malformed reserved Matrix corpus header before ordinary side effects', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, messageRepository, eventPublisher, whatsappCloudApi } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    const capturedLogger = logger();

    await useCase.execute(
      createTextPayload('🧪 Scenario 001/020 · step 0/5 · imc1_short\n\nbody'),
      savedEvent,
      capturedLogger
    );

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.ignoredReason).toEqual({
      code: 'MATRIX_CORPUS_RESERVED_HEADER_REJECTED', message: 'Reserved Matrix corpus header rejected',
    });
    expect(messageRepository.getAll()).toHaveLength(0);
    expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    expect(eventPublisher.getExtractLinkPreviewsEvents()).toHaveLength(0);
    expect(whatsappCloudApi.getMarkedAsReadMessages()).toHaveLength(0);
    const logBytes = JSON.stringify([
      vi.mocked(capturedLogger.info).mock.calls,
      vi.mocked(capturedLogger.warn).mock.calls,
      vi.mocked(capturedLogger.error).mock.calls,
      vi.mocked(capturedLogger.debug).mock.calls,
    ]);
    expect(logBytes).not.toContain('15551234567');
    expect(logBytes).not.toContain('user-1');
  });

  it('returns a retryable static failure when recording a valid reserved terminal state fails', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, messageRepository, eventPublisher, whatsappCloudApi } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    const capability = `imc1_${'A'.repeat(43)}`;
    vi.spyOn(webhookEventRepository, 'updateEventStatus').mockResolvedValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'storage failure' })
    );

    const result = await useCase.execute(
      createTextPayload(`new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${capability}\n\nbody`),
      savedEvent,
      logger()
    );

    expect(result).toEqual({
      ok: false,
      retryable: true,
      failureDetails: 'Failed to record Matrix corpus terminal status',
    });
    expect(messageRepository.getAll()).toHaveLength(0);
    expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    expect(eventPublisher.getExtractLinkPreviewsEvents()).toHaveLength(0);
    expect(whatsappCloudApi.getMarkedAsReadMessages()).toHaveLength(0);
  });

  it('returns a retryable static failure when recording a malformed reserved terminal state fails', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, messageRepository, eventPublisher, whatsappCloudApi } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    vi.spyOn(webhookEventRepository, 'updateEventStatus').mockResolvedValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'storage failure' })
    );

    const result = await useCase.execute(
      createTextPayload('🧪 Scenario 001/020 · step 0/5 · imc1_short\n\nbody'),
      savedEvent,
      logger()
    );

    expect(result).toEqual({
      ok: false,
      retryable: true,
      failureDetails: 'Failed to record Matrix corpus terminal status',
    });
    expect(messageRepository.getAll()).toHaveLength(0);
    expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    expect(eventPublisher.getExtractLinkPreviewsEvents()).toHaveLength(0);
    expect(whatsappCloudApi.getMarkedAsReadMessages()).toHaveLength(0);
  });

  it('keeps an ordinary new-session text message byte-compatible', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, messageRepository, eventPublisher, whatsappCloudApi } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    const privacyLogger = logger();

    await useCase.execute(
      createTextPayload('new session: normal message'),
      savedEvent,
      privacyLogger
    );

    expect(messageRepository.getAll()[0]?.text).toBe('new session: normal message');
    expect(eventPublisher.getIntexMessageIngestEvents()[0]).toMatchObject({ text: 'new session: normal message', sourceType: 'whatsapp_text' });
    expect(eventPublisher.getExtractLinkPreviewsEvents()).toHaveLength(1);
    expect(whatsappCloudApi.getMarkedAsReadMessages()).toHaveLength(1);
    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('completed');
    expect(
      JSON.stringify([
        vi.mocked(privacyLogger.info).mock.calls,
        vi.mocked(privacyLogger.warn).mock.calls,
        vi.mocked(privacyLogger.error).mock.calls,
        vi.mocked(privacyLogger.debug).mock.calls,
      ])
    ).not.toContain('15551234567');
  });

  it('completes audio messages without sending a response when phoneNumberId is missing', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
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
    expect(eventPublisher.getAudioStoredEvents()).toHaveLength(1);
  });

  it('does not send the old unsupported voice response after audio storage', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
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
    expect(eventResult.ok && eventResult.value?.status).toBe('completed');
    expect(messageRepository.getAll()).toHaveLength(1);
    expect(messageRepository.getAll()[0]?.mediaType).toBe('audio');
    expect(mediaStorage.getAllFiles().size).toBe(1);
    expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
    expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toHaveLength(1);
    expect(eventPublisher.getAudioStoredEvents()).toHaveLength(1);
  });

  it('completes video messages without marking read when phoneNumberId is missing', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      webhookEventRepository,
      messageRepository,
      mediaStorage,
      whatsappCloudApi,
      eventPublisher,
    } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    prepareVideoMedia(whatsappCloudApi, 'media-video-1');

    const payload = createVideoWebhookPayload({ mediaId: 'media-video-1' }) as MutablePhoneMetadataPayload;
    delete payload.entry[0]?.changes[0]?.value.metadata.phone_number_id;

    await useCase.execute(payload as unknown as WebhookPayload, savedEvent, logger());

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('completed');
    expect(messageRepository.getAll()).toHaveLength(1);
    expect(messageRepository.getAll()[0]?.mediaType).toBe('video');
    expect(mediaStorage.getAllFiles().size).toBe(1);
    expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toHaveLength(0);
    expect(eventPublisher.getMediaTranscriptionRequestedEvents()).toHaveLength(1);
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

  it('publishes Intex confirmation button messages to the ingest topic', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, eventPublisher } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);

    await useCase.execute(
      createButtonWebhookPayload({
        buttonId: 'intex_confirm:confirm-1:yes',
        buttonTitle: 'Tak',
        replyToWamid: 'wamid.confirmation',
      }) as WebhookPayload,
      savedEvent,
      logger()
    );

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(eventResult.ok && eventResult.value?.status).toBe('completed');
    expect(eventPublisher.getIntexMessageIngestEvents()).toEqual([
      {
        type: 'intex.message.ingest',
        userId: 'user-1',
        messageId: expect.stringMatching(/^wamid\.button/),
        sourceType: 'whatsapp_button',
        text: '',
        whatsappSender: '15551234567',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid.confirmation',
        },
        timestamp: '1234567890',
      },
    ]);
  });

  it('marks Intex confirmation button publishing failures as retryable', async () => {
    const { savedEvent, useCase, userMappingRepository, webhookEventRepository, eventPublisher } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    eventPublisher.setIntexMessageIngestFailure('pubsub unavailable');

    const result = await useCase.execute(
      createButtonWebhookPayload({
        buttonId: 'intex_confirm:confirm-1:yes',
        buttonTitle: 'Tak',
        replyToWamid: 'wamid.confirmation',
      }) as WebhookPayload,
      savedEvent,
      logger()
    );

    const eventResult = await webhookEventRepository.getEvent(savedEvent.id);
    expect(result).toEqual({
      ok: false,
      retryable: true,
      failureDetails: 'Failed to publish intex message ingest: pubsub unavailable',
    });
    expect(eventResult.ok && eventResult.value?.status).toBe('failed');
    expect(eventResult.ok && eventResult.value?.failureDetails).toBe(
      'Failed to publish intex message ingest: pubsub unavailable'
    );
    expect(eventPublisher.getIntexMessageIngestEvents()).toEqual([]);
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

  it('publishes replied-to inbound user message text as safe Intex context', async () => {
    const { savedEvent, useCase, userMappingRepository, messageRepository, eventPublisher } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    await messageRepository.saveMessage({
      userId: 'user-1',
      waMessageId: 'wamid.original-user-message',
      fromNumber: '15551234567',
      toNumber: '15551234567',
      text: 'Tomorrow morning please list my calendar events',
      mediaType: 'text',
      timestamp: '1234567800',
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    });

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.original-user-message',
          messageText: 'yes, that one',
        })
      ),
      savedEvent,
      logger()
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext).toEqual({
      replyToWamid: 'wamid.original-user-message',
      source: 'inbound_user_message',
      text: 'Tomorrow morning please list my calendar events',
      truncated: false,
    });
  });

  it('publishes replied-to completed audio transcription as safe Intex context', async () => {
    const { savedEvent, useCase, userMappingRepository, messageRepository, eventPublisher } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    messageRepository.setMessage({
      id: 'stored-audio-message-1',
      userId: 'user-1',
      waMessageId: 'wamid.original-audio-message',
      fromNumber: '15551234567',
      toNumber: '15551234567',
      text: '',
      mediaType: 'audio',
      media: {
        id: 'media-audio-1',
        mimeType: 'audio/ogg',
        fileSize: 42,
      },
      gcsPath: 'whatsapp/user-1/wamid.original-audio-message/media-audio-1.ogg',
      transcription: {
        status: 'completed',
        jobId: 'job-audio-1',
        text: 'Forwarded audio transcript with the details to act on.',
        completedAt: '2026-06-28T10:00:00.000Z',
      },
      timestamp: '1234567800',
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    });

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.original-audio-message',
          messageText: 'summarize this and make it actionable',
        })
      ),
      savedEvent,
      logger()
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext).toEqual({
      replyToWamid: 'wamid.original-audio-message',
      source: 'inbound_user_message',
      text: 'Forwarded audio transcript with the details to act on.',
      truncated: false,
    });
  });

  it('does not publish reply context for replied-to audio without a completed transcript', async () => {
    const { savedEvent, useCase, userMappingRepository, messageRepository, eventPublisher } =
      await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    messageRepository.setMessage({
      id: 'stored-audio-message-2',
      userId: 'user-1',
      waMessageId: 'wamid.pending-audio-message',
      fromNumber: '15551234567',
      toNumber: '15551234567',
      text: '',
      mediaType: 'audio',
      media: {
        id: 'media-audio-2',
        mimeType: 'audio/ogg',
        fileSize: 42,
      },
      gcsPath: 'whatsapp/user-1/wamid.pending-audio-message/media-audio-2.ogg',
      transcription: {
        status: 'failed',
        jobId: 'job-audio-2',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Could not transcribe',
        },
        completedAt: '2026-06-28T10:00:00.000Z',
      },
      timestamp: '1234567800',
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    });

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.pending-audio-message',
          messageText: 'try this again',
        })
      ),
      savedEvent,
      logger()
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext).toBeUndefined();
  });

  it('publishes replied-to outbound assistant message text as safe Intex context', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      outboundMessageRepository,
      eventPublisher,
    } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    const outboundMessage = {
      wamid: 'wamid.original-assistant-message',
      correlationId: 'session-1',
      userId: 'user-1',
      sentAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      messageText: 'What would you like me to help with?',
    } satisfies OutboundMessage & { messageText: string };
    await outboundMessageRepository.save(outboundMessage);

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.original-assistant-message',
          messageText: 'show tomorrow calendar events',
        })
      ),
      savedEvent,
      logger()
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext).toEqual({
      replyToWamid: 'wamid.original-assistant-message',
      source: 'outbound_assistant_message',
      text: 'What would you like me to help with?',
      truncated: false,
    });
  });

  it('publishes comments on a transcription reply as instructions with transcript context', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      outboundMessageRepository,
      eventPublisher,
    } = await createHarness();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    await outboundMessageRepository.save({
      wamid: 'wamid.transcription-reply',
      correlationId: 'transcription:stored-audio-message-1:job-audio-1',
      userId: 'user-1',
      messageText: 'Transcription:\nForwarded audio transcript with the details to act on.',
      sentAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.transcription-reply',
          messageText: 'summarize action items and make a note',
        })
      ),
      savedEvent,
      logger()
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]).toMatchObject({
      text: 'summarize action items and make a note',
      replyContext: {
        replyToWamid: 'wamid.transcription-reply',
        source: 'outbound_assistant_message',
        text: 'Transcription: Forwarded audio transcript with the details to act on.',
        truncated: false,
      },
    });
  });

  it('falls back to outbound reply context when inbound lookup fails', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      messageRepository,
      outboundMessageRepository,
      eventPublisher,
    } = await createHarness();
    const log = logger();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    vi.spyOn(messageRepository, 'findByWaMessageId')
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(err({ code: 'INTERNAL_ERROR', message: 'Simulated lookup failure' }));
    await outboundMessageRepository.save({
      wamid: 'wamid.original-assistant-message',
      correlationId: 'session-1',
      userId: 'user-1',
      sentAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      messageText: 'What would you like me to help with?',
    });

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.original-assistant-message',
          messageText: 'show tomorrow calendar events',
        })
      ),
      savedEvent,
      log
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext).toEqual({
      replyToWamid: 'wamid.original-assistant-message',
      source: 'outbound_assistant_message',
      text: 'What would you like me to help with?',
      truncated: false,
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ replyToWamid: 'wamid.original-assistant-message' }),
      'Failed to resolve inbound WhatsApp reply context'
    );
  });

  it('publishes no reply context when outbound lookup fails', async () => {
    const {
      savedEvent,
      useCase,
      userMappingRepository,
      outboundMessageRepository,
      eventPublisher,
    } = await createHarness();
    const log = logger();
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    outboundMessageRepository.setFail(true);

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.original-assistant-message',
          messageText: 'show tomorrow calendar events',
        })
      ),
      savedEvent,
      log
    );

    expect(eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext).toBeUndefined();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ replyToWamid: 'wamid.original-assistant-message' }),
      'Failed to resolve outbound WhatsApp reply context'
    );
  });

  it('truncates long replied-to message text before publishing Intex context', async () => {
    const { savedEvent, useCase, userMappingRepository, messageRepository, eventPublisher } =
      await createHarness();
    const longText = 'x'.repeat(1300);
    await userMappingRepository.saveMapping('user-1', ['15551234567']);
    await messageRepository.saveMessage({
      userId: 'user-1',
      waMessageId: 'wamid.long-user-message',
      fromNumber: '15551234567',
      toNumber: '15551234567',
      text: longText,
      mediaType: 'text',
      timestamp: '1234567800',
      receivedAt: new Date().toISOString(),
      webhookEventId: savedEvent.id,
    });

    await useCase.execute(
      asWebhookPayload(
        createReplyWebhookPayload({
          replyToWamid: 'wamid.long-user-message',
          messageText: 'yes, that one',
        })
      ),
      savedEvent,
      logger()
    );

    const replyContext = eventPublisher.getIntexMessageIngestEvents()[0]?.replyContext;
    expect(replyContext).toEqual({
      replyToWamid: 'wamid.long-user-message',
      source: 'inbound_user_message',
      text: expect.stringMatching(/\.\.\.$/),
      truncated: true,
    });
    expect(replyContext?.text).toHaveLength(1200);
  });
});
