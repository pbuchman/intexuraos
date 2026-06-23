import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import {
  IngestPrivateWhatsAppEventsUseCase,
  type IngestPrivateWhatsAppEventInput,
  type IngestPrivateWhatsAppEventsInput,
  type PrivateWhatsAppAggregateRebuildInput,
  type PrivateWhatsAppAggregateRebuildResult,
  type PrivateWhatsAppIngestOutcome,
  type PrivateWhatsAppMessageQueryInput,
  type PrivateWhatsAppMessageQueryResult,
  type PrivateWhatsAppRepository,
  type PrivateWhatsAppSenderQueryInput,
  type PrivateWhatsAppSenderQueryResult,
  type PrivateWhatsAppSenderDayQueryInput,
  type PrivateWhatsAppSenderDayQueryResult,
  type StorePrivateWhatsAppMessageInput,
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
  private readonly seenEventIds = new Map<string, PrivateWhatsAppIngestOutcome>();
  failNextStore = false;

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
    };
    this.stored.push(input);
    this.seenEventIds.set(input.message.matrixEventId, outcome);
    return Promise.resolve(ok(outcome));
  }

  findMessages(
    _input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>> {
    return Promise.resolve(ok({ messages: [] }));
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

describe('IngestPrivateWhatsAppEventsUseCase', () => {
  let repository: TestPrivateWhatsAppRepository;
  let useCase: IngestPrivateWhatsAppEventsUseCase;

  beforeEach(() => {
    repository = new TestPrivateWhatsAppRepository();
    useCase = new IngestPrivateWhatsAppEventsUseCase({
      privateWhatsAppRepository: repository,
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

  it('rejects non-incoming events without writing them', async () => {
    const result = await useCase.execute(
      createInput({
        events: [
          createEvent({
            matrixEventId: '$event-outgoing',
            message: {
              direction: 'outgoing',
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
