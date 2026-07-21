import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Timestamp,
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
} from '../../infra/firestore/conversationAssistantRepository.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
  CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_CHUNK_MAX_BYTES,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  createConversationAssistantContextAttachmentRepository,
  hasSnapshotChunkData,
  validAttachmentPreparationSource,
} from '../../infra/firestore/conversationAssistantContextAttachmentRepository.js';
import type { ConversationAssistantContextAttachmentPreparedSnapshot } from '../../domain/conversation-assistant/types.js';
import type { CaptureConversationAssistantContextAttachmentInput } from '../../domain/conversation-assistant/contextAttachmentPorts.js';

const SESSION_ID = 'session-1';
const USER_ID = 'user-1';
const GENERATION_ID = 'generation-1';
const SOURCE_ACCOUNT_ID = 'source-1';
const SOURCE_ACCOUNT_GENERATION = 'source-generation-1';
const CHAT_ID = 'chat-1';

describe('context attachment repository guards', () => {
  it('rejects absent chunk data and accepts a stored chunk record', () => {
    expect(hasSnapshotChunkData(undefined)).toBe(false);
    expect(hasSnapshotChunkData({ payload: 'stored' })).toBe(true);
  });

  it('requires matching non-empty preparation source fences', () => {
    const session = {
      sourceAccountId: SOURCE_ACCOUNT_ID,
      sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
    };
    const attachment = { ...session };
    expect(validAttachmentPreparationSource(session, attachment)).toBe(true);
    expect(validAttachmentPreparationSource(undefined, attachment)).toBe(false);
    expect(validAttachmentPreparationSource({}, attachment)).toBe(false);
    expect(validAttachmentPreparationSource({ ...session, sourceAccountId: '' }, attachment)).toBe(false);
    expect(validAttachmentPreparationSource({ ...session, sourceAccountGeneration: '' }, attachment)).toBe(false);
    expect(validAttachmentPreparationSource(session, undefined)).toBe(false);
    expect(validAttachmentPreparationSource(session, { ...attachment, sourceAccountId: 'other' })).toBe(false);
    expect(
      validAttachmentPreparationSource(session, {
        ...attachment,
        sourceAccountGeneration: 'other',
      })
    ).toBe(false);
  });
});

function modernSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    chatId: CHAT_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
    status: 'active',
    generationId: GENERATION_ID,
    range: {
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-17T00:00:00.000Z',
    },
    continuation: {
      sourceAccountId: SOURCE_ACCOUNT_ID,
      contextVersion: 3,
      contextEventThrough: '2026-07-17T00:00:00.000Z',
      contextChangeThrough: 11,
      contextChainSha256: 'a'.repeat(64),
      displayTimeZone: 'Europe/Warsaw',
      nextTurnSequence: 5,
      nextConversationRevision: 3,
      completedConversationRevision: 2,
      attachmentCount: 2,
      totalAttachedMessageCount: 12,
      totalAttachedOmittedCount: 1,
    },
    ...overrides,
  };
}

function sourceChat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    contextChangeSequence: 19,
    ...overrides,
  };
}

function sourceAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    generationId: SOURCE_ACCOUNT_GENERATION,
    status: 'active',
    ...overrides,
  };
}

function captureInput(
  overrides: Partial<CaptureConversationAssistantContextAttachmentInput> = {}
): CaptureConversationAssistantContextAttachmentInput {
  return {
    attachmentId: 'attachment-1',
    userId: USER_ID,
    sessionId: SESSION_ID,
    expectedSessionGenerationId: GENERATION_ID,
    preparationRequestId: 'request-1',
    preparationRequestFingerprint: 'fingerprint-1',
    ...overrides,
  };
}

function preparedSnapshot(
  overrides: Partial<ConversationAssistantContextAttachmentPreparedSnapshot> = {}
): ConversationAssistantContextAttachmentPreparedSnapshot {
  return {
    transcriptText: '[2026-07-18T08:00:00.000Z] Them: hello',
    messages: [
      {
        id: 'message-1',
        eventTimestamp: '2026-07-18T08:00:00.000Z',
        importedAt: '2026-07-18T08:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Them',
        messageType: 'text',
        contentKind: 'text',
        content: 'hello',
      },
    ],
    omittedMessages: [],
    corrections: [],
    eventRange: {
      from: '2026-07-18T08:00:00.000Z',
      to: '2026-07-18T08:00:00.000Z',
    },
    counts: {
      included: 1,
      omitted: 0,
      newlyAvailable: 1,
      edited: 0,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    },
    omitted: {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    },
    deltaTranscriptSha256: 'b'.repeat(64),
    previousContextChainSha256: 'a'.repeat(64),
    resultingContextChainSha256: 'c'.repeat(64),
    estimatedInputTokens: 23,
    requiresConfirmation: false,
    ...overrides,
  };
}

describe('conversationAssistantContextAttachmentRepository capture', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createConversationAssistantContextAttachmentRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createConversationAssistantContextAttachmentRepository();
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: modernSession() },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
      { id: CHAT_ID, data: sourceChat() },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: sourceAccount() },
    ]);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('captures immutable source boundaries with server time and native TTL without advancing the session', async () => {
    const sessionBefore = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID)
        .get()
    ).data();

    const result = await repository.captureContextAttachment(captureInput());

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('Expected created attachment');
    expect(result.attachment).toMatchObject({
      id: 'attachment-1',
      userId: USER_ID,
      sessionId: SESSION_ID,
      sessionGenerationId: GENERATION_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
      chatId: CHAT_ID,
      status: 'queued',
      initialContextFrom: '2026-07-14T00:00:00.000Z',
      baseContextVersion: 3,
      baseEventThrough: '2026-07-17T00:00:00.000Z',
      baseChangeSeq: 11,
      cutoffChangeSeq: 19,
      preparationAttempt: 1,
      requiresConfirmation: false,
    });
    expect(result.attachment.captureRange).toEqual({
      from: '2026-07-17T00:00:00.000Z',
      to: result.attachment.capturedAt,
    });
    expect(Date.parse(result.attachment.capturedAt)).not.toBeNaN();
    expect(Date.parse(result.attachment.expiresAt ?? '')).toBeGreaterThan(
      Date.parse(result.attachment.capturedAt)
    );

    const stored = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc('attachment-1')
        .get()
    ).data();
    expect(stored?.['capturedAt']).toBeInstanceOf(Timestamp);
    expect(stored?.['captureRange']).toMatchObject({
      from: '2026-07-17T00:00:00.000Z',
    });
    expect((stored?.['captureRange'] as Record<string, unknown>)['to']).toBeInstanceOf(Timestamp);
    expect(stored?.['expireAt']).toBeInstanceOf(Timestamp);
    expect(stored?.['expiresAt']).toBeUndefined();
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(SESSION_ID)
          .get()
      ).data()
    ).toEqual(sessionBefore);
  });

  it('treats an absent legacy chat journal watermark as logical zero', async () => {
    const continuation = modernSession()['continuation'] as Record<string, unknown>;
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({
        continuation: {
          ...continuation,
          contextChangeThrough: 0,
        },
      });
    await fakeFirestore.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(CHAT_ID).set({
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
    });

    const result = await repository.captureContextAttachment(captureInput());

    expect(result).toMatchObject({
      status: 'created',
      attachment: {
        baseChangeSeq: 0,
        cutoffChangeSeq: 0,
      },
    });
  });

  it('fails closed when the source account is disconnected', async () => {
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(USER_ID)
      .set(sourceAccount({ status: 'disabled' }));

    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'unsupported',
      reason: 'source_unavailable',
    });
  });

  it('rejects capture after erasure or a same-source reconnect and writes no attachment', async () => {
    const accountRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(USER_ID);
    const deniedAccounts = [
      { label: 'missing', account: undefined },
      {
        label: 'erasing',
        account: sourceAccount({ erasureStatus: 'erasing' }),
      },
      {
        label: 'replacement-generation',
        account: sourceAccount({ generationId: 'source-generation-2' }),
      },
    ] as const;

    for (const scenario of deniedAccounts) {
      if (scenario.account === undefined) await accountRef.delete();
      else await accountRef.set(scenario.account);
      const attachmentId = `capture-${scenario.label}`;

      await expect(
        repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: SESSION_ID })
      ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });
      await expect(
        repository.captureContextAttachment(
          captureInput({
            attachmentId,
            preparationRequestId: `request-${scenario.label}`,
            preparationRequestFingerprint: `fingerprint-${scenario.label}`,
          })
        )
      ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
            .doc(attachmentId)
            .get()
        ).exists
      ).toBe(false);
    }
  });

  it('resolves only an owned modern session whose source chat is still available', async () => {
    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).resolves.toEqual({ status: 'found', sessionGenerationId: GENERATION_ID });
    await expect(
      repository.resolveContextAttachmentSession({ userId: 'foreign-user', sessionId: SESSION_ID })
    ).resolves.toEqual({ status: 'not_found' });

    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: 'legacy', data: modernSession({ continuation: undefined }) },
      { id: 'malformed-continuation', data: modernSession({ continuation: {} }) },
      { id: 'missing-source', data: modernSession({ chatId: 'missing-chat' }) },
      { id: 'invalid-document', data: null as unknown as Record<string, unknown> },
    ]);

    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: 'legacy' })
    ).resolves.toEqual({ status: 'unsupported', reason: 'legacy_session' });
    await expect(
      repository.resolveContextAttachmentSession({
        userId: USER_ID,
        sessionId: 'malformed-continuation',
      })
    ).resolves.toEqual({ status: 'unsupported', reason: 'legacy_session' });
    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: 'missing-source' })
    ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });
    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: 'absent' })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.resolveContextAttachmentSession({
        userId: USER_ID,
        sessionId: 'invalid-document',
      })
    ).resolves.toEqual({ status: 'not_found' });
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: 'invalid-chat', data: modernSession({ chatId: null }) },
    ]);
    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: 'invalid-chat' })
    ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });
  });

  it('replays the same request, rejects body substitution, and allows two drafts at one base', async () => {
    const created = await repository.captureContextAttachment(captureInput());
    const replay = await repository.captureContextAttachment(captureInput());
    const conflict = await repository.captureContextAttachment(
      captureInput({ preparationRequestFingerprint: 'different-fingerprint' })
    );
    const secondDraft = await repository.captureContextAttachment(
      captureInput({
        attachmentId: 'attachment-2',
        preparationRequestId: 'request-2',
        preparationRequestFingerprint: 'fingerprint-2',
      })
    );

    expect(created.status).toBe('created');
    expect(replay).toEqual({
      status: 'replay',
      attachment: created.status === 'created' ? created.attachment : undefined,
    });
    expect(conflict).toEqual({ status: 'conflict' });
    expect(secondDraft.status).toBe('created');
    if (created.status === 'created' && secondDraft.status === 'created') {
      expect(secondDraft.attachment.baseContextVersion).toBe(created.attachment.baseContextVersion);
      expect(secondDraft.attachment.baseChangeSeq).toBe(created.attachment.baseChangeSeq);
    }
  });

  it('maps stored timestamps and absent optional fields', async () => {
    await repository.captureContextAttachment(captureInput());
    const ref = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1');
    const base = (await ref.get()).data();
    if (base === undefined) throw new Error('Expected attachment document');

    const withoutOptional = { ...base };
    Reflect.deleteProperty(withoutOptional, 'newerAvailableCount');
    Reflect.deleteProperty(withoutOptional, 'newerAvailableCorrectionCount');
    await ref.set(withoutOptional);
    const optionalReplay = await repository.captureContextAttachment(captureInput());
    expect(optionalReplay.status).toBe('replay');
    if (optionalReplay.status !== 'replay') throw new Error('Expected replay');
    expect(optionalReplay.attachment.newerAvailableCount).toBeUndefined();
    expect(optionalReplay.attachment.newerAvailableCorrectionCount).toBeUndefined();

    const capturedDate = new Date('2026-07-21T12:00:00.000Z');
    await ref.set({
      ...base,
      capturedAt: capturedDate,
      captureRange: {
        from: '2026-07-17T00:00:00.000Z',
        to: capturedDate,
      },
    });
    const dateReplay = await repository.captureContextAttachment(captureInput());
    expect(dateReplay.status).toBe('replay');
    if (dateReplay.status !== 'replay') throw new Error('Expected replay');
    expect(dateReplay.attachment.capturedAt).toBe(capturedDate.toISOString());

  });

  it('expires only the intended uncommitted draft when a refresh replacement is captured', async () => {
    await repository.captureContextAttachment(captureInput());

    const refreshed = await repository.captureContextAttachment(
      captureInput({
        attachmentId: 'attachment-2',
        preparationRequestId: 'request-2',
        preparationRequestFingerprint: 'fingerprint-2',
        replacesAttachmentId: 'attachment-1',
      })
    );

    expect(refreshed.status).toBe('created');
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .get()
      ).data()?.['status']
    ).toBe('expired');
    const missingReplacement = await repository.captureContextAttachment(
      captureInput({
        attachmentId: 'attachment-3',
        preparationRequestId: 'request-3',
        preparationRequestFingerprint: 'fingerprint-3',
        replacesAttachmentId: 'missing-attachment',
      })
    );
    expect(missingReplacement).toMatchObject({
      status: 'created',
      attachment: { id: 'attachment-3' },
    });

    const ownedReplacement = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc('attachment-1')
        .get()
    ).data();
    if (ownedReplacement === undefined) throw new Error('Expected replacement fixture');
    const foreignReplacement = { ...ownedReplacement, userId: 'foreign-user', status: 'ready' };
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('foreign-replacement')
      .set(foreignReplacement);
    const foreignResult = await repository.captureContextAttachment(
      captureInput({
        attachmentId: 'attachment-4',
        preparationRequestId: 'request-4',
        preparationRequestFingerprint: 'fingerprint-4',
        replacesAttachmentId: 'foreign-replacement',
      })
    );
    expect(foreignResult).toMatchObject({
      status: missingReplacement.status,
      attachment: { id: 'attachment-4' },
    });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('foreign-replacement')
          .get()
      ).data()
    ).toEqual(foreignReplacement);
  });

  it('fails closed when generation changes or the source becomes unavailable', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ generationId: 'new-generation' });
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'stale',
    });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ generationId: GENERATION_ID });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(CHAT_ID)
      .delete();
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'unsupported',
      reason: 'source_unavailable',
    });
  });

  it('rejects a corrupt or regressed source watermark and a non-ready session', async () => {
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(CHAT_ID)
      .update({ contextChangeSequence: null });
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'unsupported',
      reason: 'source_unavailable',
    });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(CHAT_ID)
      .update({ contextChangeSequence: 10 });
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'unsupported',
      reason: 'source_unavailable',
    });
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(CHAT_ID)
      .update({ contextChangeSequence: 19 });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ status: 'preparing' });
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'stale',
    });
    await expect(
      repository.resolveContextAttachmentSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('fails capture closed for absent, deleted, legacy, malformed, and substituted stored state', async () => {
    await expect(
      repository.captureContextAttachment(captureInput({ sessionId: 'absent' }))
    ).resolves.toEqual({ status: 'not_found' });
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: 'deleted',
        data: modernSession({ deletionStartedAt: '2026-07-21T00:00:00.000Z' }),
      },
      { id: 'legacy-capture', data: modernSession({ continuation: null }) },
      { id: 'invalid-range', data: modernSession({ range: { from: null } }) },
      { id: 'invalid-range-document', data: modernSession({ range: null }) },
    ]);
    await expect(
      repository.captureContextAttachment(captureInput({ sessionId: 'deleted' }))
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.captureContextAttachment(captureInput({ sessionId: 'legacy-capture' }))
    ).resolves.toEqual({ status: 'unsupported', reason: 'legacy_session' });
    await expect(
      repository.captureContextAttachment(captureInput({ sessionId: 'invalid-range' }))
    ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });
    await expect(
      repository.captureContextAttachment(captureInput({ sessionId: 'invalid-range-document' }))
    ).resolves.toEqual({ status: 'unsupported', reason: 'source_unavailable' });

    await repository.captureContextAttachment(captureInput());
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ userId: 'substituted-owner' });
    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('rejects committed replacement but atomically recaptures an owned expired draft', async () => {
    await repository.captureContextAttachment(captureInput());
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ status: 'committed' });
    await expect(
      repository.captureContextAttachment(
        captureInput({
          attachmentId: 'attachment-2',
          preparationRequestId: 'request-2',
          preparationRequestFingerprint: 'fingerprint-2',
          replacesAttachmentId: 'attachment-1',
        })
      )
    ).resolves.toEqual({ status: 'stale' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ status: 'failed', expireAt: Timestamp.fromMillis(0) });
    await expect(
      repository.captureContextAttachment(
        captureInput({
          attachmentId: 'attachment-3',
          preparationRequestId: 'request-3',
          preparationRequestFingerprint: 'fingerprint-3',
          replacesAttachmentId: 'attachment-1',
        })
      )
    ).resolves.toMatchObject({ status: 'created', attachment: { id: 'attachment-3' } });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .get()
      ).data()
    ).toMatchObject({ status: 'expired', replacedByAttachmentId: 'attachment-3' });
  });

  it('fails capture closed if metadata disappears after the transaction commits', async () => {
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (operation) => {
      const result = await originalRunTransaction(operation);
      if (
        typeof result === 'object' &&
        result !== null &&
        'status' in result &&
        result.status === 'created'
      ) {
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .delete();
      }
      return result;
    });

    await expect(repository.captureContextAttachment(captureInput())).resolves.toEqual({
      status: 'not_found',
    });
  });
});

describe('conversationAssistantContextAttachmentRepository preparation', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createConversationAssistantContextAttachmentRepository>;

  beforeEach(async () => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createConversationAssistantContextAttachmentRepository();
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: modernSession() },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
      { id: CHAT_ID, data: sourceChat() },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: sourceAccount() },
    ]);
    await repository.captureContextAttachment(captureInput());
  });

  afterEach(() => {
    resetFirestore();
  });

  it('publishes deterministic base64 JSON chunks before a fenced ready transition', async () => {
    const now = new Date().toISOString();
    const prepared = preparedSnapshot();
    const claimed = await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    expect(claimed.status).toBe('claimed');

    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      snapshotId: 'snapshot-1',
      prepared,
      maxChunkCount: 400,
      now,
    });
    expect(persisted.status).toBe('saved');
    if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');
    expect(persisted.manifest.chunkCount).toBeGreaterThan(0);
    expect(persisted.manifest.chunkIds).toHaveLength(persisted.manifest.chunkCount);

    const storedParts: string[] = [];
    for (const [index, chunkId] of persisted.manifest.chunkIds.entries()) {
      const chunk = (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc(chunkId)
          .get()
      ).data();
      expect(chunk).toMatchObject({
        attachmentId: 'attachment-1',
        sessionId: SESSION_ID,
        userId: USER_ID,
        sessionGenerationId: GENERATION_ID,
        sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
        snapshotId: 'snapshot-1',
        chunkIndex: index,
        chunkCount: persisted.manifest.chunkCount,
        encoding: 'base64-json',
        preparationAttempt: 1,
        preparationClaimId: 'claim-1',
      });
      expect(chunk?.['expireAt']).toBeInstanceOf(Timestamp);
      const attachmentStorage = (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .get()
      ).data();
      expect((chunk?.['expireAt'] as Timestamp).toMillis()).toBe(
        (attachmentStorage?.['expireAt'] as Timestamp).toMillis()
      );
      storedParts.push(String(chunk?.['payload']));
    }
    expect(JSON.parse(Buffer.from(storedParts.join(''), 'base64').toString('utf8'))).toEqual(
      prepared
    );

    const completed = await repository.completeContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      snapshotId: 'snapshot-1',
      manifest: persisted.manifest,
      prepared,
      now,
    });

    expect(completed.status).toBe('ready');
    if (completed.status !== 'ready') throw new Error('Expected ready attachment');
    expect(completed.attachment).toMatchObject({
      status: 'ready',
      snapshotId: 'snapshot-1',
      chunkManifest: persisted.manifest,
      counts: prepared.counts,
      omitted: prepared.omitted,
      eventRange: prepared.eventRange,
      deltaTranscriptSha256: prepared.deltaTranscriptSha256,
      previousContextChainSha256: prepared.previousContextChainSha256,
      resultingContextChainSha256: prepared.resultingContextChainSha256,
      estimatedInputTokens: prepared.estimatedInputTokens,
      requiresConfirmation: false,
    });
    expect(completed.attachment.preparationClaimId).toBeUndefined();
    expect(completed.attachment.preparationLeaseExpiresAt).toBeUndefined();
  });

  it('fences every preparation write after erasure or a same-source reconnect', async () => {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(now) + 60_000).toISOString();
    const accountRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(USER_ID);
    const activeAccount = sourceAccount();
    const deniedAccounts = [
      { label: 'missing', account: undefined },
      {
        label: 'erasing',
        account: sourceAccount({ status: 'disabled', erasureStatus: 'erasing' }),
      },
      {
        label: 'replacement-generation',
        account: sourceAccount({ generationId: 'source-generation-2' }),
      },
    ] as const;

    const createDraft = async (attachmentId: string): Promise<void> => {
      await accountRef.set(activeAccount);
      await expect(
        repository.captureContextAttachment(
          captureInput({
            attachmentId,
            preparationRequestId: `request-${attachmentId}`,
            preparationRequestFingerprint: `fingerprint-${attachmentId}`,
          })
        )
      ).resolves.toMatchObject({ status: 'created' });
    };
    const claimDraft = async (attachmentId: string, claimId: string): Promise<void> => {
      await expect(
        repository.claimContextAttachmentPreparation({
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId,
          expectedSessionGenerationId: GENERATION_ID,
          attempt: 1,
          claimId,
          now,
          leaseExpiresAt,
        })
      ).resolves.toMatchObject({ status: 'claimed' });
    };

    for (const scenario of deniedAccounts) {
      const claimAttachmentId = `claim-${scenario.label}`;
      await createDraft(claimAttachmentId);
      if (scenario.account === undefined) await accountRef.delete();
      else await accountRef.set(scenario.account);
      await expect(
        repository.claimContextAttachmentPreparation({
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: claimAttachmentId,
          expectedSessionGenerationId: GENERATION_ID,
          attempt: 1,
          claimId: `forbidden-${scenario.label}`,
          now,
          leaseExpiresAt,
        })
      ).resolves.toEqual({ status: 'stale' });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
            .doc(claimAttachmentId)
            .get()
        ).data()
      ).toMatchObject({ status: 'queued' });

      const persistAttachmentId = `persist-${scenario.label}`;
      const persistClaimId = `persist-claim-${scenario.label}`;
      await createDraft(persistAttachmentId);
      await claimDraft(persistAttachmentId, persistClaimId);
      if (scenario.account === undefined) await accountRef.delete();
      else await accountRef.set(scenario.account);
      await expect(
        repository.persistContextAttachmentPreparedSnapshot({
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: persistAttachmentId,
          expectedSessionGenerationId: GENERATION_ID,
          attempt: 1,
          claimId: persistClaimId,
          snapshotId: `snapshot-persist-${scenario.label}`,
          prepared: preparedSnapshot(),
          maxChunkCount: 400,
          now,
        })
      ).resolves.toEqual({ status: 'stale' });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
            .where('attachmentId', '==', persistAttachmentId)
            .get()
        ).empty
      ).toBe(true);

      const completeAttachmentId = `complete-${scenario.label}`;
      const completeClaimId = `complete-claim-${scenario.label}`;
      const snapshotId = `snapshot-complete-${scenario.label}`;
      await createDraft(completeAttachmentId);
      await claimDraft(completeAttachmentId, completeClaimId);
      const prepared = preparedSnapshot();
      const persisted = await repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: completeAttachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: completeClaimId,
        snapshotId,
        prepared,
        maxChunkCount: 400,
        now,
      });
      if (persisted.status !== 'saved') throw new Error('Expected saved preparation snapshot');
      if (scenario.account === undefined) await accountRef.delete();
      else await accountRef.set(scenario.account);
      await expect(
        repository.completeContextAttachmentPreparation({
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: completeAttachmentId,
          expectedSessionGenerationId: GENERATION_ID,
          attempt: 1,
          claimId: completeClaimId,
          snapshotId,
          manifest: persisted.manifest,
          prepared,
          now,
        })
      ).resolves.toEqual({ status: 'stale' });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
            .doc(completeAttachmentId)
            .get()
        ).data()
      ).toMatchObject({ status: 'preparing', preparationClaimId: completeClaimId });
    }
  });

  it('fences claims by lease, attempt, owner, and session generation', async () => {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(now) + 60_000).toISOString();
    const first = await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt,
    });
    expect(first.status).toBe('claimed');
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-2',
        now,
        leaseExpiresAt,
      })
    ).resolves.toEqual({ status: 'busy' });
    expect(
      (
        await repository.claimContextAttachmentPreparation({
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: 'attachment-1',
          expectedSessionGenerationId: GENERATION_ID,
          attempt: 1,
          claimId: 'claim-1',
          now,
          leaseExpiresAt,
        })
      ).status
    ).toBe('claimed');
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: 'foreign-user',
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-3',
        now,
        leaseExpiresAt,
      })
    ).resolves.toEqual({ status: 'not_found' });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ generationId: 'new-generation' });
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-3',
        now,
        leaseExpiresAt,
      })
    ).resolves.toEqual({ status: 'stale' });
  });

  it('recovers an expired preparation lease without changing the attempt or cutoff', async () => {
    const now = new Date().toISOString();
    const first = await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 1_000).toISOString(),
    });
    if (first.status !== 'claimed') throw new Error('Expected first claim');
    const recovered = await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-2',
      now: new Date(Date.parse(now) + 2_000).toISOString(),
      leaseExpiresAt: new Date(Date.parse(now) + 62_000).toISOString(),
    });

    expect(recovered.status).toBe('claimed');
    if (recovered.status !== 'claimed') throw new Error('Expected recovered claim');
    expect(recovered.attachment).toMatchObject({
      preparationAttempt: 1,
      preparationClaimId: 'claim-2',
      capturedAt: first.attachment.capturedAt,
      cutoffChangeSeq: first.attachment.cutoffChangeSeq,
    });
  });

  it('rejects writes from a claim after its lease expires even before another worker reclaims it', async () => {
    const now = new Date().toISOString();
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-expiring',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 1_000).toISOString(),
    });

    await expect(
      repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-expiring',
        snapshotId: 'snapshot-expired-lease',
        prepared: preparedSnapshot(),
        maxChunkCount: 400,
        now: new Date(Date.parse(now) + 2_000).toISOString(),
      })
    ).resolves.toEqual({ status: 'stale' });
  });

  it('fails and requeues with the original immutable cutoff and an incremented attempt', async () => {
    const now = new Date().toISOString();
    const before = await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    if (before.status !== 'claimed') throw new Error('Expected claim');
    await expect(
      repository.failContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'wrong-claim',
        error: { code: 'PREPARATION_FAILED', message: 'Safe failure' },
        now,
      })
    ).resolves.toEqual({ status: 'stale' });

    const failed = await repository.failContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      error: { code: 'PREPARATION_FAILED', message: 'Safe failure' },
      now,
    });
    expect(failed.status).toBe('failed');

    const requeued = await repository.requeueContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      updatedAt: new Date(Date.parse(now) + 1_000).toISOString(),
    });
    expect(requeued.status).toBe('queued');
    if (requeued.status !== 'queued') throw new Error('Expected queued attachment');
    expect(requeued.attachment).toMatchObject({
      preparationAttempt: 2,
      capturedAt: before.attachment.capturedAt,
      captureRange: before.attachment.captureRange,
      baseContextVersion: before.attachment.baseContextVersion,
      baseEventThrough: before.attachment.baseEventThrough,
      baseChangeSeq: before.attachment.baseChangeSeq,
      cutoffChangeSeq: before.attachment.cutoffChangeSeq,
    });
    expect(requeued.attachment.preparationError).toBeUndefined();
  });

  it('fences preparation failure and requeue when source authority disappears', async () => {
    const now = new Date().toISOString();
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-source-fence',
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      })
    ).resolves.toMatchObject({ status: 'claimed' });
    const accountRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(USER_ID);
    await accountRef.delete();
    const failInput = {
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-source-fence',
      error: { code: 'PREPARATION_FAILED', message: 'Safe failure' },
      now,
    };

    await expect(repository.failContextAttachmentPreparation(failInput)).resolves.toEqual({
      status: 'stale',
    });
    await accountRef.set(sourceAccount());
    await expect(repository.failContextAttachmentPreparation(failInput)).resolves.toMatchObject({
      status: 'failed',
    });
    await accountRef.delete();
    await expect(
      repository.requeueContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        updatedAt: new Date(Date.parse(now) + 1_000).toISOString(),
      })
    ).resolves.toEqual({ status: 'stale' });
  });

  it('marks only the still-queued matching publication attempt as failed', async () => {
    const failed = await repository.failQueuedContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      error: { code: 'PUBLISH_FAILED', message: 'Safe failure' },
    });
    expect(failed.status).toBe('failed');
    if (failed.status !== 'failed') throw new Error('Expected failed attachment');
    expect(failed.attachment.preparationError).toEqual({
      code: 'PUBLISH_FAILED',
      message: 'Safe failure',
    });

    const replayedFailure = await repository.failQueuedContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      error: { code: 'PUBLISH_FAILED', message: 'Safe failure' },
    });
    expect(replayedFailure.status).toBe('stale');
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-after-failure',
        now: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    ).resolves.toEqual({ status: 'stale' });
    const stalePublication = await repository.failQueuedContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: 'different-generation',
      attempt: 1,
      error: { code: 'PUBLISH_FAILED', message: 'Safe failure' },
    });
    expect(stalePublication.status).toBe('stale');
    await expect(
      repository.requeueContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: 'different-generation',
        updatedAt: new Date().toISOString(),
      })
    ).resolves.toEqual({ status: 'stale' });
  });

  it('rejects an oversized snapshot before writing any chunks', async () => {
    const now = new Date().toISOString();
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });

    await expect(
      repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        snapshotId: 'snapshot-too-large',
        prepared: preparedSnapshot(),
        maxChunkCount: 0,
        now,
      })
    ).resolves.toEqual({ status: 'too_large', chunkCount: 1 });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .get()
      ).size
    ).toBe(0);
  });

  it('removes already-written orphan chunks when the preparation fence is lost', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantContextAttachmentRepository({
      telemetry: { record },
    });
    const now = new Date().toISOString();
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let stoleFence = false;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (operation) => {
      const result = await originalRunTransaction(operation);
      if (!stoleFence && result === 'saved') {
        stoleFence = true;
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .update({ preparationClaimId: 'replacement-claim' });
      }
      return result;
    });

    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      snapshotId: 'snapshot-orphan',
      prepared: preparedSnapshot({
        transcriptText: 'x'.repeat(
          CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_CHUNK_MAX_BYTES + 1
        ),
      }),
      maxChunkCount: 400,
      now,
    });

    expect(persisted).toEqual({ status: 'stale' });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .get()
      ).size
    ).toBe(0);
    expect(record).toHaveBeenCalledWith({
      operation: 'attachment_preparation',
      outcome: 'partial',
      orphanCleanupCount: 1,
    });
  });

  it('fails ready publication closed when a manifested chunk is missing', async () => {
    const now = new Date().toISOString();
    const prepared = preparedSnapshot();
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      snapshotId: 'snapshot-missing',
      prepared,
      maxChunkCount: 400,
      now,
    });
    if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');
    const missingId = persisted.manifest.chunkIds[0];
    if (missingId === undefined) throw new Error('Expected chunk id');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(missingId)
      .delete();

    await expect(
      repository.completeContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        snapshotId: 'snapshot-missing',
        manifest: persisted.manifest,
        prepared,
        now,
      })
    ).resolves.toEqual({ status: 'missing_chunks' });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .get()
      ).data()?.['status']
    ).toBe('preparing');
  });

  it('fails closed when metadata or a chunk expires during preparation', async () => {
    const now = new Date().toISOString();
    const past = Timestamp.fromMillis(Date.parse(now) - 1);
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ expireAt: past });
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-expired',
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      })
    ).resolves.toEqual({ status: 'expired' });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc('attachment-1')
          .get()
      ).data()?.['status']
    ).toBe('expired');

    await repository.captureContextAttachment(
      captureInput({
        attachmentId: 'attachment-2',
        preparationRequestId: 'request-2',
        preparationRequestFingerprint: 'fingerprint-2',
      })
    );
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-2',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-2',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    const prepared = preparedSnapshot();
    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-2',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-2',
      snapshotId: 'snapshot-expired-chunk',
      prepared,
      maxChunkCount: 400,
      now,
    });
    if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');
    const chunkId = persisted.manifest.chunkIds[0];
    if (chunkId === undefined) throw new Error('Expected chunk id');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(chunkId)
      .update({ expireAt: past });
    await expect(
      repository.completeContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-2',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-2',
        snapshotId: 'snapshot-expired-chunk',
        manifest: persisted.manifest,
        prepared,
        now,
      })
    ).resolves.toEqual({ status: 'missing_chunks' });
  });

  it('returns stable fail-closed states for stale publication, attempts, manifests, and retries', async () => {
    const now = new Date().toISOString();
    await expect(
      repository.failQueuedContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'missing-attachment',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        error: { code: 'PUBLISH_FAILED', message: 'Safe failure' },
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 2,
        claimId: 'claim-wrong-attempt',
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      })
    ).resolves.toEqual({ status: 'stale' });
    await expect(
      repository.requeueContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        updatedAt: now,
      })
    ).resolves.toEqual({ status: 'invalid_state' });
    await expect(
      repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: 'different-generation',
        attempt: 1,
        claimId: 'claim-stale-generation',
        snapshotId: 'snapshot-stale-generation',
        prepared: preparedSnapshot(),
        maxChunkCount: 400,
        now,
      })
    ).resolves.toEqual({ status: 'stale' });

    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    await expect(
      repository.completeContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        snapshotId: 'snapshot-invalid-manifest',
        manifest: { chunkIds: ['duplicate', 'duplicate'], chunkCount: 2 },
        prepared: preparedSnapshot(),
        now,
      })
    ).resolves.toEqual({ status: 'missing_chunks' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ expireAt: Timestamp.fromMillis(Date.parse(now) - 1) });
    await expect(
      repository.failContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        error: { code: 'FAILED', message: 'Safe failure' },
        now,
      })
    ).resolves.toEqual({ status: 'expired' });
    await expect(
      repository.requeueContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        updatedAt: now,
      })
    ).resolves.toEqual({ status: 'expired' });
  });

  it('fails snapshot persistence when attachment TTL storage is expired or malformed', async () => {
    const now = new Date().toISOString();
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ expireAt: Timestamp.fromMillis(Date.parse(now) - 1) });
    await expect(
      repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        snapshotId: 'snapshot-expired',
        prepared: preparedSnapshot(),
        maxChunkCount: 400,
        now,
      })
    ).resolves.toEqual({ status: 'expired' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
      .doc('attachment-1')
      .update({ expireAt: 'malformed' });
    await expect(
      repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-1',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        snapshotId: 'snapshot-malformed-ttl',
        prepared: preparedSnapshot(),
        maxChunkCount: 400,
        now,
      })
    ).resolves.toEqual({ status: 'expired' });
  });

  it('fails ready publication for a lost fence, expired metadata, wrong manifest id, or changed payload', async () => {
    const now = new Date().toISOString();
    const scenarios = ['stale', 'expired', 'wrong_id', 'changed_payload'] as const;
    for (const [index, scenario] of scenarios.entries()) {
      const attachmentId = `attachment-complete-${String(index)}`;
      const snapshotId = `snapshot-complete-${String(index)}`;
      const claimId = `claim-complete-${String(index)}`;
      await repository.captureContextAttachment(
        captureInput({
          attachmentId,
          preparationRequestId: `request-complete-${String(index)}`,
          preparationRequestFingerprint: `fingerprint-complete-${String(index)}`,
        })
      );
      await repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId,
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      });
      const prepared = preparedSnapshot();
      const persisted = await repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId,
        snapshotId,
        prepared,
        maxChunkCount: 400,
        now,
      });
      if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');
      let manifest = persisted.manifest;
      if (scenario === 'stale') {
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc(attachmentId)
          .update({ preparationClaimId: 'replacement-claim' });
      } else if (scenario === 'expired') {
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc(attachmentId)
          .update({ expireAt: Timestamp.fromMillis(Date.parse(now) - 1) });
      } else if (scenario === 'wrong_id') {
        manifest = { chunkIds: ['wrong-chunk-id'], chunkCount: 1 };
      } else {
        const chunkId = manifest.chunkIds[0];
        if (chunkId === undefined) throw new Error('Expected chunk id');
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc(chunkId)
          .update({ payload: Buffer.from('{}', 'utf8').toString('base64') });
      }

      const completed = await repository.completeContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId,
        snapshotId,
        manifest,
        prepared,
        now,
      });
      expect(completed.status).toBe(
        scenario === 'stale'
          ? 'stale'
          : scenario === 'expired'
            ? 'expired'
            : 'missing_chunks'
      );
    }
  });

  it('keeps optional prepared metadata exact when publishing ready', async () => {
    const now = new Date().toISOString();
    const preparedWithRange = preparedSnapshot({
      confirmationToken: 'opaque-confirmation',
      requiresConfirmation: true,
    });
    const { eventRange: _eventRange, ...prepared } = preparedWithRange;
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-optional',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-optional',
      snapshotId: 'snapshot-optional',
      prepared,
      maxChunkCount: 400,
      now,
    });
    if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');
    const completed = await repository.completeContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-optional',
      snapshotId: 'snapshot-optional',
      manifest: persisted.manifest,
      prepared,
      now,
    });
    expect(completed.status).toBe('ready');
    if (completed.status !== 'ready') throw new Error('Expected ready attachment');
    expect(completed.attachment.eventRange).toBeUndefined();
    expect(completed.attachment.confirmationToken).toBe('opaque-confirmation');
    expect(completed.attachment.requiresConfirmation).toBe(true);
  });

  it('fails final metadata reads closed when TTL deletion races a successful transition', async () => {
    const now = new Date().toISOString();
    for (const [index, attachmentId] of [
      'attachment-fail-queued-race',
      'attachment-fail-race',
      'attachment-requeue-race',
      'attachment-complete-race',
    ].entries()) {
      await repository.captureContextAttachment(
        captureInput({
          attachmentId,
          preparationRequestId: `request-race-${String(index)}`,
          preparationRequestFingerprint: `fingerprint-race-${String(index)}`,
        })
      );
    }
    for (const attachmentId of [
      'attachment-fail-race',
      'attachment-requeue-race',
      'attachment-complete-race',
    ]) {
      await repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: `claim-${attachmentId}`,
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      });
    }
    await repository.failContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-requeue-race',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-attachment-requeue-race',
      error: { code: 'FAILED', message: 'Safe failure' },
      now,
    });
    const prepared = preparedSnapshot();
    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-complete-race',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-attachment-complete-race',
      snapshotId: 'snapshot-complete-race',
      prepared,
      maxChunkCount: 400,
      now,
    });
    if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');

    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let deleteTarget = '';
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (operation) => {
      const result = await originalRunTransaction(operation);
      if (deleteTarget !== '') {
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc(deleteTarget)
          .delete();
        deleteTarget = '';
      }
      return result;
    });

    deleteTarget = 'attachment-fail-queued-race';
    await expect(
      repository.failQueuedContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-fail-queued-race',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        error: { code: 'PUBLISH_FAILED', message: 'Safe failure' },
      })
    ).resolves.toEqual({ status: 'not_found' });

    deleteTarget = 'attachment-fail-race';
    await expect(
      repository.failContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-fail-race',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-attachment-fail-race',
        error: { code: 'FAILED', message: 'Safe failure' },
        now,
      })
    ).resolves.toEqual({ status: 'not_found' });

    deleteTarget = 'attachment-requeue-race';
    await expect(
      repository.requeueContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-requeue-race',
        expectedSessionGenerationId: GENERATION_ID,
        updatedAt: now,
      })
    ).resolves.toEqual({ status: 'not_found' });

    deleteTarget = 'attachment-complete-race';
    await expect(
      repository.completeContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-complete-race',
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-attachment-complete-race',
        snapshotId: 'snapshot-complete-race',
        manifest: persisted.manifest,
        prepared,
        now,
      })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('fails closed when ready metadata is corrupted after commit and ignores an invalid optional range', async () => {
    const now = new Date().toISOString();
    const corruptions: {
      update: Record<string, unknown>;
      rejects: boolean;
      replaceWithNull?: boolean;
    }[] = [
      { update: {}, rejects: true, replaceWithNull: true },
      { update: { capturedAt: null }, rejects: true },
      { update: { captureRange: { from: null, to: null } }, rejects: true },
      { update: { chatId: null }, rejects: true },
      { update: { baseContextVersion: -1 }, rejects: true },
      { update: { status: 'unknown-status' }, rejects: true },
      { update: { capturedAt: { toDate: () => 'not-a-date' } }, rejects: true },
      { update: { eventRange: { from: null, to: null } }, rejects: false },
    ];
    for (const [index, corruption] of corruptions.entries()) {
      const attachmentId = `attachment-corruption-${String(index)}`;
      const claimId = `claim-corruption-${String(index)}`;
      const snapshotId = `snapshot-corruption-${String(index)}`;
      await repository.captureContextAttachment(
        captureInput({
          attachmentId,
          preparationRequestId: `request-corruption-${String(index)}`,
          preparationRequestFingerprint: `fingerprint-corruption-${String(index)}`,
        })
      );
      await repository.claimContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId,
        now,
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      });
      const prepared = preparedSnapshot();
      const persisted = await repository.persistContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId,
        snapshotId,
        prepared,
        maxChunkCount: 400,
        now,
      });
      if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');
      const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
      const transactionSpy = vi
        .spyOn(fakeFirestore, 'runTransaction')
        .mockImplementation(async (operation) => {
          const result = await originalRunTransaction(operation);
          if (
            typeof result === 'object' &&
            result !== null &&
            'status' in result &&
            result.status === 'ready'
          ) {
            if (corruption.replaceWithNull === true) {
              fakeFirestore.seedCollection(
                WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
                [
                  {
                    id: attachmentId,
                    data: null as unknown as Record<string, unknown>,
                  },
                ]
              );
            } else {
              await fakeFirestore
                .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
                .doc(attachmentId)
                .update(corruption.update);
            }
          }
          return result;
        });
      const completion = repository.completeContextAttachmentPreparation({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId,
        snapshotId,
        manifest: persisted.manifest,
        prepared,
        now,
      });
      if (corruption.rejects) {
        await expect(completion).rejects.toThrow('Invalid context attachment document');
      } else {
        const result = await completion;
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') throw new Error('Expected ready attachment');
        expect(result.attachment.eventRange).toBeUndefined();
      }
      transactionSpy.mockRestore();
    }
  });

  it('deletes only chunks belonging to the exact lost preparation fence', async () => {
    const now = new Date().toISOString();
    const prepared = preparedSnapshot();
    await repository.claimContextAttachmentPreparation({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now,
      leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
    const persisted = await repository.persistContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      snapshotId: 'snapshot-delete',
      prepared,
      maxChunkCount: 400,
      now,
    });
    if (persisted.status !== 'saved') throw new Error('Expected saved snapshot');

    await repository.deleteContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'wrong-claim',
      snapshotId: 'snapshot-delete',
      chunkIds: persisted.manifest.chunkIds,
    });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .get()
      ).size
    ).toBe(persisted.manifest.chunkCount);

    await repository.deleteContextAttachmentPreparedSnapshot({
      userId: USER_ID,
      sessionId: SESSION_ID,
      attachmentId: 'attachment-1',
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      snapshotId: 'snapshot-delete',
      chunkIds: persisted.manifest.chunkIds,
    });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .get()
      ).size
    ).toBe(0);
  });
});
