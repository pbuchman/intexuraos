import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createPrivateWhatsAppRepository,
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
  PRIVATE_WHATSAPP_SENDERS_COLLECTION,
  PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
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
      senderPhoneNumberNormalized: '48123456789',
      senderKey: 'phone:+48123456789',
      direction: 'incoming',
      type: 'text',
      text: 'hello',
      eventTimestamp: '2026-06-22T10:00:00.000Z',
      eventDayKey: '2026-06-22',
      eventTimeZone: 'Europe/Warsaw',
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

  it('creates and resolves a per-user private WhatsApp account', async () => {
    const result = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      now: '2026-06-22T10:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      id: 'user-123',
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
      schemaVersion: 1,
    });
    expect(result.value.sourceAccountId).toMatch(/^private-wa-[a-f0-9]{24}$/);

    const byUser = await repository.getAccountByUserId('user-123');
    expect(byUser.ok).toBe(true);
    if (!byUser.ok) throw new Error(byUser.error.message);
    expect(byUser.value?.sourceAccountId).toBe(result.value.sourceAccountId);

    const bySource = await repository.getActiveAccountBySourceAccountId(
      result.value.sourceAccountId
    );
    expect(bySource.ok).toBe(true);
    if (!bySource.ok) throw new Error(bySource.error.message);
    expect(bySource.value?.userId).toBe('user-123');
  });

  it('returns null when a private WhatsApp account does not exist', async () => {
    const result = await repository.getAccountByUserId('missing-user');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBeNull();
  });

  it('projects sparse and legacy private WhatsApp account documents safely', async () => {
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('legacy-user').set({});
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('disabled-user').set({
      userId: 'disabled-user',
      sourceAccountId: 'legacy-private-source',
      phoneNumberNormalized: '48987654321',
      displayName: '+48987654321',
      status: 'disabled',
      createdAt: '2026-06-21T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
      lastIngestAt: '2026-06-22T10:01:00.000Z',
      lastEventAt: '2026-06-22T10:00:30.000Z',
      messageCount: 7,
      senderCount: 3,
    });

    const sparse = await repository.getAccountByUserId('legacy-user');
    const disabled = await repository.getAccountByUserId('disabled-user');

    expect(sparse.ok).toBe(true);
    expect(disabled.ok).toBe(true);
    if (!sparse.ok) throw new Error(sparse.error.message);
    if (!disabled.ok) throw new Error(disabled.error.message);
    expect(sparse.value).toMatchObject({
      id: 'legacy-user',
      userId: 'legacy-user',
      phoneNumberNormalized: '',
      displayName: '',
      status: 'active',
      createdAt: '',
      updatedAt: '',
      schemaVersion: 1,
    });
    expect(sparse.value?.sourceAccountId).toMatch(/^private-wa-[a-f0-9]{24}$/);
    expect(disabled.value).toMatchObject({
      id: 'disabled-user',
      userId: 'disabled-user',
      sourceAccountId: 'legacy-private-source',
      phoneNumberNormalized: '48987654321',
      displayName: '+48987654321',
      status: 'disabled',
      createdAt: '2026-06-21T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
      lastIngestAt: '2026-06-22T10:01:00.000Z',
      lastEventAt: '2026-06-22T10:00:30.000Z',
      messageCount: 7,
      senderCount: 3,
      schemaVersion: 1,
    });
  });

  it('rejects duplicate active private WhatsApp source account ids', async () => {
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-a').set({
      userId: 'user-a',
      sourceAccountId: 'shared-private-source',
      phoneNumberNormalized: '48111111111',
      displayName: '+48111111111',
      status: 'active',
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-b').set({
      userId: 'user-b',
      sourceAccountId: 'shared-private-source',
      phoneNumberNormalized: '48222222222',
      displayName: '+48222222222',
      status: 'active',
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:00.000Z',
    });

    const result = await repository.getActiveAccountBySourceAccountId('shared-private-source');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected duplicate source error');
    expect(result.error.code).toBe('PERSISTENCE_ERROR');
  });

  it('preserves source account id when updating an existing private WhatsApp account', async () => {
    const first = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      now: '2026-06-22T10:00:00.000Z',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);

    const second = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48987654321',
      displayName: '+48987654321',
      now: '2026-06-23T10:00:00.000Z',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.sourceAccountId).toBe(first.value.sourceAccountId);
    expect(second.value).toMatchObject({
      phoneNumberNormalized: '48987654321',
      displayName: '+48987654321',
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-23T10:00:00.000Z',
      status: 'active',
    });
  });

  it('disables private WhatsApp accounts and excludes them from source resolution', async () => {
    const created = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      now: '2026-06-22T10:00:00.000Z',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);

    const disabled = await repository.disableAccount({
      userId: 'user-123',
      now: '2026-06-23T10:00:00.000Z',
    });

    expect(disabled.ok).toBe(true);
    if (!disabled.ok) throw new Error(disabled.error.message);
    expect(disabled.value.status).toBe('disabled');
    expect(disabled.value.updatedAt).toBe('2026-06-23T10:00:00.000Z');

    const bySource = await repository.getActiveAccountBySourceAccountId(
      created.value.sourceAccountId
    );
    expect(bySource.ok).toBe(true);
    if (!bySource.ok) throw new Error(bySource.error.message);
    expect(bySource.value).toBeNull();
  });

  it('returns not found when disabling a missing private WhatsApp account', async () => {
    const result = await repository.disableAccount({
      userId: 'missing-user',
      now: '2026-06-23T10:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected not found');
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('updates private WhatsApp account ingest stats only for first-write messages', async () => {
    const accountResult = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      now: '2026-06-22T10:00:00.000Z',
    });
    expect(accountResult.ok).toBe(true);
    if (!accountResult.ok) throw new Error(accountResult.error.message);
    const input = createStoreInput({
      sourceAccountId: accountResult.value.sourceAccountId,
    });

    const first = await repository.storeIncomingMessage(input);
    const duplicate = await repository.storeIncomingMessage(input);
    const secondSameSender = await repository.storeIncomingMessage(
      createStoreInput({
        sourceAccountId: accountResult.value.sourceAccountId,
        message: {
          ...input.message,
          matrixEventId: '$event-2',
          text: 'second same sender',
          eventTimestamp: '2026-06-22T11:00:00.000Z',
        },
      })
    );

    expect(first.ok).toBe(true);
    expect(duplicate.ok).toBe(true);
    expect(secondSameSender.ok).toBe(true);
    const account = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      ?.get('user-123');
    expect(account).toMatchObject({
      sourceAccountId: accountResult.value.sourceAccountId,
      lastEventAt: '2026-06-22T11:00:00.000Z',
      messageCount: 2,
      senderCount: 1,
      schemaVersion: 1,
    });

    const updated = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48987654321',
      displayName: '+48987654321',
      now: '2026-06-23T10:00:00.000Z',
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error.message);
    expect(updated.value).toMatchObject({
      sourceAccountId: accountResult.value.sourceAccountId,
      lastEventAt: '2026-06-22T11:00:00.000Z',
      messageCount: 2,
      senderCount: 1,
    });
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
    const senderKey = input.message.senderKey;
    const eventDayKey = input.message.eventDayKey;
    if (senderKey === undefined || eventDayKey === undefined) {
      throw new Error('Expected sender metadata in test input');
    }
    const expectedSenderId = deterministicId(input.sourceAccountId, senderKey);
    const expectedSenderDayId = deterministicId(
      input.sourceAccountId,
      `${senderKey}\0${eventDayKey}`
    );
    const sender = data
      .get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)
      ?.get(expectedSenderId);
    const senderDay = data
      .get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      ?.get(expectedSenderDayId);
    expect(chat).toMatchObject({
      id: expectedChatId,
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!room:matrix.example',
      chatType: 'direct',
      displayName: 'Alice',
      messageCount: 1,
      participantCount: 1,
      participantKeys: ['phone:+48123456789'],
      firstSeenAt: '2026-06-22T10:00:00.000Z',
      lastEventAt: '2026-06-22T10:00:00.000Z',
      schemaVersion: 2,
    });
    expect(message).toMatchObject({
      id: expectedMessageId,
      chatId: expectedChatId,
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixEventId: '$event-1',
      senderKey: 'phone:+48123456789',
      senderPhoneNumberNormalized: '48123456789',
      eventDayKey: '2026-06-22',
      eventTimeZone: 'Europe/Warsaw',
      chatDisplayName: 'Alice',
      chatType: 'direct',
      schemaVersion: 2,
      direction: 'incoming',
      messageType: 'text',
      text: 'hello',
      deliveryMode: 'live',
    });
    expect(sender).toMatchObject({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      senderKey: 'phone:+48123456789',
      senderDisplayName: 'Alice',
      senderPhoneNumber: '+48123456789',
      senderPhoneNumberNormalized: '48123456789',
      firstEventAt: '2026-06-22T10:00:00.000Z',
      lastEventAt: '2026-06-22T10:00:00.000Z',
      messageCount: 1,
      chatIds: [expectedChatId],
      schemaVersion: 2,
    });
    expect(senderDay).toMatchObject({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      senderKey: 'phone:+48123456789',
      eventDayKey: '2026-06-22',
      eventTimeZone: 'Europe/Warsaw',
      senderDisplayName: 'Alice',
      senderPhoneNumber: '+48123456789',
      firstEventAt: '2026-06-22T10:00:00.000Z',
      lastEventAt: '2026-06-22T10:00:00.000Z',
      messageCount: 1,
      chatIds: [expectedChatId],
      messageTypeCounts: { text: 1 },
      summaryStatus: 'not_started',
      summarySourceMessageCount: 0,
      schemaVersion: 2,
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
    const senderKey = input.message.senderKey;
    const eventDayKey = input.message.eventDayKey;
    if (senderKey === undefined || eventDayKey === undefined) {
      throw new Error('Expected sender metadata in test input');
    }
    const senderId = deterministicId(input.sourceAccountId, senderKey);
    const senderDayId = deterministicId(
      input.sourceAccountId,
      `${senderKey}\0${eventDayKey}`
    );
    const sender = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)
      ?.get(senderId);
    const senderDay = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      ?.get(senderDayId);
    expect(sender?.['messageCount']).toBe(1);
    expect(senderDay?.['messageCount']).toBe(1);
  });

  it('increments one sender-day aggregate for multiple messages from the same sender and day', async () => {
    const first = await repository.storeIncomingMessage(createStoreInput());
    expect(first.ok).toBe(true);

    const second = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-2',
          text: 'second',
          eventTimestamp: '2026-06-22T12:00:00.000Z',
        },
      })
    );

    expect(second.ok).toBe(true);
    const senderDayId = deterministicId(
      'pbuchman-private-whatsapp',
      `phone:+48123456789\0${'2026-06-22'}`
    );
    const senderDay = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      ?.get(senderDayId);
    expect(senderDay?.['messageCount']).toBe(2);
    expect(senderDay?.['lastEventAt']).toBe('2026-06-22T12:00:00.000Z');
    expect(senderDay?.['messageTypeCounts']).toEqual({ text: 2 });
  });

  it('creates separate sender-day aggregates for the same sender on different days', async () => {
    const first = await repository.storeIncomingMessage(createStoreInput());
    expect(first.ok).toBe(true);

    const second = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-next-day',
          eventTimestamp: '2026-06-23T08:00:00.000Z',
          eventDayKey: '2026-06-23',
        },
      })
    );

    expect(second.ok).toBe(true);
    const aggregateDocs = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION);
    expect(aggregateDocs?.size).toBe(2);
  });

  it('rebuilds sender aggregates from old message documents without double-counting reruns', async () => {
    const messageId = deterministicId('pbuchman-private-whatsapp', '$old-event-1');
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).set({
      id: messageId,
      chatId: deterministicId('pbuchman-private-whatsapp', '!old-room:home-dev'),
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!old-room:home-dev',
      matrixEventId: '$old-event-1',
      matrixSenderId: '@whatsapp_48517277952:home-dev',
      senderDisplayName: 'Monika',
      direction: 'incoming',
      messageType: 'text',
      text: 'old hello',
      eventTimestamp: '2026-06-22T22:30:00.000Z',
      receivedAt: '2026-06-22T22:30:02.000Z',
      ingestedAt: '2026-06-22T22:30:02.000Z',
      deliveryMode: 'live',
      rawMatrixEvent: { event_id: '$old-event-1' },
    });

    const firstRebuild = await repository.rebuildAggregates({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 100,
    });
    const secondRebuild = await repository.rebuildAggregates({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 100,
    });

    expect(firstRebuild.ok).toBe(true);
    expect(secondRebuild.ok).toBe(true);
    if (!firstRebuild.ok) throw new Error(firstRebuild.error.message);
    expect(firstRebuild.value).toMatchObject({
      scannedMessages: 1,
      upgradedMessages: 1,
      senderCount: 1,
      senderDayCount: 1,
    });

    const data = fakeFirestore.getAllData();
    const message = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(messageId);
    expect(message).toMatchObject({
      senderKey: 'phone:+48517277952',
      senderPhoneNumberNormalized: '48517277952',
      eventDayKey: '2026-06-23',
      eventTimeZone: 'Europe/Warsaw',
      schemaVersion: 2,
    });

    const senderId = deterministicId('pbuchman-private-whatsapp', 'phone:+48517277952');
    const senderDayId = deterministicId(
      'pbuchman-private-whatsapp',
      `phone:+48517277952\0${'2026-06-23'}`
    );
    const sender = data.get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)?.get(senderId);
    const senderDay = data.get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)?.get(senderDayId);
    expect(sender?.['messageCount']).toBe(1);
    expect(senderDay?.['messageCount']).toBe(1);
    expect(senderDay?.['eventDayKey']).toBe('2026-06-23');
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

  it('keeps group chat type when a newer event is misclassified as direct', async () => {
    const groupResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!group-room:matrix.example',
          type: 'group',
          displayName: 'Fishing Crew (WA)',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!group-room:matrix.example',
          matrixEventId: '$event-group',
          matrixSenderId: '@whatsapp_lid-111111111111111:home-dev',
          senderDisplayName: 'LID One (WA)',
          senderKey: 'matrix:@whatsapp_lid-111111111111111:home-dev',
          text: 'group message',
          eventTimestamp: '2026-06-22T10:00:00.000Z',
        },
      })
    );
    expect(groupResult.ok).toBe(true);

    const directResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!group-room:matrix.example',
          type: 'direct',
          displayName: 'Fishing Crew (WA)',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!group-room:matrix.example',
          matrixEventId: '$event-misclassified-reaction',
          matrixSenderId: '@whatsapp_lid-222222222222222:home-dev',
          senderDisplayName: 'LID Two (WA)',
          senderKey: 'matrix:@whatsapp_lid-222222222222222:home-dev',
          direction: 'incoming',
          type: 'reaction',
          text: 'ok',
          eventTimestamp: '2026-06-22T10:06:00.000Z',
          rawMatrixEvent: {
            type: 'm.reaction',
            event_id: '$event-misclassified-reaction',
          },
        },
      })
    );

    expect(directResult.ok).toBe(true);
    const chatId = deterministicId('pbuchman-private-whatsapp', '!group-room:matrix.example');
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
    expect(chat?.['chatType']).toBe('group');
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

  it('queries private messages with filters, invalid cursors, and generated cursors', async () => {
    const firstResult = await repository.storeIncomingMessage(createStoreInput());
    const secondResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-2',
          text: 'newer same sender',
          eventTimestamp: '2026-06-22T11:00:00.000Z',
        },
      })
    );
    const otherSenderResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-other-sender',
          matrixSenderId: '@bob:matrix.example',
          senderDisplayName: 'Bob',
          senderPhoneNumber: '+48987654321',
          senderPhoneNumberNormalized: '48987654321',
          senderKey: 'phone:+48987654321',
          text: 'different sender',
          eventTimestamp: '2026-06-22T11:30:00.000Z',
        },
      })
    );
    const otherChatResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!other-room:matrix.example',
          type: 'group',
          displayName: 'Other Room',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!other-room:matrix.example',
          matrixEventId: '$event-other-chat',
          text: 'different chat',
          eventTimestamp: '2026-06-22T12:30:00.000Z',
        },
      })
    );
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(otherSenderResult.ok).toBe(true);
    expect(otherChatResult.ok).toBe(true);

    const malformedCursorResult = await repository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      senderKey: 'phone:+48123456789',
      eventDayKey: '2026-06-22',
      from: '2026-06-22T09:00:00.000Z',
      to: '2026-06-22T12:00:00.000Z',
      limit: 1,
      cursor: 'not-json',
    });

    expect(malformedCursorResult.ok).toBe(true);
    if (!malformedCursorResult.ok) throw new Error(malformedCursorResult.error.message);
    expect(malformedCursorResult.value.messages).toMatchObject([
      { matrixEventId: '$event-2', senderKey: 'phone:+48123456789' },
    ]);
    expect(malformedCursorResult.value.nextCursor).toEqual(expect.any(String));

    const nextCursor = malformedCursorResult.value.nextCursor;
    if (nextCursor === undefined) throw new Error('Expected next cursor');
    const secondPageResult = await repository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      senderKey: 'phone:+48123456789',
      eventDayKey: '2026-06-22',
      from: '2026-06-22T09:00:00.000Z',
      to: '2026-06-22T12:00:00.000Z',
      limit: 1,
      cursor: nextCursor,
    });

    expect(secondPageResult.ok).toBe(true);
    if (!secondPageResult.ok) throw new Error(secondPageResult.error.message);
    expect(secondPageResult.value.messages).toMatchObject([{ matrixEventId: '$event-1' }]);
    expect(secondPageResult.value.nextCursor).toBeUndefined();

    const incompleteCursor = Buffer.from(JSON.stringify({ sortValue: '2026-06-22' })).toString(
      'base64url'
    );
    const incompleteCursorResult = await repository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
      cursor: incompleteCursor,
    });
    expect(incompleteCursorResult.ok).toBe(true);

    const zeroLimitResult = await repository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 0,
    });
    expect(zeroLimitResult.ok).toBe(true);
    if (!zeroLimitResult.ok) throw new Error(zeroLimitResult.error.message);
    expect(zeroLimitResult.value.messages).toEqual([]);
    expect(zeroLimitResult.value.nextCursor).toBeUndefined();

    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    const chatFilterResult = await repository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId,
      limit: 10,
    });
    expect(chatFilterResult.ok).toBe(true);
    if (!chatFilterResult.ok) throw new Error(chatFilterResult.error.message);
    expect(chatFilterResult.value.messages.map((message) => message.chatId)).toEqual([
      chatId,
      chatId,
      chatId,
    ]);
  });

  it('queries private WhatsApp chats newest-first and projects legacy chat documents safely', async () => {
    const olderResult = await repository.storeIncomingMessage(createStoreInput());
    const newerResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!group-room:matrix.example',
          type: 'group',
          displayName: 'Fishing Crew (WA)',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!group-room:matrix.example',
          matrixEventId: '$event-group',
          matrixSenderId: '@whatsapp_48536911713:home-dev',
          senderDisplayName: 'Piotrek (WA)',
          senderPhoneNumber: '+48536911713',
          senderPhoneNumberNormalized: '48536911713',
          senderKey: 'phone:+48536911713',
          text: 'group message',
          eventTimestamp: '2026-06-23T09:00:00.000Z',
        },
      })
    );
    expect(olderResult.ok).toBe(true);
    expect(newerResult.ok).toBe(true);

    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('legacy-chat').set({
      sourceAccountId: 'pbuchman-private-whatsapp',
      displayName: 'Legacy Room',
      avatarMxcUri: 'mxc://matrix.example/avatar',
      lastEventAt: '2026-06-21T09:00:00.000Z',
      messageCount: 7,
      participantKeys: ['phone:+48111111111', 123],
    });

    const firstPage = await repository.findChats({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 1,
    });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) throw new Error(firstPage.error.message);
    expect(firstPage.value.chats).toMatchObject([
      {
        chatType: 'group',
        displayName: 'Fishing Crew (WA)',
        messageCount: 1,
        participantCount: 1,
      },
    ]);
    expect(firstPage.value.nextCursor).toEqual(expect.any(String));

    const cursor = firstPage.value.nextCursor;
    if (cursor === undefined) throw new Error('Expected chat cursor');
    const secondPage = await repository.findChats({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
      cursor,
    });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) throw new Error(secondPage.error.message);
    expect(secondPage.value.chats.map((chat) => chat.id)).toContain('legacy-chat');

    const legacy = secondPage.value.chats.find((chat) => chat.id === 'legacy-chat');
    expect(legacy).toMatchObject({
      id: 'legacy-chat',
      userId: '',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '',
      chatType: 'unknown',
      displayName: 'Legacy Room',
      avatarMxcUri: 'mxc://matrix.example/avatar',
      messageCount: 7,
      participantCount: 1,
      participantKeys: ['phone:+48111111111'],
      firstSeenAt: '',
      lastEventAt: '2026-06-21T09:00:00.000Z',
      updatedAt: '',
      schemaVersion: 2,
    });

    const zeroLimit = await repository.findChats({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 0,
    });
    expect(zeroLimit.ok).toBe(true);
    if (!zeroLimit.ok) throw new Error(zeroLimit.error.message);
    expect(zeroLimit.value.chats).toEqual([]);
    expect(zeroLimit.value.nextCursor).toBeUndefined();
  });

  it('queries sender-day aggregates with and without sender cursors', async () => {
    const firstResult = await repository.storeIncomingMessage(createStoreInput());
    const nextDayResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-next-day',
          eventTimestamp: '2026-06-23T08:00:00.000Z',
          eventDayKey: '2026-06-23',
        },
      })
    );
    const otherSenderResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-other-sender',
          matrixSenderId: '@bob:matrix.example',
          senderDisplayName: 'Bob',
          senderPhoneNumber: '+48987654321',
          senderPhoneNumberNormalized: '48987654321',
          senderKey: 'phone:+48987654321',
          eventTimestamp: '2026-06-22T09:30:00.000Z',
        },
      })
    );
    expect(firstResult.ok).toBe(true);
    expect(nextDayResult.ok).toBe(true);
    expect(otherSenderResult.ok).toBe(true);

    const firstPageResult = await repository.findSenderDays({
      sourceAccountId: 'pbuchman-private-whatsapp',
      fromDay: '2026-06-22',
      toDay: '2026-06-23',
      limit: 1,
    });

    expect(firstPageResult.ok).toBe(true);
    if (!firstPageResult.ok) throw new Error(firstPageResult.error.message);
    expect(firstPageResult.value.senderDays).toHaveLength(1);
    expect(firstPageResult.value.nextCursor).toEqual(expect.any(String));

    const firstPageCursor = firstPageResult.value.nextCursor;
    if (firstPageCursor === undefined) throw new Error('Expected sender-day cursor');
    const secondPageResult = await repository.findSenderDays({
      sourceAccountId: 'pbuchman-private-whatsapp',
      fromDay: '2026-06-22',
      toDay: '2026-06-23',
      limit: 10,
      cursor: firstPageCursor,
    });
    expect(secondPageResult.ok).toBe(true);
    if (!secondPageResult.ok) throw new Error(secondPageResult.error.message);
    expect(secondPageResult.value.senderDays.length).toBeGreaterThan(0);

    const senderPageResult = await repository.findSenderDays({
      sourceAccountId: 'pbuchman-private-whatsapp',
      senderKey: 'phone:+48123456789',
      limit: 1,
    });
    expect(senderPageResult.ok).toBe(true);
    if (!senderPageResult.ok) throw new Error(senderPageResult.error.message);
    expect(senderPageResult.value.nextCursor).toEqual(expect.any(String));

    const senderCursor = senderPageResult.value.nextCursor;
    if (senderCursor === undefined) throw new Error('Expected sender cursor');
    const senderSecondPageResult = await repository.findSenderDays({
      sourceAccountId: 'pbuchman-private-whatsapp',
      senderKey: 'phone:+48123456789',
      limit: 10,
      cursor: senderCursor,
    });
    expect(senderSecondPageResult.ok).toBe(true);

    const zeroLimitResult = await repository.findSenderDays({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 0,
    });
    expect(zeroLimitResult.ok).toBe(true);
    if (!zeroLimitResult.ok) throw new Error(zeroLimitResult.error.message);
    expect(zeroLimitResult.value.senderDays).toEqual([]);
    expect(zeroLimitResult.value.nextCursor).toBeUndefined();
  });

  it('queries private WhatsApp senders newest-first with a stable cursor', async () => {
    const olderResult = await repository.storeIncomingMessage(createStoreInput());
    const newerResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-newer-sender',
          matrixSenderId: '@bob:matrix.example',
          senderDisplayName: 'Bob',
          senderPhoneNumber: '+48987654321',
          senderPhoneNumberNormalized: '48987654321',
          senderKey: 'phone:+48987654321',
          eventTimestamp: '2026-06-23T09:30:00.000Z',
          eventDayKey: '2026-06-23',
        },
      })
    );
    const sameTimestampResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-same-timestamp',
          matrixSenderId: '@cora:matrix.example',
          senderDisplayName: 'Cora',
          senderPhoneNumber: '+48777111222',
          senderPhoneNumberNormalized: '48777111222',
          senderKey: 'phone:+48777111222',
          eventTimestamp: '2026-06-23T09:30:00.000Z',
          eventDayKey: '2026-06-23',
        },
      })
    );
    expect(olderResult.ok).toBe(true);
    expect(newerResult.ok).toBe(true);
    expect(sameTimestampResult.ok).toBe(true);

    const firstPageResult = await repository.findSenders({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 2,
    });

    expect(firstPageResult.ok).toBe(true);
    if (!firstPageResult.ok) throw new Error(firstPageResult.error.message);
    expect(firstPageResult.value.senders).toHaveLength(2);
    expect(firstPageResult.value.senders.map((sender) => sender.lastEventAt)).toEqual([
      '2026-06-23T09:30:00.000Z',
      '2026-06-23T09:30:00.000Z',
    ]);
    expect(firstPageResult.value.nextCursor).toEqual(expect.any(String));

    const cursor = firstPageResult.value.nextCursor;
    if (cursor === undefined) throw new Error('Expected sender cursor');
    const secondPageResult = await repository.findSenders({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
      cursor,
    });

    expect(secondPageResult.ok).toBe(true);
    if (!secondPageResult.ok) throw new Error(secondPageResult.error.message);
    expect(secondPageResult.value.senders.map((sender) => sender.senderKey)).toEqual([
      'phone:+48123456789',
    ]);
    expect(secondPageResult.value.nextCursor).toBeUndefined();
  });

  it('does not generate a sender cursor for an empty sender page', async () => {
    const storedResult = await repository.storeIncomingMessage(createStoreInput());
    expect(storedResult.ok).toBe(true);

    const result = await repository.findSenders({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.senders).toEqual([]);
    expect(result.value.nextCursor).toBeUndefined();
  });

  it('rebuilds sparse legacy messages with range filters and fallback metadata', async () => {
    const imageMessageId = deterministicId('pbuchman-private-whatsapp', '$legacy-image');
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(imageMessageId).set({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!legacy-image-room:home-dev',
      matrixEventId: '$legacy-image',
      matrixSenderId: '@legacy_sender:home-dev',
      senderDisplayName: 'Legacy Sender',
      senderPhoneNumber: '+48 222 333 444',
      chatDisplayName: 'Legacy Sender (WA)',
      direction: 'incoming',
      messageType: 'image',
      media: {
        mxcUri: 'mxc://matrix.example/legacy-image',
        mimeType: 'image/jpeg',
      },
      eventTimestamp: '2026-06-23T10:00:00.000Z',
      receivedAt: '2026-06-23T10:00:02.000Z',
      ingestedAt: '2026-06-23T10:00:02.000Z',
      deliveryMode: 'backfill',
      rawMatrixEvent: { event_id: '$legacy-image' },
    });
    const invalidMessageId = deterministicId('pbuchman-private-whatsapp', '$legacy-invalid');
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(invalidMessageId).set({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!legacy-invalid-room:home-dev',
      matrixEventId: '$legacy-invalid',
      matrixSenderId: '@plain_sender:home-dev',
      senderPhoneNumber: 'unknown',
      direction: 'incoming',
      messageType: 'custom-type',
      eventTimestamp: 'not-a-date',
      receivedAt: '2026-06-23T10:01:02.000Z',
      ingestedAt: '2026-06-23T10:01:02.000Z',
      deliveryMode: 'backfill',
      rawMatrixEvent: { event_id: '$legacy-invalid' },
    });

    const rangedRebuild = await repository.rebuildAggregates({
      sourceAccountId: 'pbuchman-private-whatsapp',
      from: '2026-06-23T00:00:00.000Z',
      to: '2026-06-24T00:00:00.000Z',
      limit: 100,
    });
    expect(rangedRebuild.ok).toBe(true);
    if (!rangedRebuild.ok) throw new Error(rangedRebuild.error.message);
    expect(rangedRebuild.value.scannedMessages).toBe(1);

    const fullRebuild = await repository.rebuildAggregates({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 100,
    });
    expect(fullRebuild.ok).toBe(true);
    if (!fullRebuild.ok) throw new Error(fullRebuild.error.message);
    expect(fullRebuild.value.scannedMessages).toBe(2);

    const data = fakeFirestore.getAllData();
    const imageMessage = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(imageMessageId);
    const invalidMessage = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(invalidMessageId);
    expect(imageMessage).toMatchObject({
      senderKey: 'phone:+48222333444',
      senderPhoneNumberNormalized: '48222333444',
      eventDayKey: '2026-06-23',
      eventTimeZone: 'Europe/Warsaw',
      chatType: 'unknown',
      schemaVersion: 2,
    });
    expect(invalidMessage).toMatchObject({
      senderKey: 'matrix:@plain_sender:home-dev',
      eventDayKey: 'not-a-date',
      messageType: 'custom-type',
      chatType: 'unknown',
      schemaVersion: 2,
    });

    const invalidSenderDayId = deterministicId(
      'pbuchman-private-whatsapp',
      `matrix:@plain_sender:home-dev\0${'not-a-date'}`
    );
    const invalidSenderDay = data
      .get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      ?.get(invalidSenderDayId);
    expect(invalidSenderDay?.['messageTypeCounts']).toEqual({ unknown: 1 });
  });

  it('updates legacy aggregate display names when existing timestamps are missing', async () => {
    const input = createStoreInput({
      message: {
        ...createStoreInput().message,
        senderDisplayName: 'Current Alice',
      },
    });
    const senderKey = input.message.senderKey;
    const eventDayKey = input.message.eventDayKey;
    if (senderKey === undefined || eventDayKey === undefined) {
      throw new Error('Expected sender metadata in test input');
    }
    const senderId = deterministicId(input.sourceAccountId, senderKey);
    const senderDayId = deterministicId(input.sourceAccountId, `${senderKey}\0${eventDayKey}`);
    await fakeFirestore.collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION).doc(senderId).set({
      id: senderId,
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      senderKey,
      senderDisplayName: 'Legacy Alice',
      firstEventAt: input.message.eventTimestamp,
      messageCount: 0,
      chatIds: [],
      updatedAt: input.receivedAt,
      schemaVersion: 2,
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION).doc(senderDayId).set({
      id: senderDayId,
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      senderKey,
      eventDayKey,
      eventTimeZone: 'Europe/Warsaw',
      senderDisplayName: 'Legacy Alice',
      firstEventAt: input.message.eventTimestamp,
      messageCount: 0,
      chatIds: [],
      messageTypeCounts: {},
      summaryStatus: 'not_started',
      summarySourceMessageCount: 0,
      updatedAt: input.receivedAt,
      schemaVersion: 2,
    });

    const result = await repository.storeIncomingMessage(input);

    expect(result.ok).toBe(true);
    const data = fakeFirestore.getAllData();
    expect(
      data.get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)?.get(senderId)?.['senderDisplayName']
    ).toBe('Current Alice');
    expect(
      data.get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)?.get(senderDayId)?.['senderDisplayName']
    ).toBe('Current Alice');
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
