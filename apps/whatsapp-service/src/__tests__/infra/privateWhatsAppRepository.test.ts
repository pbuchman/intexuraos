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
    expect(summaries).toHaveLength(1);
    expect(summaries).toMatchObject([
      {
        emoji: '👍',
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
      expect.arrayContaining([firstReactionResult.value.messageId])
    );
    expect(reactions.value.attachedReactionMessageIds).not.toContain(secondReactionResult.value.messageId);
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
        eventTimestamp: '2026-06-22T10:05:00.000Z',
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

  it('returns a persistence error when Firestore fails', async () => {
    fakeFirestore.configure({ errorToThrow: new Error('DB unavailable') });

    const result = await repository.storeIncomingMessage(createStoreInput());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected persistence failure');
    expect(result.error.code).toBe('PERSISTENCE_ERROR');
    expect(result.error.message).toContain('Failed to store private WhatsApp message');
  });
});
