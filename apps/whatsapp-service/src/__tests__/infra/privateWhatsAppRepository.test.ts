import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createPrivateWhatsAppRepository,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';
import type { StorePrivateWhatsAppMessageInput } from '../../domain/whatsapp/index.js';

function deterministicId(sourceAccountId: string, matrixId: string): string {
  return createHash('sha256').update(`${sourceAccountId}\0${matrixId}`).digest('hex');
}

function createStoreInput(
  overrides: Partial<StorePrivateWhatsAppMessageInput> = {}
): StorePrivateWhatsAppMessageInput {
  return {
    sourceAccountId: 'pbuchman-private-whatsapp',
    userId: 'user-123',
    deliveryMode: 'live',
    receivedAt: '2026-06-22T10:00:02.000Z',
    chat: {
      matrixRoomId: '!room:matrix.example',
      type: 'direct',
      displayName: 'Alice',
    },
    message: {
      matrixRoomId: '!room:matrix.example',
      matrixEventId: '$event-1',
      matrixSenderId: '@alice:matrix.example',
      senderDisplayName: 'Alice',
      senderPhoneNumber: '+48123456789',
      direction: 'incoming',
      type: 'text',
      text: 'hello',
      eventTimestamp: '2026-06-22T10:00:00.000Z',
      rawMatrixEvent: {
        type: 'm.room.message',
        event_id: '$event-1',
      },
    },
    ...overrides,
  };
}

describe('privateWhatsAppRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createPrivateWhatsAppRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createPrivateWhatsAppRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  it('stores a chat and message with deterministic ids', async () => {
    const input = createStoreInput();

    const result = await repository.storeIncomingMessage(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const expectedChatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const expectedMessageId = deterministicId(
      input.sourceAccountId,
      input.message.matrixEventId
    );
    expect(result.value).toEqual({
      outcome: 'created',
      chatId: expectedChatId,
      messageId: expectedMessageId,
      matrixEventId: input.message.matrixEventId,
    });

    const data = fakeFirestore.getAllData();
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(expectedChatId);
    const message = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(expectedMessageId);
    expect(chat).toMatchObject({
      id: expectedChatId,
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!room:matrix.example',
      chatType: 'direct',
      displayName: 'Alice',
      firstSeenAt: '2026-06-22T10:00:00.000Z',
      lastEventAt: '2026-06-22T10:00:00.000Z',
    });
    expect(message).toMatchObject({
      id: expectedMessageId,
      chatId: expectedChatId,
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixEventId: '$event-1',
      direction: 'incoming',
      messageType: 'text',
      text: 'hello',
      deliveryMode: 'live',
    });
  });

  it('returns duplicate without overwriting an existing message', async () => {
    const input = createStoreInput();
    const firstResult = await repository.storeIncomingMessage(input);
    expect(firstResult.ok).toBe(true);

    const duplicateResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...input.message,
          text: 'changed text from retry',
        },
      })
    );

    expect(duplicateResult.ok).toBe(true);
    if (!duplicateResult.ok) throw new Error(duplicateResult.error.message);
    expect(duplicateResult.value.outcome).toBe('duplicate');

    const messageId = deterministicId(input.sourceAccountId, input.message.matrixEventId);
    const message = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(messageId);
    expect(message?.['text']).toBe('hello');
  });

  it('updates chat metadata when a later event arrives in the same room', async () => {
    const firstResult = await repository.storeIncomingMessage(createStoreInput());
    expect(firstResult.ok).toBe(true);

    const secondResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!room:matrix.example',
          type: 'direct',
          displayName: 'Alice Cooper',
        },
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-2',
          text: 'newer message',
          eventTimestamp: '2026-06-22T10:05:00.000Z',
        },
      })
    );

    expect(secondResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['displayName']).toBe('Alice Cooper');
    expect(chat?.['lastEventAt']).toBe('2026-06-22T10:05:00.000Z');
  });

  it('keeps the newer chat timestamp and lowers firstSeenAt when an older backfill event arrives later', async () => {
    const liveResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-live',
          eventTimestamp: '2026-06-22T10:05:00.000Z',
        },
      })
    );
    expect(liveResult.ok).toBe(true);

    const backfillResult = await repository.storeIncomingMessage(
      createStoreInput({
        deliveryMode: 'backfill',
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-backfill',
          eventTimestamp: '2026-06-22T09:55:00.000Z',
        },
      })
    );

    expect(backfillResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['firstSeenAt']).toBe('2026-06-22T09:55:00.000Z');
    expect(chat?.['lastEventAt']).toBe('2026-06-22T10:05:00.000Z');
  });

  it('keeps newer chat metadata when an older sparse backfill event arrives later', async () => {
    const liveResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!room:matrix.example',
          type: 'direct',
          displayName: 'Current Alice',
          avatarMxcUri: 'mxc://matrix.example/current-avatar',
        },
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-live',
          eventTimestamp: '2026-06-22T10:05:00.000Z',
        },
      })
    );
    expect(liveResult.ok).toBe(true);

    const backfillResult = await repository.storeIncomingMessage(
      createStoreInput({
        deliveryMode: 'backfill',
        chat: {
          matrixRoomId: '!room:matrix.example',
          type: 'unknown',
          displayName: 'Old Alice',
          avatarMxcUri: 'mxc://matrix.example/old-avatar',
        },
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-backfill',
          eventTimestamp: '2026-06-22T09:55:00.000Z',
        },
      })
    );

    expect(backfillResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['chatType']).toBe('direct');
    expect(chat?.['displayName']).toBe('Current Alice');
    expect(chat?.['avatarMxcUri']).toBe('mxc://matrix.example/current-avatar');
    expect(chat?.['lastEventAt']).toBe('2026-06-22T10:05:00.000Z');
  });

  it('stores media messages without adding absent optional message fields', async () => {
    const input = createStoreInput({
      chat: {
        matrixRoomId: '!media-room:matrix.example',
        type: 'group',
      },
      message: {
        matrixRoomId: '!media-room:matrix.example',
        matrixEventId: '$event-media',
        matrixSenderId: '@alice:matrix.example',
        direction: 'incoming',
        type: 'image',
        media: {
          mxcUri: 'mxc://matrix.example/media',
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          sizeBytes: 12345,
          sha256: 'hash123',
        },
        eventTimestamp: '2026-06-22T10:10:00.000Z',
        rawMatrixEvent: {
          type: 'm.room.message',
          event_id: '$event-media',
        },
      },
    });

    const result = await repository.storeIncomingMessage(input);

    expect(result.ok).toBe(true);
    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const messageId = deterministicId(input.sourceAccountId, input.message.matrixEventId);
    const data = fakeFirestore.getAllData();
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    const message = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(messageId);
    expect(chat).not.toHaveProperty('displayName');
    expect(message).not.toHaveProperty('senderDisplayName');
    expect(message).not.toHaveProperty('senderPhoneNumber');
    expect(message).not.toHaveProperty('text');
    expect(message?.['media']).toEqual({
      mxcUri: 'mxc://matrix.example/media',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      sizeBytes: 12345,
      sha256: 'hash123',
    });
  });

  it('keeps a known chat type when a newer event reports unknown type', async () => {
    const firstResult = await repository.storeIncomingMessage(createStoreInput());
    expect(firstResult.ok).toBe(true);

    const secondResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!room:matrix.example',
          type: 'unknown',
        },
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-unknown-type',
          eventTimestamp: '2026-06-22T10:06:00.000Z',
        },
      })
    );

    expect(secondResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['chatType']).toBe('direct');
    expect(chat?.['lastEventAt']).toBe('2026-06-22T10:06:00.000Z');
  });

  it('repairs invalid existing chat timestamps when a valid later event arrives', async () => {
    const invalidResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-invalid-existing',
          eventTimestamp: 'not-a-date',
        },
      })
    );
    expect(invalidResult.ok).toBe(true);

    const validResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-valid-after-invalid',
          eventTimestamp: '2026-06-22T10:15:00.000Z',
        },
      })
    );

    expect(validResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['firstSeenAt']).toBe('2026-06-22T10:15:00.000Z');
    expect(chat?.['lastEventAt']).toBe('2026-06-22T10:15:00.000Z');
  });

  it('ignores invalid next timestamps when preserving existing chat bounds', async () => {
    const validResult = await repository.storeIncomingMessage(createStoreInput());
    expect(validResult.ok).toBe(true);

    const invalidResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!room:matrix.example',
          type: 'group',
          displayName: 'Invalid Timestamp Name',
        },
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-invalid-next',
          eventTimestamp: 'not-a-date',
        },
      })
    );

    expect(invalidResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['chatType']).toBe('direct');
    expect(chat?.['displayName']).toBe('Alice');
    expect(chat?.['firstSeenAt']).toBe('2026-06-22T10:00:00.000Z');
    expect(chat?.['lastEventAt']).toBe('2026-06-22T10:00:00.000Z');
  });

  it('returns a persistence error when Firestore fails', async () => {
    fakeFirestore.configure({ errorToThrow: new Error('DB unavailable') });

    const result = await repository.storeIncomingMessage(createStoreInput());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected persistence failure');
    expect(result.error.code).toBe('PERSISTENCE_ERROR');
    expect(result.error.message).toContain('Failed to store private WhatsApp message');
  });
});
