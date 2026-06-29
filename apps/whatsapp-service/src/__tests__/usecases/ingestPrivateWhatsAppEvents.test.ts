import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import {
  type AudioStoredEvent,
  type EventPublisherPort,
  type ExtractLinkPreviewsEvent,
  IngestPrivateWhatsAppEventsUseCase,
  type DisablePrivateWhatsAppAccountInput,
  type IntexMessageIngestEvent,
  type IngestPrivateWhatsAppEventInput,
  type IngestPrivateWhatsAppEventsInput,
  type MediaCleanupEvent,
  type MediaTranscriptionRequestedEvent,
  type PrivateWhatsAppAccount,
  type PrivateWhatsAppAggregateRebuildInput,
  type PrivateWhatsAppAggregateRebuildResult,
  type PrivateWhatsAppChat,
  type PrivateWhatsAppChatQueryInput,
  type PrivateWhatsAppChatQueryResult,
  type PrivateWhatsAppIngestOutcome,
  type PrivateWhatsAppMessageQueryInput,
  type PrivateWhatsAppMessageQueryResult,
  type PrivateWhatsAppRepository,
  type PrivateWhatsAppSenderQueryInput,
  type PrivateWhatsAppSenderQueryResult,
  type PrivateWhatsAppSenderDayQueryInput,
  type PrivateWhatsAppSenderDayQueryResult,
  type PrivateWhatsAppTranscriptionState,
  type StorePrivateWhatsAppMessageInput,
  type UpdatePrivateWhatsAppChatTranscriptionInput,
  type UpdatePrivateWhatsAppMessageTranscriptionInput,
  type UpsertPrivateWhatsAppAccountInput,
  type WebhookProcessEvent,
  type WhatsAppError,
} from '../../domain/whatsapp/index.js';
import type { Logger } from '../../domain/whatsapp/utils/logger.js';

const logger: Logger = {
  info: (): void => undefined,
  error: (): void => undefined,
};

function createEvent(overrides: Partial<IngestPrivateWhatsAppEventInput> = {}): IngestPrivateWhatsAppEventInput {
  return {
    matrixRoomId: '!room:matrix.example',
    matrixEventId: '$event-1',
    matrixSenderId: '@sender:matrix.example',
    eventTimestamp: '2026-06-22T10:00:00.000Z',
    chat: {
      type: 'direct',
      displayName: 'Alice',
    },
    sender: {
      displayName: 'Alice',
      phoneNumber: '+48123456789',
    },
    message: {
      direction: 'incoming',
      type: 'text',
      text: 'hello from private whatsapp',
    },
    rawMatrixEvent: {
      type: 'm.room.message',
      event_id: '$event-1',
    },
    ...overrides,
  };
}

function createInput(
  overrides: Partial<IngestPrivateWhatsAppEventsInput> = {}
): IngestPrivateWhatsAppEventsInput {
  return {
    sourceAccountId: 'pbuchman-private-whatsapp',
    userId: 'user-123',
    deliveryMode: 'live',
    events: [createEvent()],
    ...overrides,
  };
}

class TestPrivateWhatsAppRepository implements PrivateWhatsAppRepository {
  readonly stored: StorePrivateWhatsAppMessageInput[] = [];
  readonly transcriptions: { messageId: string; transcription: PrivateWhatsAppTranscriptionState }[] = [];
  private readonly seenEventIds = new Map<string, PrivateWhatsAppIngestOutcome>();
  failNextStore = false;
  chatTranscriptionEnabled = false;

  getAccountByUserId(
    _userId: string
  ): Promise<Result<PrivateWhatsAppAccount | null, WhatsAppError>> {
    return Promise.resolve(ok(null));
  }

  getActiveAccountBySourceAccountId(
    _sourceAccountId: string
  ): Promise<Result<PrivateWhatsAppAccount | null, WhatsAppError>> {
    return Promise.resolve(ok(null));
  }

  upsertAccount(
    _input: UpsertPrivateWhatsAppAccountInput
  ): Promise<Result<PrivateWhatsAppAccount, WhatsAppError>> {
    return Promise.resolve(
      err({ code: 'INTERNAL_ERROR', message: 'Account writes are not used by this fake' })
    );
  }

  disableAccount(
    _input: DisablePrivateWhatsAppAccountInput
  ): Promise<Result<PrivateWhatsAppAccount, WhatsAppError>> {
    return Promise.resolve(
      err({ code: 'NOT_FOUND', message: 'Account writes are not used by this fake' })
    );
  }

  storeIncomingMessage(
    input: StorePrivateWhatsAppMessageInput
  ): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>> {
    if (this.failNextStore) {
      this.failNextStore = false;
      return Promise.resolve(
        err({ code: 'PERSISTENCE_ERROR', message: 'Failed to persist private WhatsApp message' })
      );
    }

    const existing = this.seenEventIds.get(input.message.matrixEventId);
    if (existing !== undefined) {
      return Promise.resolve(ok({ ...existing, outcome: 'duplicate' }));
    }

    const outcome: PrivateWhatsAppIngestOutcome = {
      outcome: 'created',
      chatId: `chat-${String(this.stored.length + 1)}`,
      messageId: `message-${String(this.stored.length + 1)}`,
      matrixEventId: input.message.matrixEventId,
      chatTranscriptionEnabled: this.chatTranscriptionEnabled,
    };
    this.stored.push(input);
    this.seenEventIds.set(input.message.matrixEventId, outcome);
    return Promise.resolve(ok(outcome));
  }

  getMessageById(_messageId: string): Promise<Result<null, WhatsAppError>> {
    return Promise.resolve(ok(null));
  }

  updateChatTranscriptionSetting(
    _input: UpdatePrivateWhatsAppChatTranscriptionInput
  ): Promise<Result<PrivateWhatsAppChat, WhatsAppError>> {
    return Promise.resolve(
      err({ code: 'NOT_FOUND', message: 'Chat writes are not used by this fake' })
    );
  }

  updateMessageTranscription(
    input: UpdatePrivateWhatsAppMessageTranscriptionInput
  ): Promise<Result<void, WhatsAppError>> {
    this.transcriptions.push({
      messageId: input.messageId,
      transcription: input.transcription,
    });
    return Promise.resolve(ok(undefined));
  }

  findMessages(
    _input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>> {
    return Promise.resolve(ok({ messages: [] }));
  }

  findChats(
    _input: PrivateWhatsAppChatQueryInput
  ): Promise<Result<PrivateWhatsAppChatQueryResult, WhatsAppError>> {
    return Promise.resolve(ok({ chats: [] }));
  }

  findSenders(
    _input: PrivateWhatsAppSenderQueryInput
  ): Promise<Result<PrivateWhatsAppSenderQueryResult, WhatsAppError>> {
    return Promise.resolve(ok({ senders: [] }));
  }

  findSenderDays(
    _input: PrivateWhatsAppSenderDayQueryInput
  ): Promise<Result<PrivateWhatsAppSenderDayQueryResult, WhatsAppError>> {
    return Promise.resolve(ok({ senderDays: [] }));
  }

  rebuildAggregates(
    _input: PrivateWhatsAppAggregateRebuildInput
  ): Promise<Result<PrivateWhatsAppAggregateRebuildResult, WhatsAppError>> {
    return Promise.resolve(
      ok({ scannedMessages: 0, upgradedMessages: 0, senderCount: 0, senderDayCount: 0 })
    );
  }
}

class TestEventPublisher implements EventPublisherPort {
  readonly audioStoredEvents: AudioStoredEvent[] = [];
  readonly mediaTranscriptionRequestedEvents: MediaTranscriptionRequestedEvent[] = [];
  failNextAudioStored = false;
  failNextMediaTranscriptionRequested = false;

  publishMediaCleanup(_event: MediaCleanupEvent): Promise<Result<void, WhatsAppError>> {
    return Promise.resolve(ok(undefined));
  }

  publishAudioStored(event: AudioStoredEvent): Promise<Result<void, WhatsAppError>> {
    if (this.failNextAudioStored) {
      this.failNextAudioStored = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Audio publish failed' }));
    }
    this.audioStoredEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishMediaTranscriptionRequested(
    event: MediaTranscriptionRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    if (this.failNextMediaTranscriptionRequested) {
      this.failNextMediaTranscriptionRequested = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Media transcription publish failed' })
      );
    }
    this.mediaTranscriptionRequestedEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishIntexMessageIngest(_event: IntexMessageIngestEvent): Promise<Result<void, WhatsAppError>> {
    return Promise.resolve(ok(undefined));
  }

  publishWebhookProcess(_event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>> {
    return Promise.resolve(ok(undefined));
  }

  publishExtractLinkPreviews(_event: ExtractLinkPreviewsEvent): Promise<Result<void, WhatsAppError>> {
    return Promise.resolve(ok(undefined));
  }
}

describe('IngestPrivateWhatsAppEventsUseCase', () => {
  let repository: TestPrivateWhatsAppRepository;
  let eventPublisher: TestEventPublisher;
  let useCase: IngestPrivateWhatsAppEventsUseCase;

  beforeEach(() => {
    repository = new TestPrivateWhatsAppRepository();
    eventPublisher = new TestEventPublisher();
    useCase = new IngestPrivateWhatsAppEventsUseCase({
      privateWhatsAppRepository: repository,
      eventPublisher,
    });
  });

  it('stores incoming live Matrix events as private WhatsApp messages', async () => {
    const result = await useCase.execute(createInput(), logger);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      messages: [
        {
          matrixEventId: '$event-1',
          messageId: 'message-1',
          chatId: 'chat-1',
          outcome: 'created',
        },
      ],
    });
    expect(repository.stored).toHaveLength(1);
    expect(repository.stored[0]?.deliveryMode).toBe('live');
    expect(repository.stored[0]?.message.text).toBe('hello from private whatsapp');
    expect(repository.stored[0]?.message.direction).toBe('incoming');
  });

  it('stores outgoing Matrix events from the private account owner', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$outgoing-event-1',
            matrixSenderId: '@pbuchman:home-dev',
            sender: {
              displayName: 'You',
            },
            message: {
              direction: 'outgoing',
              type: 'text',
              text: 'sent by me',
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    expect(repository.stored).toHaveLength(1);
    expect(repository.stored[0]?.message.direction).toBe('outgoing');
    expect(repository.stored[0]?.message.senderDisplayName).toBe('You');
    expect(repository.stored[0]?.message.senderKey).toBe('matrix:@pbuchman:home-dev');
  });

  it('preserves stored private image media fields from the Matrix adapter', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$stored-image',
            message: {
              direction: 'incoming',
              type: 'image',
              text: 'image.jpg',
              media: {
                mxcUri: 'mxc://home-dev/image',
                mimeType: 'image/jpeg',
                fileName: 'image.jpg',
                sizeBytes: 11,
                width: 1280,
                height: 720,
                durationMs: 3456,
                sha256: 'sha256-value',
                storageStatus: 'stored',
                gcsPath: 'whatsapp/private/user-123/message/image.jpg',
                thumbnailGcsPath: 'whatsapp/private/user-123/message/image_thumb.jpg',
                storedMimeType: 'image/jpeg',
                storedSizeBytes: 11,
                storedAt: '2026-06-26T10:00:00.000Z',
              },
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(repository.stored[0]?.message.media).toEqual({
      mxcUri: 'mxc://home-dev/image',
      mimeType: 'image/jpeg',
      fileName: 'image.jpg',
      sizeBytes: 11,
      width: 1280,
      height: 720,
      durationMs: 3456,
      sha256: 'sha256-value',
      storageStatus: 'stored',
      gcsPath: 'whatsapp/private/user-123/message/image.jpg',
      thumbnailGcsPath: 'whatsapp/private/user-123/message/image_thumb.jpg',
      storedMimeType: 'image/jpeg',
      storedSizeBytes: 11,
      storedAt: '2026-06-26T10:00:00.000Z',
    });
  });

  it('derives sender identity and Europe/Warsaw day metadata before persistence', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            eventTimestamp: '2026-06-22T22:30:00.000Z',
            sender: {
              displayName: 'Alice',
              phoneNumber: '+48 123 456 789',
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    const stored = repository.stored[0] as StorePrivateWhatsAppMessageInput | undefined;
    expect(stored?.message.senderKey).toBe('phone:+48123456789');
    expect(stored?.message.senderPhoneNumberNormalized).toBe('48123456789');
    expect(stored?.message.eventDayKey).toBe('2026-06-23');
    expect(stored?.message.eventTimeZone).toBe('Europe/Warsaw');
  });

  it('falls back to Matrix sender id when phone metadata is absent', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixSenderId: '@whatsapp_unknown:home-dev',
            sender: {
              displayName: 'Unknown Sender',
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    const stored = repository.stored[0] as StorePrivateWhatsAppMessageInput | undefined;
    expect(stored?.message.senderKey).toBe('matrix:@whatsapp_unknown:home-dev');
    expect(stored?.message.senderPhoneNumberNormalized).toBeUndefined();
    expect(stored?.message.eventDayKey).toBe('2026-06-22');
  });

  it('falls back to Matrix sender id when phone metadata contains no digits', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixSenderId: '@alice:matrix.example',
            sender: {
              displayName: 'Alice',
              phoneNumber: 'not a phone number',
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    const stored = repository.stored[0] as StorePrivateWhatsAppMessageInput | undefined;
    expect(stored?.message.senderKey).toBe('matrix:@alice:matrix.example');
    expect(stored?.message.senderPhoneNumberNormalized).toBeUndefined();
  });

  it('marks repeated Matrix event ids as duplicates', async () => {
    const firstResult = await useCase.execute(createInput(), logger);
    expect(firstResult.ok).toBe(true);

    const duplicateResult = await useCase.execute(createInput(), logger);

    expect(duplicateResult.ok).toBe(true);
    if (!duplicateResult.ok) throw new Error(duplicateResult.error.message);
    expect(duplicateResult.value).toMatchObject({
      accepted: 0,
      duplicates: 1,
      rejected: 0,
      messages: [{ matrixEventId: '$event-1', outcome: 'duplicate' }],
    });
    expect(repository.stored).toHaveLength(1);
  });

  it('publishes private audio transcription jobs only for enabled chats and created events', async () => {
    repository.chatTranscriptionEnabled = true;
    const audioEvent = createEvent({
      matrixEventId: '$audio-event-1',
      message: {
        direction: 'incoming',
        type: 'audio',
        media: {
          mxcUri: 'mxc://home-dev/audio-event-1',
          mimeType: 'audio/ogg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message-1/audio.ogg',
          storedMimeType: 'audio/ogg',
          storedSizeBytes: 1234,
        },
      },
    });

    const firstResult = await useCase.execute(createInput({ events: [audioEvent] }), logger);
    const duplicateResult = await useCase.execute(createInput({ events: [audioEvent] }), logger);

    expect(firstResult.ok).toBe(true);
    expect(duplicateResult.ok).toBe(true);
    expect(eventPublisher.audioStoredEvents).toEqual([
      {
        type: 'whatsapp.audio.stored',
        messageSource: 'private_whatsapp',
        userId: 'user-123',
        messageId: 'message-1',
        mediaId: 'mxc://home-dev/audio-event-1',
        gcsPath: 'whatsapp/private/user-123/message-1/audio.ogg',
        mimeType: 'audio/ogg',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('skips private audio transcription jobs when the chat is disabled or audio is not stored', async () => {
    const disabledResult = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$disabled-audio',
            message: {
              direction: 'incoming',
              type: 'audio',
              media: {
                mxcUri: 'mxc://home-dev/disabled-audio',
                mimeType: 'audio/ogg',
                storageStatus: 'stored',
                gcsPath: 'whatsapp/private/user-123/message-1/audio.ogg',
              },
            },
          }),
        ],
      }),
      logger
    );
    repository.chatTranscriptionEnabled = true;
    const missingStorageResult = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$unstored-audio',
            message: {
              direction: 'incoming',
              type: 'audio',
              media: {
                mxcUri: 'mxc://home-dev/unstored-audio',
                mimeType: 'audio/ogg',
              },
            },
          }),
        ],
      }),
      logger
    );

    expect(disabledResult.ok).toBe(true);
    expect(missingStorageResult.ok).toBe(true);
    expect(eventPublisher.audioStoredEvents).toEqual([]);
  });

  it('skips private audio transcription jobs for non-audio messages even when chat transcription is enabled', async () => {
    repository.chatTranscriptionEnabled = true;

    const result = await useCase.execute(createInput(), logger);

    expect(result.ok).toBe(true);
    expect(eventPublisher.audioStoredEvents).toEqual([]);
  });

  it('publishes private video transcription jobs only for enabled chats and created events', async () => {
    repository.chatTranscriptionEnabled = true;
    const videoEvent = createEvent({
      matrixEventId: '$video-event-1',
      message: {
        direction: 'incoming',
        type: 'video',
        media: {
          mxcUri: 'mxc://home-dev/video-event-1',
          mimeType: 'video/mp4',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message-1/video.mp4',
          storedMimeType: 'video/mp4',
          storedSizeBytes: 4321,
        },
      },
    });

    const firstResult = await useCase.execute(createInput({ events: [videoEvent] }), logger);
    const duplicateResult = await useCase.execute(createInput({ events: [videoEvent] }), logger);

    expect(firstResult.ok).toBe(true);
    expect(duplicateResult.ok).toBe(true);
    expect(eventPublisher.mediaTranscriptionRequestedEvents).toEqual([
      {
        type: 'whatsapp.media.transcription.requested',
        messageSource: 'private_whatsapp',
        mediaKind: 'video',
        userId: 'user-123',
        messageId: 'message-1',
        mediaId: 'mxc://home-dev/video-event-1',
        gcsPath: 'whatsapp/private/user-123/message-1/video.mp4',
        mimeType: 'video/mp4',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('returns a persistence error when publishing a private audio transcription job fails', async () => {
    repository.chatTranscriptionEnabled = true;
    eventPublisher.failNextAudioStored = true;

    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$audio-publish-failure',
            message: {
              direction: 'incoming',
              type: 'audio',
              media: {
                mxcUri: 'mxc://home-dev/audio-publish-failure',
                mimeType: 'audio/ogg',
                storageStatus: 'stored',
                gcsPath: 'whatsapp/private/user-123/audio-publish-failure/audio.ogg',
              },
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected publish failure');
    expect(result.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Audio publish failed',
    });
    expect(eventPublisher.audioStoredEvents).toEqual([]);
  });

  it('rejects unsupported directions without writing them', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$event-outgoing',
            message: {
              direction: 'sideways',
              type: 'text',
              text: 'sent from me',
            },
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      accepted: 0,
      duplicates: 0,
      rejected: 1,
      messages: [
        {
          matrixEventId: '$event-outgoing',
          outcome: 'rejected',
          reason: 'unsupported_direction',
        },
      ],
    });
    expect(repository.stored).toHaveLength(0);
  });

  it('keeps valid events when the same batch contains an invalid event', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({ matrixEventId: '$event-valid' }),
          createEvent({
            matrixEventId: '$event-invalid',
            matrixRoomId: '',
          }),
        ],
      }),
      logger
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.accepted).toBe(1);
    expect(result.value.rejected).toBe(1);
    expect(result.value.messages.map((message) => message.outcome)).toEqual([
      'created',
      'rejected',
    ]);
    expect(repository.stored).toHaveLength(1);
  });

  it('reports parser rejection reasons for malformed Matrix events', async () => {
    const validEvent = createEvent();
    const malformedEvents: unknown[] = [
      'not-an-event',
      { ...validEvent, matrixEventId: '' },
      { ...validEvent, matrixEventId: '$missing-room', matrixRoomId: '' },
      { ...validEvent, matrixEventId: '$missing-sender', matrixSenderId: '' },
      { ...validEvent, matrixEventId: '$missing-timestamp', eventTimestamp: '' },
      { ...validEvent, matrixEventId: '$invalid-timestamp', eventTimestamp: 'not-a-date' },
      { ...validEvent, matrixEventId: '$invalid-received-type', receivedAt: 42 },
      {
        ...validEvent,
        matrixEventId: '$invalid-received-date',
        receivedAt: 'not-a-date',
      },
      { ...validEvent, matrixEventId: '$missing-message', message: undefined },
      {
        ...validEvent,
        matrixEventId: '$media-not-object',
        message: { ...validEvent.message, media: 'mxc://matrix.example/media' },
      },
      {
        ...validEvent,
        matrixEventId: '$missing-media-uri',
        message: { ...validEvent.message, media: { mimeType: 'image/jpeg' } },
      },
    ];

    const result = await useCase.execute(createInput({ events: malformedEvents }), logger);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.accepted).toBe(0);
    expect(result.value.rejected).toBe(malformedEvents.length);
    expect(result.value.messages).toEqual([
      { matrixEventId: '<unknown>', outcome: 'rejected', reason: 'invalid_event' },
      {
        matrixEventId: '<unknown>',
        outcome: 'rejected',
        reason: 'missing_matrix_event_id',
      },
      {
        matrixEventId: '$missing-room',
        outcome: 'rejected',
        reason: 'missing_matrix_room_id',
      },
      {
        matrixEventId: '$missing-sender',
        outcome: 'rejected',
        reason: 'missing_matrix_sender_id',
      },
      {
        matrixEventId: '$missing-timestamp',
        outcome: 'rejected',
        reason: 'missing_event_timestamp',
      },
      {
        matrixEventId: '$invalid-timestamp',
        outcome: 'rejected',
        reason: 'invalid_event_timestamp',
      },
      {
        matrixEventId: '$invalid-received-type',
        outcome: 'rejected',
        reason: 'invalid_received_at',
      },
      {
        matrixEventId: '$invalid-received-date',
        outcome: 'rejected',
        reason: 'invalid_received_at',
      },
      { matrixEventId: '$missing-message', outcome: 'rejected', reason: 'missing_message' },
      {
        matrixEventId: '$media-not-object',
        outcome: 'rejected',
        reason: 'missing_media_mxc_uri',
      },
      {
        matrixEventId: '$missing-media-uri',
        outcome: 'rejected',
        reason: 'missing_media_mxc_uri',
      },
    ]);
    expect(repository.stored).toHaveLength(0);
  });

  it('normalizes sparse Matrix payloads and preserves media metadata', async () => {
    const noChatEvent = {
      matrixRoomId: '!room-no-chat:matrix.example',
      matrixEventId: '$event-no-chat',
      matrixSenderId: '@sender:matrix.example',
      eventTimestamp: '2026-06-22T10:01:00.000Z',
      message: {
        direction: 'incoming',
        type: 'text',
        text: 'message without chat metadata',
      },
    };
    const sparseChatEvent = {
      matrixRoomId: '!room-sparse:matrix.example',
      matrixEventId: '$event-sparse',
      matrixSenderId: '@sender:matrix.example',
      eventTimestamp: '2026-06-22T10:02:00.000Z',
      chat: {},
      message: {
        direction: 'incoming',
      },
    };
    const mediaEvent = {
      matrixRoomId: '!room-media:matrix.example',
      matrixEventId: '$event-media',
      matrixSenderId: '@sender:matrix.example',
      eventTimestamp: '2026-06-22T10:03:00.000Z',
      receivedAt: '2026-06-22T10:03:05.000Z',
      chat: {
        type: 'broadcast',
        avatarMxcUri: 'mxc://matrix.example/avatar',
      },
      sender: {},
      message: {
        direction: 'incoming',
        type: 'location',
        media: {
          mxcUri: 'mxc://matrix.example/media',
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          sizeBytes: 12345,
          sha256: 'hash123',
        },
      },
    };
    const minimalMediaEvent = {
      matrixRoomId: '!room-minimal-media:matrix.example',
      matrixEventId: '$event-minimal-media',
      matrixSenderId: '@sender:matrix.example',
      eventTimestamp: '2026-06-22T10:04:00.000Z',
      chat: {
        type: 'direct',
      },
      message: {
        direction: 'incoming',
        type: 'image',
        media: {
          mxcUri: 'mxc://matrix.example/minimal-media',
        },
      },
    };

    const result = await useCase.execute(
      createInput({ events: [noChatEvent, sparseChatEvent, mediaEvent, minimalMediaEvent] }),
      logger
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.accepted).toBe(4);
    expect(repository.stored).toHaveLength(4);

    expect(repository.stored[0]?.chat.type).toBe('unknown');
    expect(repository.stored[0]?.message.type).toBe('text');
    expect(repository.stored[0]?.message.rawMatrixEvent).toBe(noChatEvent);

    expect(repository.stored[1]?.chat.type).toBe('unknown');
    expect(repository.stored[1]?.message.type).toBe('unknown');
    expect(repository.stored[1]?.message.text).toBeUndefined();

    expect(repository.stored[2]?.receivedAt).toBe('2026-06-22T10:03:05.000Z');
    expect(repository.stored[2]?.chat.type).toBe('unknown');
    expect(repository.stored[2]?.chat.avatarMxcUri).toBe('mxc://matrix.example/avatar');
    expect(repository.stored[2]?.message.type).toBe('unknown');
    expect(repository.stored[2]?.message.senderDisplayName).toBeUndefined();
    expect(repository.stored[2]?.message.senderPhoneNumber).toBeUndefined();
    expect(repository.stored[2]?.message.media).toEqual({
      mxcUri: 'mxc://matrix.example/media',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      sizeBytes: 12345,
      sha256: 'hash123',
    });

    expect(repository.stored[3]?.message.media).toEqual({
      mxcUri: 'mxc://matrix.example/minimal-media',
    });
  });

  it('returns a persistence error so callers can retry the batch', async () => {
    repository.failNextStore = true;

    const result = await useCase.execute(createInput(), logger);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected persistence failure');
    expect(result.error.code).toBe('PERSISTENCE_ERROR');
  });
});
