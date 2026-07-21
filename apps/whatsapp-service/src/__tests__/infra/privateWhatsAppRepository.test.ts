import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createPrivateWhatsAppRepository,
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
  PRIVATE_WHATSAPP_SENDERS_COLLECTION,
  PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';
import { createPrivateWhatsAppErasureRepository } from '../../infra/firestore/privateWhatsAppErasureRepository.js';
import type { StorePrivateWhatsAppMessageInput } from '../../domain/whatsapp/index.js';

interface TransactionWriteMethods {
  set(...args: unknown[]): unknown;
  update(...args: unknown[]): unknown;
  delete(...args: unknown[]): unknown;
}

interface InstrumentedTransactions {
  readonly transactionCalls: number;
  readonly maxWritesObserved: number;
  disableInjectedFailure(): void;
}

function instrumentTransactions(
  fakeFirestore: ReturnType<typeof createFakeFirestore>,
  options: {
    failBeforeTransaction?: number;
    beforeTransaction?: (transactionNumber: number) => void;
  } = {}
): InstrumentedTransactions {
  const firestore = fakeFirestore as unknown as {
    runTransaction<T>(
      updateFn: (transaction: TransactionWriteMethods) => Promise<T>
    ): Promise<T>;
  };
  const originalRunTransaction = firestore.runTransaction.bind(firestore);
  let transactionCalls = 0;
  let maxWritesObserved = 0;
  let injectedFailureEnabled = options.failBeforeTransaction !== undefined;

  firestore.runTransaction = async <T>(
    updateFn: (transaction: TransactionWriteMethods) => Promise<T>
  ): Promise<T> => {
    transactionCalls += 1;
    options.beforeTransaction?.(transactionCalls);
    if (
      injectedFailureEnabled &&
      transactionCalls === options.failBeforeTransaction
    ) {
      throw new Error('Injected resolver crash before transaction');
    }

    let writes = 0;
    return originalRunTransaction(async (transaction) => {
      const countingTransaction = new Proxy(transaction, {
        get(target, property, receiver): unknown {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (
            (property === 'set' || property === 'update' || property === 'delete') &&
            typeof value === 'function'
          ) {
            return (...args: unknown[]): unknown => {
              writes += 1;
              maxWritesObserved = Math.max(maxWritesObserved, writes);
              return Reflect.apply(value, target, args);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as TransactionWriteMethods;
      return updateFn(countingTransaction);
    });
  };

  return {
    get transactionCalls(): number {
      return transactionCalls;
    },
    get maxWritesObserved(): number {
      return maxWritesObserved;
    },
    disableInjectedFailure(): void {
      injectedFailureEnabled = false;
    },
  };
}

function deterministicId(sourceAccountId: string, matrixId: string): string {
  return createHash('sha256').update(`${sourceAccountId}\0${matrixId}`).digest('hex');
}

type TestOverrides<T> = { [Key in keyof T]?: T[Key] | undefined };
type StoreInputOverrides = TestOverrides<
  Omit<StorePrivateWhatsAppMessageInput, 'message'>
> & {
  message?: TestOverrides<StorePrivateWhatsAppMessageInput['message']>;
};

function createStoreInput(
  overrides: StoreInputOverrides = {}
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
  } as StorePrivateWhatsAppMessageInput;
}

function createAudioStoreInput(
  matrixEventId: string,
  media: NonNullable<StorePrivateWhatsAppMessageInput['message']['media']>
): StorePrivateWhatsAppMessageInput {
  const { text: _text, ...baseMessage } = createStoreInput().message;
  return createStoreInput({
    message: {
      ...baseMessage,
      matrixEventId,
      type: 'audio',
      media,
    },
  });
}

function seedPendingTargetOperations(
  fakeFirestore: ReturnType<typeof createFakeFirestore>,
  input: {
    targetMatrixEventId: string;
    replacementCount: number;
    includeReaction?: boolean;
    includeRedaction?: boolean;
  }
): { relationIds: string[]; reactionIds: string[] } {
  const sourceAccountId = 'pbuchman-private-whatsapp';
  const userId = 'user-123';
  const matrixRoomId = '!room:matrix.example';
  const chatId = deterministicId(sourceAccountId, matrixRoomId);
  const targetMessageId = deterministicId(sourceAccountId, input.targetMatrixEventId);
  const relationIds: string[] = [];
  const reactionIds: string[] = [];
  const documents: { id: string; data: Record<string, unknown> }[] = [];
  const timestampAt = (offsetMilliseconds: number): string =>
    new Date(Date.parse('2026-06-22T10:00:00.000Z') + offsetMilliseconds).toISOString();

  for (let index = 0; index < input.replacementCount; index += 1) {
    const matrixEventId = `$bulk-replacement-${String(index).padStart(3, '0')}`;
    const id = deterministicId(sourceAccountId, matrixEventId);
    const eventTimestamp = timestampAt((index + 1) * 1_000);
    relationIds.push(id);
    documents.push({
      id,
      data: {
        id,
        chatId,
        userId,
        sourceAccountId,
        matrixRoomId,
        matrixEventId,
        matrixSenderId: '@alice:matrix.example',
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        direction: 'incoming',
        messageType: 'text',
        text: `Correction ${String(index)}`,
        relation: {
          kind: 'replacement',
          targetMatrixEventId: input.targetMatrixEventId,
          targetMessageId,
          applicationStatus: 'pending',
        },
        eventTimestamp,
        receivedAt: eventTimestamp,
        ingestedAt: eventTimestamp,
        deliveryMode: 'backfill',
        rawMatrixEvent: { event_id: matrixEventId },
        schemaVersion: 2,
      },
    });
  }

  if (input.includeReaction === true) {
    const matrixEventId = '$bulk-pending-reaction';
    const id = deterministicId(sourceAccountId, matrixEventId);
    const eventTimestamp = timestampAt(124_500);
    reactionIds.push(id);
    documents.push({
      id,
      data: {
        id,
        chatId,
        userId,
        sourceAccountId,
        matrixRoomId,
        matrixEventId,
        matrixSenderId: '@alice:matrix.example',
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        direction: 'incoming',
        messageType: 'reaction',
        text: '🔥',
        reaction: {
          emoji: '🔥',
          targetMatrixEventId: input.targetMatrixEventId,
          targetMessageId,
        },
        eventTimestamp,
        receivedAt: eventTimestamp,
        ingestedAt: eventTimestamp,
        deliveryMode: 'backfill',
        rawMatrixEvent: { event_id: matrixEventId },
        schemaVersion: 2,
      },
    });
  }

  if (input.includeRedaction === true) {
    const matrixEventId = '$bulk-pending-redaction';
    const id = deterministicId(sourceAccountId, matrixEventId);
    const eventTimestamp = timestampAt((input.replacementCount + 10) * 1_000);
    relationIds.push(id);
    documents.push({
      id,
      data: {
        id,
        chatId,
        userId,
        sourceAccountId,
        matrixRoomId,
        matrixEventId,
        matrixSenderId: '@alice:matrix.example',
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        direction: 'incoming',
        messageType: 'redaction',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: input.targetMatrixEventId,
          targetMessageId,
          applicationStatus: 'pending',
        },
        eventTimestamp,
        receivedAt: eventTimestamp,
        ingestedAt: eventTimestamp,
        deliveryMode: 'backfill',
        rawMatrixEvent: { event_id: matrixEventId },
        schemaVersion: 2,
      },
    });
  }

  fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, documents);
  return { relationIds, reactionIds };
}

function seedPendingOperationalRedactions(
  fakeFirestore: ReturnType<typeof createFakeFirestore>,
  input: { targetMatrixEventId: string; count: number }
): string[] {
  const sourceAccountId = 'pbuchman-private-whatsapp';
  const userId = 'user-123';
  const matrixRoomId = '!room:matrix.example';
  const chatId = deterministicId(sourceAccountId, matrixRoomId);
  const targetMessageId = deterministicId(sourceAccountId, input.targetMatrixEventId);
  const ids: string[] = [];
  const documents = Array.from({ length: input.count }, (_value, index) => {
    const matrixEventId = `$bulk-operational-redaction-${String(index).padStart(3, '0')}`;
    const id = deterministicId(sourceAccountId, matrixEventId);
    const eventTimestamp = new Date(
      Date.parse('2026-06-22T10:10:00.000Z') + index * 1_000
    ).toISOString();
    ids.push(id);
    return {
      id,
      data: {
        id,
        chatId,
        userId,
        sourceAccountId,
        matrixRoomId,
        matrixEventId,
        matrixSenderId: '@alice:matrix.example',
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        direction: 'incoming',
        messageType: 'redaction',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: input.targetMatrixEventId,
          targetMessageId,
          applicationStatus: 'pending',
        },
        eventTimestamp,
        receivedAt: eventTimestamp,
        ingestedAt: eventTimestamp,
        deliveryMode: 'backfill',
        rawMatrixEvent: { event_id: matrixEventId },
        schemaVersion: 2,
      },
    };
  });
  fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, documents);
  return ids;
}

describe('privateWhatsAppRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createPrivateWhatsAppRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: 'user-123',
        data: {
          userId: 'user-123',
          sourceAccountId: 'pbuchman-private-whatsapp',
          generationId: 'generation-default',
          phoneNumberNormalized: '48123456789',
          displayName: 'Test',
          status: 'active',
          createdAt: '2026-06-22T09:00:00.000Z',
          updatedAt: '2026-06-22T09:00:00.000Z',
          schemaVersion: 1,
        },
      },
    ]);
    repository = createPrivateWhatsAppRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  it('creates and resolves a per-user private WhatsApp account', async () => {
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-123').delete();
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
    expect(result.value.generationId).toMatch(/^private-wa-generation-[a-f0-9-]{36}$/);

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

  it('returns null when a private WhatsApp message does not exist', async () => {
    const result = await repository.getMessageById('missing-message');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBeNull();
  });

  it('updates stored private WhatsApp media metadata idempotently', async () => {
    const input = createAudioStoreInput('$event-audio-media', {
      mxcUri: 'mxc://home-dev/audio-media',
      mimeType: 'audio/ogg',
      fileName: 'Voice message.ogg',
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const messageId = deterministicId(input.sourceAccountId, '$event-audio-media');
    const updated = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-media',
        mimeType: 'audio/ogg',
        fileName: 'Voice message.ogg',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-media/audio.ogg',
        storedMimeType: 'audio/ogg',
        storedSizeBytes: 2048,
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error.message);
    expect(updated.value).toMatchObject({
      status: 'updated',
      message: {
        id: messageId,
        media: {
          mxcUri: 'mxc://home-dev/audio-media',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/audio-media/audio.ogg',
          storedMimeType: 'audio/ogg',
        },
      },
    });

    const repeated = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-media',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-media/audio.ogg',
      },
      now: '2026-06-22T10:04:00.000Z',
    });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) throw new Error(repeated.error.message);
    expect(repeated.value.status).toBe('already_stored');

    const persisted = await repository.getMessageById(messageId);
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error(persisted.error.message);
    expect(persisted.value?.media).toMatchObject({
      mxcUri: 'mxc://home-dev/audio-media',
      storageStatus: 'stored',
      gcsPath: 'whatsapp/private/user-123/audio-media/audio.ogg',
    });
  });

  it('updates stored media when a private WhatsApp message document relies on the document id', async () => {
    const input = createAudioStoreInput('$event-audio-without-embedded-id', {
      mxcUri: 'mxc://home-dev/audio-without-embedded-id',
      mimeType: 'audio/ogg',
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    const messageId = deterministicId(input.sourceAccountId, '$event-audio-without-embedded-id');
    const messageRef = fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId);
    const messageDoc = await messageRef.get();
    const { id: _id, ...messageWithoutEmbeddedId } = messageDoc.data() as Record<string, unknown>;
    await messageRef.set(messageWithoutEmbeddedId);

    const updated = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-without-embedded-id',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-without-embedded-id/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error.message);
    expect(updated.value.message.id).toBe(messageId);
    expect(updated.value.status).toBe('updated');
  });

  it('rejects invalid private WhatsApp stored media updates', async () => {
    const input = createAudioStoreInput('$event-audio-invalid-media', {
      mxcUri: 'mxc://home-dev/audio-invalid-media',
      mimeType: 'audio/ogg',
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    const messageId = deterministicId(input.sourceAccountId, '$event-audio-invalid-media');

    const missingPath = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-invalid-media',
        storageStatus: 'stored',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(missingPath.ok).toBe(false);
    if (missingPath.ok) throw new Error('Expected missing path to fail');
    expect(missingPath.error.code).toBe('VALIDATION_ERROR');

    const missingMessage = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId: 'missing-message',
      media: {
        mxcUri: 'mxc://home-dev/audio-invalid-media',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-invalid-media/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(missingMessage.ok).toBe(false);
    if (missingMessage.ok) throw new Error('Expected missing message to fail');
    expect(missingMessage.error.code).toBe('NOT_FOUND');

    const wrongSource = await repository.updateMessageStoredMedia({
      sourceAccountId: 'wrong-source',
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-invalid-media',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-invalid-media/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(wrongSource.ok).toBe(false);
    if (wrongSource.ok) throw new Error('Expected wrong source to fail');
    expect(wrongSource.error.code).toBe('NOT_FOUND');

    const mismatchedMxc = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/different-media',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-invalid-media/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(mismatchedMxc.ok).toBe(false);
    if (mismatchedMxc.ok) throw new Error('Expected mismatched media to fail');
    expect(mismatchedMxc.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects stored media updates for text messages and conflicting stored paths', async () => {
    const textInput = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$event-text-no-media',
      },
    });
    const textStored = await repository.storeIncomingMessage(textInput);
    expect(textStored.ok).toBe(true);
    if (!textStored.ok) throw new Error(textStored.error.message);
    const textMessageId = deterministicId(textInput.sourceAccountId, '$event-text-no-media');
    const noMedia = await repository.updateMessageStoredMedia({
      sourceAccountId: textInput.sourceAccountId,
      messageId: textMessageId,
      media: {
        mxcUri: 'mxc://home-dev/no-media',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/no-media/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(noMedia.ok).toBe(false);
    if (noMedia.ok) throw new Error('Expected no-media update to fail');
    expect(noMedia.error.code).toBe('VALIDATION_ERROR');

    const audioInput = createAudioStoreInput('$event-audio-conflicting-path', {
      mxcUri: 'mxc://home-dev/audio-conflicting-path',
      mimeType: 'audio/ogg',
    });
    const audioStored = await repository.storeIncomingMessage(audioInput);
    expect(audioStored.ok).toBe(true);
    if (!audioStored.ok) throw new Error(audioStored.error.message);
    const audioMessageId = deterministicId(audioInput.sourceAccountId, '$event-audio-conflicting-path');
    const firstUpdate = await repository.updateMessageStoredMedia({
      sourceAccountId: audioInput.sourceAccountId,
      messageId: audioMessageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-conflicting-path',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-conflicting-path/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(firstUpdate.ok).toBe(true);
    if (!firstUpdate.ok) throw new Error(firstUpdate.error.message);

    const conflictingPath = await repository.updateMessageStoredMedia({
      sourceAccountId: audioInput.sourceAccountId,
      messageId: audioMessageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-conflicting-path',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-conflicting-path/different.ogg',
      },
      now: '2026-06-22T10:04:00.000Z',
    });
    expect(conflictingPath.ok).toBe(false);
    if (conflictingPath.ok) throw new Error('Expected conflicting stored path to fail');
    expect(conflictingPath.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns not found when stored media update cannot resolve the matching chat', async () => {
    const input = createAudioStoreInput('$event-audio-missing-chat', {
      mxcUri: 'mxc://home-dev/audio-missing-chat',
      mimeType: 'audio/ogg',
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    const messageId = deterministicId(input.sourceAccountId, '$event-audio-missing-chat');
    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);

    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId).delete();
    const missingChat = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-missing-chat',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-missing-chat/audio.ogg',
      },
      now: '2026-06-22T10:03:00.000Z',
    });
    expect(missingChat.ok).toBe(false);
    if (missingChat.ok) throw new Error('Expected missing chat to fail');
    expect(missingChat.error.code).toBe('NOT_FOUND');

    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(chatId)
      .set({
        id: chatId,
        userId: input.userId,
        sourceAccountId: 'wrong-source',
        matrixRoomId: input.chat.matrixRoomId,
        chatType: 'direct',
        firstSeenAt: input.message.eventTimestamp,
        lastEventAt: input.message.eventTimestamp,
        updatedAt: input.receivedAt,
      });
    const wrongChatSource = await repository.updateMessageStoredMedia({
      sourceAccountId: input.sourceAccountId,
      messageId,
      media: {
        mxcUri: 'mxc://home-dev/audio-missing-chat',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/audio-missing-chat/audio.ogg',
      },
      now: '2026-06-22T10:04:00.000Z',
    });
    expect(wrongChatSource.ok).toBe(false);
    if (wrongChatSource.ok) throw new Error('Expected wrong chat source to fail');
    expect(wrongChatSource.error.code).toBe('NOT_FOUND');
  });

  it('updates a private WhatsApp chat transcription setting and preserves it across later messages', async () => {
    const input = createStoreInput();
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const enabled = await repository.updateChatTranscriptionSetting({
      sourceAccountId: input.sourceAccountId,
      chatId,
      enabled: true,
      now: '2026-06-22T10:05:00.000Z',
    });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) throw new Error(enabled.error.message);
    expect(enabled.value).toMatchObject({
      id: chatId,
      transcriptionEnabled: true,
      transcriptionEnabledAt: '2026-06-22T10:05:00.000Z',
      transcriptionUpdatedAt: '2026-06-22T10:05:00.000Z',
    });

    const later = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...input.message,
          matrixEventId: '$event-2',
          text: 'later message',
          eventTimestamp: '2026-06-22T10:06:00.000Z',
        },
      })
    );
    expect(later.ok).toBe(true);
    if (!later.ok) throw new Error(later.error.message);

    const chats = await repository.findChats({
      sourceAccountId: input.sourceAccountId,
      limit: 10,
    });
    expect(chats.ok).toBe(true);
    if (!chats.ok) throw new Error(chats.error.message);
    expect(chats.value.chats[0]).toMatchObject({
      id: chatId,
      transcriptionEnabled: true,
      transcriptionEnabledAt: '2026-06-22T10:05:00.000Z',
      transcriptionUpdatedAt: '2026-06-22T10:05:00.000Z',
      messageCount: 2,
    });
  });

  it('keeps the original private WhatsApp chat transcription enabled timestamp when disabling', async () => {
    const input = createStoreInput();
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const enabled = await repository.updateChatTranscriptionSetting({
      sourceAccountId: input.sourceAccountId,
      chatId,
      enabled: true,
      now: '2026-06-22T10:05:00.000Z',
    });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) throw new Error(enabled.error.message);

    const disabled = await repository.updateChatTranscriptionSetting({
      sourceAccountId: input.sourceAccountId,
      chatId,
      enabled: false,
      now: '2026-06-22T10:08:00.000Z',
    });

    expect(disabled.ok).toBe(true);
    if (!disabled.ok) throw new Error(disabled.error.message);
    expect(disabled.value).toMatchObject({
      id: chatId,
      transcriptionEnabled: false,
      transcriptionEnabledAt: '2026-06-22T10:05:00.000Z',
      transcriptionUpdatedAt: '2026-06-22T10:08:00.000Z',
    });
  });

  it('leaves private WhatsApp chat transcription enabled timestamp unset when disabling before first enable', async () => {
    const input = createStoreInput();
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const disabled = await repository.updateChatTranscriptionSetting({
      sourceAccountId: input.sourceAccountId,
      chatId,
      enabled: false,
      now: '2026-06-22T10:08:00.000Z',
    });

    expect(disabled.ok).toBe(true);
    if (!disabled.ok) throw new Error(disabled.error.message);
    expect(disabled.value).toMatchObject({
      id: chatId,
      transcriptionEnabled: false,
      transcriptionUpdatedAt: '2026-06-22T10:08:00.000Z',
    });
    expect(disabled.value.transcriptionEnabledAt).toBeUndefined();
  });

  it('returns not found for missing or cross-account private WhatsApp chat transcription updates', async () => {
    const missing = await repository.updateChatTranscriptionSetting({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: 'missing-chat',
      enabled: true,
      now: '2026-06-22T10:05:00.000Z',
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('Expected missing chat to be rejected');
    expect(missing.error.code).toBe('NOT_FOUND');

    const input = createStoreInput();
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const wrongSource = await repository.updateChatTranscriptionSetting({
      sourceAccountId: 'other-private-source',
      chatId,
      enabled: true,
      now: '2026-06-22T10:05:00.000Z',
    });

    expect(wrongSource.ok).toBe(false);
    if (wrongSource.ok) throw new Error('Expected cross-account chat update to be rejected');
    expect(wrongSource.error.code).toBe('NOT_FOUND');
  });

  it('stores private WhatsApp message transcription success and failure states', async () => {
    const input = createStoreInput({
      message: {
        ...createStoreInput().message,
        type: 'audio',
        media: {
          mxcUri: 'mxc://matrix.example/audio',
          mimeType: 'audio/ogg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/audio-message/audio.ogg',
        },
      },
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const completed = await repository.updateMessageTranscription({
      userId: 'user-123',
      messageId: stored.value.messageId,
      transcription: {
        status: 'completed',
        jobId: 'job-private-1',
        text: 'Pick up milk.',
        summary: 'Errand reminder.',
        detectedLanguage: 'en',
        completedAt: '2026-06-22T10:10:00.000Z',
      },
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) throw new Error(completed.error.message);

    const completedMessage = await repository.getMessageById(stored.value.messageId);
    expect(completedMessage.ok).toBe(true);
    if (!completedMessage.ok) throw new Error(completedMessage.error.message);
    expect(completedMessage.value?.transcription).toEqual({
      status: 'completed',
      jobId: 'job-private-1',
      text: 'Pick up milk.',
      summary: 'Errand reminder.',
      detectedLanguage: 'en',
      completedAt: '2026-06-22T10:10:00.000Z',
    });

    const failed = await repository.updateMessageTranscription({
      userId: 'user-123',
      messageId: stored.value.messageId,
      transcription: {
        status: 'failed',
        jobId: 'job-private-2',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Audio format was not supported',
        },
        completedAt: '2026-06-22T10:11:00.000Z',
      },
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) throw new Error(failed.error.message);

    const failedMessage = await repository.getMessageById(stored.value.messageId);
    expect(failedMessage.ok).toBe(true);
    if (!failedMessage.ok) throw new Error(failedMessage.error.message);
    expect(failedMessage.value?.transcription).toEqual({
      status: 'failed',
      jobId: 'job-private-2',
      error: {
        code: 'TRANSCRIPTION_FAILED',
        message: 'Audio format was not supported',
      },
      completedAt: '2026-06-22T10:11:00.000Z',
    });
  });

  it('journals one projection change for a completed transcription and ignores an identical retry', async () => {
    const input = createAudioStoreInput('$audio-context-event', {
      mxcUri: 'mxc://matrix.example/context-audio',
      mimeType: 'audio/ogg',
      storageStatus: 'stored',
      gcsPath: 'whatsapp/private/user-123/context-audio/audio.ogg',
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const transcription = {
      status: 'completed' as const,
      jobId: 'job-context-audio',
      text: 'Please pick up milk.',
      summary: 'Errand reminder.',
      detectedLanguage: 'en',
      completedAt: '2026-06-22T10:10:00.000Z',
    };
    const completed = await repository.updateMessageTranscription({
      userId: input.userId,
      messageId: stored.value.messageId,
      transcription,
    });
    expect(completed.ok).toBe(true);

    const retry = await repository.updateMessageTranscription({
      userId: input.userId,
      messageId: stored.value.messageId,
      transcription,
    });
    expect(retry.ok).toBe(true);

    const data = fakeFirestore.getAllData();
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(stored.value.chatId);
    const message = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(stored.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));

    expect(chat).toMatchObject({ contextChangeSequence: 2 });
    expect(message).toMatchObject({
      contextRevision: 2,
      contextChangeSequence: 2,
      contextState: 'visible',
      transcription,
    });
    expect(journal).toHaveLength(2);
    expect(journal[1]).toMatchObject({
      sequence: 2,
      messageId: stored.value.messageId,
      messageRevision: 2,
      changeType: 'transcription_changed',
      before: {
        state: 'omitted',
        omissionReason: 'media_only',
      },
      after: {
        state: 'included',
        contentKind: 'transcription',
        content: 'Please pick up milk.',
      },
    });
  });

  it('returns not found for missing or cross-user private WhatsApp message transcription updates', async () => {
    const missing = await repository.updateMessageTranscription({
      userId: 'user-123',
      messageId: 'missing-message',
      transcription: {
        status: 'failed',
        jobId: 'job-missing',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Missing message',
        },
        completedAt: '2026-06-22T10:11:00.000Z',
      },
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('Expected missing message update to be rejected');
    expect(missing.error.code).toBe('NOT_FOUND');

    const stored = await repository.storeIncomingMessage(createStoreInput());
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const wrongUser = await repository.updateMessageTranscription({
      userId: 'other-user',
      messageId: stored.value.messageId,
      transcription: {
        status: 'failed',
        jobId: 'job-wrong-user',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Wrong user',
        },
        completedAt: '2026-06-22T10:12:00.000Z',
      },
    });

    expect(wrongUser.ok).toBe(false);
    if (wrongUser.ok) throw new Error('Expected cross-user message update to be rejected');
    expect(wrongUser.error.code).toBe('NOT_FOUND');
  });

  it('updates transcription on legacy private WhatsApp message documents that do not store their id', async () => {
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('legacy-private-message')
      .set({
        userId: 'user-123',
      });

    const result = await repository.updateMessageTranscription({
      userId: 'user-123',
      messageId: 'legacy-private-message',
      transcription: {
        status: 'completed',
        jobId: 'job-legacy',
        text: 'Legacy transcript.',
        completedAt: '2026-06-22T10:11:00.000Z',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const doc = await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('legacy-private-message')
      .get();
    expect(doc.data()?.['transcription']).toEqual({
      status: 'completed',
      jobId: 'job-legacy',
      text: 'Legacy transcript.',
      completedAt: '2026-06-22T10:11:00.000Z',
    });
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
    expect(sparse.value?.sourceAccountId).toBe(
      `private-wa-${createHash('sha256')
        .update('private-whatsapp\0legacy-user')
        .digest('hex')
        .slice(0, 24)}`
    );
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
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-123').delete();
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

  it('loads private WhatsApp messages by id for signed media access', async () => {
    const input = createStoreInput({
      message: {
        ...createStoreInput().message,
        type: 'image',
        media: {
          mxcUri: 'mxc://home-dev/image',
          mimeType: 'image/jpeg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image.jpg',
          thumbnailGcsPath: 'whatsapp/private/user-123/message/image_thumb.jpg',
        },
      },
    });
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const result = await repository.getMessageById(stored.value.messageId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value?.id).toBe(stored.value.messageId);
    expect(result.value?.media?.gcsPath).toBe('whatsapp/private/user-123/message/image.jpg');
    expect(result.value?.media?.thumbnailGcsPath).toBe(
      'whatsapp/private/user-123/message/image_thumb.jpg'
    );
  });

  it('loads private WhatsApp chats by id within the source account', async () => {
    const input = createStoreInput();
    const stored = await repository.storeIncomingMessage(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);

    const result = await repository.getChatById({
      sourceAccountId: input.sourceAccountId,
      chatId: stored.value.chatId,
    });
    const crossAccount = await repository.getChatById({
      sourceAccountId: 'other-source',
      chatId: stored.value.chatId,
    });
    const missing = await repository.getChatById({
      sourceAccountId: input.sourceAccountId,
      chatId: 'missing-chat',
    });

    expect(result.ok).toBe(true);
    expect(crossAccount.ok).toBe(true);
    expect(missing.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    if (!crossAccount.ok) throw new Error(crossAccount.error.message);
    if (!missing.ok) throw new Error(missing.error.message);
    expect(result.value?.id).toBe(stored.value.chatId);
    expect(result.value?.sourceAccountId).toBe(input.sourceAccountId);
    expect(crossAccount.value).toBeNull();
    expect(missing.value).toBeNull();
  });

  it('finds private conversation context messages ascending and returns limit plus one', async () => {
    const input = createStoreInput();
    const chatId = deterministicId(input.sourceAccountId, input.chat.matrixRoomId);
    const outOfRangeBefore = 'context-before';
    const first = 'context-first';
    const second = 'context-second';
    const sameTimestampLaterId = 'context-zzz';
    const otherChat = 'context-other-chat';
    const outOfRangeAfter = 'context-after';
    const baseMessage = {
      chatId,
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      matrixRoomId: input.chat.matrixRoomId,
      matrixSenderId: input.message.matrixSenderId,
      direction: 'incoming',
      messageType: 'text',
      receivedAt: '2026-06-22T10:00:01.000Z',
      ingestedAt: '2026-06-22T10:00:02.000Z',
      deliveryMode: 'live',
      rawMatrixEvent: { type: 'm.room.message' },
      schemaVersion: 2,
    };
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(outOfRangeBefore).set({
      ...baseMessage,
      id: outOfRangeBefore,
      matrixEventId: '$before',
      text: 'before',
      eventTimestamp: '2026-06-22T09:59:59.999Z',
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(second).set({
      ...baseMessage,
      id: second,
      matrixEventId: '$second',
      text: 'second',
      eventTimestamp: '2026-06-22T10:01:00.000Z',
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(first).set({
      ...baseMessage,
      matrixEventId: '$first',
      text: 'first',
      eventTimestamp: '2026-06-22T10:00:00.000Z',
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(sameTimestampLaterId).set({
      ...baseMessage,
      id: sameTimestampLaterId,
      matrixEventId: '$zzz',
      text: 'same timestamp later id',
      eventTimestamp: '2026-06-22T10:01:00.000Z',
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(otherChat).set({
      ...baseMessage,
      id: otherChat,
      chatId: 'other-chat',
      matrixEventId: '$other-chat',
      text: 'other chat',
      eventTimestamp: '2026-06-22T10:00:30.000Z',
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(outOfRangeAfter).set({
      ...baseMessage,
      id: outOfRangeAfter,
      matrixEventId: '$after',
      text: 'after',
      eventTimestamp: '2026-06-22T10:02:00.000Z',
    });

    const result = await repository.findConversationContextMessages({
      sourceAccountId: input.sourceAccountId,
      chatId,
      from: '2026-06-22T10:00:00.000Z',
      to: '2026-06-22T10:02:00.000Z',
      limit: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.messages.map((candidate) => candidate.id)).toEqual([
      first,
      second,
    ]);
    expect(result.value.nextCursor).toEqual(expect.any(String));
    expect(result.value.totalCount).toBe(3);
  });

  it('projects legacy private WhatsApp messages by document id when embedded id is absent', async () => {
    const messageId = deterministicId('pbuchman-private-whatsapp', '$legacy-event');
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).set({
      chatId: deterministicId('pbuchman-private-whatsapp', '!room:matrix.example'),
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!room:matrix.example',
      matrixEventId: '$legacy-event',
      matrixSenderId: '@alice:matrix.example',
      direction: 'incoming',
      messageType: 'image',
      eventTimestamp: '2026-06-22T10:00:00.000Z',
      eventDayKey: '2026-06-22',
      eventTimeZone: 'Europe/Warsaw',
      receivedAt: '2026-06-22T10:00:02.000Z',
      ingestedAt: '2026-06-22T10:00:03.000Z',
      deliveryMode: 'live',
      rawMatrixEvent: {
        type: 'm.room.message',
        event_id: '$legacy-event',
      },
      media: {
        mxcUri: 'mxc://home-dev/image',
        mimeType: 'image/jpeg',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/message/legacy-image.jpg',
        thumbnailGcsPath: 'whatsapp/private/user-123/message/legacy-image_thumb.jpg',
      },
      schemaVersion: 2,
    });

    const result = await repository.getMessageById(messageId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value?.id).toBe(messageId);
    expect(result.value?.media?.gcsPath).toBe(
      'whatsapp/private/user-123/message/legacy-image.jpg'
    );
  });

  it('projects legacy private WhatsApp message query rows by document id when embedded id is absent', async () => {
    const messageId = deterministicId('pbuchman-private-whatsapp', '$legacy-query-event');
    const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).set({
      chatId,
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!room:matrix.example',
      matrixEventId: '$legacy-query-event',
      matrixSenderId: '@alice:matrix.example',
      senderKey: 'phone:+48123456789',
      direction: 'incoming',
      messageType: 'text',
      text: 'legacy query row',
      eventTimestamp: '2026-06-22T10:00:00.000Z',
      eventDayKey: '2026-06-22',
      eventTimeZone: 'Europe/Warsaw',
      receivedAt: '2026-06-22T10:00:02.000Z',
      ingestedAt: '2026-06-22T10:00:03.000Z',
      deliveryMode: 'live',
      rawMatrixEvent: { type: 'm.room.message', event_id: '$legacy-query-event' },
    });

    const result = await repository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId,
      from: '2026-06-22T09:00:00.000Z',
      to: '2026-06-22T11:00:00.000Z',
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.messages[0]?.id).toBe(messageId);
  });

  it('finds private WhatsApp reactions for target message ids without exposing Matrix ids', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$target-event',
        text: 'original post',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error('target store failed');

    const firstReactionResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$reaction-event',
          direction: 'incoming',
          type: 'reaction',
          text: '👍',
          reaction: {
            emoji: '👍',
            targetMatrixEventId: '$target-event',
          },
        },
      })
    );
    expect(firstReactionResult.ok).toBe(true);
    if (!firstReactionResult.ok) throw new Error('first reaction store failed');

    const secondReactionResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$legacy-reaction-event',
          direction: 'incoming',
          type: 'reaction',
          text: '❤️',
          rawMatrixEvent: {
            type: 'm.reaction',
            event_id: '$legacy-reaction-event',
            content: {
              'm.relates_to': {
                rel_type: 'm.annotation',
                event_id: '$target-event',
                key: '❤️',
              },
            },
          },
        },
      })
    );
    expect(secondReactionResult.ok).toBe(true);
    if (!secondReactionResult.ok) throw new Error('second reaction store failed');

    const findReactionsForMessageIds = Reflect.get(repository, 'findReactionsForMessageIds');
    expect(typeof findReactionsForMessageIds).toBe('function');
    if (typeof findReactionsForMessageIds !== 'function') {
      throw new Error('reaction query method missing');
    }

    const reactions = await findReactionsForMessageIds.call(repository, {
      sourceAccountId: target.sourceAccountId,
      chatId: targetResult.value.chatId,
      targets: [
        {
          messageId: targetResult.value.messageId,
          matrixEventId: '$target-event',
        },
      ],
    });

    expect(reactions.ok).toBe(true);
    if (!reactions.ok) throw new Error('reaction query failed');
    const summaries = reactions.value.reactionsByMessageId[targetResult.value.messageId];
    if (summaries === undefined) throw new Error('target reactions missing');
    expect(summaries).toHaveLength(2);
    expect(summaries).toMatchObject([
      {
        emoji: '👍',
        senderDisplayName: 'Alice',
        direction: 'incoming',
      },
      {
        emoji: '❤️',
        senderDisplayName: 'Alice',
        direction: 'incoming',
      },
    ]);
    expect(summaries.map((summary: { eventTimestamp: string }) => summary.eventTimestamp)).toEqual(
      summaries
        .map((summary: { eventTimestamp: string }) => summary.eventTimestamp)
        .sort()
    );
    expect(reactions.value.attachedReactionMessageIds).toEqual(
      expect.arrayContaining([
        firstReactionResult.value.messageId,
        secondReactionResult.value.messageId,
      ])
    );
    expect(JSON.stringify(reactions.value)).not.toContain('$target-event');
  });

  it('returns an empty private WhatsApp reaction result for empty target input', async () => {
    const reactions = await repository.findReactionsForMessageIds({
      sourceAccountId: 'pbuchman-private-whatsapp',
      targets: [],
    });

    expect(reactions.ok).toBe(true);
    if (!reactions.ok) throw new Error(reactions.error.message);
    expect(reactions.value).toEqual({
      reactionsByMessageId: {},
      attachedReactionMessageIds: [],
    });
  });

  it('finds private WhatsApp reactions without a chat scope and ignores malformed stored candidates', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$unscoped-target-event',
        text: 'original post',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error('target store failed');

    const normalizedReactionResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$unscoped-reaction-event',
          direction: 'outgoing',
          type: 'reaction',
          text: '👍',
          reaction: {
            emoji: '👍',
            targetMatrixEventId: '$unscoped-target-event',
          },
        },
      })
    );
    expect(normalizedReactionResult.ok).toBe(true);
    if (!normalizedReactionResult.ok) throw new Error('normalized reaction store failed');
    const normalizedReactionId = normalizedReactionResult.value.messageId;
    const normalizedReactionRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc(normalizedReactionId);
    const normalizedReactionDoc = await normalizedReactionRef.get();
    const { id: _id, ...normalizedWithoutEmbeddedId } =
      normalizedReactionDoc.data() as Record<string, unknown>;
    await normalizedReactionRef.set(normalizedWithoutEmbeddedId);

    const baseMalformedReaction = {
      chatId: targetResult.value.chatId,
      userId: target.userId,
      sourceAccountId: target.sourceAccountId,
      matrixRoomId: target.message.matrixRoomId,
      matrixEventId: '$malformed-reaction',
      matrixSenderId: target.message.matrixSenderId,
      direction: 'incoming',
      messageType: 'reaction',
      eventTimestamp: '2026-06-22T10:06:00.000Z',
      receivedAt: '2026-06-22T10:06:01.000Z',
      ingestedAt: '2026-06-22T10:06:01.000Z',
      deliveryMode: 'live',
      rawMatrixEvent: {},
      schemaVersion: 2,
    };
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-empty-summary')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-empty-summary',
        matrixEventId: '$malformed-empty-summary',
        text: '',
        reaction: {
          emoji: '',
          targetMatrixEventId: '$unscoped-target-event',
          targetMessageId: targetResult.value.messageId,
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-missing-summary')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-missing-summary',
        matrixEventId: '$malformed-missing-summary',
        reaction: {
          targetMatrixEventId: '$unscoped-target-event',
          targetMessageId: targetResult.value.messageId,
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('normalized-missing-target')
      .set({
        ...baseMalformedReaction,
        id: 'normalized-missing-target',
        matrixEventId: '$normalized-missing-target',
        text: '👀',
        reaction: {
          emoji: '👀',
          targetMatrixEventId: '$unscoped-target-event',
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('normalized-with-raw-target')
      .set({
        ...baseMalformedReaction,
        id: 'normalized-with-raw-target',
        matrixEventId: '$normalized-with-raw-target',
        text: '💬',
        reaction: {
          emoji: '💬',
          targetMatrixEventId: '$unscoped-target-event',
          targetMessageId: 'unrelated-message',
        },
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$unscoped-target-event',
              key: '💬',
            },
          },
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-raw-event')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-raw-event',
        matrixEventId: '$malformed-raw-event',
        rawMatrixEvent: 'not-an-event',
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-content')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-content',
        matrixEventId: '$malformed-content',
        rawMatrixEvent: { content: 'not-content' },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-relation')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-relation',
        matrixEventId: '$malformed-relation',
        rawMatrixEvent: { content: { 'm.relates_to': 'not-relation' } },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-relation-with-target')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-relation-with-target',
        matrixEventId: '$malformed-relation-with-target',
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.replace',
              event_id: '$unscoped-target-event',
              key: '❤️',
            },
          },
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('malformed-missing-key')
      .set({
        ...baseMalformedReaction,
        id: 'malformed-missing-key',
        matrixEventId: '$malformed-missing-key',
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$unscoped-target-event',
            },
          },
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('unmatched-legacy-target')
      .set({
        ...baseMalformedReaction,
        id: 'unmatched-legacy-target',
        matrixEventId: '$unmatched-legacy-target',
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$other-target-event',
              key: '❤️',
            },
          },
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('same-time-b-reaction')
      .set({
        ...baseMalformedReaction,
        id: 'same-time-b-reaction',
        matrixEventId: '$same-time-b-reaction',
        text: '👋',
        reaction: {
          emoji: '👋',
          targetMatrixEventId: '$unscoped-target-event',
          targetMessageId: targetResult.value.messageId,
        },
      });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('same-time-a-reaction')
      .set({
        ...baseMalformedReaction,
        id: 'same-time-a-reaction',
        matrixEventId: '$same-time-a-reaction',
        text: '🔥',
        reaction: {
          emoji: '🔥',
          targetMatrixEventId: '$unscoped-target-event',
          targetMessageId: targetResult.value.messageId,
        },
      });

    const reactions = await repository.findReactionsForMessageIds({
      sourceAccountId: target.sourceAccountId,
      targets: [
        {
          messageId: targetResult.value.messageId,
          matrixEventId: '$unscoped-target-event',
        },
      ],
    });

    expect(reactions.ok).toBe(true);
    if (!reactions.ok) throw new Error(reactions.error.message);
    expect(reactions.value.reactionsByMessageId[targetResult.value.messageId]).toEqual([
      {
        id: normalizedReactionId,
        emoji: '👍',
        direction: 'outgoing',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        senderPhoneNumber: '+48123456789',
      },
      {
        id: 'same-time-a-reaction',
        emoji: '🔥',
        direction: 'incoming',
        eventTimestamp: '2026-06-22T10:06:00.000Z',
      },
      {
        id: 'same-time-b-reaction',
        emoji: '👋',
        direction: 'incoming',
        eventTimestamp: '2026-06-22T10:06:00.000Z',
      },
    ]);
    expect(reactions.value.attachedReactionMessageIds).toEqual([
      normalizedReactionId,
      'same-time-a-reaction',
      'same-time-b-reaction',
    ]);
    expect(JSON.stringify(reactions.value)).not.toContain('$unscoped-target-event');
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

  it('atomically journals the sanitized context projection for a created message', async () => {
    const input = createStoreInput();

    const result = await repository.storeIncomingMessage(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const data = fakeFirestore.getAllData();
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(result.value.chatId);
    const message = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(result.value.messageId);
    const journal = [...(data.get('whatsapp_private_context_changes')?.values() ?? [])];

    expect(chat).toMatchObject({
      contextChangeSequence: 1,
      contextChangedAt: expect.any(String),
    });
    expect(message).toMatchObject({
      contextRevision: 1,
      contextChangeSequence: 1,
      contextState: 'visible',
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      chatId: result.value.chatId,
      sequence: 1,
      messageId: result.value.messageId,
      messageRevision: 1,
      changeType: 'created',
      changedAt: expect.any(String),
      eventTimestamp: input.message.eventTimestamp,
      before: { state: 'missing' },
      after: {
        state: 'included',
        eventTimestamp: input.message.eventTimestamp,
        importedAt: input.receivedAt,
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'hello',
        reactions: [],
      },
      schemaVersion: 1,
    });
    const serialized = JSON.stringify(journal[0]);
    expect(serialized).not.toContain('+48123456789');
    expect(serialized).not.toContain('rawMatrixEvent');
    expect(serialized).not.toContain('matrixRoomId');
  });

  it('reads an owned bounded journal range and hydrates messages in stable event order', async () => {
    const later = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$journal-later',
        text: 'later',
        eventTimestamp: '2026-06-22T10:01:00.000Z',
      },
    });
    const earlier = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$journal-earlier',
        text: 'earlier',
        eventTimestamp: '2026-06-22T09:59:00.000Z',
      },
    });
    const laterResult = await repository.storeIncomingMessage(later);
    const earlierResult = await repository.storeIncomingMessage(earlier);
    expect(laterResult.ok).toBe(true);
    expect(earlierResult.ok).toBe(true);
    if (!laterResult.ok || !earlierResult.ok) throw new Error('journal setup failed');

    const head = await repository.getConversationContextJournalHead({
      userId: later.userId,
      sourceAccountId: later.sourceAccountId,
      chatId: laterResult.value.chatId,
    });
    expect(head).toEqual({ ok: true, value: 2 });

    const firstPage = await repository.findConversationContextJournalEntries({
      userId: later.userId,
      sourceAccountId: later.sourceAccountId,
      chatId: laterResult.value.chatId,
      afterSequence: 0,
      throughSequence: 2,
      limit: 1,
    });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) throw new Error(firstPage.error.message);
    expect(firstPage.value.entries.map((entry) => entry.sequence)).toEqual([1]);
    expect(firstPage.value.nextAfterSequence).toBe(1);

    const secondPage = await repository.findConversationContextJournalEntries({
      userId: later.userId,
      sourceAccountId: later.sourceAccountId,
      chatId: laterResult.value.chatId,
      afterSequence: firstPage.value.nextAfterSequence ?? 0,
      throughSequence: 2,
      limit: 1,
    });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) throw new Error(secondPage.error.message);
    expect(secondPage.value.entries.map((entry) => entry.sequence)).toEqual([2]);
    expect(secondPage.value.nextAfterSequence).toBeUndefined();

    const hydrated = await repository.findConversationContextMessagesByIds({
      userId: later.userId,
      sourceAccountId: later.sourceAccountId,
      chatId: laterResult.value.chatId,
      messageIds: [laterResult.value.messageId, 'missing', earlierResult.value.messageId],
    });
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) throw new Error(hydrated.error.message);
    expect(hydrated.value.map((message) => message.id)).toEqual([
      earlierResult.value.messageId,
      laterResult.value.messageId,
    ]);

    const wrongOwner = await repository.getConversationContextJournalHead({
      userId: later.userId,
      sourceAccountId: 'other-source-account',
      chatId: laterResult.value.chatId,
    });
    expect(wrongOwner.ok).toBe(false);
    if (wrongOwner.ok) throw new Error('Expected cross-account journal read to fail');
    expect(wrongOwner.error.code).toBe('NOT_FOUND');
  });

  it('applies a replacement to its logical target and journals only the target revision', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$replace-target',
        text: 'Original message',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const replacement = createStoreInput({
      receivedAt: '2026-06-22T10:05:02.000Z',
      message: {
        ...createStoreInput().message,
        matrixEventId: '$replacement-event',
        text: 'Corrected message',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$replace-target',
          applicationStatus: 'pending',
        },
      },
    });
    const replacementResult = await repository.storeIncomingMessage(replacement);
    expect(replacementResult.ok).toBe(true);
    if (!replacementResult.ok) throw new Error(replacementResult.error.message);

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const relationMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(replacementResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));

    expect(targetMessage).toMatchObject({
      text: 'Corrected message',
      contextRevision: 2,
      contextChangeSequence: 2,
      editedAt: replacement.message.eventTimestamp,
    });
    expect(relationMessage).toMatchObject({
      relation: {
        kind: 'replacement',
        targetMatrixEventId: '$replace-target',
        targetMessageId: targetResult.value.messageId,
        applicationStatus: 'applied',
        appliedAt: expect.any(String),
      },
    });
    expect(journal).toHaveLength(2);
    expect(journal[1]).toMatchObject({
      sequence: 2,
      messageId: targetResult.value.messageId,
      messageRevision: 2,
      changeType: 'edited',
      before: { state: 'included', content: 'Original message' },
      after: { state: 'included', content: 'Corrected message' },
    });
  });

  it('rolls the logical target back through replacement history when edit events are redacted', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$replacement-redaction-target',
        text: 'Original message',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const createReplacement = (
      matrixEventId: string,
      text: string,
      eventTimestamp: string
    ): StorePrivateWhatsAppMessageInput =>
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId,
          text,
          eventTimestamp,
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$replacement-redaction-target',
            applicationStatus: 'pending',
          },
        },
      });
    const firstReplacement = await repository.storeIncomingMessage(
      createReplacement('$replacement-first', 'First correction', '2026-06-22T10:05:00.000Z')
    );
    const secondReplacement = await repository.storeIncomingMessage(
      createReplacement('$replacement-second', 'Second correction', '2026-06-22T10:10:00.000Z')
    );
    expect(firstReplacement.ok).toBe(true);
    expect(secondReplacement.ok).toBe(true);
    if (!firstReplacement.ok || !secondReplacement.ok) {
      throw new Error('replacement setup failed');
    }

    const redactReplacement = async (
      matrixEventId: string,
      redactionId: string
    ): ReturnType<typeof repository.storeIncomingMessage> =>
      repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: redactionId,
            type: 'redaction',
            text: undefined,
            eventTimestamp: '2026-06-22T10:20:00.000Z',
            relation: {
              kind: 'redaction',
              targetMatrixEventId: matrixEventId,
              applicationStatus: 'pending',
            },
          },
        })
      );

    const secondRedaction = await redactReplacement(
      '$replacement-second',
      '$replacement-second-redaction'
    );
    expect(secondRedaction.ok).toBe(true);
    let data = fakeFirestore.getAllData();
    expect(
      data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(targetResult.value.messageId)
    ).toMatchObject({
      text: 'First correction',
      contextOriginalText: 'Original message',
      latestReplacementMessageId: firstReplacement.value.messageId,
      contextRevision: 4,
      contextChangeSequence: 4,
    });
    const redactedSecond = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(secondReplacement.value.messageId);
    expect(redactedSecond).toMatchObject({
      contextState: 'redacted',
      relation: { kind: 'replacement' },
    });
    expect(redactedSecond).not.toHaveProperty('text');

    const firstRedaction = await redactReplacement(
      '$replacement-first',
      '$replacement-first-redaction'
    );
    expect(firstRedaction.ok).toBe(true);
    data = fakeFirestore.getAllData();
    const restoredOriginal = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    expect(restoredOriginal).toMatchObject({
      text: 'Original message',
      contextOriginalText: 'Original message',
      contextRevision: 5,
      contextChangeSequence: 5,
    });
    expect(restoredOriginal).not.toHaveProperty('latestReplacementMessageId');
    expect(restoredOriginal).not.toHaveProperty('latestReplacementEventTimestamp');

    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));
    expect(journal.map((entry) => entry['changeType'])).toEqual([
      'created',
      'edited',
      'edited',
      'edited',
      'edited',
    ]);
    expect(journal[3]).toMatchObject({
      before: { state: 'included', content: 'Second correction' },
      after: { state: 'included', content: 'First correction' },
    });
    expect(journal[4]).toMatchObject({
      before: { state: 'included', content: 'First correction' },
      after: { state: 'included', content: 'Original message' },
    });
  });

  it('redacts and scrubs a logical target while retaining an ordered tombstone', async () => {
    const target = createAudioStoreInput('$redaction-target', {
      mxcUri: 'mxc://matrix.example/private-audio',
      mimeType: 'audio/ogg',
      fileName: 'private-audio.ogg',
      storageStatus: 'stored',
      gcsPath: 'whatsapp/private/user-123/private-audio/audio.ogg',
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);
    const transcriptionResult = await repository.updateMessageTranscription({
      userId: target.userId,
      messageId: targetResult.value.messageId,
      transcription: {
        status: 'completed',
        jobId: 'private-transcription-job',
        text: 'Sensitive spoken content',
        summary: 'Sensitive summary',
        completedAt: '2026-06-22T10:04:00.000Z',
      },
    });
    expect(transcriptionResult.ok).toBe(true);

    const redaction = createStoreInput({
      receivedAt: '2026-06-22T10:05:02.000Z',
      message: {
        ...createStoreInput().message,
        matrixEventId: '$redaction-event',
        type: 'redaction',
        text: undefined,
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: '$redaction-target',
          applicationStatus: 'pending',
        },
        rawMatrixEvent: {
          type: 'm.room.redaction',
          event_id: '$redaction-event',
          redacts: '$redaction-target',
        },
      },
    });
    const redactionResult = await repository.storeIncomingMessage(redaction);
    expect(redactionResult.ok).toBe(true);
    if (!redactionResult.ok) throw new Error(redactionResult.error.message);

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const redactionMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(redactionResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));

    expect(targetMessage).toMatchObject({
      contextState: 'redacted',
      contextRevision: 3,
      contextChangeSequence: 3,
      redactedAt: redaction.message.eventTimestamp,
      rawMatrixEvent: {
        type: 'm.room.message',
        event_id: '$redaction-target',
        redacted: true,
      },
    });
    expect(targetMessage).not.toHaveProperty('text');
    expect(targetMessage).not.toHaveProperty('transcription');
    expect(targetMessage).not.toHaveProperty('media');
    expect(redactionMessage).toMatchObject({
      relation: {
        kind: 'redaction',
        targetMessageId: targetResult.value.messageId,
        applicationStatus: 'applied',
      },
    });
    expect(journal).toHaveLength(3);
    expect(journal[2]).toMatchObject({
      sequence: 3,
      messageId: targetResult.value.messageId,
      messageRevision: 3,
      changeType: 'redacted',
      before: { state: 'included', content: 'Sensitive spoken content' },
      after: {
        state: 'redacted',
        eventTimestamp: target.message.eventTimestamp,
      },
    });
    expect(JSON.stringify(targetMessage)).not.toContain('Sensitive');
    expect(JSON.stringify(journal[2])).not.toContain('mxc://');
  });

  it('journals a sanitized reaction change on the logical target', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-journal-target',
        text: 'React to this',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const reaction = createStoreInput({
      receivedAt: '2026-06-22T10:03:02.000Z',
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-journal-event',
        type: 'reaction',
        text: '👍',
        eventTimestamp: '2026-06-22T10:03:00.000Z',
        reaction: {
          emoji: '👍',
          targetMatrixEventId: '$reaction-journal-target',
        },
      },
    });
    const reactionResult = await repository.storeIncomingMessage(reaction);
    expect(reactionResult.ok).toBe(true);
    if (!reactionResult.ok) throw new Error(reactionResult.error.message);

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));

    expect(targetMessage).toMatchObject({
      contextRevision: 2,
      contextChangeSequence: 2,
      reactions: [
        {
          id: reactionResult.value.messageId,
          emoji: '👍',
          senderDisplayName: 'Alice',
          direction: 'incoming',
          eventTimestamp: reaction.message.eventTimestamp,
        },
      ],
    });
    expect(journal).toHaveLength(2);
    expect(journal[1]).toMatchObject({
      sequence: 2,
      messageId: targetResult.value.messageId,
      messageRevision: 2,
      changeType: 'reaction_changed',
      before: { state: 'included', reactions: [] },
      after: {
        state: 'included',
        reactions: [{ id: reactionResult.value.messageId, emoji: '👍' }],
      },
    });
    expect(JSON.stringify(targetMessage?.['reactions'])).not.toContain('+48123456789');
    expect(JSON.stringify(targetMessage?.['reactions'])).not.toContain('phone:');
    expect(JSON.stringify(journal[1])).not.toContain('+48123456789');
  });

  it('removes a reaction from its logical target when the reaction event is redacted', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-removal-target',
        text: 'Reaction lifecycle',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);
    const reaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-to-remove',
        type: 'reaction',
        text: '❤️',
        eventTimestamp: '2026-06-22T10:02:00.000Z',
        reaction: {
          emoji: '❤️',
          targetMatrixEventId: '$reaction-removal-target',
        },
      },
    });
    const reactionResult = await repository.storeIncomingMessage(reaction);
    expect(reactionResult.ok).toBe(true);
    if (!reactionResult.ok) throw new Error(reactionResult.error.message);

    const redaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-removal-redaction',
        type: 'redaction',
        text: undefined,
        eventTimestamp: '2026-06-22T10:03:00.000Z',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: '$reaction-to-remove',
          applicationStatus: 'pending',
        },
      },
    });
    const redactionResult = await repository.storeIncomingMessage(redaction);
    expect(redactionResult.ok).toBe(true);
    if (!redactionResult.ok) throw new Error(redactionResult.error.message);

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const reactionMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(reactionResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));

    expect(targetMessage).toMatchObject({
      contextRevision: 3,
      contextChangeSequence: 3,
      reactions: [],
    });
    expect(reactionMessage).toMatchObject({
      contextState: 'redacted',
      redactedAt: redaction.message.eventTimestamp,
      redactedReactionTargetMessageId: targetResult.value.messageId,
    });
    expect(reactionMessage).not.toHaveProperty('reaction');
    expect(reactionMessage).not.toHaveProperty('text');
    expect(journal).toHaveLength(3);
    expect(journal[2]).toMatchObject({
      sequence: 3,
      messageId: targetResult.value.messageId,
      messageRevision: 3,
      changeType: 'reaction_changed',
      before: {
        state: 'included',
        reactions: [{ id: reactionResult.value.messageId, emoji: '❤️' }],
      },
      after: { state: 'included', reactions: [] },
    });
  });

  it('never exposes a reaction when its redaction arrived before the reaction event', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pre-redacted-reaction-target',
        text: 'Reaction should stay absent',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const redaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pre-reaction-redaction',
        type: 'redaction',
        text: undefined,
        eventTimestamp: '2026-06-22T10:03:00.000Z',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: '$reaction-arriving-after-redaction',
          applicationStatus: 'pending',
        },
      },
    });
    const redactionResult = await repository.storeIncomingMessage(redaction);
    expect(redactionResult.ok).toBe(true);
    if (!redactionResult.ok) throw new Error(redactionResult.error.message);

    const reaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$reaction-arriving-after-redaction',
        type: 'reaction',
        text: '🔥',
        eventTimestamp: '2026-06-22T10:02:00.000Z',
        reaction: {
          emoji: '🔥',
          targetMatrixEventId: '$pre-redacted-reaction-target',
        },
      },
    });
    const reactionResult = await repository.storeIncomingMessage(reaction);
    expect(reactionResult.ok).toBe(true);
    if (!reactionResult.ok) throw new Error(reactionResult.error.message);

    const data = fakeFirestore.getAllData();
    const unchangedTarget = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    expect(unchangedTarget?.['reactions'] ?? []).toEqual([]);
    const reactionMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(reactionResult.value.messageId);
    expect(reactionMessage).toMatchObject({
      contextState: 'redacted',
      redactedReactionTargetMessageId: targetResult.value.messageId,
    });
    expect(reactionMessage).not.toHaveProperty('reaction');
    expect(
      data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(redactionResult.value.messageId)
    ).toMatchObject({
      relation: {
        applicationStatus: 'applied',
        targetMessageId: reactionResult.value.messageId,
      },
    });
    expect(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size).toBe(1);
  });

  it('never applies an edit when its redaction arrived before the replacement event', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pre-redacted-edit-target',
        text: 'Original survives',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const redaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pre-edit-redaction',
        type: 'redaction',
        text: undefined,
        eventTimestamp: '2026-06-22T10:06:00.000Z',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: '$edit-arriving-after-redaction',
          applicationStatus: 'pending',
        },
      },
    });
    const redactionResult = await repository.storeIncomingMessage(redaction);
    expect(redactionResult.ok).toBe(true);
    if (!redactionResult.ok) throw new Error(redactionResult.error.message);

    const replacement = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$edit-arriving-after-redaction',
        text: 'Must never appear',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$pre-redacted-edit-target',
          applicationStatus: 'pending',
        },
      },
    });
    const replacementResult = await repository.storeIncomingMessage(replacement);
    expect(replacementResult.ok).toBe(true);
    if (!replacementResult.ok) throw new Error(replacementResult.error.message);

    const data = fakeFirestore.getAllData();
    expect(
      data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(targetResult.value.messageId)
    ).toMatchObject({
      text: 'Original survives',
      contextRevision: 1,
      contextChangeSequence: 1,
    });
    const replacementMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(replacementResult.value.messageId);
    expect(replacementMessage).toMatchObject({
      contextState: 'redacted',
      relation: { kind: 'replacement', applicationStatus: 'superseded' },
    });
    expect(replacementMessage).not.toHaveProperty('text');
    expect(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size).toBe(1);
  });

  it('applies a pending replacement in event order when its target arrives later', async () => {
    const replacement = createStoreInput({
      receivedAt: '2026-06-22T10:05:02.000Z',
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pending-replacement',
        text: 'Corrected after late target',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$late-replacement-target',
          applicationStatus: 'pending',
        },
      },
    });
    const pendingResult = await repository.storeIncomingMessage(replacement);
    expect(pendingResult.ok).toBe(true);
    if (!pendingResult.ok) throw new Error(pendingResult.error.message);

    let data = fakeFirestore.getAllData();
    expect(data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(pendingResult.value.chatId)).not.toHaveProperty(
      'contextChangeSequence'
    );
    expect(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size ?? 0).toBe(0);

    const target = createStoreInput({
      receivedAt: '2026-06-22T10:00:02.000Z',
      message: {
        ...createStoreInput().message,
        matrixEventId: '$late-replacement-target',
        text: 'Original late target',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const relationMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(pendingResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));

    expect(targetMessage).toMatchObject({
      text: 'Corrected after late target',
      contextRevision: 2,
      contextChangeSequence: 2,
      editedAt: replacement.message.eventTimestamp,
    });
    expect(relationMessage).toMatchObject({
      relation: {
        applicationStatus: 'applied',
        targetMessageId: targetResult.value.messageId,
      },
    });
    expect(journal).toHaveLength(2);
    expect(journal.map((entry) => entry['changeType'])).toEqual(['created', 'edited']);
    expect(journal.map((entry) => entry['messageId'])).toEqual([
      targetResult.value.messageId,
      targetResult.value.messageId,
    ]);
    expect(journal.map((entry) => entry['sequence'])).toEqual([1, 2]);
  });

  it('applies a pending reaction to the logical target when the target arrives later', async () => {
    const reaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pending-reaction',
        type: 'reaction',
        text: '🔥',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        reaction: {
          emoji: '🔥',
          targetMatrixEventId: '$late-reaction-target',
        },
      },
    });
    const pendingResult = await repository.storeIncomingMessage(reaction);
    expect(pendingResult.ok).toBe(true);
    if (!pendingResult.ok) throw new Error(pendingResult.error.message);
    expect(
      fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size ?? 0
    ).toBe(0);

    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$late-reaction-target',
        text: 'Late reaction target',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));
    expect(targetMessage).toMatchObject({
      contextRevision: 2,
      contextChangeSequence: 2,
      reactions: [{ id: pendingResult.value.messageId, emoji: '🔥' }],
    });
    expect(journal.map((entry) => entry['changeType'])).toEqual(['created', 'reaction_changed']);
    expect(journal.map((entry) => entry['sequence'])).toEqual([1, 2]);
  });

  it('applies a terminal pending redaction when its target arrives later', async () => {
    const redaction = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$pending-redaction',
        type: 'redaction',
        text: undefined,
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        relation: {
          kind: 'redaction',
          targetMatrixEventId: '$late-redaction-target',
          applicationStatus: 'pending',
        },
      },
    });
    const pendingResult = await repository.storeIncomingMessage(redaction);
    expect(pendingResult.ok).toBe(true);
    if (!pendingResult.ok) throw new Error(pendingResult.error.message);

    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$late-redaction-target',
        text: 'Content that arrived late',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const relationMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(pendingResult.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));
    expect(targetMessage).toMatchObject({
      contextState: 'redacted',
      contextRevision: 2,
      contextChangeSequence: 2,
    });
    expect(targetMessage).not.toHaveProperty('text');
    expect(relationMessage).toMatchObject({
      relation: {
        applicationStatus: 'applied',
        targetMessageId: targetResult.value.messageId,
      },
    });
    expect(journal.map((entry) => entry['changeType'])).toEqual(['created', 'redacted']);
    expect(journal.map((entry) => entry['sequence'])).toEqual([1, 2]);
  });

  it.each(['replacement', 'reaction'] as const)(
    'resolves 501 redactions targeting a late %s in bounded resumable transactions',
    async (operationKind) => {
      const targetMatrixEventId = `$bounded-operational-${operationKind}`;
      const redactionIds = seedPendingOperationalRedactions(fakeFirestore, {
        targetMatrixEventId,
        count: 501,
      });
      const transactions = instrumentTransactions(fakeFirestore);
      const baseMessage = createStoreInput().message;
      const operation =
        operationKind === 'replacement'
          ? createStoreInput({
              message: {
                ...baseMessage,
                matrixEventId: targetMatrixEventId,
                text: 'Late replacement',
                relation: {
                  kind: 'replacement',
                  targetMatrixEventId: '$logical-target',
                  applicationStatus: 'pending',
                },
              },
            })
          : createStoreInput({
              message: {
                ...baseMessage,
                matrixEventId: targetMatrixEventId,
                type: 'reaction',
                text: '🔥',
                reaction: {
                  emoji: '🔥',
                  targetMatrixEventId: '$logical-target',
                },
              },
            });

      const result = await repository.storeIncomingMessage(operation);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(transactions.maxWritesObserved).toBeLessThanOrEqual(202);
      expect(transactions.transactionCalls).toBeGreaterThan(5);
      const messages = fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
      expect(messages?.get(result.value.messageId)).toMatchObject({
        contextState: 'redacted',
        pendingOperationResolution: { status: 'completed' },
      });
      const statuses = redactionIds.map(
        (id) =>
          (messages?.get(id)?.['relation'] as Record<string, unknown> | undefined)?.[
            'applicationStatus'
          ]
      );
      expect(statuses.filter((status) => status === 'applied')).toHaveLength(1);
      expect(statuses.every((status) => status === 'applied' || status === 'superseded')).toBe(
        true
      );
    }
  );

  it('resumes operational redaction batches from the durable cursor after a crash', async () => {
    const targetMatrixEventId = '$crash-resume-operational-replacement';
    const redactionIds = seedPendingOperationalRedactions(fakeFirestore, {
      targetMatrixEventId,
      count: 250,
    });
    const transactions = instrumentTransactions(fakeFirestore, { failBeforeTransaction: 3 });
    const baseMessage = createStoreInput().message;
    const operation = createStoreInput({
      message: {
        ...baseMessage,
        matrixEventId: targetMatrixEventId,
        text: 'Late replacement',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$logical-target',
          applicationStatus: 'pending',
        },
      },
    });

    const interrupted = await repository.storeIncomingMessage(operation);

    expect(interrupted).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
    let messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(
      redactionIds.filter(
        (id) =>
          (messages?.get(id)?.['relation'] as Record<string, unknown> | undefined)?.[
            'applicationStatus'
          ] !== 'pending'
      )
    ).toHaveLength(200);
    expect(messages?.get(deterministicId(operation.sourceAccountId, targetMatrixEventId))).toMatchObject(
      { pendingOperationResolution: { status: 'pending' } }
    );

    transactions.disableInjectedFailure();
    const retried = await repository.storeIncomingMessage(operation);

    expect(retried).toMatchObject({ ok: true, value: { outcome: 'duplicate' } });
    messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(
      redactionIds.every(
        (id) =>
          (messages?.get(id)?.['relation'] as Record<string, unknown> | undefined)?.[
            'applicationStatus'
          ] !== 'pending'
      )
    ).toBe(true);
    expect(messages?.get(deterministicId(operation.sourceAccountId, targetMatrixEventId))).toMatchObject(
      { pendingOperationResolution: { status: 'completed' } }
    );
  });

  it('rechecks the erasure fence before continuing operational redaction batches', async () => {
    const targetMatrixEventId = '$fenced-operational-replacement';
    seedPendingOperationalRedactions(fakeFirestore, { targetMatrixEventId, count: 101 });
    instrumentTransactions(fakeFirestore, {
      beforeTransaction: (transactionNumber) => {
        if (transactionNumber !== 2) return;
        fakeFirestore.seedCollection('whatsapp_private_erasure_requests', [
          {
            id: 'erasure-before-operational-redaction-batch',
            data: {
              id: 'erasure-before-operational-redaction-batch',
              userId: 'user-123',
              sourceAccountId: 'pbuchman-private-whatsapp',
              status: 'running',
            },
          },
        ]);
      },
    });
    const baseMessage = createStoreInput().message;
    const result = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...baseMessage,
          matrixEventId: targetMatrixEventId,
          text: 'Late replacement',
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$logical-target',
            applicationStatus: 'pending',
          },
        },
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });
  });

  it('completes an operational resolver when remaining pending rows disappear before resume', async () => {
    const targetMatrixEventId = '$empty-operational-resume';
    const redactionIds = seedPendingOperationalRedactions(fakeFirestore, {
      targetMatrixEventId,
      count: 101,
    });
    instrumentTransactions(fakeFirestore, {
      beforeTransaction: (transactionNumber) => {
        if (transactionNumber !== 2) return;
        const messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
        const remaining = messages?.get(redactionIds[100] ?? '');
        const relation = remaining?.['relation'] as Record<string, unknown> | undefined;
        if (relation !== undefined) relation['applicationStatus'] = 'superseded';
      },
    });
    const baseMessage = createStoreInput().message;
    const operation = createStoreInput({
      message: {
        ...baseMessage,
        matrixEventId: targetMatrixEventId,
        text: 'Late replacement',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$logical-target',
          applicationStatus: 'pending',
        },
      },
    });

    const result = await repository.storeIncomingMessage(operation);

    expect(result.ok).toBe(true);
    expect(
      fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        ?.get(deterministicId(operation.sourceAccountId, targetMatrixEventId))
    ).toMatchObject({ pendingOperationResolution: { status: 'completed' } });
  });

  it('returns a retryable error when an operational target disappears between batches', async () => {
    const targetMatrixEventId = '$missing-operational-resume';
    seedPendingOperationalRedactions(fakeFirestore, { targetMatrixEventId, count: 101 });
    const targetMessageId = deterministicId('pbuchman-private-whatsapp', targetMatrixEventId);
    instrumentTransactions(fakeFirestore, {
      beforeTransaction: (transactionNumber) => {
        if (transactionNumber !== 2) return;
        fakeFirestore
          .getAllData()
          .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
          ?.delete(targetMessageId);
      },
    });
    const baseMessage = createStoreInput().message;

    const result = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...baseMessage,
          matrixEventId: targetMatrixEventId,
          text: 'Late replacement',
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$logical-target',
            applicationStatus: 'pending',
          },
        },
      })
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
  });

  it('resolves more than 500 pending-operation writes in bounded globally ordered transactions', async () => {
    const targetMatrixEventId = '$bounded-late-target';
    const pending = seedPendingTargetOperations(fakeFirestore, {
      targetMatrixEventId,
      replacementCount: 248,
      includeReaction: true,
      includeRedaction: true,
    });
    const transactions = instrumentTransactions(fakeFirestore);
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: targetMatrixEventId,
        text: 'Original bounded target',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });

    const result = await repository.storeIncomingMessage(target);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(transactions.maxWritesObserved).toBeLessThanOrEqual(202);
    expect(transactions.transactionCalls).toBeGreaterThan(3);

    const data = fakeFirestore.getAllData();
    const messages = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    const targetMessage = messages?.get(result.value.messageId);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));
    expect(targetMessage).toMatchObject({
      contextState: 'redacted',
      contextRevision: 251,
      contextChangeSequence: 251,
      pendingOperationResolution: { status: 'completed' },
    });
    expect(targetMessage).not.toHaveProperty('text');
    expect(journal).toHaveLength(251);
    expect(journal.map((entry) => entry['sequence'])).toEqual(
      Array.from({ length: 251 }, (_, index) => index + 1)
    );
    expect(journal.filter((entry) => entry['changeType'] === 'edited')).toHaveLength(248);
    expect(journal.filter((entry) => entry['changeType'] === 'reaction_changed')).toHaveLength(1);
    expect(journal.filter((entry) => entry['changeType'] === 'redacted')).toHaveLength(1);

    for (const relationId of pending.relationIds) {
      expect(
        (messages?.get(relationId)?.['relation'] as Record<string, unknown> | undefined)?.[
          'applicationStatus'
        ]
      ).toMatch(/^(applied|superseded)$/);
    }
    for (const reactionId of pending.reactionIds) {
      expect(
        (messages?.get(reactionId)?.['reaction'] as Record<string, unknown> | undefined)?.[
          'applicationStatus'
        ]
      ).toMatch(/^(applied|superseded)$/);
    }

    const publicTarget = await repository.getMessageById(result.value.messageId);
    expect(publicTarget.ok).toBe(true);
    if (!publicTarget.ok) throw new Error(publicTarget.error.message);
    expect(publicTarget.value).not.toHaveProperty('pendingOperationResolution');
  });

  it('returns a retryable persistence error after a committed batch and resumes from the durable cursor on duplicate replay', async () => {
    const targetMatrixEventId = '$crash-resume-late-target';
    const pending = seedPendingTargetOperations(fakeFirestore, {
      targetMatrixEventId,
      replacementCount: 130,
    });
    const transactions = instrumentTransactions(fakeFirestore, {
      failBeforeTransaction: 3,
    });
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: targetMatrixEventId,
        text: 'Original crash-resume target',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });

    const interrupted = await repository.storeIncomingMessage(target);

    expect(interrupted).toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR' },
    });
    let data = fakeFirestore.getAllData();
    let messages = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    const targetMessageId = deterministicId(target.sourceAccountId, targetMatrixEventId);
    expect(messages?.get(targetMessageId)).toMatchObject({
      text: 'Correction 99',
      contextRevision: 101,
      contextChangeSequence: 101,
      pendingOperationResolution: {
        status: 'pending',
        cursorEventTimestamp: '2026-06-22T10:01:40.000Z',
        cursorMessageId: pending.relationIds[99],
      },
    });
    expect(
      pending.relationIds.filter(
        (id) =>
          (messages?.get(id)?.['relation'] as Record<string, unknown> | undefined)?.[
            'applicationStatus'
          ] !== 'pending'
      )
    ).toHaveLength(100);

    transactions.disableInjectedFailure();
    const retried = await repository.storeIncomingMessage(target);

    expect(retried).toMatchObject({ ok: true, value: { outcome: 'duplicate' } });
    data = fakeFirestore.getAllData();
    messages = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(messages?.get(targetMessageId)).toMatchObject({
      text: 'Correction 129',
      contextRevision: 131,
      contextChangeSequence: 131,
      pendingOperationResolution: { status: 'completed' },
    });
    expect(
      pending.relationIds.every(
        (id) =>
          (messages?.get(id)?.['relation'] as Record<string, unknown> | undefined)?.[
            'applicationStatus'
          ] === 'applied'
      )
    ).toBe(true);
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));
    expect(journal.map((entry) => entry['sequence'])).toEqual(
      Array.from({ length: 131 }, (_, index) => index + 1)
    );
  });

  it('rechecks the generation and erasure fence before every pending-operation batch', async () => {
    const targetMatrixEventId = '$fenced-batch-late-target';
    const pending = seedPendingTargetOperations(fakeFirestore, {
      targetMatrixEventId,
      replacementCount: 130,
    });
    let fenceSeeded = false;
    instrumentTransactions(fakeFirestore, {
      beforeTransaction: (transactionNumber) => {
        if (transactionNumber !== 3 || fenceSeeded) return;
        fenceSeeded = true;
        fakeFirestore.seedCollection('whatsapp_private_erasure_requests', [
          {
            id: 'erasure-between-resolver-batches',
            data: {
              id: 'erasure-between-resolver-batches',
              userId: 'user-123',
              sourceAccountId: 'pbuchman-private-whatsapp',
              status: 'running',
            },
          },
        ]);
      },
    });
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: targetMatrixEventId,
        text: 'Original fenced target',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });

    const result = await repository.storeIncomingMessage(target);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });
    const data = fakeFirestore.getAllData();
    const messages = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(messages?.get(deterministicId(target.sourceAccountId, targetMatrixEventId))).toMatchObject(
      {
        text: 'Correction 99',
        contextRevision: 101,
        contextChangeSequence: 101,
        pendingOperationResolution: { status: 'pending' },
      }
    );
    expect(
      pending.relationIds.filter(
        (id) =>
          (messages?.get(id)?.['relation'] as Record<string, unknown> | undefined)?.[
            'applicationStatus'
          ] !== 'pending'
      )
    ).toHaveLength(100);
  });

  it('serializes concurrent target replays without duplicate journal sequences', async () => {
    const targetMatrixEventId = '$concurrent-resolver-target';
    seedPendingTargetOperations(fakeFirestore, {
      targetMatrixEventId,
      replacementCount: 130,
      includeReaction: true,
    });
    const transactions = instrumentTransactions(fakeFirestore);
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: targetMatrixEventId,
        text: 'Original concurrent target',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });

    const [first, second] = await Promise.all([
      repository.storeIncomingMessage(target),
      repository.storeIncomingMessage(target),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Expected concurrent replays to succeed');
    expect([first.value.outcome, second.value.outcome].sort()).toEqual(['created', 'duplicate']);
    expect(transactions.maxWritesObserved).toBeLessThanOrEqual(202);
    const data = fakeFirestore.getAllData();
    const journal = [
      ...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? []),
    ].sort((left, right) => Number(left['sequence']) - Number(right['sequence']));
    expect(journal).toHaveLength(132);
    expect(journal.map((entry) => entry['sequence'])).toEqual(
      Array.from({ length: 132 }, (_, index) => index + 1)
    );
    expect(new Set(journal.map((entry) => entry['sequence'])).size).toBe(132);
  });

  it('uses document id as the deterministic tie-breaker for same-time pending operations', async () => {
    const targetMatrixEventId = '$same-time-resolver-target';
    const pending = seedPendingTargetOperations(fakeFirestore, {
      targetMatrixEventId,
      replacementCount: 2,
    });
    const messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    const sameTimestamp = '2026-06-22T10:00:05.000Z';
    for (const relationId of pending.relationIds) {
      const relation = messages?.get(relationId);
      if (relation !== undefined) relation['eventTimestamp'] = sameTimestamp;
    }
    const expectedLastId = [...pending.relationIds].sort((left, right) => left.localeCompare(right))[1];
    if (expectedLastId === undefined) throw new Error('Expected a deterministic last relation');
    const expectedText = messages?.get(expectedLastId)?.['text'];
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: targetMatrixEventId,
        text: 'Original tie-break target',
      },
    });

    const result = await repository.storeIncomingMessage(target);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(messages?.get(result.value.messageId)).toMatchObject({
      text: expectedText,
      latestReplacementMessageId: expectedLastId,
      latestReplacementEventTimestamp: sameTimestamp,
      contextRevision: 3,
      contextChangeSequence: 3,
    });
  });

  it('completes a legacy target resolver with no pending operations on duplicate replay', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$legacy-resolver-target',
      },
    });
    const created = await repository.storeIncomingMessage(target);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);
    const storedTarget = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(created.value.messageId);
    if (storedTarget === undefined) throw new Error('Expected stored target');
    Reflect.deleteProperty(storedTarget, 'pendingOperationResolution');

    const duplicate = await repository.storeIncomingMessage(target);

    expect(duplicate).toMatchObject({ ok: true, value: { outcome: 'duplicate' } });
    expect(
      fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        ?.get(created.value.messageId)
    ).toMatchObject({
      pendingOperationResolution: { status: 'completed' },
    });
  });

  it('supersedes an older replacement delivered after a newer applied replacement', async () => {
    const target = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$replacement-order-target',
        text: 'Original ordered content',
      },
    });
    const targetResult = await repository.storeIncomingMessage(target);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const createReplacement = (
      matrixEventId: string,
      text: string,
      eventTimestamp: string
    ): StorePrivateWhatsAppMessageInput =>
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId,
          text,
          eventTimestamp,
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$replacement-order-target',
            applicationStatus: 'pending',
          },
        },
      });
    const newerResult = await repository.storeIncomingMessage(
      createReplacement('$replacement-newer', 'Newest content', '2026-06-22T10:10:00.000Z')
    );
    const olderResult = await repository.storeIncomingMessage(
      createReplacement('$replacement-older', 'Stale content', '2026-06-22T10:05:00.000Z')
    );
    expect(newerResult.ok).toBe(true);
    expect(olderResult.ok).toBe(true);
    if (!newerResult.ok || !olderResult.ok) throw new Error('replacement ordering failed');

    const data = fakeFirestore.getAllData();
    const targetMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const olderMessage = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(olderResult.value.messageId);
    const journal = [...(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.values() ?? [])];
    expect(targetMessage).toMatchObject({
      text: 'Newest content',
      contextRevision: 2,
      contextChangeSequence: 2,
      latestReplacementMessageId: newerResult.value.messageId,
    });
    expect(olderMessage).toMatchObject({
      relation: { applicationStatus: 'superseded' },
    });
    expect(journal).toHaveLength(2);
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

  it('returns duplicate for stored private WhatsApp reactions without losing target metadata', async () => {
    const reactionInput = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$duplicate-reaction-event',
        type: 'reaction',
        text: '👍',
        reaction: {
          emoji: '👍',
          targetMatrixEventId: '$duplicate-target-event',
        },
      },
    });

    const firstResult = await repository.storeIncomingMessage(reactionInput);
    const duplicateResult = await repository.storeIncomingMessage(reactionInput);

    expect(firstResult.ok).toBe(true);
    expect(duplicateResult.ok).toBe(true);
    if (!duplicateResult.ok) throw new Error(duplicateResult.error.message);
    expect(duplicateResult.value.outcome).toBe('duplicate');

    const messageId = deterministicId(
      reactionInput.sourceAccountId,
      reactionInput.message.matrixEventId
    );
    const message = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(messageId);
    expect(message).toMatchObject({
      messageType: 'reaction',
      reaction: {
        emoji: '👍',
        targetMatrixEventId: '$duplicate-target-event',
        targetMessageId: deterministicId(
          reactionInput.sourceAccountId,
          '$duplicate-target-event'
        ),
      },
    });
  });

  it('returns the room chat id for a duplicate legacy message without a stored chat id', async () => {
    const input = createStoreInput();
    const messageId = deterministicId(input.sourceAccountId, input.message.matrixEventId);
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).set({
      id: messageId,
      sourceAccountId: input.sourceAccountId,
      matrixRoomId: input.message.matrixRoomId,
      matrixEventId: input.message.matrixEventId,
      text: 'legacy duplicate',
    });

    const result = await repository.storeIncomingMessage(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      outcome: 'duplicate',
      chatId: deterministicId(input.sourceAccountId, input.chat.matrixRoomId),
      messageId,
      matrixEventId: input.message.matrixEventId,
    });
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

  it('rebuilds sender aggregates from normalized private WhatsApp reaction rows', async () => {
    const messageId = deterministicId('pbuchman-private-whatsapp', '$old-reaction-event');
    await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).set({
      id: messageId,
      chatId: deterministicId('pbuchman-private-whatsapp', '!reaction-room:home-dev'),
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      matrixRoomId: '!reaction-room:home-dev',
      matrixEventId: '$old-reaction-event',
      matrixSenderId: '@whatsapp_48517277952:home-dev',
      senderDisplayName: 'Monika',
      direction: 'incoming',
      messageType: 'reaction',
      text: '👍',
      reaction: {
        emoji: '👍',
        targetMatrixEventId: '$old-target-event',
        targetMessageId: deterministicId('pbuchman-private-whatsapp', '$old-target-event'),
      },
      eventTimestamp: '2026-06-22T22:30:00.000Z',
      receivedAt: '2026-06-22T22:30:02.000Z',
      ingestedAt: '2026-06-22T22:30:02.000Z',
      deliveryMode: 'live',
      rawMatrixEvent: {
        content: {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: '$old-target-event',
            key: '👍',
          },
        },
      },
    });

    const rebuild = await repository.rebuildAggregates({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 100,
    });

    expect(rebuild.ok).toBe(true);
    if (!rebuild.ok) throw new Error(rebuild.error.message);
    expect(rebuild.value).toMatchObject({
      scannedMessages: 1,
      upgradedMessages: 1,
      senderCount: 1,
      senderDayCount: 1,
    });

    const senderDayId = deterministicId(
      'pbuchman-private-whatsapp',
      `phone:+48517277952\0${'2026-06-23'}`
    );
    const senderDay = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      ?.get(senderDayId);
    expect(senderDay).toMatchObject({
      messageTypeCounts: { reaction: 1 },
    });
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

  it('reuses an existing direct chat when the same phone sender appears in a new Matrix room', async () => {
    const firstInput = createStoreInput({
      chat: {
        matrixRoomId: '!old-room:matrix.example',
        type: 'direct',
        displayName: 'Marcinek',
      },
      message: {
        ...createStoreInput().message,
        matrixRoomId: '!old-room:matrix.example',
        matrixEventId: '$old-room-event',
        matrixSenderId: '@whatsapp_48123456789:matrix.example',
        senderDisplayName: 'Marcinek',
        senderPhoneNumber: '+48123456789',
        senderPhoneNumberNormalized: '48123456789',
        senderKey: 'phone:+48123456789',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
      },
    });
    const firstResult = await repository.storeIncomingMessage(firstInput);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error(firstResult.error.message);

    const secondInput = createStoreInput({
      chat: {
        matrixRoomId: '!new-room:matrix.example',
        type: 'direct',
        displayName: 'Pawel M (WA)',
      },
      message: {
        ...createStoreInput().message,
        matrixRoomId: '!new-room:matrix.example',
        matrixEventId: '$new-room-event',
        matrixSenderId: '@whatsapp_48123456789:matrix.example',
        senderDisplayName: 'Pawel M (WA)',
        senderPhoneNumber: '+48123456789',
        senderPhoneNumberNormalized: '48123456789',
        senderKey: 'phone:+48123456789',
        eventTimestamp: '2026-06-23T10:05:00.000Z',
        eventDayKey: '2026-06-23',
      },
    });
    const secondResult = await repository.storeIncomingMessage(secondInput);

    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) throw new Error(secondResult.error.message);
    expect(secondResult.value.chatId).toBe(firstResult.value.chatId);

    const chats = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION);
    expect(chats?.size).toBe(1);
    const chat = chats?.get(firstResult.value.chatId);
    expect(chat).toMatchObject({
      id: firstResult.value.chatId,
      matrixRoomId: '!old-room:matrix.example',
      matrixRoomIds: ['!old-room:matrix.example', '!new-room:matrix.example'],
      displayName: 'Marcinek',
      messageCount: 2,
      participantKeys: ['phone:+48123456789'],
    });

    const data = fakeFirestore.getAllData();
    const senderId = deterministicId('pbuchman-private-whatsapp', 'phone:+48123456789');
    const senderDayId = deterministicId(
      'pbuchman-private-whatsapp',
      `phone:+48123456789\0${'2026-06-23'}`
    );
    const sender = data.get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)?.get(senderId);
    const senderDay = data.get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)?.get(senderDayId);
    expect(sender?.['senderDisplayName']).toBe('Marcinek');
    expect(senderDay?.['senderDisplayName']).toBe('Marcinek');
    const newRoomMessageId = deterministicId('pbuchman-private-whatsapp', '$new-room-event');
    const newRoomMessage = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(newRoomMessageId);
    expect(newRoomMessage?.['senderDisplayName']).toBe('Marcinek');
    expect(newRoomMessage?.['chatDisplayName']).toBe('Marcinek');
  });

  it('keeps a canonical direct sender label when a later alias uses a phone label', async () => {
    const firstResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!old-karolina-room:matrix.example',
          type: 'direct',
          displayName: 'Karolina Buchman',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!old-karolina-room:matrix.example',
          matrixEventId: '$old-karolina-event',
          matrixSenderId: '@whatsapp_48000000002:matrix.example',
          senderDisplayName: 'Karolina Buchman',
          senderPhoneNumber: '+48000000002',
          senderPhoneNumberNormalized: '48000000002',
          senderKey: 'phone:+48000000002',
          eventTimestamp: '2026-06-22T10:00:00.000Z',
        },
      })
    );
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error(firstResult.error.message);

    const secondResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!new-karolina-room:matrix.example',
          type: 'direct',
          displayName: '+48000000002',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!new-karolina-room:matrix.example',
          matrixEventId: '$new-karolina-event',
          matrixSenderId: '@whatsapp_48000000002:matrix.example',
          senderDisplayName: '+48000000002',
          senderPhoneNumber: '+48000000002',
          senderPhoneNumberNormalized: '48000000002',
          senderKey: 'phone:+48000000002',
          eventTimestamp: '2026-06-23T10:05:00.000Z',
          eventDayKey: '2026-06-23',
        },
      })
    );

    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) throw new Error(secondResult.error.message);
    expect(secondResult.value.chatId).toBe(firstResult.value.chatId);

    const data = fakeFirestore.getAllData();
    const senderId = deterministicId('pbuchman-private-whatsapp', 'phone:+48000000002');
    const senderDayId = deterministicId(
      'pbuchman-private-whatsapp',
      `phone:+48000000002\0${'2026-06-23'}`
    );
    const messageId = deterministicId('pbuchman-private-whatsapp', '$new-karolina-event');
    expect(data.get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)?.get(senderId)?.['senderDisplayName']).toBe(
      'Karolina Buchman'
    );
    expect(
      data.get(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)?.get(senderDayId)?.['senderDisplayName']
    ).toBe('Karolina Buchman');
    expect(
      data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(messageId)?.['senderDisplayName']
    ).toBe('Karolina Buchman');
  });

  it('keeps a stable group sender label when a later member label is bridge-generated', async () => {
    const firstResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!group-room:matrix.example',
          type: 'group',
          displayName: 'Fishing Crew',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!group-room:matrix.example',
          matrixEventId: '$old-group-member-event',
          matrixSenderId: '@whatsapp_48000000003:matrix.example',
          senderDisplayName: 'Piotrek',
          senderPhoneNumber: '+48000000003',
          senderPhoneNumberNormalized: '48000000003',
          senderKey: 'phone:+48000000003',
          eventTimestamp: '2026-06-22T10:00:00.000Z',
        },
      })
    );
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error(firstResult.error.message);

    const secondResult = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!group-room:matrix.example',
          type: 'group',
          displayName: 'Fishing Crew',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!group-room:matrix.example',
          matrixEventId: '$new-group-member-event',
          matrixSenderId: '@whatsapp_48000000003:matrix.example',
          senderDisplayName: 'Piotrek (WA)',
          senderPhoneNumber: '+48000000003',
          senderPhoneNumberNormalized: '48000000003',
          senderKey: 'phone:+48000000003',
          eventTimestamp: '2026-06-23T10:05:00.000Z',
          eventDayKey: '2026-06-23',
        },
      })
    );

    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) throw new Error(secondResult.error.message);

    const data = fakeFirestore.getAllData();
    const senderId = deterministicId('pbuchman-private-whatsapp', 'phone:+48000000003');
    const messageId = deterministicId('pbuchman-private-whatsapp', '$new-group-member-event');
    expect(data.get(PRIVATE_WHATSAPP_SENDERS_COLLECTION)?.get(senderId)?.['senderDisplayName']).toBe(
      'Piotrek'
    );
    expect(
      data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(messageId)?.['senderDisplayName']
    ).toBe('Piotrek');
  });

  it('reuses a direct chat alias for outgoing messages from a linked Matrix room', async () => {
    const oldRoomIncoming = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!old-room:matrix.example',
          type: 'direct',
          displayName: 'Marcinek',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!old-room:matrix.example',
          matrixEventId: '$old-room-incoming',
          matrixSenderId: '@whatsapp_48123456789:matrix.example',
          senderDisplayName: 'Marcinek',
          senderKey: 'phone:+48123456789',
          eventTimestamp: '2026-06-22T10:00:00.000Z',
        },
      })
    );
    expect(oldRoomIncoming.ok).toBe(true);
    if (!oldRoomIncoming.ok) throw new Error(oldRoomIncoming.error.message);

    const newRoomIncoming = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!new-room:matrix.example',
          type: 'direct',
          displayName: 'Pawel M (WA)',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!new-room:matrix.example',
          matrixEventId: '$new-room-incoming',
          matrixSenderId: '@whatsapp_48123456789:matrix.example',
          senderDisplayName: 'Pawel M (WA)',
          senderKey: 'phone:+48123456789',
          eventTimestamp: '2026-06-22T10:05:00.000Z',
        },
      })
    );
    expect(newRoomIncoming.ok).toBe(true);
    if (!newRoomIncoming.ok) throw new Error(newRoomIncoming.error.message);

    const {
      senderPhoneNumber: _senderPhoneNumber,
      senderPhoneNumberNormalized: _senderPhoneNumberNormalized,
      ...outgoingMessageBase
    } = createStoreInput().message;
    const newRoomOutgoing = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!new-room:matrix.example',
          type: 'direct',
          displayName: 'Pawel M (WA)',
        },
        message: {
          ...outgoingMessageBase,
          matrixRoomId: '!new-room:matrix.example',
          matrixEventId: '$new-room-outgoing',
          matrixSenderId: '@pbuchman:matrix.example',
          senderDisplayName: 'You',
          senderKey: 'matrix:@pbuchman:matrix.example',
          direction: 'outgoing',
          text: 'reply from the new room',
          eventTimestamp: '2026-06-22T10:06:00.000Z',
        },
      })
    );

    expect(newRoomOutgoing.ok).toBe(true);
    if (!newRoomOutgoing.ok) throw new Error(newRoomOutgoing.error.message);
    expect(newRoomOutgoing.value.chatId).toBe(oldRoomIncoming.value.chatId);

    const chats = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION);
    expect(chats?.size).toBe(1);
    expect(chats?.get(oldRoomIncoming.value.chatId)?.['messageCount']).toBe(3);
  });

  it('uses a room chat id for an outgoing direct message when no linked alias exists', async () => {
    const {
      senderPhoneNumber: _senderPhoneNumber,
      senderPhoneNumberNormalized: _senderPhoneNumberNormalized,
      ...outgoingMessageBase
    } = createStoreInput().message;
    const result = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!outgoing-only-room:matrix.example',
          type: 'direct',
          displayName: 'Pawel M (WA)',
        },
        message: {
          ...outgoingMessageBase,
          matrixRoomId: '!outgoing-only-room:matrix.example',
          matrixEventId: '$outgoing-only-event',
          matrixSenderId: '@pbuchman:matrix.example',
          senderDisplayName: 'You',
          senderKey: 'matrix:@pbuchman:matrix.example',
          direction: 'outgoing',
          text: 'reply before any incoming alias',
          eventTimestamp: '2026-06-22T10:06:00.000Z',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.chatId).toBe(
      deterministicId('pbuchman-private-whatsapp', '!outgoing-only-room:matrix.example')
    );
    const chats = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION);
    expect(chats?.size).toBe(1);
  });

  it('chooses the strongest existing direct chat candidate for a repeated sender', async () => {
    const sourceAccountId = 'pbuchman-private-whatsapp';
    const senderKey = 'phone:+48123456789';
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('candidate-low').set({
      id: 'candidate-low',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!low-room:matrix.example',
      chatType: 'direct',
      displayName: 'Low Candidate',
      participantKeys: [senderKey],
      participantCount: 1,
      firstSeenAt: '2026-05-01T10:00:00.000Z',
      lastEventAt: '2026-05-01T10:00:00.000Z',
      schemaVersion: 2,
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('candidate-later').set({
      id: 'candidate-later',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!later-room:matrix.example',
      chatType: 'direct',
      displayName: 'Later Candidate',
      participantKeys: [senderKey],
      participantCount: 1,
      messageCount: 4,
      firstSeenAt: '2026-06-01T10:00:00.000Z',
      lastEventAt: '2026-06-01T10:00:00.000Z',
      schemaVersion: 2,
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('candidate-earlier').set({
      id: 'candidate-earlier',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!earlier-room:matrix.example',
      chatType: 'direct',
      displayName: 'Earlier Candidate',
      participantKeys: [senderKey],
      participantCount: 1,
      messageCount: 4,
      firstSeenAt: '2026-04-01T10:00:00.000Z',
      lastEventAt: '2026-04-01T10:00:00.000Z',
      schemaVersion: 2,
    });

    const result = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!fresh-room:matrix.example',
          type: 'direct',
          displayName: 'Fresh Sender (WA)',
        },
        message: {
          ...createStoreInput().message,
          matrixRoomId: '!fresh-room:matrix.example',
          matrixEventId: '$fresh-repeated-sender-event',
          matrixSenderId: '@whatsapp_48123456789:matrix.example',
          senderDisplayName: 'Fresh Sender (WA)',
          senderKey,
          eventTimestamp: '2026-06-22T10:10:00.000Z',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.chatId).toBe('candidate-earlier');
    const chats = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION);
    expect(chats?.size).toBe(3);
    expect(chats?.get('candidate-earlier')).toMatchObject({
      displayName: 'Earlier Candidate',
      matrixRoomIds: ['!earlier-room:matrix.example', '!fresh-room:matrix.example'],
      messageCount: 5,
    });
  });

  it('orders linked direct chat aliases when candidate metadata is sparse', async () => {
    const sourceAccountId = 'pbuchman-private-whatsapp';
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('alias-a').set({
      id: 'alias-a',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!primary-a:matrix.example',
      matrixRoomIds: ['!alias-room:matrix.example'],
      chatType: 'direct',
      displayName: 'Alias A',
      participantKeys: ['phone:+48123456789'],
      participantCount: 1,
      messageCount: 4,
      lastEventAt: '2026-06-01T10:00:00.000Z',
      schemaVersion: 2,
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('alias-b').set({
      id: 'alias-b',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!primary-b:matrix.example',
      matrixRoomIds: ['!alias-room:matrix.example'],
      chatType: 'direct',
      displayName: 'Alias B',
      participantKeys: ['phone:+48123456789'],
      participantCount: 1,
      messageCount: 4,
      firstSeenAt: '2026-04-01T10:00:00.000Z',
      lastEventAt: '2026-06-01T10:00:00.000Z',
      schemaVersion: 2,
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('alias-c').set({
      id: 'alias-c',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!primary-c:matrix.example',
      matrixRoomIds: ['!alias-room:matrix.example'],
      chatType: 'direct',
      displayName: 'Alias C',
      participantKeys: ['phone:+48123456789'],
      participantCount: 1,
      firstSeenAt: '2026-03-01T10:00:00.000Z',
      lastEventAt: '2026-06-01T10:00:00.000Z',
      schemaVersion: 2,
    });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc('alias-d').set({
      id: 'alias-d',
      userId: 'user-123',
      sourceAccountId,
      matrixRoomId: '!primary-d:matrix.example',
      matrixRoomIds: ['!alias-room:matrix.example'],
      chatType: 'direct',
      displayName: 'Alias D',
      participantKeys: ['phone:+48123456789'],
      participantCount: 1,
      messageCount: 4,
      lastEventAt: '2026-06-01T10:00:00.000Z',
      schemaVersion: 2,
    });

    const {
      senderPhoneNumber: _senderPhoneNumber,
      senderPhoneNumberNormalized: _senderPhoneNumberNormalized,
      ...outgoingMessageBase
    } = createStoreInput().message;
    const result = await repository.storeIncomingMessage(
      createStoreInput({
        chat: {
          matrixRoomId: '!alias-room:matrix.example',
          type: 'direct',
          displayName: 'Alias Room',
        },
        message: {
          ...outgoingMessageBase,
          matrixRoomId: '!alias-room:matrix.example',
          matrixEventId: '$alias-room-outgoing',
          matrixSenderId: '@pbuchman:matrix.example',
          senderDisplayName: 'You',
          senderKey: 'matrix:@pbuchman:matrix.example',
          direction: 'outgoing',
          text: 'reply in linked alias room',
          eventTimestamp: '2026-06-22T10:12:00.000Z',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.chatId).toBe('alias-a');
    const chats = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION);
    expect(chats?.size).toBe(4);
    expect(chats?.get('alias-a')?.['messageCount']).toBe(5);
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

  it('loads a private WhatsApp chat by source account and chat id', async () => {
    const storeResult = await repository.storeIncomingMessage(createStoreInput());
    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) throw new Error(storeResult.error.message);

    const chatResult = await repository.getChatById({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: storeResult.value.chatId,
    });

    expect(chatResult.ok).toBe(true);
    if (!chatResult.ok) throw new Error(chatResult.error.message);
    expect(chatResult.value).toMatchObject({
      id: storeResult.value.chatId,
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatType: 'direct',
      displayName: 'Alice',
    });

    const wrongSourceResult = await repository.getChatById({
      sourceAccountId: 'wrong-source',
      chatId: storeResult.value.chatId,
    });
    expect(wrongSourceResult.ok).toBe(true);
    if (!wrongSourceResult.ok) throw new Error(wrongSourceResult.error.message);
    expect(wrongSourceResult.value).toBeNull();
  });

  it('returns null when loading a missing private WhatsApp chat by id', async () => {
    const result = await repository.getChatById({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: 'missing-chat',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBeNull();
  });

  it('queries private conversation context messages oldest-first with cursor pagination', async () => {
    const firstResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-1-context',
          text: 'first',
          eventTimestamp: '2026-06-22T10:00:00.000Z',
        },
      })
    );
    const secondResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-2-context',
          text: 'second',
          eventTimestamp: '2026-06-22T10:01:00.000Z',
        },
      })
    );
    const sameTimestampResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-3-context',
          text: 'same timestamp',
          eventTimestamp: '2026-06-22T10:02:00.000Z',
        },
      })
    );
    const beyondLimitResult = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-4-context',
          text: 'beyond bounded snapshot',
          eventTimestamp: '2026-06-22T10:03:00.000Z',
        },
      })
    );
    await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$event-outside-range',
          text: 'outside range',
          eventTimestamp: '2026-06-22T11:00:00.000Z',
        },
      })
    );
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(sameTimestampResult.ok).toBe(true);
    expect(beyondLimitResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error(firstResult.error.message);

    const result = await repository.findConversationContextMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: firstResult.value.chatId,
      from: '2026-06-22T09:00:00.000Z',
      to: '2026-06-22T11:00:00.000Z',
      limit: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.messages.map((message) => message.matrixEventId)).toEqual([
      '$event-1-context',
      '$event-2-context',
    ]);
    expect(result.value.totalCount).toBe(4);
    expect(result.value.nextCursor).toEqual(expect.any(String));

    const nextCursor = result.value.nextCursor;
    if (nextCursor === undefined) throw new Error('Expected next cursor');
    const nextPageResult = await repository.findConversationContextMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: firstResult.value.chatId,
      from: '2026-06-22T09:00:00.000Z',
      to: '2026-06-22T11:00:00.000Z',
      limit: 2,
      cursor: nextCursor,
    });

    expect(nextPageResult.ok).toBe(true);
    if (!nextPageResult.ok) throw new Error(nextPageResult.error.message);
    expect(nextPageResult.value.messages.map((message) => message.matrixEventId)).toEqual([
      '$event-3-context',
      '$event-4-context',
    ]);
    expect(nextPageResult.value.totalCount).toBe(4);
    expect(nextPageResult.value.nextCursor).toBeUndefined();

    const zeroLimitResult = await repository.findConversationContextMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: firstResult.value.chatId,
      from: '2026-06-22T09:00:00.000Z',
      to: '2026-06-22T11:00:00.000Z',
      limit: 0,
    });

    expect(zeroLimitResult.ok).toBe(true);
    if (!zeroLimitResult.ok) throw new Error(zeroLimitResult.error.message);
    expect(zeroLimitResult.value.messages).toEqual([]);
    expect(zeroLimitResult.value.totalCount).toBe(4);
    expect(zeroLimitResult.value.nextCursor).toBeUndefined();
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

  it('fences ingestion, duplicate replay, media, transcription, chat, aggregate, and reconnect mutations after erasure starts', async () => {
    const sourceAccountId = 'pbuchman-private-whatsapp';
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: 'user-123',
        data: {
          userId: 'user-123',
          sourceAccountId,
          generationId: 'generation-old',
          phoneNumberNormalized: '48123456789',
          displayName: 'Test',
          status: 'active',
          createdAt: '2026-06-22T09:00:00.000Z',
          updatedAt: '2026-06-22T09:00:00.000Z',
          schemaVersion: 1,
        },
      },
    ]);
    const sourceInput = createAudioStoreInput('$event-fenced', {
      mxcUri: 'mxc://home-dev/fenced-audio',
      mimeType: 'audio/ogg',
    });
    const stored = await repository.storeIncomingMessage(sourceInput);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    const messageId = deterministicId(sourceAccountId, '$event-fenced');
    const erasure = createPrivateWhatsAppErasureRepository();
    const started = await erasure.start({
      sourceAccountId,
      userId: 'user-123',
      erasureRequestId: 'erase-fenced',
      now: '2026-06-22T10:05:00.000Z',
    });
    expect(started).toMatchObject({ ok: true, value: { status: 'created' } });

    const results = await Promise.all([
      repository.storeIncomingMessage(sourceInput),
      repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: '$event-after-fence',
          },
        })
      ),
      repository.updateMessageStoredMedia({
        sourceAccountId,
        messageId,
        media: {
          mxcUri: 'mxc://home-dev/fenced-audio',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/fenced/audio.ogg',
        },
        now: '2026-06-22T10:06:00.000Z',
      }),
      repository.updateMessageTranscription({
        userId: 'user-123',
        messageId,
        transcription: { status: 'completed', text: 'must not revive' },
      }),
      repository.updateChatTranscriptionSetting({
        sourceAccountId,
        chatId: stored.value.chatId,
        enabled: true,
        now: '2026-06-22T10:06:00.000Z',
      }),
      repository.rebuildAggregates({ sourceAccountId, limit: 50 }),
      repository.upsertAccount({
        userId: 'user-123',
        phoneNumberNormalized: '48999999999',
        now: '2026-06-22T10:06:00.000Z',
      }),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected erasure fence rejection');
      expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 409 });
    }
    const message = (
      await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).get()
    ).data();
    expect(message?.['transcription']).toBeUndefined();
    expect((message?.['media'] as Record<string, unknown>)['gcsPath']).toBeUndefined();
    expect(
      (
        await fakeFirestore
          .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
          .doc(stored.value.chatId)
          .get()
      ).data()?.['transcriptionEnabled']
    ).toBeUndefined();
  });

  it('serializes an erasure start against concurrent ingestion and reconnects with a new source generation', async () => {
    const sourceAccountId = 'pbuchman-private-whatsapp';
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: 'user-123',
        data: {
          userId: 'user-123',
          sourceAccountId,
          generationId: 'generation-old',
          phoneNumberNormalized: '48123456789',
          displayName: 'Test',
          status: 'active',
          createdAt: '2026-06-22T09:00:00.000Z',
          updatedAt: '2026-06-22T09:00:00.000Z',
          schemaVersion: 1,
        },
      },
    ]);
    const erasure = createPrivateWhatsAppErasureRepository();
    const [started, racedIngest] = await Promise.all([
      erasure.start({
        sourceAccountId,
        userId: 'user-123',
        erasureRequestId: 'erase-race',
        now: '2026-06-22T10:00:00.000Z',
      }),
      repository.storeIncomingMessage(createStoreInput()),
    ]);
    expect(started).toMatchObject({ ok: true, value: { status: 'created' } });
    expect(racedIngest).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');

    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-123').delete();
    const prematureReconnect = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      now: '2026-06-22T10:00:30.000Z',
    });
    expect(prematureReconnect).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });

    let request = started.value.request;
    for (let count = 0; request.status !== 'completed' && count < 30; count += 1) {
      const now = `2026-06-22T10:${String(count + 1).padStart(2, '0')}:00.000Z`;
      let advanced = await erasure.advanceOneBatch({
        sourceAccountId,
        userId: 'user-123',
        erasureRequestId: 'erase-race',
        expectedAttempt: request.attempt,
        batchSize: 20,
        now,
      });
      if (advanced.ok && advanced.value.status === 'private_media') {
        advanced = await erasure.commitPrivateMediaBatch({
          sourceAccountId,
          userId: 'user-123',
          erasureRequestId: 'erase-race',
          expectedAttempt: request.attempt,
          ...(advanced.value.cursor === undefined
            ? {}
            : { expectedCursor: advanced.value.cursor }),
          batch: { status: 'empty', deletedCount: 0 },
          now,
        });
      }
      expect(advanced.ok).toBe(true);
      if (!advanced.ok || advanced.value.status === 'stale' || advanced.value.status === 'not_found') {
        throw new Error('Expected erasure progress');
      }
      request = advanced.value.request;
    }
    expect(request.status).toBe('completed');

    const staleIngestBeforeReconnect = await repository.storeIncomingMessage(createStoreInput());
    expect(staleIngestBeforeReconnect).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).get()).size
    ).toBe(0);
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).get()).size
    ).toBe(0);
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION).get())
        .size
    ).toBe(0);

    const reconnected = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      now: '2026-06-22T11:00:00.000Z',
    });
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) throw new Error(reconnected.error.message);
    expect(reconnected.value.sourceAccountId).not.toBe(sourceAccountId);
    expect(reconnected.value.generationId).not.toBe('generation-old');

    const staleIngest = await repository.storeIncomingMessage(createStoreInput());
    expect(staleIngest).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });
    const newGenerationIngest = await repository.storeIncomingMessage(
      createStoreInput({ sourceAccountId: reconnected.value.sourceAccountId })
    );
    expect(newGenerationIngest.ok).toBe(true);
  });

  it('reconciles sparse legacy media targets and avoids journaling a projection-identical edit', async () => {
    const { text: _text, ...baseMessage } = createStoreInput().message;
    const targetInput = createStoreInput({
      message: {
        ...baseMessage,
        matrixEventId: '$sparse-media-target',
        type: 'image',
      },
    });
    const targetResult = await repository.storeIncomingMessage(targetInput);
    expect(targetResult.ok).toBe(true);
    if (!targetResult.ok) throw new Error(targetResult.error.message);

    const data = fakeFirestore.getAllData();
    const target = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(targetResult.value.chatId);
    if (target === undefined || chat === undefined) throw new Error('Expected sparse target setup');
    Reflect.deleteProperty(target, 'id');
    Reflect.deleteProperty(target, 'contextRevision');
    Reflect.deleteProperty(target, 'contextChangeSequence');
    Reflect.deleteProperty(chat, 'contextChangeSequence');
    data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.clear();

    const replacement = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$sparse-media-replacement',
        text: 'Accessible replacement text',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$sparse-media-target',
          applicationStatus: 'pending',
        },
      },
    });
    const first = await repository.storeIncomingMessage(replacement);
    expect(first.ok).toBe(true);
    const identical = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...replacement.message,
          matrixEventId: '$sparse-media-identical-replacement',
          eventTimestamp: '2026-06-22T10:06:00.000Z',
        },
      })
    );

    expect(identical.ok).toBe(true);
    const updatedTarget = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(targetResult.value.messageId);
    expect(updatedTarget).toMatchObject({
      id: targetResult.value.messageId,
      text: 'Accessible replacement text',
      contextRevision: 2,
      contextChangeSequence: 1,
    });
    expect(updatedTarget).not.toHaveProperty('contextOriginalText');
    expect(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size).toBe(1);
  });

  it('applies sparse legacy redactions and supersedes later operations against the tombstone', async () => {
    const targetInput = createStoreInput({
      message: {
        ...createStoreInput().message,
        matrixEventId: '$sparse-redaction-target',
      },
    });
    const stored = await repository.storeIncomingMessage(targetInput);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    const data = fakeFirestore.getAllData();
    const target = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(stored.value.messageId);
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(stored.value.chatId);
    if (target === undefined || chat === undefined) throw new Error('Expected redaction target');
    Reflect.deleteProperty(target, 'id');
    Reflect.deleteProperty(target, 'contextRevision');
    Reflect.deleteProperty(target, 'contextChangeSequence');
    Reflect.deleteProperty(chat, 'contextChangeSequence');
    data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.clear();

    const redactionMessage = (
      matrixEventId: string,
      eventTimestamp: string
    ): StorePrivateWhatsAppMessageInput =>
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId,
          type: 'redaction',
          text: undefined,
          eventTimestamp,
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$sparse-redaction-target',
            applicationStatus: 'pending',
          },
        },
      });
    const applied = await repository.storeIncomingMessage(
      redactionMessage('$sparse-redaction-applied', '2026-06-22T10:05:00.000Z')
    );
    const superseded = await repository.storeIncomingMessage(
      redactionMessage('$sparse-redaction-superseded', '2026-06-22T10:06:00.000Z')
    );
    const reaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$reaction-after-redaction',
          type: 'reaction',
          text: '👍',
          eventTimestamp: '2026-06-22T10:07:00.000Z',
          reaction: { emoji: '👍', targetMatrixEventId: '$sparse-redaction-target' },
        },
      })
    );

    expect(applied.ok).toBe(true);
    expect(superseded.ok).toBe(true);
    expect(reaction.ok).toBe(true);
    expect(data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(stored.value.messageId)).toMatchObject({
      contextState: 'redacted',
      contextRevision: 2,
      contextChangeSequence: 1,
    });
    const messages = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(messages?.get(deterministicId(targetInput.sourceAccountId, '$sparse-redaction-superseded')))
      .toMatchObject({ relation: { applicationStatus: 'superseded' } });
    expect(messages?.get(deterministicId(targetInput.sourceAccountId, '$reaction-after-redaction')))
      .toMatchObject({ reaction: { applicationStatus: 'superseded' } });
  });

  it('applies a reaction to a sparse group target without inventing a sender display name', async () => {
    const roomId = '!sparse-reaction-group:matrix.example';
    const base = createStoreInput().message;
    const messageWithoutIdentity = {
      ...base,
      matrixRoomId: roomId,
      matrixSenderId: '@anonymous:matrix.example',
      senderKey: 'matrix:@anonymous:matrix.example',
      senderDisplayName: undefined,
      senderPhoneNumber: undefined,
      senderPhoneNumberNormalized: undefined,
    };
    const targetInput = createStoreInput({
      chat: { matrixRoomId: roomId, type: 'group' },
      message: { ...messageWithoutIdentity, matrixEventId: '$sparse-reaction-target' },
    });
    const stored = await repository.storeIncomingMessage(targetInput);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    const data = fakeFirestore.getAllData();
    const target = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)?.get(stored.value.messageId);
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(stored.value.chatId);
    if (target === undefined || chat === undefined) throw new Error('Expected reaction target');
    Reflect.deleteProperty(target, 'id');
    Reflect.deleteProperty(target, 'contextRevision');
    Reflect.deleteProperty(target, 'contextChangeSequence');
    Reflect.deleteProperty(chat, 'contextChangeSequence');
    data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.clear();

    const reaction = await repository.storeIncomingMessage(
      createStoreInput({
        chat: { matrixRoomId: roomId, type: 'group' },
        message: {
          ...messageWithoutIdentity,
          matrixEventId: '$sparse-reaction',
          type: 'reaction',
          text: '🔥',
          eventTimestamp: '2026-06-22T10:05:00.000Z',
          reaction: { emoji: '🔥', targetMatrixEventId: '$sparse-reaction-target' },
        },
      })
    );

    expect(reaction.ok).toBe(true);
    const updatedTarget = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(stored.value.messageId);
    expect(updatedTarget).toMatchObject({ contextRevision: 2, contextChangeSequence: 1 });
    expect(updatedTarget?.['reactions']).toEqual([
      expect.objectContaining({ id: deterministicId(targetInput.sourceAccountId, '$sparse-reaction') }),
    ]);
    expect((updatedTarget?.['reactions'] as Record<string, unknown>[])[0]).not.toHaveProperty(
      'senderDisplayName'
    );
  });

  it('redacts an older replacement without rolling back the latest edit and fences foreign edits', async () => {
    const targetInput = createStoreInput({
      message: { ...createStoreInput().message, matrixEventId: '$replacement-history-target' },
    });
    const target = await repository.storeIncomingMessage(targetInput);
    expect(target.ok).toBe(true);
    if (!target.ok) throw new Error(target.error.message);
    const replacementInput = (
      matrixEventId: string,
      text: string,
      eventTimestamp: string
    ): StorePrivateWhatsAppMessageInput =>
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId,
          text,
          eventTimestamp,
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$replacement-history-target',
            applicationStatus: 'pending',
          },
        },
      });
    const older = await repository.storeIncomingMessage(
      replacementInput('$replacement-history-older', 'Older edit', '2026-06-22T10:05:00.000Z')
    );
    const latest = await repository.storeIncomingMessage(
      replacementInput('$replacement-history-latest', 'Latest edit', '2026-06-22T10:06:00.000Z')
    );
    expect(older.ok).toBe(true);
    expect(latest.ok).toBe(true);
    if (!older.ok || !latest.ok) throw new Error('Expected replacement setup');

    const redactOperation = (
      matrixEventId: string,
      targetMatrixEventId: string
    ): ReturnType<typeof repository.storeIncomingMessage> =>
      repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId,
            type: 'redaction',
            text: undefined,
            eventTimestamp: '2026-06-22T10:10:00.000Z',
            relation: { kind: 'redaction', targetMatrixEventId, applicationStatus: 'pending' },
          },
        })
      );
    const olderRedaction = await redactOperation(
      '$redact-older-replacement',
      '$replacement-history-older'
    );
    expect(olderRedaction.ok).toBe(true);
    const messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(messages?.get(target.value.messageId)).toMatchObject({
      text: 'Latest edit',
      latestReplacementMessageId: latest.value.messageId,
    });

    const latestDocument = messages?.get(latest.value.messageId);
    if (latestDocument === undefined) throw new Error('Expected latest replacement');
    latestDocument['userId'] = 'foreign-user';
    const foreignRedaction = await redactOperation(
      '$redact-foreign-replacement',
      '$replacement-history-latest'
    );
    expect(foreignRedaction.ok).toBe(true);
    expect(
      messages?.get(deterministicId(targetInput.sourceAccountId, '$redact-foreign-replacement'))
    ).toMatchObject({ relation: { applicationStatus: 'superseded' } });
  });

  it('handles projection-identical and sparse replacement rollbacks', async () => {
    const { text: _text, ...baseMessage } = createStoreInput().message;
    const mediaTargetInput = createStoreInput({
      message: {
        ...baseMessage,
        matrixEventId: '$rollback-media-target',
        type: 'image',
      },
    });
    const mediaTarget = await repository.storeIncomingMessage(mediaTargetInput);
    expect(mediaTarget.ok).toBe(true);
    if (!mediaTarget.ok) throw new Error(mediaTarget.error.message);
    const mediaReplacement = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$rollback-media-replacement',
          text: 'Temporary media caption',
          eventTimestamp: '2026-06-22T10:05:00.000Z',
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$rollback-media-target',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(mediaReplacement.ok).toBe(true);
    if (!mediaReplacement.ok) throw new Error(mediaReplacement.error.message);
    const data = fakeFirestore.getAllData();
    const mediaTargetDocument = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(mediaTarget.value.messageId);
    if (mediaTargetDocument === undefined) throw new Error('Expected media target');
    Reflect.deleteProperty(mediaTargetDocument, 'text');
    const journalSizeBefore = data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size;
    const identicalRollback = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$rollback-media-redaction',
          type: 'redaction',
          text: undefined,
          eventTimestamp: '2026-06-22T10:06:00.000Z',
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$rollback-media-replacement',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(identicalRollback.ok).toBe(true);
    expect(data.get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)?.size).toBe(journalSizeBefore);

    const textTargetInput = createStoreInput({
      message: { ...createStoreInput().message, matrixEventId: '$rollback-sparse-target' },
    });
    const textTarget = await repository.storeIncomingMessage(textTargetInput);
    expect(textTarget.ok).toBe(true);
    if (!textTarget.ok) throw new Error(textTarget.error.message);
    const textReplacement = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$rollback-sparse-replacement',
          text: 'Sparse edit',
          eventTimestamp: '2026-06-22T10:07:00.000Z',
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$rollback-sparse-target',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(textReplacement.ok).toBe(true);
    const textTargetDocument = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(textTarget.value.messageId);
    const textChat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(textTarget.value.chatId);
    if (textTargetDocument === undefined || textChat === undefined) throw new Error('Expected text target');
    Reflect.deleteProperty(textTargetDocument, 'contextRevision');
    Reflect.deleteProperty(textChat, 'contextChangeSequence');
    const sparseRollback = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$rollback-sparse-redaction',
          type: 'redaction',
          text: undefined,
          eventTimestamp: '2026-06-22T10:08:00.000Z',
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$rollback-sparse-replacement',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(sparseRollback.ok).toBe(true);
  });

  it('handles missing and projection-identical logical targets when reactions are redacted', async () => {
    const seedAppliedReaction = async (
      suffix: string
    ): Promise<{
      targetMessageId: string;
      targetChatId: string;
      reactionMatrixEventId: string;
    }> => {
      const targetMatrixEventId = `$reaction-redaction-target-${suffix}`;
      const target = await repository.storeIncomingMessage(
        createStoreInput({
          message: { ...createStoreInput().message, matrixEventId: targetMatrixEventId },
        })
      );
      if (!target.ok) throw new Error(target.error.message);
      const reactionMatrixEventId = `$reaction-redaction-operation-${suffix}`;
      const reaction = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: reactionMatrixEventId,
            type: 'reaction',
            text: '✅',
            eventTimestamp: '2026-06-22T10:05:00.000Z',
            reaction: { emoji: '✅', targetMatrixEventId },
          },
        })
      );
      if (!reaction.ok) throw new Error(reaction.error.message);
      return {
        targetMessageId: target.value.messageId,
        targetChatId: target.value.chatId,
        reactionMatrixEventId,
      };
    };
    const redactReaction = (
      suffix: string,
      targetMatrixEventId: string
    ): ReturnType<typeof repository.storeIncomingMessage> =>
      repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: `$reaction-redaction-${suffix}`,
            type: 'redaction',
            text: undefined,
            eventTimestamp: '2026-06-22T10:06:00.000Z',
            relation: {
              kind: 'redaction',
              targetMatrixEventId,
              applicationStatus: 'pending',
            },
          },
        })
      );
    const noProjectionChange = await seedAppliedReaction('no-projection-change');
    const unchangedTarget = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(noProjectionChange.targetMessageId);
    if (unchangedTarget === undefined) throw new Error('Expected unchanged target');
    Reflect.deleteProperty(unchangedTarget, 'reactions');
    expect(
      await redactReaction('no-projection-change', noProjectionChange.reactionMatrixEventId)
    ).toMatchObject({ ok: true });

    const sparse = await seedAppliedReaction('sparse');
    const sparseData = fakeFirestore.getAllData();
    const sparseTarget = sparseData
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(sparse.targetMessageId);
    const sparseChat = sparseData
      .get(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      ?.get(sparse.targetChatId);
    if (sparseTarget === undefined || sparseChat === undefined) throw new Error('Expected sparse target');
    Reflect.deleteProperty(sparseTarget, 'contextRevision');
    Reflect.deleteProperty(sparseTarget, 'contextChangeSequence');
    Reflect.deleteProperty(sparseChat, 'contextChangeSequence');
    expect(await redactReaction('sparse', sparse.reactionMatrixEventId)).toMatchObject({ ok: true });

    const missing = await seedAppliedReaction('missing');
    fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.delete(missing.targetMessageId);
    const missingResult = await redactReaction('missing', missing.reactionMatrixEventId);
    expect(missingResult.ok).toBe(true);
    expect(
      fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        ?.get(deterministicId('pbuchman-private-whatsapp', '$reaction-redaction-missing'))
    ).toMatchObject({ relation: { applicationStatus: 'superseded' } });
  });

  it('scrubs late reaction and redaction operations without assuming logical target metadata', async () => {
    const redactionBeforeReaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$redaction-before-orphan-reaction',
          type: 'redaction',
          text: undefined,
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$orphan-reaction-operation',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(redactionBeforeReaction.ok).toBe(true);
    const orphanReaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$orphan-reaction-operation',
          type: 'reaction',
          text: '❓',
          reaction: { emoji: '❓', targetMatrixEventId: '$missing-logical-target' },
        },
      })
    );
    expect(orphanReaction.ok).toBe(true);

    const redactionBeforeRedaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$redaction-before-redaction-operation',
          type: 'redaction',
          text: undefined,
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$late-redaction-operation',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(redactionBeforeRedaction.ok).toBe(true);
    const lateRedaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$late-redaction-operation',
          type: 'redaction',
          text: undefined,
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$another-missing-target',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(lateRedaction.ok).toBe(true);
    const messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(messages?.get(deterministicId('pbuchman-private-whatsapp', '$orphan-reaction-operation')))
      .toMatchObject({ contextState: 'redacted' });
    expect(messages?.get(deterministicId('pbuchman-private-whatsapp', '$late-redaction-operation')))
      .toMatchObject({
        contextState: 'redacted',
        rawMatrixEvent: { type: 'm.room.redaction' },
      });
  });

  it.each(['missing_chat', 'invalid_target', 'completed'] as const)(
    'handles a %s race before pending target resolution starts',
    async (scenario) => {
      const targetMatrixEventId = `$target-resolution-race-${scenario}`;
      seedPendingTargetOperations(fakeFirestore, {
        targetMatrixEventId,
        replacementCount: 1,
      });
      const targetMessageId = deterministicId('pbuchman-private-whatsapp', targetMatrixEventId);
      const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
      instrumentTransactions(fakeFirestore, {
        beforeTransaction: (transactionNumber) => {
          if (transactionNumber !== 2) return;
          const data = fakeFirestore.getAllData();
          if (scenario === 'missing_chat') {
            data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.delete(chatId);
            return;
          }
          const target = data
            .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
            ?.get(targetMessageId);
          if (target === undefined) throw new Error('Expected resolver target');
          if (scenario === 'invalid_target') {
            target['userId'] = 'other-user';
            return;
          }
          target['pendingOperationResolution'] = {
            status: 'completed',
            completedAt: '2026-06-22T10:30:00.000Z',
          };
        },
      });

      const result = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: targetMatrixEventId,
          },
        })
      );

      if (scenario === 'completed') {
        expect(result.ok).toBe(true);
      } else {
        expect(result).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
      }
    }
  );

  it('supersedes terminal and foreign pending operations while accepting an identical edit', async () => {
    const targetMatrixEventId = '$mixed-pending-operation-target';
    const pending = seedPendingTargetOperations(fakeFirestore, {
      targetMatrixEventId,
      replacementCount: 3,
      includeReaction: true,
      includeRedaction: true,
    });
    instrumentTransactions(fakeFirestore, {
      beforeTransaction: (transactionNumber) => {
        if (transactionNumber !== 2) return;
        const messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
        const terminalReplacement = messages?.get(pending.relationIds[0] ?? '');
        const foreignReplacement = messages?.get(pending.relationIds[1] ?? '');
        const identicalReplacement = messages?.get(pending.relationIds[2] ?? '');
        const foreignRedaction = messages?.get(pending.relationIds[3] ?? '');
        const foreignReaction = messages?.get(pending.reactionIds[0] ?? '');
        const terminalRelation = terminalReplacement?.['relation'] as
          | Record<string, unknown>
          | undefined;
        if (terminalRelation !== undefined) terminalRelation['applicationStatus'] = 'applied';
        if (foreignReplacement !== undefined) foreignReplacement['userId'] = 'other-user';
        if (identicalReplacement !== undefined) identicalReplacement['text'] = 'hello';
        if (foreignRedaction !== undefined) foreignRedaction['userId'] = 'other-user';
        if (foreignReaction !== undefined) foreignReaction['userId'] = 'other-user';
      },
    });

    const result = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: targetMatrixEventId,
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const data = fakeFirestore.getAllData();
    const messages = data.get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
    expect(messages?.get(result.value.messageId)).toMatchObject({
      text: 'hello',
      contextRevision: 1,
      pendingOperationResolution: { status: 'completed' },
    });
    expect(
      (messages?.get(pending.reactionIds[0] ?? '')?.['reaction'] as
        | Record<string, unknown>
        | undefined)?.['applicationStatus']
    ).toBe('superseded');
  });

  it.each(['reaction', 'replacement', 'redaction'] as const)(
    'resolves a %s against sparse legacy context counters',
    async (operationKind) => {
      const targetMatrixEventId = `$sparse-${operationKind}-resolver-target`;
      seedPendingTargetOperations(fakeFirestore, {
        targetMatrixEventId,
        replacementCount: operationKind === 'replacement' ? 1 : 0,
        includeReaction: operationKind === 'reaction',
        includeRedaction: operationKind === 'redaction',
      });
      const targetMessageId = deterministicId('pbuchman-private-whatsapp', targetMatrixEventId);
      const chatId = deterministicId('pbuchman-private-whatsapp', '!room:matrix.example');
      instrumentTransactions(fakeFirestore, {
        beforeTransaction: (transactionNumber) => {
          if (transactionNumber !== 2) return;
          const data = fakeFirestore.getAllData();
          const target = data
            .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
            ?.get(targetMessageId);
          const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(chatId);
          if (target === undefined || chat === undefined) throw new Error('Expected sparse target');
          Reflect.deleteProperty(target, 'contextRevision');
          Reflect.deleteProperty(chat, 'contextChangeSequence');
        },
      });

      const result = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: targetMatrixEventId,
          },
        })
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(
        fakeFirestore
          .getAllData()
          .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
          ?.get(result.value.messageId)
      ).toMatchObject({
        contextRevision: 2,
        contextChangeSequence: 1,
        pendingOperationResolution: { status: 'completed' },
      });
    }
  );

  it.each(['completed', 'invalid_target', 'invalid_candidate'] as const)(
    'handles a %s race while resolving operational redactions',
    async (scenario) => {
      const targetMatrixEventId = `$operational-resolution-race-${scenario}`;
      const redactionIds = seedPendingOperationalRedactions(fakeFirestore, {
        targetMatrixEventId,
        count: 101,
      });
      const targetMessageId = deterministicId('pbuchman-private-whatsapp', targetMatrixEventId);
      instrumentTransactions(fakeFirestore, {
        beforeTransaction: (transactionNumber) => {
          if (transactionNumber !== 2) return;
          const messages = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION);
          const target = messages?.get(targetMessageId);
          const candidate = messages?.get(redactionIds[100] ?? '');
          if (target === undefined || candidate === undefined) {
            throw new Error('Expected operational resolver documents');
          }
          if (scenario === 'completed') {
            target['pendingOperationResolution'] = {
              status: 'completed',
              completedAt: '2026-06-22T10:30:00.000Z',
            };
          } else if (scenario === 'invalid_target') {
            target['userId'] = 'other-user';
          } else {
            candidate['userId'] = 'other-user';
          }
        },
      });
      const baseMessage = createStoreInput().message;

      const result = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...baseMessage,
            matrixEventId: targetMatrixEventId,
            text: 'Late replacement',
            relation: {
              kind: 'replacement',
              targetMatrixEventId: '$logical-target',
              applicationStatus: 'pending',
            },
          },
        })
      );

      if (scenario === 'invalid_target') {
        expect(result).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
      } else {
        expect(result.ok).toBe(true);
      }
    }
  );

  it('returns unchanged for an identical transcription on a legacy message', async () => {
    const transcription = {
      status: 'completed' as const,
      text: 'Already transcribed.',
      completedAt: '2026-06-22T10:11:00.000Z',
    };
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc('legacy-identical-transcription')
      .set({ userId: 'user-123', transcription });

    const result = await repository.updateMessageTranscription({
      userId: 'user-123',
      messageId: 'legacy-identical-transcription',
      transcription,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'unchanged', messageId: 'legacy-identical-transcription' },
    });
  });

  it.each(['missing', 'foreign'] as const)(
    'rejects a transcription update when its journal chat is %s',
    async (scenario) => {
      const stored = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: `$transcription-${scenario}-chat`,
          },
        })
      );
      if (!stored.ok) throw new Error(stored.error.message);
      const chats = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION);
      if (scenario === 'missing') {
        chats?.delete(stored.value.chatId);
      } else {
        const chat = chats?.get(stored.value.chatId);
        if (chat === undefined) throw new Error('Expected transcription chat');
        chat['userId'] = 'other-user';
      }

      const result = await repository.updateMessageTranscription({
        userId: 'user-123',
        messageId: stored.value.messageId,
        transcription: { status: 'completed', text: 'Transcript' },
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    }
  );

  it.each(['chat_sequence', 'zero_sequence'] as const)(
    'returns sparse %s context counters for a projection-identical transcription',
    async (scenario) => {
      const stored = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...createStoreInput().message,
            matrixEventId: `$projection-identical-transcription-${scenario}`,
          },
        })
      );
      if (!stored.ok) throw new Error(stored.error.message);
      const data = fakeFirestore.getAllData();
      const message = data
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        ?.get(stored.value.messageId);
      const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(stored.value.chatId);
      if (message === undefined || chat === undefined) throw new Error('Expected stored context');
      Reflect.deleteProperty(message, 'contextRevision');
      Reflect.deleteProperty(message, 'contextChangeSequence');
      if (scenario === 'zero_sequence') Reflect.deleteProperty(chat, 'contextChangeSequence');

      const result = await repository.updateMessageTranscription({
        userId: 'user-123',
        messageId: stored.value.messageId,
        transcription: { status: 'completed', text: 'Invisible behind message text' },
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: 'unchanged',
          contextRevision: 1,
          contextChangeSequence: scenario === 'chat_sequence' ? 1 : 0,
        },
      });
    }
  );

  it('journals a projection-changing transcription with sparse legacy counters', async () => {
    const stored = await repository.storeIncomingMessage(
      createAudioStoreInput('$sparse-transcription-change', {
        mxcUri: 'mxc://matrix.example/sparse-transcription',
        mimeType: 'audio/ogg',
        storageStatus: 'stored',
        gcsPath: 'whatsapp/private/user-123/sparse-transcription/audio.ogg',
      })
    );
    if (!stored.ok) throw new Error(stored.error.message);
    const data = fakeFirestore.getAllData();
    const message = data
      .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      ?.get(stored.value.messageId);
    const chat = data.get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get(stored.value.chatId);
    if (message === undefined || chat === undefined) throw new Error('Expected sparse context');
    Reflect.deleteProperty(message, 'contextRevision');
    Reflect.deleteProperty(chat, 'contextChangeSequence');

    const result = await repository.updateMessageTranscription({
      userId: 'user-123',
      messageId: stored.value.messageId,
      transcription: { status: 'completed', text: 'Sparse transcript' },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { status: 'updated', contextRevision: 2, contextChangeSequence: 1 },
    });
  });

  it('supports legacy journal heads, validates bounds, and orders timestamp ties by id', async () => {
    const first = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$journal-tie-first',
          eventTimestamp: '2026-06-22T10:40:00.000Z',
        },
      })
    );
    const second = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$journal-tie-second',
          eventTimestamp: '2026-06-22T10:40:00.000Z',
        },
      })
    );
    if (!first.ok || !second.ok) throw new Error('Expected journal messages');
    const chat = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      ?.get(first.value.chatId);
    if (chat === undefined) throw new Error('Expected journal chat');
    Reflect.deleteProperty(chat, 'contextChangeSequence');

    const head = await repository.getConversationContextJournalHead({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: first.value.chatId,
    });
    expect(head).toEqual({ ok: true, value: 0 });

    const invalidRange = await repository.findConversationContextJournalEntries({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: first.value.chatId,
      afterSequence: -1,
      throughSequence: 2,
      limit: 1,
    });
    expect(invalidRange).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const tooManyMessages = await repository.findConversationContextMessagesByIds({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: first.value.chatId,
      messageIds: Array.from({ length: 401 }, (_value, index) => `message-${String(index)}`),
    });
    expect(tooManyMessages).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });

    const hydrated = await repository.findConversationContextMessagesByIds({
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: first.value.chatId,
      messageIds: [second.value.messageId, first.value.messageId],
    });
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) throw new Error(hydrated.error.message);
    expect(hydrated.value.map((message) => message.id)).toEqual(
      [first.value.messageId, second.value.messageId].sort((left, right) =>
        left.localeCompare(right)
      )
    );
  });

  it('propagates owned-chat read failures through every journal API', async () => {
    fakeFirestore.configure({ errorToThrow: new Error('Journal DB unavailable') });
    const ownership = {
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      chatId: 'unavailable-chat',
    };

    const head = await repository.getConversationContextJournalHead(ownership);
    const entries = await repository.findConversationContextJournalEntries({
      ...ownership,
      afterSequence: 0,
      throughSequence: 1,
      limit: 1,
    });
    const messages = await repository.findConversationContextMessagesByIds({
      ...ownership,
      messageIds: [],
    });

    expect(head).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
    expect(entries).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
    expect(messages).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
  });

  it('projects every transcription and textless media omission reason', async () => {
    const audio = await repository.storeIncomingMessage(
      createAudioStoreInput('$omission-transcription-audio', {
        mxcUri: 'mxc://matrix.example/omission-audio',
        mimeType: 'audio/ogg',
      })
    );
    if (!audio.ok) throw new Error(audio.error.message);
    for (const status of ['pending', 'processing'] as const) {
      expect(
        await repository.updateMessageTranscription({
          userId: 'user-123',
          messageId: audio.value.messageId,
          transcription: { status },
        })
      ).toMatchObject({ ok: true });
    }
    expect(
      await repository.updateMessageTranscription({
        userId: 'user-123',
        messageId: audio.value.messageId,
        transcription: {
          status: 'failed',
          error: { code: 'FAILED', message: 'No transcript' },
        },
      })
    ).toMatchObject({ ok: true });

    const { text: _text, ...textlessMessage } = createStoreInput().message;
    for (const messageType of ['video', 'file', 'sticker', 'unknown'] as const) {
      const stored = await repository.storeIncomingMessage(
        createStoreInput({
          message: {
            ...textlessMessage,
            matrixEventId: `$omission-${messageType}`,
            type: messageType,
          },
        })
      );
      expect(stored.ok).toBe(true);
    }

    const projections = [
      ...(fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)
        ?.values() ?? []),
    ].map((change) => change['after'] as Record<string, unknown>);
    expect(projections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ omissionReason: 'pending_transcription' }),
        expect.objectContaining({ omissionReason: 'failed_transcription' }),
        expect.objectContaining({ messageType: 'video', omissionReason: 'media_only' }),
        expect.objectContaining({ messageType: 'file', omissionReason: 'media_only' }),
        expect.objectContaining({ messageType: 'sticker', omissionReason: 'media_only' }),
        expect.objectContaining({ messageType: 'unknown', omissionReason: 'non_text' }),
      ])
    );
  });

  it('redacts a malformed reaction without a reaction target', async () => {
    const pendingRedaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$redaction-before-malformed-reaction',
          type: 'redaction',
          text: undefined,
          relation: {
            kind: 'redaction',
            targetMatrixEventId: '$malformed-reaction',
            applicationStatus: 'pending',
          },
        },
      })
    );
    expect(pendingRedaction.ok).toBe(true);

    const malformedReaction = await repository.storeIncomingMessage(
      createStoreInput({
        message: {
          ...createStoreInput().message,
          matrixEventId: '$malformed-reaction',
          type: 'reaction',
          text: undefined,
          reaction: undefined,
        },
      })
    );

    expect(malformedReaction.ok).toBe(true);
    if (!malformedReaction.ok) throw new Error(malformedReaction.error.message);
    expect(
      fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        ?.get(malformedReaction.value.messageId)
    ).toMatchObject({ contextState: 'redacted' });
  });

  it('fences a new account while an erasure request is running', async () => {
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-123').delete();
    fakeFirestore.seedCollection('whatsapp_private_erasure_requests', [
      {
        id: 'running-erasure-fence',
        data: {
          id: 'running-erasure-fence',
          userId: 'user-123',
          sourceAccountId: 'pbuchman-private-whatsapp',
          status: 'running',
        },
      },
    ]);

    const result = await repository.upsertAccount({
      userId: 'user-123',
      phoneNumberNormalized: '48123456789',
      displayName: 'Test',
      now: '2026-06-22T10:00:00.000Z',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', httpStatus: 409 },
    });
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
