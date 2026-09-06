import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Timestamp,
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import {
  CASCADE_DELETE_BATCH_SIZE,
  CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS,
  CONTEXT_CHUNK_MAX_BYTES,
  createConversationAssistantRepository,
  resolveConversationAssistantInitialPreparationChunkLimit,
  TRANSCRIPT_CHUNK_MAX_BYTES,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from '../../infra/firestore/conversationAssistantRepository.js';
import type {
  ConversationAssistantContextResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';
import { createConversationAssistantDeletionToken } from '../../domain/conversation-assistant/deletionToken.js';
import { WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION } from '../../infra/firestore/conversationAssistantContextAttachmentRepository.js';
import { WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION } from '../../infra/firestore/conversationAssistantTurnRequestRepository.js';
import { createPrivateWhatsAppErasureRepository } from '../../infra/firestore/privateWhatsAppErasureRepository.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';

function makeSession(
  overrides: Partial<ConversationAssistantSession> = {}
): ConversationAssistantSession {
  return {
    id: 'whatsapp_conv_session_1',
    userId: 'user-123',
    chatId: 'chat-123',
    sourceAccountId: 'source-account-123',
    sourceAccountGeneration: 'account-generation-123',
    chatDisplayName: 'Alice',
    status: 'active',
    range: { from: '2026-06-30T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
    effectiveRange: { from: '2026-06-30T10:00:00.000Z', to: '2026-06-30T10:00:00.000Z' },
    model: 'or:google/gemini-3.5-flash',
    transcriptSha256: 'hash',
    transcriptMessageCount: 1,
    transcriptText: '[2026-06-30T10:00:00.000Z] Alice: hello',
    assistantRoleLabel: 'Doctor',
    omitted: {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    },
    title: 'Question',
    createdAt: '2026-06-30T10:00:00.000Z',
    updatedAt: '2026-06-30T10:00:00.000Z',
    ...overrides,
  };
}

function makeTurn(overrides: Partial<ConversationAssistantTurn> = {}): ConversationAssistantTurn {
  return {
    id: 'whatsapp_conv_turn_1',
    sessionId: 'whatsapp_conv_session_1',
    userId: 'user-123',
    role: 'user',
    text: 'What happened?',
    createdAt: '2026-06-30T10:01:00.000Z',
    ...overrides,
  };
}

function makeContextMessage(
  id: string
): ConversationAssistantContextResult['messages'][number] {
  return {
    id,
    eventTimestamp: '2026-07-21T10:00:00.000Z',
    importedAt: '2026-07-21T10:00:01.000Z',
    direction: 'incoming',
    speakerLabel: 'Them',
    messageType: 'text',
    contentKind: 'text',
    content: `Context ${id}`,
  };
}

function deletionInput(
  session: ConversationAssistantSession,
  userId = session.userId
): { sessionId: string; userId: string; deletionToken: string } {
  return {
    sessionId: session.id,
    userId,
    deletionToken: createConversationAssistantDeletionToken(session),
  };
}

describe('conversationAssistantRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createConversationAssistantRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createConversationAssistantRepository();
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: 'user-123',
        data: {
          userId: 'user-123',
          sourceAccountId: 'source-account-123',
          generationId: 'account-generation-123',
          status: 'active',
        },
      },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
      {
        id: 'chat-123',
        data: {
          userId: 'user-123',
          sourceAccountId: 'source-account-123',
        },
      },
    ]);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('keeps cascade-delete transactions below a conservative Firestore payload budget', () => {
    const largestChunkBytes = Math.max(TRANSCRIPT_CHUNK_MAX_BYTES, CONTEXT_CHUNK_MAX_BYTES);

    expect(CASCADE_DELETE_BATCH_SIZE * largestChunkBytes).toBeLessThanOrEqual(5_000_000);
  });

  it('enforces the initial preparation finalization chunk boundary without materializing payloads', () => {
    const withinLimit = vi.fn(() => 'within');
    const overLimit = vi.fn(() => 'over');

    expect(
      resolveConversationAssistantInitialPreparationChunkLimit({
        chunkCounts: [498, 1],
        withinLimit,
        overLimit,
      })
    ).toBe('within');
    expect(
      resolveConversationAssistantInitialPreparationChunkLimit({
        chunkCounts: [499, 1],
        withinLimit,
        overLimit,
      })
    ).toBe('over');
    expect(withinLimit).toHaveBeenCalledOnce();
    expect(overLimit).toHaveBeenCalledOnce();
  });

  it('revalidates and deletes at most one cascade document per transaction', async () => {
    const session = {
      ...makeSession(),
      generationId: 'generation-delete-one-at-a-time',
    } as ConversationAssistantSession;
    await repository.saveSession(session);
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
      Array.from({ length: 3 }, (_value, index) => ({
        id: `large-turn-${String(index)}`,
        data: {
          ...makeTurn({ id: `large-turn-${String(index)}` }),
          sessionGenerationId: session.generationId,
        },
      }))
    );
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let maximumReadsInOneTransaction = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(
      async (updateFn) =>
        await originalRunTransaction(async (transaction) => {
          let reads = 0;
          const instrumentedTransaction = new Proxy(transaction, {
            get(target, property, receiver): unknown {
              if (property === 'get') {
                return async (
                  ...args: Parameters<typeof target.get>
                ): Promise<Awaited<ReturnType<typeof target.get>>> => {
                  reads += 1;
                  maximumReadsInOneTransaction = Math.max(maximumReadsInOneTransaction, reads);
                  return await target.get(...args);
                };
              }
              const value = Reflect.get(target, property, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return await updateFn(instrumentedTransaction);
        })
    );

    await repository.deleteSession(deletionInput(session));

    expect(maximumReadsInOneTransaction).toBe(1);
  });

  it('stores private transcript text in chunks and lists only the owning user sessions', async () => {
    const transcriptText = `${'a'.repeat(TRANSCRIPT_CHUNK_MAX_BYTES)}b`;
    await repository.saveSession(makeSession({ transcriptText }));
    await repository.saveSession(
      makeSession({
        id: 'whatsapp_conv_session_other',
        userId: 'other-user',
        updatedAt: '2026-06-30T12:00:00.000Z',
      })
    );

    const loaded = await repository.getSessionById('whatsapp_conv_session_1');
    const listed = await repository.listSessionsByUserId('user-123');
    const storedDoc = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_1')
      .get();
    const firstChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc('whatsapp_conv_session_1_hash_000000')
      .get();
    const secondChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc('whatsapp_conv_session_1_hash_000001')
      .get();

    expect(loaded?.transcriptText).toBe(transcriptText);
    expect(listed.map((session) => session.id)).toEqual(['whatsapp_conv_session_1']);
    expect(storedDoc.data()?.['transcriptText']).toBeUndefined();
    expect(storedDoc.data()?.['transcriptStorage']).toEqual({
      type: 'chunks',
      chunkCount: 2,
      chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
      byteLength: TRANSCRIPT_CHUNK_MAX_BYTES + 1,
      snapshotId: 'hash',
    });
    expect(firstChunk.data()).toMatchObject({
      sessionId: 'whatsapp_conv_session_1',
      snapshotId: 'hash',
      chunkIndex: 0,
      text: 'a'.repeat(TRANSCRIPT_CHUNK_MAX_BYTES),
    });
    expect(secondChunk.data()).toMatchObject({
      sessionId: 'whatsapp_conv_session_1',
      snapshotId: 'hash',
      chunkIndex: 1,
      text: 'b',
    });
  });

  it('round-trips continuation watermarks without exposing transcript storage details', async () => {
    const continuation = {
      sourceAccountId: 'source-account-123',
      contextVersion: 0,
      contextEventThrough: '2026-07-01T00:00:00.000Z',
      contextChangeThrough: 7,
      contextChainSha256: 'a'.repeat(64),
      displayTimeZone: 'Europe/Warsaw',
      nextTurnSequence: 1,
      nextConversationRevision: 1,
      completedConversationRevision: 0,
      attachmentCount: 0,
      totalAttachedMessageCount: 0,
      totalAttachedOmittedCount: 0,
    };
    await repository.saveSession(makeSession({ continuation }));

    const loaded = await repository.getSessionById('whatsapp_conv_session_1');

    expect(loaded?.continuation).toEqual(continuation);
  });

  it('stores and lists turns chronologically by session', async () => {
    await repository.saveSession(makeSession());
    await repository.saveTurn(
      makeTurn({ id: 'turn-2', role: 'assistant', createdAt: '2026-06-30T10:02:00.000Z' })
    );
    await repository.saveTurn(
      makeTurn({ id: 'turn-1', role: 'user', createdAt: '2026-06-30T10:01:00.000Z' })
    );
    await repository.saveTurn(makeTurn({ id: 'foreign-turn', sessionId: 'other-session' }));

    const listed = await repository.listTurnsBySessionId('whatsapp_conv_session_1');
    const storedDoc = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc('turn-2')
      .get();

    expect(listed.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2']);
    expect(storedDoc.data()?.['role']).toBe('assistant');
  });

  it('hides every public session read immediately after erasure starts before any delete batch', async () => {
    const session = makeSession({
      generationId: 'session-generation-read-fence',
      contextSnapshotId: 'snapshot-read-fence',
    });
    const includedMessage = {
      id: 'message-read-fence',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'text' as const,
      contentKind: 'text' as const,
      content: 'Must disappear as soon as erasure starts',
    };
    await repository.saveSession(session);
    await repository.saveTurn(makeTurn({ sessionId: session.id }));
    await repository.saveContextSnapshot(
      session.id,
      session.userId,
      'snapshot-read-fence',
      { messages: [includedMessage], omittedMessages: [] },
      session.generationId
    );

    const erasure = createPrivateWhatsAppErasureRepository();
    await expect(
      erasure.start({
        sourceAccountId: 'source-account-123',
        userId: session.userId,
        erasureRequestId: 'erasure-read-fence',
        now: '2026-07-21T10:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, value: { status: 'created' } });

    await expect(repository.getSessionById(session.id)).resolves.toBeNull();
    await expect(
      repository.getSessionSnapshotById({ sessionId: session.id, userId: session.userId })
    ).resolves.toBeNull();
    await expect(repository.listSessionsByUserId(session.userId)).resolves.toEqual([]);
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
    await expect(
      repository.getContextPage(session.id, 'snapshot-read-fence', {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: 1,
        omittedMessageCount: 0,
      })
    ).resolves.toEqual({ messages: [], omittedMessages: [], snapshotAvailable: false });
  });

  it('keeps same-generation disabled history readable but hides missing and replacement accounts', async () => {
    const session = makeSession({ generationId: 'session-generation-account-read-fence' });
    await repository.saveSession(session);
    await repository.saveTurn(makeTurn({ sessionId: session.id }));
    const accountRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(session.userId);
    const sameGenerationAccount = {
      userId: session.userId,
      sourceAccountId: session.sourceAccountId,
      generationId: session.sourceAccountGeneration,
      status: 'disabled',
    };

    await accountRef.set(sameGenerationAccount);
    await expect(repository.getSessionById(session.id)).resolves.toMatchObject({ id: session.id });
    await expect(repository.listSessionsByUserId(session.userId)).resolves.toHaveLength(1);
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toHaveLength(1);

    for (const unsafeAccount of [
      undefined,
      { ...sameGenerationAccount, generationId: 'replacement-generation', status: 'active' },
      { ...sameGenerationAccount, sourceAccountId: 'replacement-source', status: 'active' },
    ]) {
      if (unsafeAccount === undefined) await accountRef.delete();
      else await accountRef.set(unsafeAccount);
      await expect(repository.getSessionById(session.id)).resolves.toBeNull();
      await expect(repository.listSessionsByUserId(session.userId)).resolves.toEqual([]);
      await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
    }
  });

  it('round-trips durable request ordering, revision, and immutable attachment summary fields', async () => {
    const durableTurn = {
      ...makeTurn(),
      sequence: 3,
      conversationRevision: 2,
      requestId: 'request-durable-1',
      kind: 'context_attachment_question' as const,
      contextAttachmentId: 'attachment-1',
      contextAttachment: {
        id: 'attachment-1',
        capturedAt: '2026-07-21T10:00:00.000Z',
        captureRange: {
          from: '2026-07-18T00:00:00.000Z',
          to: '2026-07-21T10:00:00.000Z',
        },
        eventRange: {
          from: '2026-07-19T08:00:00.000Z',
          to: '2026-07-20T09:00:00.000Z',
        },
        counts: {
          included: 2,
          excluded: 1,
          newlyAvailable: 0,
          edited: 1,
          redacted: 1,
          deleted: 0,
          reactionsChanged: 1,
          lateIngested: 0,
          completedTranscriptions: 0,
        },
        omitted: {
          mediaOnly: 1,
          failedTranscriptions: 0,
          pendingTranscriptions: 0,
          nonText: 0,
          overLimit: 0,
        },
      },
      acknowledgment: 'Added the requested context.',
    } as ConversationAssistantTurn & {
      sequence: number;
      conversationRevision: number;
      requestId: string;
      kind: 'context_attachment_question';
      contextAttachmentId: string;
      contextAttachment: Record<string, unknown>;
    };

    await repository.saveSession(makeSession());
    await repository.saveTurn(durableTurn);
    const [loaded] = await repository.listTurnsBySessionId(durableTurn.sessionId);

    expect(loaded).toMatchObject({
      sequence: 3,
      conversationRevision: 2,
      requestId: 'request-durable-1',
      kind: 'context_attachment_question',
      contextAttachmentId: 'attachment-1',
      contextAttachment: durableTurn.contextAttachment,
      acknowledgment: 'Added the requested context.',
    });
  });

  it('orders durable turns by their reserved sequence even when timestamps disagree', async () => {
    await repository.saveSession(makeSession());
    await repository.saveTurn({
      ...makeTurn({ id: 'turn-sequence-4', createdAt: '2026-06-30T10:00:00.000Z' }),
      sequence: 4,
      conversationRevision: 2,
      requestId: 'request-2',
      kind: 'message',
    });
    await repository.saveTurn({
      ...makeTurn({ id: 'turn-sequence-3', createdAt: '2026-06-30T11:00:00.000Z' }),
      sequence: 3,
      conversationRevision: 2,
      requestId: 'request-2',
      kind: 'message',
    });

    const loaded = await repository.listTurnsBySessionId('whatsapp_conv_session_1');

    expect(loaded.map((candidate) => candidate.id)).toEqual(['turn-sequence-3', 'turn-sequence-4']);
  });

  it('orders equal-sequence and equal-time turns by stable document id', async () => {
    await repository.saveSession(makeSession());
    for (const id of ['turn-tie-b', 'turn-tie-a']) {
      await repository.saveTurn({
        ...makeTurn({ id, createdAt: '2026-06-30T10:01:00.000Z' }),
        sequence: 3,
        conversationRevision: 2,
        requestId: 'request-tie',
        kind: 'message',
      });
    }

    const loaded = await repository.listTurnsBySessionId('whatsapp_conv_session_1');

    expect(loaded.map((candidate) => candidate.id)).toEqual(['turn-tie-a', 'turn-tie-b']);
  });

  it('drops malformed immutable attachment summaries while hydrating turns', async () => {
    await repository.saveSession(makeSession());
    const validCounts = {
      included: 1,
      excluded: 0,
      newlyAvailable: 1,
      edited: 0,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    };
    const validOmitted = {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    };
    const baseSummary = {
      id: 'attachment-corrupt',
      capturedAt: '2026-07-21T10:00:00.000Z',
      captureRange: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T10:00:00.000Z',
      },
      counts: validCounts,
      omitted: validOmitted,
    };
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc('turn-valid-summary-without-event-range')
      .set({
        ...makeTurn({ id: 'turn-valid-summary-without-event-range' }),
        contextAttachment: baseSummary,
      });
    for (const [index, contextAttachment] of [
      { ...baseSummary, captureRange: null },
      { ...baseSummary, counts: { ...validCounts, included: -1 } },
      { ...baseSummary, omitted: { ...validOmitted, mediaOnly: -1 } },
    ].entries()) {
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
        .doc(`turn-corrupt-summary-${String(index)}`)
        .set({
          ...makeTurn({ id: `turn-corrupt-summary-${String(index)}` }),
          contextAttachment,
        });
    }

    const loaded = await repository.listTurnsBySessionId('whatsapp_conv_session_1');

    expect(loaded).toHaveLength(4);
    expect(loaded.filter((turn) => turn.contextAttachment !== undefined)).toHaveLength(1);
    expect(
      loaded.find((turn) => turn.id === 'turn-valid-summary-without-event-range')
        ?.contextAttachment
    ).toEqual(baseSummary);
  });

  it('deletes every owned session record and leaves foreign records untouched', async () => {
    const ownedSession = makeSession();
    await repository.saveSession(ownedSession);
    await repository.saveTurn(makeTurn());
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
      {
        id: 'owned-context',
        data: {
          sessionId: 'whatsapp_conv_session_1',
          userId: 'user-123',
          snapshotId: 'snapshot-1',
        },
      },
      {
        id: 'foreign-context',
        data: { sessionId: 'foreign-session', userId: 'other-user', snapshotId: 'snapshot-2' },
      },
    ]);
    await repository.saveSession(
      makeSession({ id: 'foreign-session', userId: 'other-user', transcriptSha256: 'foreign-hash' })
    );
    await repository.saveTurn(
      makeTurn({ id: 'foreign-turn', sessionId: 'foreign-session', userId: 'other-user' })
    );

    await repository.deleteSession(deletionInput(ownedSession, 'other-user'));
    expect(await repository.getSessionById('whatsapp_conv_session_1')).not.toBeNull();

    await repository.deleteSession(deletionInput(ownedSession));

    await expect(repository.getSessionById('whatsapp_conv_session_1')).resolves.toBeNull();
    await expect(repository.listTurnsBySessionId('whatsapp_conv_session_1')).resolves.toEqual([]);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
          .doc('whatsapp_conv_session_1_hash_000000')
          .get()
      ).exists
    ).toBe(false);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('owned-context')
          .get()
      ).exists
    ).toBe(false);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc('foreign-session')
          .get()
      ).exists
    ).toBe(true);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .doc('foreign-turn')
          .get()
      ).exists
    ).toBe(true);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('foreign-context')
          .get()
      ).exists
    ).toBe(true);

    await expect(repository.deleteSession(deletionInput(ownedSession))).resolves.toBeUndefined();
  });

  it('cascades generated-session deletion through attachments and durable request records', async () => {
    const session = {
      ...makeSession(),
      generationId: 'generation-cascade-new-context',
    } as ConversationAssistantSession;
    await repository.saveSession(session);
    const ownedDocument = {
      sessionId: session.id,
      userId: session.userId,
      sessionGenerationId: session.generationId,
    };
    const replacementGenerationDocument = {
      sessionId: session.id,
      userId: session.userId,
      sessionGenerationId: 'generation-replacement',
    };
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION, [
      { id: 'owned-attachment', data: { ...ownedDocument, status: 'ready' } },
      {
        id: 'replacement-attachment',
        data: { ...replacementGenerationDocument, status: 'ready' },
      },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION, [
      { id: 'owned-request', data: { ...ownedDocument, status: 'completed' } },
      {
        id: 'replacement-request',
        data: { ...replacementGenerationDocument, status: 'completed' },
      },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
      {
        id: 'owned-attachment-chunk',
        data: { ...ownedDocument, attachmentId: 'owned-attachment' },
      },
      {
        id: 'replacement-attachment-chunk',
        data: { ...replacementGenerationDocument, attachmentId: 'replacement-attachment' },
      },
    ]);

    await repository.deleteSession(deletionInput(session));

    for (const [collection, id] of [
      [WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION, 'owned-attachment'],
      [WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION, 'owned-request'],
      [WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, 'owned-attachment-chunk'],
    ] as const) {
      expect((await fakeFirestore.collection(collection).doc(id).get()).exists).toBe(false);
    }
    for (const [collection, id] of [
      [WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION, 'replacement-attachment'],
      [WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION, 'replacement-request'],
      [WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, 'replacement-attachment-chunk'],
    ] as const) {
      expect((await fakeFirestore.collection(collection).doc(id).get()).exists).toBe(true);
    }
  });

  it('persists turns only while their owned session still exists', async () => {
    const session = makeSession();
    const userTurn = makeTurn();
    const assistantTurn = makeTurn({
      id: 'assistant-turn',
      role: 'assistant',
      text: 'Answer',
      createdAt: '2026-06-30T10:02:00.000Z',
    });
    await repository.saveSession(session);

    await expect(repository.saveTurnIfSessionExists(userTurn, session.generationId)).resolves.toBe(
      true
    );
    await expect(
      repository.saveAssistantTurnAndTouchSession({ session, turn: assistantTurn })
    ).resolves.toBe(true);
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toHaveLength(2);
    await expect(repository.getSessionById(session.id)).resolves.toMatchObject({
      updatedAt: assistantTurn.createdAt,
      lastTurnAt: assistantTurn.createdAt,
    });

    await repository.deleteSession(deletionInput(session));
    await expect(repository.saveTurnIfSessionExists(userTurn, session.generationId)).resolves.toBe(
      false
    );
    await expect(
      repository.saveAssistantTurnAndTouchSession({ session, turn: assistantTurn })
    ).resolves.toBe(false);
    await expect(repository.getSessionById(session.id)).resolves.toBeNull();
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
  });

  it('atomically fences legacy turn writes when private-account erasure starts', async () => {
    const session = makeSession();
    await repository.saveSession(session);
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(session.userId)
      .update({ status: 'disabled', erasureStatus: 'erasing' });

    await expect(
      repository.saveTurnIfSessionExists(makeTurn({ id: 'fenced-user-turn' }), session.generationId)
    ).resolves.toBe(false);
    await expect(
      repository.saveAssistantTurnAndTouchSession({
        session,
        turn: makeTurn({
          id: 'fenced-assistant-turn',
          role: 'assistant',
          text: 'Must not persist',
        }),
      })
    ).resolves.toBe(false);
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
  });

  it('fails closed for every legacy source lookup and account-generation fence', async () => {
    const legacySession = makeSession({ id: 'legacy-source-fence-session' });
    delete legacySession.sourceAccountId;
    delete legacySession.sourceAccountGeneration;
    await repository.saveSession(legacySession);
    const save = async (id: string): Promise<boolean> =>
      await repository.saveTurnIfSessionExists(
        makeTurn({ id, sessionId: legacySession.id }),
        legacySession.generationId
      );
    const chatRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(legacySession.chatId);
    const accountRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(legacySession.userId);
    const validChat = {
      userId: legacySession.userId,
      sourceAccountId: 'source-account-123',
    };
    const validAccount = {
      userId: legacySession.userId,
      sourceAccountId: 'source-account-123',
      generationId: 'account-generation-123',
      status: 'active',
    };

    await chatRef.delete();
    await expect(save('missing-chat-turn')).resolves.toBe(false);
    await chatRef.set({ ...validChat, userId: 'foreign-user' });
    await expect(save('foreign-chat-turn')).resolves.toBe(false);
    await chatRef.set({ ...validChat, sourceAccountId: 42 });
    await expect(save('invalid-chat-source-turn')).resolves.toBe(false);
    await chatRef.set(validChat);

    await accountRef.delete();
    await expect(save('missing-account-turn')).resolves.toBe(false);
    await accountRef.set({ ...validAccount, userId: 'foreign-user' });
    await expect(save('foreign-account-turn')).resolves.toBe(false);
    await accountRef.set({ ...validAccount, sourceAccountId: 'replacement-source' });
    await expect(save('replacement-account-turn')).resolves.toBe(false);
    await accountRef.set({ ...validAccount, status: 'disabled' });
    await expect(save('disabled-account-turn')).resolves.toBe(false);
    await accountRef.set({ ...validAccount, erasureStatus: 'erasing' });
    await expect(save('erasing-account-turn')).resolves.toBe(false);
    await accountRef.set({
      userId: validAccount.userId,
      sourceAccountId: validAccount.sourceAccountId,
      status: validAccount.status,
    });
    await expect(save('legacy-generation-turn')).resolves.toBe(true);

    const fencedSession = makeSession({
      id: 'generated-source-fence-session',
      sourceAccountId: validAccount.sourceAccountId,
      sourceAccountGeneration: validAccount.generationId,
    });
    await repository.saveSession(fencedSession);
    await accountRef.set(validAccount);
    await expect(
      repository.saveTurnIfSessionExists(
        makeTurn({ id: 'generated-fence-turn', sessionId: fencedSession.id }),
        fencedSession.generationId
      )
    ).resolves.toBe(true);
    await accountRef.set({ ...validAccount, generationId: 'replacement-generation' });
    await expect(
      repository.saveTurnIfSessionExists(
        makeTurn({ id: 'stale-generation-turn', sessionId: fencedSession.id }),
        fencedSession.generationId
      )
    ).resolves.toBe(false);
  });

  it('touches a legacy session that has no transcript storage metadata', async () => {
    const session = makeSession();
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id)
      .set(session);
    const assistantTurn = makeTurn({
      id: 'legacy-storage-assistant-turn',
      role: 'assistant',
      text: 'Legacy answer',
      createdAt: '2026-06-30T10:03:00.000Z',
    });

    await expect(
      repository.saveAssistantTurnAndTouchSession({ session, turn: assistantTurn })
    ).resolves.toBe(true);
    const stored = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id)
      .get();
    expect(stored.data()?.['transcriptStorage']).toMatchObject({
      type: 'chunks',
      chunkCount: 0,
    });
  });

  it('rejects delayed turns from an older generation of the same session id', async () => {
    const originalSession = {
      ...makeSession(),
      generationId: 'generation-original',
    } as ConversationAssistantSession;
    const replacementSession = {
      ...makeSession({ updatedAt: '2026-06-30T11:00:00.000Z' }),
      generationId: 'generation-replacement',
    } as ConversationAssistantSession;
    const saveTurnForGeneration = repository.saveTurnIfSessionExists as unknown as (
      turn: ConversationAssistantTurn,
      expectedGenerationId: string | undefined
    ) => Promise<boolean>;

    await repository.saveSession(originalSession);
    await repository.saveSession(replacementSession);

    await expect(
      saveTurnForGeneration(makeTurn({ id: 'late-user-turn' }), 'generation-original')
    ).resolves.toBe(false);
    await expect(
      repository.saveAssistantTurnAndTouchSession({
        session: originalSession,
        turn: makeTurn({ id: 'late-assistant-turn', role: 'assistant', text: 'Late answer' }),
      })
    ).resolves.toBe(false);
    await expect(repository.listTurnsBySessionId(originalSession.id)).resolves.toEqual([]);
    await expect(repository.getSessionById(originalSession.id)).resolves.toMatchObject({
      generationId: 'generation-replacement',
      updatedAt: replacementSession.updatedAt,
    });
  });

  it('keeps interrupted cascade deletion hidden and resumes it in bounded batches', async () => {
    const session = {
      ...makeSession(),
      generationId: 'generation-delete',
    } as ConversationAssistantSession;
    await repository.saveSession(session);
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
      Array.from({ length: 251 }, (_value, index) => ({
        id: `turn-${String(index)}`,
        data: {
          ...makeTurn({ id: `turn-${String(index)}` }),
          sessionGenerationId: 'generation-delete',
        },
      }))
    );
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
      {
        id: 'context-delete',
        data: {
          sessionId: session.id,
          userId: session.userId,
          sessionGenerationId: 'generation-delete',
          snapshotId: 'snapshot-delete',
        },
      },
    ]);

    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionCount = 0;
    const transactionSpy = vi
      .spyOn(fakeFirestore, 'runTransaction')
      .mockImplementation(async (updateFn) => {
        transactionCount += 1;
        if (transactionCount === 3) throw new Error('interrupted cascade');
        return await originalRunTransaction(updateFn);
      });

    await expect(repository.deleteSession(deletionInput(session))).rejects.toThrow(
      'interrupted cascade'
    );
    const storedDuringDeletion = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id)
      .get();
    expect(storedDuringDeletion.exists).toBe(true);
    expect(storedDuringDeletion.data()?.['deletionStartedAt']).toEqual(expect.any(String));
    await expect(repository.getSessionById(session.id)).resolves.toBeNull();
    await expect(repository.listSessionsByUserId(session.userId)).resolves.toEqual([]);

    const saveTurnForGeneration = repository.saveTurnIfSessionExists as unknown as (
      turn: ConversationAssistantTurn,
      expectedGenerationId: string | undefined
    ) => Promise<boolean>;
    await expect(
      saveTurnForGeneration(makeTurn({ id: 'turn-during-delete' }), 'generation-delete')
    ).resolves.toBe(false);

    transactionSpy.mockRestore();
    await expect(repository.deleteSession(deletionInput(session))).resolves.toBeUndefined();
    expect(transactionCount).toBeGreaterThan(1);
    await expect(repository.getSessionById(session.id)).resolves.toBeNull();
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('context-delete')
          .get()
      ).exists
    ).toBe(false);
  });

  it('finishes idempotently when the deletion marker disappears before final cleanup', async () => {
    const session = makeSession({ transcriptText: '', transcriptSha256: '' });
    await repository.saveSession(session);
    const sessionRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id);
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (updateFn) => {
      transactionNumber += 1;
      if (transactionNumber === 2) await sessionRef.delete();
      return await originalRunTransaction(updateFn);
    });

    await expect(repository.deleteSession(deletionInput(session))).resolves.toBeUndefined();
    expect(transactionNumber).toBe(2);
  });

  it('deletes generation-less legacy data across more than one bounded query', async () => {
    const session = makeSession({ transcriptText: '', transcriptSha256: '' });
    await repository.saveSession(session);
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
      Array.from({ length: 21 }, (_value, index) => ({
        id: `legacy-turn-${String(index).padStart(2, '0')}`,
        data: {
          ...makeTurn({ id: `legacy-turn-${String(index).padStart(2, '0')}` }),
          sessionGenerationId: null,
        },
      }))
    );

    await repository.deleteSession(deletionInput(session));

    await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
  });

  it('does not let a stale conditional delete remove a replacement transcript chunk', async () => {
    const originalSession = {
      ...makeSession(),
      generationId: 'generation-original',
    } as ConversationAssistantSession;
    await repository.saveSession(originalSession);
    let releaseSlowDelete!: () => void;
    let reportSlowDeleteStarted!: () => void;
    const slowDeleteStarted = new Promise<void>((resolve) => {
      reportSlowDeleteStarted = resolve;
    });
    const releaseSlow = new Promise<void>((resolve) => {
      releaseSlowDelete = resolve;
    });
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (updateFn) => {
      transactionNumber += 1;
      if (transactionNumber === 2) {
        reportSlowDeleteStarted();
        await releaseSlow;
      }
      return await originalRunTransaction(updateFn);
    });

    const slowDeletion = repository.deleteSession({
      sessionId: originalSession.id,
      userId: originalSession.userId,
      deletionToken: createConversationAssistantDeletionToken(originalSession),
    });
    await slowDeleteStarted;
    await repository.deleteSession({
      sessionId: originalSession.id,
      userId: originalSession.userId,
      deletionToken: createConversationAssistantDeletionToken(originalSession),
    });
    const replacementSession = {
      ...makeSession({
        updatedAt: '2026-06-30T13:00:00.000Z',
        transcriptText: 'replacement transcript',
      }),
      generationId: 'generation-replacement',
    } as ConversationAssistantSession;
    await repository.saveSession(replacementSession);
    await repository.saveTurn(
      makeTurn({ id: 'replacement-turn', createdAt: '2026-06-30T13:01:00.000Z' })
    );

    releaseSlowDelete();
    await slowDeletion;

    await expect(repository.getSessionById(replacementSession.id)).resolves.toMatchObject({
      generationId: 'generation-replacement',
    });
    const replacementChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${replacementSession.id}_${replacementSession.transcriptSha256}_000000`)
      .get();
    expect(replacementChunk.data()).toMatchObject({
      sessionGenerationId: 'generation-replacement',
      text: 'replacement transcript',
    });
  });

  it('does not let a completed deletion retry remove a replacement session', async () => {
    const originalSession = {
      ...makeSession(),
      generationId: 'generation-original',
    } as ConversationAssistantSession;
    await repository.saveSession(originalSession);
    await repository.deleteSession(deletionInput(originalSession));

    const replacementSession = {
      ...makeSession({
        createdAt: '2026-06-30T13:00:00.000Z',
        updatedAt: '2026-06-30T13:00:00.000Z',
      }),
      generationId: 'generation-replacement',
    } as ConversationAssistantSession;
    await repository.saveSession(replacementSession);

    await repository.deleteSession(deletionInput(originalSession));

    await expect(repository.getSessionById(replacementSession.id)).resolves.toMatchObject({
      generationId: 'generation-replacement',
    });
  });

  it('fences queued preparation failure by session generation', async () => {
    const replacementSession = {
      ...makeSession({
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptText: '',
        transcriptSha256: '',
      }),
      generationId: 'generation-replacement',
    } as ConversationAssistantSession;
    await repository.saveSession(replacementSession);
    const failForGeneration = repository.failQueuedPreparation as unknown as (
      input: Parameters<typeof repository.failQueuedPreparation>[0] & {
        expectedGenerationId: string | undefined;
      }
    ) => ReturnType<typeof repository.failQueuedPreparation>;

    await expect(
      failForGeneration({
        sessionId: replacementSession.id,
        userId: replacementSession.userId,
        attempt: 1,
        expectedGenerationId: 'generation-original',
        error: { code: 'INTERNAL_ERROR', message: 'Old publish failed' },
        updatedAt: '2026-06-30T13:02:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(repository.getSessionById(replacementSession.id)).resolves.toMatchObject({
      generationId: 'generation-replacement',
      status: 'preparing',
    });
  });

  it('does not let a generation-less failure mutate a generated session', async () => {
    const replacementSession = {
      ...makeSession({
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptText: '',
        transcriptSha256: '',
      }),
      generationId: 'generation-replacement',
    } as ConversationAssistantSession;
    await repository.saveSession(replacementSession);

    await expect(
      repository.failQueuedPreparation({
        sessionId: replacementSession.id,
        userId: replacementSession.userId,
        attempt: 1,
        error: { code: 'INTERNAL_ERROR', message: 'Old publish failed' },
        updatedAt: '2026-06-30T13:02:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(repository.getSessionById(replacementSession.id)).resolves.toMatchObject({
      generationId: 'generation-replacement',
      status: 'preparing',
    });
  });

  it('does not overwrite or clean up transcript chunks owned by a replacement generation', async () => {
    const transcriptSha256 = 'shared-transcript';
    const replacementSession = {
      ...makeSession({
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationAttempt: 1,
        preparationClaimId: 'claim-replacement',
        transcriptText: 'replacement transcript',
        transcriptSha256,
      }),
      generationId: 'generation-replacement',
    } as ConversationAssistantSession;
    await repository.saveSession(replacementSession);
    const sharedChunkId = `${replacementSession.id}_${transcriptSha256}_000000`;

    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...replacementSession,
          status: 'ready',
          preparationStage: 'ready',
          preparationClaimId: 'claim-original',
          generationId: 'generation-original',
          transcriptSha256,
          transcriptText: 'replacement transcript',
        },
        attempt: 1,
        claimId: 'claim-original',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(false);
    const sharedChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(sharedChunkId)
      .get();
    expect(sharedChunk.data()).toMatchObject({
      sessionGenerationId: 'generation-replacement',
      text: 'replacement transcript',
    });
  });

  it('does not write context chunks after deletion has started', async () => {
    const session = {
      ...makeSession(),
      generationId: 'generation-delete-context',
      deletionStartedAt: '2026-06-30T13:00:00.000Z',
    } as ConversationAssistantSession;
    await repository.saveSession(session);
    const saveForGeneration = repository.saveContextSnapshot as unknown as (
      sessionId: string,
      userId: string,
      snapshotId: string,
      snapshot: { messages: []; omittedMessages: [] },
      expectedGenerationId: string | undefined
    ) => Promise<boolean>;

    await expect(
      saveForGeneration(
        session.id,
        session.userId,
        'blocked-context',
        { messages: [], omittedMessages: [] },
        session.generationId
      )
    ).resolves.toBe(false);
    const chunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .where('sessionId', '==', session.id)
      .get();
    expect(chunks.empty).toBe(true);
  });

  it('rejects context snapshots when the session is missing before or during chunk writes', async () => {
    const message = {
      id: 'context-race-message',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'text' as const,
      contentKind: 'text' as const,
      content: 'Context race',
    };
    await expect(
      repository.saveContextSnapshot('missing-session', 'user-123', 'missing-snapshot', {
        messages: [message],
        omittedMessages: [],
      })
    ).resolves.toBe(false);

    const session = {
      ...makeSession({ transcriptText: '', transcriptSha256: '' }),
      generationId: 'generation-context-race',
    } as ConversationAssistantSession;
    await repository.saveSession(session);
    const sessionRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id);
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (updateFn) => {
      transactionNumber += 1;
      if (transactionNumber === 2) await sessionRef.delete();
      return await originalRunTransaction(updateFn);
    });

    await expect(
      repository.saveContextSnapshot(
        session.id,
        session.userId,
        'racing-snapshot',
        { messages: [message], omittedMessages: [] },
        session.generationId
      )
    ).resolves.toBe(false);
  });

  it('cleans a context snapshot when its generation changes during a chunk write', async () => {
    const session = {
      ...makeSession({ transcriptText: '', transcriptSha256: '' }),
      generationId: 'generation-context-original',
    } as ConversationAssistantSession;
    await repository.saveSession(session);
    const message = {
      id: 'context-replacement-message',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'text' as const,
      contentKind: 'text' as const,
      content: 'Context replacement',
    };
    const sessionRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id);
    const storedData = (await sessionRef.get()).data();
    expect(storedData).toBeDefined();
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (updateFn) => {
      transactionNumber += 1;
      if (transactionNumber === 2) {
        await sessionRef.set({ ...storedData, generationId: 'generation-context-replacement' });
      }
      return await originalRunTransaction(updateFn);
    });

    await expect(
      repository.saveContextSnapshot(
        session.id,
        session.userId,
        'replacement-snapshot',
        { messages: [message], omittedMessages: [] },
        session.generationId
      )
    ).resolves.toBe(false);
    const chunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .where('snapshotId', '==', 'replacement-snapshot')
      .get();
    expect(chunks.empty).toBe(true);
  });

  it('rechecks source authority and the preparation claim for every context chunk write', async () => {
    const accountRef = fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-123');
    const activeAccount = (await accountRef.get()).data();
    if (activeAccount === undefined) throw new Error('Expected account fixture');

    for (const scenario of ['source', 'claim'] as const) {
      await accountRef.set(activeAccount);
      const pending = makeSession({
        id: `context-chunk-${scenario}-race`,
        generationId: `context-chunk-${scenario}-generation`,
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationAttempt: 1,
        preparationClaimId: `context-chunk-${scenario}-claim`,
        preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
        transcriptText: '',
        transcriptSha256: '',
      });
      await repository.saveSession(pending);
      const sessionRef = fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(pending.id);
      const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
      let transactionNumber = 0;
      const transactionSpy = vi
        .spyOn(fakeFirestore, 'runTransaction')
        .mockImplementation(async (operation) => {
          transactionNumber += 1;
          if (transactionNumber === 2) {
            if (scenario === 'source') await accountRef.delete();
            else await sessionRef.update({ preparationClaimId: 'replacement-claim' });
          }
          return await originalRunTransaction(operation);
        });

      await expect(
        repository.saveContextSnapshot(
          pending.id,
          pending.userId,
          `context-chunk-${scenario}-snapshot`,
          { messages: [makeContextMessage(`context-chunk-${scenario}`)], omittedMessages: [] },
          pending.generationId
        )
      ).resolves.toBe(false);
      transactionSpy.mockRestore();
    }
  });

  it('cleans pending context chunks when the final manifest loses its session fence', async () => {
    for (const scenario of ['missing', 'claim'] as const) {
      const pending = makeSession({
        id: `context-manifest-${scenario}-race`,
        generationId: `context-manifest-${scenario}-generation`,
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationAttempt: 1,
        preparationClaimId: `context-manifest-${scenario}-claim`,
        preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
        transcriptText: '',
        transcriptSha256: '',
      });
      await repository.saveSession(pending);
      const sessionRef = fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(pending.id);
      const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
      let transactionNumber = 0;
      const transactionSpy = vi
        .spyOn(fakeFirestore, 'runTransaction')
        .mockImplementation(async (operation) => {
          transactionNumber += 1;
          if (transactionNumber === 3) {
            if (scenario === 'missing') await sessionRef.delete();
            else await sessionRef.update({ preparationClaimId: 'replacement-claim' });
          }
          return await originalRunTransaction(operation);
        });

      await expect(
        repository.saveContextSnapshot(
          pending.id,
          pending.userId,
          `context-manifest-${scenario}-snapshot`,
          { messages: [makeContextMessage(`context-manifest-${scenario}`)], omittedMessages: [] },
          pending.generationId
        )
      ).resolves.toBe(false);
      transactionSpy.mockRestore();
      const chunks = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
        .where('sessionId', '==', pending.id)
        .get();
      expect(chunks.empty).toBe(true);
    }
  });

  it('stores a generation-less pending manifest without inventing a generation and fails closed', async () => {
    const pending = makeSession({
      id: 'context-manifest-legacy-generation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'context-manifest-legacy-claim',
      preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(pending);

    await expect(
      repository.saveContextSnapshot(
        pending.id,
        pending.userId,
        'context-manifest-legacy-snapshot',
        { messages: [makeContextMessage('context-manifest-legacy')], omittedMessages: [] }
      )
    ).resolves.toBe(true);
    const sessionDocument = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(pending.id)
      .get();
    expect(sessionDocument.data()?.['pendingContextStorage']).toMatchObject({
      snapshotId: 'context-manifest-legacy-snapshot',
      preparationClaimId: 'context-manifest-legacy-claim',
    });
    expect(
      (sessionDocument.data()?.['pendingContextStorage'] as Record<string, unknown>)[
        'sessionGenerationId'
      ]
    ).toBeUndefined();
    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...pending,
          status: 'ready',
          preparationStage: 'ready',
          contextSnapshotId: 'context-manifest-legacy-snapshot',
        },
        attempt: 1,
        claimId: 'context-manifest-legacy-claim',
        now: '2026-07-21T10:01:00.000Z',
      })
    ).resolves.toBe(false);
  });

  it('creates a session only once without overwriting a preparation claim', async () => {
    const sourceFence = {
      sourceAccountId: 'source-account-123',
      accountGeneration: 'account-generation-123',
    };
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: 'user-123',
        data: {
          userId: 'user-123',
          sourceAccountId: sourceFence.sourceAccountId,
          generationId: sourceFence.accountGeneration,
          status: 'active',
        },
      },
    ]);
    const queued = makeSession({
      sourceAccountId: sourceFence.sourceAccountId,
      sourceAccountGeneration: sourceFence.accountGeneration,
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: 1,
      transcriptSha256: '',
      transcriptText: '',
    });
    const created = await repository.createSessionIfAbsent(queued);
    expect(created.status).toBe('created');
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(queued.id)
          .get()
      ).data()
    ).toMatchObject({
      sourceAccountId: sourceFence.sourceAccountId,
      sourceAccountGeneration: sourceFence.accountGeneration,
    });
    const claim = await repository.claimPreparation({
      sessionId: queued.id,
      userId: queued.userId,
      attempt: 1,
      claimId: 'active-claim',
      now: '2026-06-30T10:01:00.000Z',
      leaseExpiresAt: '2026-06-30T10:06:00.000Z',
    });
    expect(claim.status).toBe('claimed');

    const repeated = await repository.createSessionIfAbsent(queued);

    expect(repeated).toMatchObject({
      status: 'existing',
      session: {
        preparationStage: 'loading_messages',
        preparationClaimId: 'active-claim',
      },
    });
    expect((await repository.getSessionById(queued.id))?.preparationClaimId).toBe('active-claim');

    const deleting = {
      ...queued,
      id: 'whatsapp_conv_session_deleting_existing',
      deletionStartedAt: '2026-06-30T10:02:00.000Z',
    };
    await repository.saveSession(deleting);
    await expect(repository.createSessionIfAbsent(deleting)).resolves.toMatchObject({
      status: 'existing',
      session: { id: deleting.id, deletionStartedAt: deleting.deletionStartedAt },
    });

    const legacyStored = makeSession({
      id: 'whatsapp_conv_session_existing_without_source_fence',
      status: 'preparing',
      preparationStage: 'queued',
    });
    delete legacyStored.sourceAccountId;
    delete legacyStored.sourceAccountGeneration;
    await repository.saveSession(legacyStored);
    const legacyCandidate = {
      ...legacyStored,
      sourceAccountId: sourceFence.sourceAccountId,
      sourceAccountGeneration: sourceFence.accountGeneration,
    };
    await expect(repository.createSessionIfAbsent(legacyCandidate)).resolves.toMatchObject({
      status: 'existing',
      session: {
        sourceAccountId: sourceFence.sourceAccountId,
        sourceAccountGeneration: sourceFence.accountGeneration,
      },
    });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(legacyStored.id)
          .get()
      ).data()
    ).toMatchObject({
      sourceAccountId: sourceFence.sourceAccountId,
      sourceAccountGeneration: sourceFence.accountGeneration,
    });

    const mismatchedStored = {
      ...legacyCandidate,
      id: 'whatsapp_conv_session_existing_source_mismatch',
      sourceAccountId: 'different-source-account',
    };
    await repository.saveSession(mismatchedStored);
    await expect(
      repository.createSessionIfAbsent({
        ...legacyCandidate,
        id: mismatchedStored.id,
      })
    ).resolves.toEqual({ status: 'source_unavailable' });
  });

  it('atomically fences session creation when source erasure or generation drift begins', async () => {
    const queued = makeSession({
      id: 'whatsapp_conv_session_source_fence',
      sourceAccountId: 'source-account-123',
      sourceAccountGeneration: 'account-generation-123',
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: 1,
      transcriptSha256: '',
      transcriptText: '',
    });
    const sourceFence = {
      sourceAccountId: 'source-account-123',
      accountGeneration: 'account-generation-123',
    };

    for (const account of [
      undefined,
      {
        userId: queued.userId,
        sourceAccountId: sourceFence.sourceAccountId,
        generationId: sourceFence.accountGeneration,
        status: 'disabled',
        erasureStatus: 'erasing',
      },
      {
        userId: queued.userId,
        sourceAccountId: sourceFence.sourceAccountId,
        generationId: 'new-generation',
        status: 'active',
      },
    ]) {
      if (account === undefined) {
        await fakeFirestore
          .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
          .doc(queued.userId)
          .delete();
      } else {
        fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
          { id: queued.userId, data: account },
        ]);
      }

      await expect(repository.createSessionIfAbsent(queued)).resolves.toEqual({
        status: 'source_unavailable',
      });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
            .doc(queued.id)
            .get()
        ).exists
      ).toBe(false);
    }

    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: queued.userId,
        data: {
          userId: queued.userId,
          sourceAccountId: sourceFence.sourceAccountId,
          generationId: sourceFence.accountGeneration,
          status: 'active',
        },
      },
    ]);
    const missingSourceFence = makeSession({
      id: 'whatsapp_conv_session_missing_source_fence',
      status: 'preparing',
      preparationStage: 'queued',
    });
    delete missingSourceFence.sourceAccountId;
    delete missingSourceFence.sourceAccountGeneration;
    await expect(repository.createSessionIfAbsent(missingSourceFence)).resolves.toEqual({
      status: 'source_unavailable',
    });

    const legacyGenerationSession = makeSession({
      id: 'whatsapp_conv_session_legacy_source_generation',
      sourceAccountId: sourceFence.sourceAccountId,
      sourceAccountGeneration: sourceFence.sourceAccountId,
      status: 'preparing',
      preparationStage: 'queued',
    });
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: queued.userId,
        data: {
          userId: queued.userId,
          sourceAccountId: sourceFence.sourceAccountId,
          status: 'active',
        },
      },
    ]);
    await expect(repository.createSessionIfAbsent(legacyGenerationSession)).resolves.toMatchObject({
      status: 'created',
    });
  });

  it('handles missing, foreign, stale, and legacy preparation claims', async () => {
    const claimInput = {
      userId: 'user-123',
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-06-30T10:01:00.000Z',
      leaseExpiresAt: '2026-06-30T10:06:00.000Z',
    };

    await expect(
      repository.claimPreparation({ ...claimInput, sessionId: 'missing-session' })
    ).resolves.toEqual({ status: 'not_found' });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('foreign-session')
      .set(
        makeSession({
          id: 'foreign-session',
          userId: 'other-user',
          status: 'preparing',
          preparationStage: 'queued',
          preparationAttempt: 1,
        })
      );
    await expect(
      repository.claimPreparation({ ...claimInput, sessionId: 'foreign-session' })
    ).resolves.toEqual({ status: 'not_found' });

    await repository.saveSession(makeSession({ id: 'ready-session', status: 'ready' }));
    await expect(
      repository.claimPreparation({ ...claimInput, sessionId: 'ready-session' })
    ).resolves.toMatchObject({ status: 'stale', session: { id: 'ready-session' } });

    const legacySessionId = 'legacy-queued-session';
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(legacySessionId)
      .set(
        makeSession({
          id: legacySessionId,
          status: 'preparing',
          preparationStage: 'queued',
          preparationAttempt: 1,
          transcriptText: '',
          transcriptSha256: '',
        })
      );
    await expect(
      repository.claimPreparation({ ...claimInput, sessionId: legacySessionId })
    ).resolves.toMatchObject({ status: 'claimed', session: { preparationClaimId: 'claim-1' } });

    const stored = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(legacySessionId)
      .get();
    expect(stored.data()?.['transcriptStorage']).toEqual({
      type: 'chunks',
      chunkCount: 0,
      chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
      byteLength: 0,
    });
  });

  it('handles missing and legacy records in conditional preparation writes', async () => {
    await expect(
      repository.saveClaimedPreparationSession({
        session: makeSession({
          id: 'missing-session',
          status: 'ready',
          preparationStage: 'ready',
          preparationAttempt: 1,
          transcriptText: 'orphan transcript',
          transcriptSha256: 'orphan-hash',
        }),
        attempt: 1,
        claimId: 'claim-1',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(false);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
          .doc('missing-session_orphan-hash_000000')
          .get()
      ).exists
    ).toBe(false);

    await expect(
      repository.requeueFailedPreparation({
        sessionId: 'missing-session',
        userId: 'user-123',
        expectedAttempt: 0,
        updatedAt: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('foreign-failed-session')
      .set(
        makeSession({
          id: 'foreign-failed-session',
          userId: 'other-user',
          status: 'failed',
          preparationStage: 'failed',
        })
      );
    await expect(
      repository.requeueFailedPreparation({
        sessionId: 'foreign-failed-session',
        userId: 'user-123',
        expectedAttempt: 0,
        updatedAt: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });

    const legacyFailedSessionId = 'legacy-failed-session';
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(legacyFailedSessionId)
      .set(
        makeSession({
          id: legacyFailedSessionId,
          status: 'failed',
          preparationStage: 'failed',
          transcriptText: '',
          transcriptSha256: '',
        })
      );
    await expect(
      repository.requeueFailedPreparation({
        sessionId: legacyFailedSessionId,
        userId: 'user-123',
        expectedAttempt: 0,
        updatedAt: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toMatchObject({
      status: 'queued',
      session: { preparationAttempt: 1, preparationStage: 'queued' },
    });

    await expect(
      repository.failQueuedPreparation({
        sessionId: 'missing-session',
        userId: 'user-123',
        attempt: 1,
        error: { code: 'INTERNAL_ERROR', message: 'Queue failed' },
        updatedAt: '2026-06-30T10:02:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('foreign-queued-session')
      .set(
        makeSession({
          id: 'foreign-queued-session',
          userId: 'other-user',
          status: 'preparing',
          preparationStage: 'queued',
          preparationAttempt: 1,
        })
      );
    await expect(
      repository.failQueuedPreparation({
        sessionId: 'foreign-queued-session',
        userId: 'user-123',
        attempt: 1,
        error: { code: 'INTERNAL_ERROR', message: 'Queue failed' },
        updatedAt: '2026-06-30T10:02:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });

    const legacyQueuedSessionId = 'legacy-queued-for-failure';
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(legacyQueuedSessionId)
      .set(
        makeSession({
          id: legacyQueuedSessionId,
          status: 'preparing',
          preparationStage: 'queued',
          preparationAttempt: 1,
          transcriptText: '',
          transcriptSha256: '',
        })
      );
    await expect(
      repository.failQueuedPreparation({
        sessionId: legacyQueuedSessionId,
        userId: 'user-123',
        attempt: 1,
        error: { code: 'INTERNAL_ERROR', message: 'Queue failed' },
        updatedAt: '2026-06-30T10:02:00.000Z',
      })
    ).resolves.toMatchObject({ status: 'saved', session: { status: 'failed' } });

    for (const sessionId of [legacyFailedSessionId, legacyQueuedSessionId]) {
      const stored = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(sessionId)
        .get();
      expect(stored.data()?.['transcriptStorage']).toMatchObject({
        type: 'chunks',
        chunkCount: 0,
      });
    }
  });

  it('increments a failed preparation attempt only once', async () => {
    await repository.saveSession(
      makeSession({
        status: 'failed',
        preparationStage: 'failed',
        preparationAttempt: 1,
        preparationError: { code: 'PERSISTENCE_ERROR', message: 'Temporary failure' },
      })
    );

    const first = await repository.requeueFailedPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      expectedAttempt: 1,
      updatedAt: '2026-06-30T10:01:00.000Z',
    });
    const repeated = await repository.requeueFailedPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      expectedAttempt: 1,
      updatedAt: '2026-06-30T10:02:00.000Z',
    });

    expect(first).toMatchObject({
      status: 'queued',
      session: { status: 'preparing', preparationStage: 'queued', preparationAttempt: 2 },
    });
    expect(repeated).toMatchObject({
      status: 'stale',
      session: { status: 'preparing', preparationStage: 'queued', preparationAttempt: 2 },
    });
  });

  it('conditionally saves only the active preparation claim and generation', async () => {
    await repository.saveSession(
      makeSession({
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptSha256: '',
        transcriptText: '',
      })
    );

    const claimed = await repository.claimPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-06-30T10:01:00.000Z',
      leaseExpiresAt: '2026-06-30T10:06:00.000Z',
    });
    const busy = await repository.claimPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      attempt: 1,
      claimId: 'claim-2',
      now: '2026-06-30T10:02:00.000Z',
      leaseExpiresAt: '2026-06-30T10:07:00.000Z',
    });
    expect(claimed.status).toBe('claimed');
    expect(busy.status).toBe('busy');
    if (claimed.status !== 'claimed') return;

    const staleSave = await repository.saveClaimedPreparationSession({
      session: { ...claimed.session, status: 'ready', preparationStage: 'ready' },
      attempt: 1,
      claimId: 'claim-2',
      now: '2026-06-30T10:03:00.000Z',
    });
    expect(staleSave).toBe(false);
    expect((await repository.getSessionById('whatsapp_conv_session_1'))?.status).toBe('preparing');

    const retrySession = {
      ...claimed.session,
      preparationStage: 'queued' as const,
      preparationAttempt: 2,
    };
    delete retrySession.preparationClaimId;
    delete retrySession.preparationLeaseExpiresAt;
    await repository.saveSession(retrySession);
    const secondClaim = await repository.claimPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      attempt: 2,
      claimId: 'claim-generation-2',
      now: '2026-06-30T10:03:00.000Z',
      leaseExpiresAt: '2026-06-30T10:08:00.000Z',
    });
    expect(secondClaim.status).toBe('claimed');
    const oldGenerationSave = await repository.saveClaimedPreparationSession({
      session: { ...claimed.session, status: 'ready', preparationStage: 'ready' },
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-06-30T10:04:00.000Z',
    });
    expect(oldGenerationSave).toBe(false);
    if (secondClaim.status !== 'claimed') return;

    const saved = await repository.saveClaimedPreparationSession({
      session: { ...secondClaim.session, status: 'ready', preparationStage: 'ready' },
      attempt: 2,
      claimId: 'claim-generation-2',
      now: '2026-06-30T10:04:00.000Z',
    });
    expect(saved).toBe(true);
    expect((await repository.getSessionById('whatsapp_conv_session_1'))?.status).toBe('ready');
  });

  it('atomically fences initial preparation authority and private writes after source erasure or reconnect', async () => {
    const accountRef = fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc('user-123');
    const activeAccount = {
      userId: 'user-123',
      sourceAccountId: 'source-account-123',
      generationId: 'account-generation-123',
      status: 'active',
    };
    const deniedAccounts = [
      { label: 'missing', account: undefined },
      {
        label: 'erasing',
        account: { ...activeAccount, status: 'disabled', erasureStatus: 'erasing' },
      },
      {
        label: 'replacement-generation',
        account: { ...activeAccount, generationId: 'replacement-generation' },
      },
    ] as const;

    for (const scenario of deniedAccounts) {
      await accountRef.set(activeAccount);
      const sessionId = `initial-preparation-${scenario.label}`;
      const queued = makeSession({
        id: sessionId,
        generationId: `session-generation-${scenario.label}`,
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptSha256: '',
        transcriptText: '',
      });
      await expect(repository.createSessionIfAbsent(queued)).resolves.toMatchObject({
        status: 'created',
      });
      const claim = await repository.claimPreparation({
        sessionId,
        userId: queued.userId,
        attempt: 1,
        claimId: `claim-${scenario.label}`,
        now: '2026-07-21T10:00:00.000Z',
        leaseExpiresAt: '2026-07-21T10:05:00.000Z',
        expectedGenerationId: queued.generationId as string,
      });
      expect(claim.status).toBe('claimed');
      if (claim.status !== 'claimed') throw new Error('Expected preparation claim');

      if (scenario.account === undefined) await accountRef.delete();
      else await accountRef.set(scenario.account);

      await expect(
        repository.saveClaimedPreparationSession({
          session: {
            ...claim.session,
            status: 'ready',
            preparationStage: 'ready',
            transcriptSha256: `snapshot-${scenario.label}`,
            transcriptText: `${'x'.repeat(TRANSCRIPT_CHUNK_MAX_BYTES)}y`,
          },
          attempt: 1,
          claimId: `claim-${scenario.label}`,
          now: '2026-07-21T10:01:00.000Z',
        })
      ).resolves.toBe(false);
      await expect(
        repository.saveContextSnapshot(
          sessionId,
          queued.userId,
          `context-${scenario.label}`,
          {
            messages: [
              {
                id: `message-${scenario.label}`,
                eventTimestamp: '2026-07-21T10:00:00.000Z',
                importedAt: '2026-07-21T10:00:01.000Z',
                direction: 'incoming',
                speakerLabel: 'Them',
                messageType: 'text',
                contentKind: 'text',
                content: 'must not persist',
              },
            ],
            omittedMessages: [],
          },
          queued.generationId
        )
      ).resolves.toBe(false);

      const transcriptChunks = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
        .where('sessionId', '==', sessionId)
        .get();
      const contextChunks = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
        .where('sessionId', '==', sessionId)
        .get();
      expect(transcriptChunks.empty).toBe(true);
      expect(contextChunks.empty).toBe(true);
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
            .doc(sessionId)
            .get()
        ).data()
      ).toMatchObject({
        status: 'preparing',
        preparationClaimId: `claim-${scenario.label}`,
      });

      await accountRef.set(activeAccount);
      const unclaimed = makeSession({
        ...queued,
        id: `${sessionId}-unclaimed`,
        generationId: `${queued.generationId}-unclaimed`,
      });
      await expect(repository.createSessionIfAbsent(unclaimed)).resolves.toMatchObject({
        status: 'created',
      });
      if (scenario.account === undefined) await accountRef.delete();
      else await accountRef.set(scenario.account);
      await expect(
        repository.claimPreparation({
          sessionId: unclaimed.id,
          userId: unclaimed.userId,
          attempt: 1,
          claimId: `forbidden-claim-${scenario.label}`,
          now: '2026-07-21T10:00:00.000Z',
          leaseExpiresAt: '2026-07-21T10:05:00.000Z',
          expectedGenerationId: unclaimed.generationId as string,
        })
      ).resolves.toEqual({ status: 'not_found' });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
            .doc(unclaimed.id)
            .get()
        ).data()?.['preparationClaimId']
      ).toBeUndefined();
    }
  });

  it('keeps crash-orphaned initial chunks on native pending TTL', async () => {
    const queued = makeSession({
      id: 'initial-pending-ttl-crash',
      generationId: 'initial-pending-ttl-generation',
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: 1,
      transcriptSha256: '',
      transcriptText: '',
    });
    await repository.createSessionIfAbsent(queued);
    const claim = await repository.claimPreparation({
      sessionId: queued.id,
      userId: queued.userId,
      attempt: 1,
      claimId: 'initial-pending-ttl-claim',
      now: '2026-07-21T10:00:00.000Z',
      leaseExpiresAt: '2026-07-21T10:05:00.000Z',
      expectedGenerationId: queued.generationId as string,
    });
    if (claim.status !== 'claimed') throw new Error('Expected preparation claim');
    await expect(
      repository.saveContextSnapshot(
        queued.id,
        queued.userId,
        'initial-pending-context',
        {
          messages: [
            {
              id: 'pending-message',
              eventTimestamp: '2026-07-21T10:00:00.000Z',
              importedAt: '2026-07-21T10:00:01.000Z',
              direction: 'incoming',
              speakerLabel: 'Them',
              messageType: 'text',
              contentKind: 'text',
              content: 'pending private context',
            },
          ],
          omittedMessages: [],
        },
        queued.generationId
      )
    ).resolves.toBe(true);
    const pendingContext = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .where('sessionId', '==', queued.id)
      .get();
    expect(pendingContext.empty).toBe(false);
    expect(
      pendingContext.docs.every(
        (document) => document.data()?.['expireAt'] instanceof Timestamp
      )
    )
      .toBe(true);

    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (operation) => {
      transactionNumber += 1;
      if (transactionNumber === 3) throw new Error('simulated crash before final manifest');
      return await originalRunTransaction(operation);
    });
    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...claim.session,
          status: 'ready',
          preparationStage: 'ready',
          contextSnapshotId: 'initial-pending-context',
          transcriptSha256: 'initial-pending-transcript',
          transcriptText: `${'t'.repeat(TRANSCRIPT_CHUNK_MAX_BYTES)}u`,
        },
        attempt: 1,
        claimId: 'initial-pending-ttl-claim',
        now: '2026-07-21T10:01:00.000Z',
      })
    ).rejects.toThrow('simulated crash before final manifest');
    const pendingTranscript = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .where('sessionId', '==', queued.id)
      .get();
    expect(pendingTranscript).toHaveProperty('size', 2);
    expect(
      pendingTranscript.docs.every(
        (document) => document.data()?.['expireAt'] instanceof Timestamp
      )
    ).toBe(true);
  });

  it('atomically removes pending TTL from the exact initial manifest on ready publication', async () => {
    const preparationNow = new Date().toISOString();
    const preparationLeaseExpiresAt = new Date(Date.parse(preparationNow) + 5 * 60 * 1000).toISOString();
    const queued = makeSession({
      id: 'initial-pending-ttl-ready',
      generationId: 'initial-ready-generation',
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: 1,
      transcriptSha256: '',
      transcriptText: '',
    });
    await repository.createSessionIfAbsent(queued);
    const claim = await repository.claimPreparation({
      sessionId: queued.id,
      userId: queued.userId,
      attempt: 1,
      claimId: 'initial-ready-claim',
      now: preparationNow,
      leaseExpiresAt: preparationLeaseExpiresAt,
      expectedGenerationId: queued.generationId as string,
    });
    if (claim.status !== 'claimed') throw new Error('Expected preparation claim');
    const snapshotId = 'initial-ready-context';
    await repository.saveContextSnapshot(
      queued.id,
      queued.userId,
      snapshotId,
      {
        messages: [
          {
            id: 'ready-message',
            eventTimestamp: '2026-07-21T10:00:00.000Z',
            importedAt: '2026-07-21T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Them',
            messageType: 'text',
            contentKind: 'text',
            content: 'durable private context',
          },
        ],
        omittedMessages: [],
      },
      queued.generationId
    );

    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...claim.session,
          status: 'ready',
          preparationStage: 'ready',
          contextSnapshotId: snapshotId,
          transcriptSha256: 'initial-ready-transcript',
          transcriptText: 'durable transcript',
        },
        attempt: 1,
        claimId: 'initial-ready-claim',
        now: preparationNow,
      })
    ).resolves.toBe(true);
    const contextChunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .where('sessionId', '==', queued.id)
      .get();
    const transcriptChunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .where('sessionId', '==', queued.id)
      .get();
    expect([...contextChunks.docs, ...transcriptChunks.docs]).toHaveLength(2);
    expect(
      [...contextChunks.docs, ...transcriptChunks.docs].every(
        (document) => document.data()?.['expireAt'] === undefined
      )
    ).toBe(true);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(queued.id)
          .get()
      ).data()
    ).toMatchObject({
      status: 'ready',
      contextSnapshotId: snapshotId,
      transcriptStorage: { chunkCount: 1 },
    });
    expect(CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS + 1).toBe(500);
  });

  it('uses at most 500 writes to publish initial chunks and rejects a 501-write finalization', async () => {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
    const pendingExpireAt = Timestamp.fromMillis(Date.parse(now) + 30 * 60 * 1000);

    const finalize = async (chunkCount: number, label: string): Promise<boolean> => {
      const sessionId = `initial-finalization-${label}`;
      const generationId = `initial-finalization-generation-${label}`;
      const snapshotId = `initial-finalization-context-${label}`;
      const claimId = `initial-finalization-claim-${label}`;
      const queued = makeSession({
        id: sessionId,
        generationId,
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptSha256: '',
        transcriptText: '',
      });
      await repository.createSessionIfAbsent(queued);
      const claim = await repository.claimPreparation({
        sessionId,
        userId: queued.userId,
        attempt: 1,
        claimId,
        now,
        leaseExpiresAt,
        expectedGenerationId: generationId,
      });
      if (claim.status !== 'claimed') throw new Error('Expected preparation claim');
      const chunkIds = Array.from(
        { length: chunkCount },
        (_value, chunkIndex) =>
          `${sessionId}_${snapshotId}_${String(chunkIndex).padStart(6, '0')}`
      );
      fakeFirestore.seedCollection(
        WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
        chunkIds.map((chunkId, chunkIndex) => ({
          id: chunkId,
          data: {
            sessionId,
            userId: queued.userId,
            sessionGenerationId: generationId,
            sourceAccountId: queued.sourceAccountId,
            sourceAccountGeneration: queued.sourceAccountGeneration,
            snapshotId,
            chunkIndex,
            preparationAttempt: 1,
            preparationClaimId: claimId,
            expireAt: pendingExpireAt,
          },
        }))
      );
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(sessionId)
        .update({
          pendingContextStorage: {
            type: 'chunks',
            snapshotId,
            chunkIds,
            chunkCount,
            sessionGenerationId: generationId,
            sourceAccountId: queued.sourceAccountId,
            sourceAccountGeneration: queued.sourceAccountGeneration,
            preparationAttempt: 1,
            preparationClaimId: claimId,
          },
        });

      return await repository.saveClaimedPreparationSession({
        session: {
          ...claim.session,
          status: 'ready',
          preparationStage: 'ready',
          contextSnapshotId: snapshotId,
          transcriptSha256: '',
          transcriptText: '',
        },
        attempt: 1,
        claimId,
        now,
      });
    };

    await expect(
      finalize(CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS, '500-writes')
    ).resolves.toBe(true);
    const publishedChunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .where('sessionId', '==', 'initial-finalization-500-writes')
      .get();
    expect(publishedChunks).toHaveProperty(
      'size',
      CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS
    );
    expect(
      publishedChunks.docs.every((document) => document.data()?.['expireAt'] === undefined)
    ).toBe(true);

    await expect(
      finalize(CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS + 1, '501-writes')
    ).resolves.toBe(false);
    const rejectedChunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .where('sessionId', '==', 'initial-finalization-501-writes')
      .get();
    expect(rejectedChunks).toHaveProperty(
      'size',
      CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS + 1
    );
    expect(
      rejectedChunks.docs.every((document) => document.data()?.['expireAt'] === pendingExpireAt)
    ).toBe(true);
    await expect(
      repository.getSessionById('initial-finalization-501-writes')
    ).resolves.toMatchObject({ status: 'preparing' });
  });

  it('does not publish initial context after its pending TTL or preparation lease expires', async () => {
    const baseNowMs = Date.now();
    const claimNow = new Date(baseNowMs).toISOString();
    const leaseExpiresAt = new Date(baseNowMs + 5 * 60 * 1000).toISOString();

    for (const scenario of [
      {
        label: 'chunk-ttl',
        finalizationNow: new Date(baseNowMs + 60 * 1000).toISOString(),
        expireChunk: true,
      },
      { label: 'lease', finalizationNow: leaseExpiresAt, expireChunk: false },
    ]) {
      const sessionId = `initial-expired-${scenario.label}`;
      const generationId = `initial-expired-generation-${scenario.label}`;
      const snapshotId = `initial-expired-context-${scenario.label}`;
      const claimId = `initial-expired-claim-${scenario.label}`;
      const queued = makeSession({
        id: sessionId,
        generationId,
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptSha256: '',
        transcriptText: '',
      });
      await repository.createSessionIfAbsent(queued);
      const claim = await repository.claimPreparation({
        sessionId,
        userId: queued.userId,
        attempt: 1,
        claimId,
        now: claimNow,
        leaseExpiresAt,
        expectedGenerationId: generationId,
      });
      if (claim.status !== 'claimed') throw new Error('Expected preparation claim');
      await expect(
        repository.saveContextSnapshot(
          sessionId,
          queued.userId,
          snapshotId,
          {
            messages: [
              {
                id: `message-${scenario.label}`,
                eventTimestamp: claimNow,
                importedAt: claimNow,
                direction: 'incoming',
                speakerLabel: 'Them',
                messageType: 'text',
                contentKind: 'text',
                content: `private ${scenario.label} context`,
              },
            ],
            omittedMessages: [],
          },
          generationId
        )
      ).resolves.toBe(true);
      const pendingChunks = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
        .where('sessionId', '==', sessionId)
        .get();
      expect(pendingChunks).toHaveProperty('size', 1);
      if (scenario.expireChunk) {
        await pendingChunks.docs[0]?.ref.update({
          expireAt: Timestamp.fromMillis(Date.parse(scenario.finalizationNow) - 1),
        });
      }

      await expect(
        repository.saveClaimedPreparationSession({
          session: {
            ...claim.session,
            status: 'ready',
            preparationStage: 'ready',
            contextSnapshotId: snapshotId,
            transcriptSha256: '',
            transcriptText: '',
          },
          attempt: 1,
          claimId,
          now: scenario.finalizationNow,
        })
      ).resolves.toBe(false);
      await expect(repository.getSessionById(sessionId)).resolves.toMatchObject({
        status: 'preparing',
        preparationClaimId: claimId,
      });
      const retainedChunk = await pendingChunks.docs[0]?.ref.get();
      expect(retainedChunk?.data()?.['expireAt']).toBeInstanceOf(Timestamp);
    }
  });

  it('does not let stale claim cleanup remove a newer claim transcript', async () => {
    const claimedByA = {
      ...makeSession({
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationAttempt: 1,
        preparationClaimId: 'claim-a',
        preparationLeaseExpiresAt: '2026-06-30T10:05:00.000Z',
        transcriptText: '',
        transcriptSha256: '',
      }),
      generationId: 'shared-generation',
    } as ConversationAssistantSession;
    await repository.saveSession(claimedByA);

    let releaseASessionWrite!: () => void;
    let reportASessionWriteStarted!: () => void;
    const aSessionWriteStarted = new Promise<void>((resolve) => {
      reportASessionWriteStarted = resolve;
    });
    const aSessionWriteRelease = new Promise<void>((resolve) => {
      releaseASessionWrite = resolve;
    });
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (updateFn) => {
      transactionNumber += 1;
      if (transactionNumber === 2) {
        reportASessionWriteStarted();
        await aSessionWriteRelease;
      }
      return await originalRunTransaction(updateFn);
    });

    const readyA = {
      ...claimedByA,
      status: 'ready' as const,
      preparationStage: 'ready' as const,
      transcriptSha256: 'shared-transcript',
      transcriptText: 'transcript from claim A',
    };
    const saveA = repository.saveClaimedPreparationSession({
      session: readyA,
      attempt: 1,
      claimId: 'claim-a',
      now: '2026-06-30T10:01:00.000Z',
    });
    await aSessionWriteStarted;

    const claimedByB = {
      ...claimedByA,
      preparationClaimId: 'claim-b',
    };
    await repository.saveSession(claimedByB);
    const readyB = {
      ...claimedByB,
      status: 'ready' as const,
      preparationStage: 'ready' as const,
      transcriptSha256: 'shared-transcript',
      transcriptText: 'transcript from claim B',
    };
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${claimedByA.id}_shared-transcript_000000`)
      .set({
        sessionId: claimedByA.id,
        sessionGenerationId: 'shared-generation',
        preparationAttempt: 1,
        preparationClaimId: 'claim-b',
        snapshotId: 'shared-transcript',
        chunkIndex: 0,
        text: 'transcript from claim B',
      });

    releaseASessionWrite();
    await expect(saveA).resolves.toBe(false);
    await expect(
      repository.saveClaimedPreparationSession({
        session: readyB,
        attempt: 1,
        claimId: 'claim-b',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(true);

    const sharedChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${claimedByA.id}_shared-transcript_000000`)
      .get();
    expect(sharedChunk.data()).toMatchObject({
      sessionGenerationId: 'shared-generation',
      preparationAttempt: 1,
      preparationClaimId: 'claim-b',
      text: 'transcript from claim B',
    });
  });

  it('fails only an unclaimed queued preparation and preserves an active claim', async () => {
    await repository.saveSession(
      makeSession({
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        transcriptSha256: '',
        transcriptText: '',
      })
    );

    const savedFailure = await repository.failQueuedPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      attempt: 1,
      error: { code: 'INTERNAL_ERROR', message: 'Publish failed' },
      updatedAt: '2026-06-30T10:01:00.000Z',
    });
    expect(savedFailure).toMatchObject({
      status: 'saved',
      session: {
        status: 'failed',
        preparationStage: 'failed',
        preparationError: { code: 'INTERNAL_ERROR', message: 'Publish failed' },
      },
    });

    await repository.saveSession(
      makeSession({
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 2,
        transcriptSha256: '',
        transcriptText: '',
      })
    );
    const claim = await repository.claimPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      attempt: 2,
      claimId: 'active-claim',
      now: '2026-06-30T10:02:00.000Z',
      leaseExpiresAt: '2026-06-30T10:07:00.000Z',
    });
    expect(claim.status).toBe('claimed');

    const staleFailure = await repository.failQueuedPreparation({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      attempt: 2,
      error: { code: 'INTERNAL_ERROR', message: 'Late publish failure' },
      updatedAt: '2026-06-30T10:03:00.000Z',
    });
    expect(staleFailure).toMatchObject({
      status: 'stale',
      session: {
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationClaimId: 'active-claim',
      },
    });
    expect((await repository.getSessionById('whatsapp_conv_session_1'))?.status).toBe('preparing');
  });

  it('round-trips reactions and exact omitted messages in a versioned context snapshot', async () => {
    await repository.saveSession(makeSession());
    const includedMessage = {
      id: 'message-included',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'text' as const,
      contentKind: 'text' as const,
      content: 'Included',
      reactions: [
        {
          id: 'reaction-1',
          emoji: '👍',
          direction: 'outgoing' as const,
          eventTimestamp: '2026-06-30T10:00:02.000Z',
        },
      ],
    };
    const omittedMessage = {
      id: 'message-omitted',
      eventTimestamp: '2026-06-30T10:01:00.000Z',
      importedAt: '2026-06-30T10:01:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'reaction' as const,
      omissionReason: 'non_text' as const,
      reaction: {
        emoji: '👍',
        targetMessageId: 'message-outside-snapshot',
        targetMatrixEventId: '$outside-snapshot',
      },
    };
    await repository.saveContextSnapshot('whatsapp_conv_session_1', 'user-123', 'snapshot-a', {
      messages: [includedMessage],
      omittedMessages: [omittedMessage],
    });

    await expect(
      repository.getContextPage('whatsapp_conv_session_1', 'snapshot-a', {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: 1,
        omittedMessageCount: 1,
      })
    ).resolves.toEqual({
      messages: [includedMessage],
      omittedMessages: [omittedMessage],
      snapshotAvailable: true,
    });
    await expect(
      repository.getContextPage('whatsapp_conv_session_1', 'snapshot-b', {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: 1,
        omittedMessageCount: 1,
      })
    ).resolves.toEqual({ messages: [], omittedMessages: [], snapshotAvailable: false });
  });

  it('hydrates all supported context variants from stored chunks', async () => {
    const sessionId = 'whatsapp_conv_session_context_variants';
    const snapshotId = 'snapshot-variants';
    await repository.saveSession(makeSession({ id: sessionId }));
    const includedMessage = {
      id: 'included-outgoing',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'outgoing',
      speakerLabel: 'Me',
      messageType: 'audio',
      contentKind: 'transcription',
      content: 'Transcribed voice note',
      reactions: [
        {
          id: 'reaction-rich',
          emoji: '👍',
          direction: 'outgoing',
          eventTimestamp: '2026-06-30T10:00:02.000Z',
          senderKey: 'phone:+48111111111',
          senderDisplayName: 'Alice',
          senderPhoneNumber: '+48111111111',
        },
      ],
    };
    const omittedMessages = [
      {
        id: 'omitted-rich',
        eventTimestamp: '2026-06-30T10:01:00.000Z',
        importedAt: '2026-06-30T10:01:01.000Z',
        direction: 'outgoing',
        speakerLabel: 'Me',
        messageType: 'audio',
        omissionReason: 'over_limit',
        contentKind: 'transcription',
        content: 'Omitted transcription',
        reactions: [
          {
            id: 'omitted-reaction',
            emoji: '❤️',
            direction: 'incoming',
            eventTimestamp: '2026-06-30T10:01:02.000Z',
          },
        ],
      },
      {
        id: 'omitted-message-target',
        eventTimestamp: '2026-06-30T10:02:00.000Z',
        importedAt: '2026-06-30T10:02:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'reaction',
        omissionReason: 'non_text',
        reaction: { emoji: '👍', targetMessageId: 'message-target' },
      },
      {
        id: 'omitted-matrix-target',
        eventTimestamp: '2026-06-30T10:03:00.000Z',
        importedAt: '2026-06-30T10:03:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'reaction',
        omissionReason: 'non_text',
        reaction: { emoji: '🔥', targetMatrixEventId: '$matrix-target' },
      },
    ];
    const collection = fakeFirestore.collection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION
    );
    await collection.doc('included-variants').set({
      sessionId,
      userId: 'user-123',
      snapshotId,
      chunkIndex: 0,
      kind: 'included',
      start: 0,
      end: 1,
      messages: [includedMessage],
    });
    await collection.doc('omitted-variants').set({
      sessionId,
      userId: 'user-123',
      snapshotId,
      chunkIndex: 1,
      kind: 'omitted',
      start: 0,
      end: 3,
      messages: [],
      omittedMessages,
    });

    await expect(
      repository.getContextPage(sessionId, snapshotId, {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: 1,
        omittedMessageCount: 3,
      })
    ).resolves.toEqual({
      messages: [includedMessage],
      omittedMessages,
      snapshotAvailable: true,
    });
  });

  it.each([
    {
      name: 'invalid chunk metadata',
      kind: 'included',
      chunk: { chunkIndex: -1, messages: [], omittedMessages: [] },
      expected: 'Invalid context chunk',
    },
    {
      name: 'non-record included message',
      kind: 'included',
      chunk: { messages: [null], omittedMessages: [] },
      expected: 'Invalid context message',
    },
    {
      name: 'invalid included message fields',
      kind: 'included',
      chunk: {
        messages: [
          {
            id: 123,
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Message',
          },
        ],
        omittedMessages: [],
      },
      expected: 'Invalid context message',
    },
    {
      name: 'non-record omitted message',
      kind: 'omitted',
      chunk: { messages: [], omittedMessages: [null] },
      expected: 'Invalid omitted context message',
    },
    {
      name: 'invalid omitted message fields',
      kind: 'omitted',
      chunk: {
        messages: [],
        omittedMessages: [
          {
            id: 123,
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            omissionReason: 'non_text',
          },
        ],
      },
      expected: 'Invalid omitted context message',
    },
    {
      name: 'non-record omitted reaction reference',
      kind: 'omitted',
      chunk: {
        messages: [],
        omittedMessages: [
          {
            id: 'omitted-1',
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'reaction',
            omissionReason: 'non_text',
            reaction: 'invalid',
          },
        ],
      },
      expected: 'Invalid reaction reference',
    },
    {
      name: 'omitted reaction reference without a target',
      kind: 'omitted',
      chunk: {
        messages: [],
        omittedMessages: [
          {
            id: 'omitted-1',
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'reaction',
            omissionReason: 'non_text',
            reaction: { emoji: '👍' },
          },
        ],
      },
      expected: 'Invalid reaction reference',
    },
    {
      name: 'non-record reaction summary',
      kind: 'included',
      chunk: {
        messages: [
          {
            id: 'included-1',
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Message',
            reactions: [null],
          },
        ],
        omittedMessages: [],
      },
      expected: 'Invalid reaction 0',
    },
    {
      name: 'invalid reaction summary fields',
      kind: 'included',
      chunk: {
        messages: [
          {
            id: 'included-1',
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Message',
            reactions: [
              {
                id: 123,
                emoji: '👍',
                direction: 'incoming',
                eventTimestamp: '2026-06-30T10:00:02.000Z',
              },
            ],
          },
        ],
        omittedMessages: [],
      },
      expected: 'Invalid reaction 0',
    },
  ])('rejects $name in persisted context chunks', async ({ kind, chunk, expected }) => {
    const sessionId = 'whatsapp_conv_session_invalid_context';
    const snapshotId = `snapshot-${kind}`;
    await repository.saveSession(makeSession({ id: sessionId }));
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc('invalid-context-chunk')
      .set({
        sessionId,
        userId: 'user-123',
        snapshotId,
        chunkIndex: 0,
        kind,
        start: 0,
        end: 1,
        ...chunk,
      });

    await expect(
      repository.getContextPage(sessionId, snapshotId, {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: kind === 'included' ? 1 : 0,
        omittedMessageCount: kind === 'omitted' ? 1 : 0,
      })
    ).rejects.toThrow(expected);
  });

  it('stores the frozen context in ordered chunks and replaces stale chunks on retry', async () => {
    await repository.saveSession(makeSession());
    const firstMessage = {
      id: 'message-1',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'text' as const,
      contentKind: 'text' as const,
      content: 'a'.repeat(CONTEXT_CHUNK_MAX_BYTES),
    };
    const secondMessage = {
      ...firstMessage,
      id: 'message-2',
      eventTimestamp: '2026-06-30T10:01:00.000Z',
      content: 'second',
    };

    await repository.saveContextSnapshot('whatsapp_conv_session_1', 'user-123', 'snapshot-1', {
      messages: [firstMessage, secondMessage],
      omittedMessages: [],
    });

    expect(
      await repository.getContextPage('whatsapp_conv_session_1', 'snapshot-1', {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: 2,
        omittedMessageCount: 0,
      })
    ).toEqual({
      messages: [firstMessage, secondMessage],
      omittedMessages: [],
      snapshotAvailable: true,
    });
    const secondChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc('whatsapp_conv_session_1_snapshot-1_000001')
      .get();
    expect(secondChunk.data()).toMatchObject({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
      snapshotId: 'snapshot-1',
      chunkIndex: 1,
      messages: [secondMessage],
    });

    await repository.saveContextSnapshot('whatsapp_conv_session_1', 'user-123', 'snapshot-1', {
      messages: [secondMessage],
      omittedMessages: [],
    });

    expect(
      await repository.getContextPage('whatsapp_conv_session_1', 'snapshot-1', {
        messageCursor: 0,
        omittedCursor: 0,
        limit: 100,
        messageCount: 1,
        omittedMessageCount: 0,
      })
    ).toEqual({ messages: [secondMessage], omittedMessages: [], snapshotAvailable: true });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('whatsapp_conv_session_1_snapshot-1_000001')
          .get()
      ).exists
    ).toBe(false);
  });

  it('deletes only the owned context snapshot selected for cleanup', async () => {
    await repository.saveSession(makeSession());
    const message = {
      id: 'message-1',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:01.000Z',
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'text' as const,
      contentKind: 'text' as const,
      content: 'Included',
    };
    await repository.saveContextSnapshot('whatsapp_conv_session_1', 'user-123', 'snapshot-delete', {
      messages: [message],
      omittedMessages: [],
    });
    await repository.saveContextSnapshot('whatsapp_conv_session_1', 'user-123', 'snapshot-keep', {
      messages: [message],
      omittedMessages: [],
    });

    await repository.deleteContextSnapshot(
      'whatsapp_conv_session_1',
      'other-user',
      'snapshot-delete'
    );
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('whatsapp_conv_session_1_snapshot-delete_000000')
          .get()
      ).exists
    ).toBe(true);

    await repository.deleteContextSnapshot(
      'whatsapp_conv_session_1',
      'user-123',
      'snapshot-delete'
    );
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('whatsapp_conv_session_1_snapshot-delete_000000')
          .get()
      ).exists
    ).toBe(false);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('whatsapp_conv_session_1_snapshot-keep_000000')
          .get()
      ).exists
    ).toBe(true);
  });

  it('loads a session snapshot with hydrated transcript chunks and turns from one repository call', async () => {
    const transcriptText = `${'x'.repeat(TRANSCRIPT_CHUNK_MAX_BYTES)}y`;
    await repository.saveSession(makeSession({ transcriptText }));
    await repository.saveTurn(
      makeTurn({ id: 'turn-2', role: 'assistant', createdAt: '2026-06-30T10:02:00.000Z' })
    );
    await repository.saveTurn(
      makeTurn({ id: 'turn-1', role: 'user', createdAt: '2026-06-30T10:01:00.000Z' })
    );
    await repository.saveTurn(makeTurn({ id: 'foreign-turn', sessionId: 'other-session' }));
    await repository.saveTurn(
      makeTurn({
        id: 'foreign-user-turn',
        userId: 'other-user',
        createdAt: '2026-06-30T10:03:00.000Z',
      })
    );

    const snapshot = await repository.getSessionSnapshotById({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'user-123',
    });
    const missing = await repository.getSessionSnapshotById({
      sessionId: 'missing',
      userId: 'user-123',
    });
    const foreign = await repository.getSessionSnapshotById({
      sessionId: 'whatsapp_conv_session_1',
      userId: 'other-user',
    });

    expect(snapshot?.session.id).toBe('whatsapp_conv_session_1');
    expect(snapshot?.session.transcriptText).toBe(transcriptText);
    expect(snapshot?.turns.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2']);
    expect(missing).toBeNull();
    expect(foreign).toBeNull();
  });

  it('hydrates legacy sessions that still store transcript text inline', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_legacy_inline')
      .set(makeSession({ transcriptText: 'legacy inline transcript' }));

    const loaded = await repository.getSessionById('whatsapp_conv_session_legacy_inline');

    expect(loaded?.transcriptText).toBe('legacy inline transcript');
  });

  it('hydrates empty chunk storage without writing inline transcript text', async () => {
    await repository.saveSession(
      makeSession({ id: 'whatsapp_conv_session_empty_transcript', transcriptText: '' })
    );

    const loaded = await repository.getSessionById('whatsapp_conv_session_empty_transcript');
    const storedDoc = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_empty_transcript')
      .get();
    const firstChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc('whatsapp_conv_session_empty_transcript_000000')
      .get();

    expect(loaded?.transcriptText).toBe('');
    expect(storedDoc.data()?.['transcriptText']).toBeUndefined();
    expect(storedDoc.data()?.['transcriptStorage']).toEqual({
      type: 'chunks',
      chunkCount: 0,
      chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
      byteLength: 0,
    });
    expect(firstChunk.exists).toBe(false);
  });

  it('hydrates optional session metadata and stores nonempty legacy chunks without a snapshot id', async () => {
    const sessionId = 'whatsapp_conv_session_optional_metadata';
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(sessionId)
      .set({
        ...makeSession({ id: sessionId }),
        creationRequestId: 'request-1',
        contextSnapshotId: 'snapshot-1',
        maxMessages: 25,
      });

    await expect(repository.getSessionById(sessionId)).resolves.toMatchObject({
      creationRequestId: 'request-1',
      contextSnapshotId: 'snapshot-1',
      maxMessages: 25,
    });

    const chunkSessionId = 'whatsapp_conv_session_chunk_without_snapshot';
    await repository.saveSession(
      makeSession({
        id: chunkSessionId,
        transcriptText: 'legacy chunk',
        transcriptSha256: '',
      })
    );
    const chunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${chunkSessionId}_000000`)
      .get();
    expect(chunk.data()).toEqual({
      sessionId: chunkSessionId,
      sessionGenerationId: null,
      sourceAccountId: 'source-account-123',
      sourceAccountGeneration: 'account-generation-123',
      chunkIndex: 0,
      text: 'legacy chunk',
    });
  });

  it('falls back to inline transcript text when legacy storage metadata is malformed', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_wrong_storage_type')
      .set({
        ...makeSession({
          id: 'whatsapp_conv_session_wrong_storage_type',
          transcriptText: 'wrong storage type fallback',
        }),
        transcriptStorage: { type: 'inline' },
      });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_invalid_storage_shape')
      .set({
        ...makeSession({
          id: 'whatsapp_conv_session_invalid_storage_shape',
          transcriptText: 'invalid storage shape fallback',
        }),
        transcriptStorage: {
          type: 'chunks',
          chunkCount: '1',
          chunkSizeBytes: 0,
          byteLength: -1,
        },
      });

    const wrongType = await repository.getSessionById('whatsapp_conv_session_wrong_storage_type');
    const invalidShape = await repository.getSessionById(
      'whatsapp_conv_session_invalid_storage_shape'
    );

    expect(wrongType?.transcriptText).toBe('wrong storage type fallback');
    expect(invalidShape?.transcriptText).toBe('invalid storage shape fallback');
  });

  it('throws a load error when chunked transcript metadata points to missing or invalid chunks', async () => {
    const missingChunkSession = 'whatsapp_conv_session_missing_chunk';
    const invalidChunkSession = 'whatsapp_conv_session_invalid_chunk';
    const missingChunkDocument: Record<string, unknown> = {
      ...makeSession({ id: missingChunkSession }),
      transcriptStorage: {
        type: 'chunks',
        chunkCount: 1,
        chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
        byteLength: 1,
      },
    };
    const invalidChunkDocument: Record<string, unknown> = {
      ...makeSession({ id: invalidChunkSession }),
      transcriptStorage: {
        type: 'chunks',
        chunkCount: 1,
        chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
        byteLength: 1,
      },
    };
    Reflect.deleteProperty(missingChunkDocument, 'transcriptText');
    Reflect.deleteProperty(invalidChunkDocument, 'transcriptText');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(missingChunkSession)
      .set(missingChunkDocument);
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(invalidChunkSession)
      .set(invalidChunkDocument);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION, [
      {
        id: `${invalidChunkSession}_000000`,
        data: null as unknown as Record<string, unknown>,
      },
    ]);

    await expect(repository.getSessionById(missingChunkSession)).rejects.toThrow(
      `Missing transcript chunk 0 for ${missingChunkSession}`
    );
    await expect(repository.getSessionById(invalidChunkSession)).rejects.toThrow(
      `Invalid transcript chunk 0 for ${invalidChunkSession}`
    );
  });

  it('returns null for missing and malformed unowned sessions', async () => {
    const missing = await repository.getSessionById('whatsapp_conv_session_missing');
    expect(missing).toBeNull();

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_empty')
      .set({});
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_partial')
      .set({
        status: 'archived',
        chatDisplayName: 'Alice',
        lastTurnAt: '2026-06-30T10:03:00.000Z',
      });
    const empty = await repository.getSessionById('whatsapp_conv_session_empty');
    const loaded = await repository.getSessionById('whatsapp_conv_session_partial');

    expect(empty).toBeNull();
    expect(loaded).toBeNull();
  });

  it('preserves unknown legacy models while defaulting missing model values', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_missing_model')
      .set({
        userId: 'user-123',
        chatId: 'chat-123',
      });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_legacy_model')
      .set({
        userId: 'user-123',
        chatId: 'chat-123',
        model: 'legacy/model',
      });

    const missingModel = await repository.getSessionById('whatsapp_conv_session_missing_model');
    const legacyModel = await repository.getSessionById('whatsapp_conv_session_legacy_model');

    expect(missingModel?.model).toBe(DEFAULT_CONVERSATION_ASSISTANT_MODEL);
    expect(legacyModel?.model).toBe('legacy/model');
  });

  it('hydrates legacy sessions without effectiveRange by falling back to range', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_legacy_range')
      .set({
        userId: 'user-123',
        chatId: 'chat-123',
        range: { from: '2026-06-30T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
      });

    const loaded = await repository.getSessionById('whatsapp_conv_session_legacy_range');

    expect(loaded?.effectiveRange).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
  });

  it('hydrates preparation timezone and active continuation lease metadata', async () => {
    const continuation = {
      sourceAccountId: 'source-account-123',
      contextVersion: 2,
      contextEventThrough: '2026-07-01T00:00:00.000Z',
      contextChangeThrough: 7,
      contextChainSha256: 'a'.repeat(64),
      displayTimeZone: 'Europe/Warsaw',
      nextTurnSequence: 5,
      nextConversationRevision: 3,
      completedConversationRevision: 2,
      attachmentCount: 1,
      totalAttachedMessageCount: 4,
      totalAttachedOmittedCount: 1,
      activeTurnRequestId: 'request-active',
      activeTurnLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
    };
    await repository.saveSession(
      makeSession({
        id: 'whatsapp_conv_session_continuation_metadata',
        preparationDisplayTimeZone: 'Europe/Warsaw',
        continuation,
      })
    );

    const loaded = await repository.getSessionById(
      'whatsapp_conv_session_continuation_metadata'
    );

    expect(loaded).toMatchObject({ preparationDisplayTimeZone: 'Europe/Warsaw', continuation });
  });

  it('fails malformed session identity and continuation hydration closed in preparation claims', async () => {
    const collection = fakeFirestore.collection(
      WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION
    );
    const malformedUser = { ...makeSession({ status: 'preparing', preparationAttempt: 1 }) } as Record<
      string,
      unknown
    >;
    Reflect.deleteProperty(malformedUser, 'userId');
    await collection.doc('malformed-user-session').set(malformedUser);
    await expect(
      repository.claimPreparation({
        sessionId: 'malformed-user-session',
        userId: 'user-123',
        attempt: 1,
        claimId: 'claim-malformed-user',
        now: '2026-06-30T10:01:00.000Z',
        leaseExpiresAt: '2026-06-30T10:06:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });

    const malformedChat = {
      ...makeSession({ status: 'preparing', preparationAttempt: 1 }),
      continuation: { sourceAccountId: '' },
    } as Record<string, unknown>;
    Reflect.deleteProperty(malformedChat, 'chatId');
    await collection.doc('malformed-chat-session').set(malformedChat);
    const claim = await repository.claimPreparation({
      sessionId: 'malformed-chat-session',
      userId: 'user-123',
      attempt: 1,
      claimId: 'claim-malformed-chat',
      now: '2026-06-30T10:01:00.000Z',
      leaseExpiresAt: '2026-06-30T10:06:00.000Z',
    });
    expect(claim).toMatchObject({ status: 'claimed', session: { chatId: '' } });
    if (claim.status === 'claimed') expect(claim.session.continuation).toBeUndefined();
  });

  it('covers empty and unauthorized conditional preparation persistence boundaries', async () => {
    await expect(
      repository.saveClaimedPreparationSession({
        session: makeSession({
          id: 'missing-empty-preparation',
          status: 'ready',
          preparationAttempt: 1,
          transcriptText: '',
          transcriptSha256: '',
        }),
        attempt: 1,
        claimId: 'claim-missing-empty',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(false);

    const inactiveLeaseSession = makeSession({
      id: 'inactive-lease-preparation',
      status: 'failed',
      preparationAttempt: 1,
      preparationClaimId: 'claim-inactive-lease',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(inactiveLeaseSession);
    await expect(
      repository.saveClaimedPreparationSession({
        session: inactiveLeaseSession,
        attempt: 1,
        claimId: 'claim-inactive-lease',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(false);

    const activeClaim = makeSession({
      id: 'active-empty-preparation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'claim-active-empty',
      preparationLeaseExpiresAt: '2026-06-30T10:06:00.000Z',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(activeClaim);
    await expect(
      repository.saveClaimedPreparationSession({
        session: { ...activeClaim, preparationStage: 'building_context' },
        attempt: 1,
        claimId: 'claim-active-empty',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(true);

    const deniedClaim = makeSession({
      id: 'denied-empty-preparation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'claim-denied-empty',
      preparationLeaseExpiresAt: '2026-06-30T10:06:00.000Z',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(deniedClaim);
    const accountRef = fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc('user-123');
    await accountRef.delete();
    await expect(
      repository.saveClaimedPreparationSession({
        session: { ...deniedClaim, status: 'ready', preparationStage: 'ready' },
        attempt: 1,
        claimId: 'claim-denied-empty',
        now: '2026-06-30T10:01:00.000Z',
      })
    ).resolves.toBe(false);

    await expect(
      repository.requeueFailedPreparation({
        sessionId: 'denied-empty-preparation',
        userId: 'user-123',
        expectedAttempt: 1,
        updatedAt: '2026-06-30T10:02:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('keeps the current transcript snapshot when final persistence loses its fence', async () => {
    const pending = makeSession({
      id: 'same-transcript-snapshot-cleanup',
      generationId: 'same-transcript-generation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'same-transcript-claim',
      preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
      transcriptText: 'same transcript',
      transcriptSha256: 'same-transcript-hash',
    });
    await repository.saveSession(pending);
    const sessionRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(pending.id);
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    const transactionSpy = vi
      .spyOn(fakeFirestore, 'runTransaction')
      .mockImplementation(async (operation) => {
        transactionNumber += 1;
        if (transactionNumber === 2) {
          await sessionRef.update({ deletionStartedAt: '2026-07-21T10:00:30.000Z' });
        }
        return await originalRunTransaction(operation);
      });

    await expect(
      repository.saveClaimedPreparationSession({
        session: { ...pending, status: 'ready', preparationStage: 'ready' },
        attempt: 1,
        claimId: 'same-transcript-claim',
        now: '2026-07-21T10:01:00.000Z',
      })
    ).resolves.toBe(false);
    transactionSpy.mockRestore();
    const chunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${pending.id}_same-transcript-hash_000000`)
      .get();
    expect(chunk.exists).toBe(true);
    expect(chunk.data()?.['text']).toBe('same transcript');
  });

  it('rejects a pending context manifest that no longer matches ready publication', async () => {
    const pending = makeSession({
      id: 'mismatched-pending-context-manifest',
      generationId: 'mismatched-context-generation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'mismatched-context-claim',
      preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(pending);
    await expect(
      repository.saveContextSnapshot(
        pending.id,
        pending.userId,
        'mismatched-context-snapshot',
        { messages: [makeContextMessage('mismatched-context')], omittedMessages: [] },
        pending.generationId
      )
    ).resolves.toBe(true);
    const sessionRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(pending.id);
    const sessionDocument = await sessionRef.get();
    await sessionRef.update({
      pendingContextStorage: {
        ...(sessionDocument.data()?.['pendingContextStorage'] as Record<string, unknown>),
        snapshotId: 'replacement-context-snapshot',
      },
    });

    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...pending,
          status: 'ready',
          preparationStage: 'ready',
          contextSnapshotId: 'mismatched-context-snapshot',
        },
        attempt: 1,
        claimId: 'mismatched-context-claim',
        now: '2026-07-21T10:01:00.000Z',
      })
    ).resolves.toBe(false);
  });

  it('rejects an expired pending transcript chunk during ready publication', async () => {
    const pending = makeSession({
      id: 'expired-pending-transcript',
      generationId: 'expired-transcript-generation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'expired-transcript-claim',
      preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(pending);
    const chunkRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${pending.id}_expired-transcript-hash_000000`);
    const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    let transactionNumber = 0;
    const transactionSpy = vi
      .spyOn(fakeFirestore, 'runTransaction')
      .mockImplementation(async (operation) => {
        transactionNumber += 1;
        if (transactionNumber === 2) {
          await chunkRef.update({
            expireAt: Timestamp.fromMillis(Date.parse('2026-07-21T10:00:59.000Z')),
          });
        }
        return await originalRunTransaction(operation);
      });

    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...pending,
          status: 'ready',
          preparationStage: 'ready',
          transcriptText: 'pending transcript',
          transcriptSha256: 'expired-transcript-hash',
        },
        attempt: 1,
        claimId: 'expired-transcript-claim',
        now: '2026-07-21T10:01:00.000Z',
      })
    ).resolves.toBe(false);
    transactionSpy.mockRestore();
    expect((await chunkRef.get()).exists).toBe(false);
  });

  it('rejects transcript staging when ready context has no pending manifest', async () => {
    const pending = makeSession({
      id: 'missing-pending-context-manifest',
      generationId: 'missing-context-generation',
      status: 'preparing',
      preparationStage: 'loading_messages',
      preparationAttempt: 1,
      preparationClaimId: 'missing-context-claim',
      preparationLeaseExpiresAt: '2026-07-21T10:05:00.000Z',
      transcriptText: '',
      transcriptSha256: '',
    });
    await repository.saveSession(pending);

    await expect(
      repository.saveClaimedPreparationSession({
        session: {
          ...pending,
          status: 'ready',
          preparationStage: 'ready',
          contextSnapshotId: 'missing-context-snapshot',
          transcriptText: 'pending transcript',
          transcriptSha256: 'missing-context-transcript-hash',
        },
        attempt: 1,
        claimId: 'missing-context-claim',
        now: '2026-07-21T10:01:00.000Z',
      })
    ).resolves.toBe(false);
    const chunks = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .where('sessionId', '==', pending.id)
      .get();
    expect(chunks.empty).toBe(true);
  });

  it('hydrates assistant turn defaults and optional metadata', async () => {
    await repository.saveSession(makeSession());
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc('turn-partial')
      .set({
        sessionId: 'whatsapp_conv_session_1',
        userId: 'user-123',
        role: 'assistant',
        createdAt: null,
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.001 },
        error: { code: 'LLM_ERROR', message: 'failed' },
      });

    const listed = await repository.listTurnsBySessionId('whatsapp_conv_session_1');

    expect(listed).toEqual([
      {
        id: 'turn-partial',
        sessionId: 'whatsapp_conv_session_1',
        userId: 'user-123',
        role: 'assistant',
        text: '',
        createdAt: '',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.001 },
        error: { code: 'LLM_ERROR', message: 'failed' },
      },
    ]);
  });
});
