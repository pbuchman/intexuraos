import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import {
  CASCADE_DELETE_BATCH_SIZE,
  CONTEXT_CHUNK_MAX_BYTES,
  createConversationAssistantRepository,
  TRANSCRIPT_CHUNK_MAX_BYTES,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from '../../infra/firestore/conversationAssistantRepository.js';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';
import { createConversationAssistantDeletionToken } from '../../domain/conversation-assistant/deletionToken.js';

function makeSession(overrides: Partial<ConversationAssistantSession> = {}): ConversationAssistantSession {
  return {
    id: 'whatsapp_conv_session_1',
    userId: 'user-123',
    chatId: 'chat-123',
    chatDisplayName: 'Alice',
    status: 'active',
    range: { from: '2026-06-30T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
    effectiveRange: { from: '2026-06-30T10:00:00.000Z', to: '2026-06-30T10:00:00.000Z' },
    model: 'or:google/gemini-3.5-flash',
    transcriptSha256: 'hash',
    transcriptMessageCount: 1,
    transcriptText: '[2026-06-30T10:00:00.000Z] Alice: hello',
    assistantRoleLabel: 'Doctor',
    omitted: { mediaOnly: 0, failedTranscriptions: 0, pendingTranscriptions: 0, nonText: 0, overLimit: 0 },
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
  });

  afterEach(() => {
    resetFirestore();
  });

  it('keeps cascade-delete transactions below a conservative Firestore payload budget', () => {
    const largestChunkBytes = Math.max(TRANSCRIPT_CHUNK_MAX_BYTES, CONTEXT_CHUNK_MAX_BYTES);

    expect(CASCADE_DELETE_BATCH_SIZE * largestChunkBytes).toBeLessThanOrEqual(5_000_000);
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
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(async (updateFn) =>
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

  it('stores and lists turns chronologically by session', async () => {
    await repository.saveTurn(makeTurn({ id: 'turn-2', role: 'assistant', createdAt: '2026-06-30T10:02:00.000Z' }));
    await repository.saveTurn(makeTurn({ id: 'turn-1', role: 'user', createdAt: '2026-06-30T10:01:00.000Z' }));
    await repository.saveTurn(makeTurn({ id: 'foreign-turn', sessionId: 'other-session' }));

    const listed = await repository.listTurnsBySessionId('whatsapp_conv_session_1');
    const storedDoc = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc('turn-2')
      .get();

    expect(listed.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2']);
    expect(storedDoc.data()?.['role']).toBe('assistant');
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
    await expect(repository.getSessionById('foreign-session')).resolves.not.toBeNull();
    await expect(repository.listTurnsBySessionId('foreign-session')).resolves.toHaveLength(1);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('foreign-context')
          .get()
      ).exists
    ).toBe(true);

    await expect(
      repository.deleteSession(deletionInput(ownedSession))
    ).resolves.toBeUndefined();
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

    await expect(
      repository.saveTurnIfSessionExists(userTurn, session.generationId)
    ).resolves.toBe(true);
    await expect(
      repository.saveAssistantTurnAndTouchSession({ session, turn: assistantTurn })
    ).resolves.toBe(true);
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toHaveLength(2);
    await expect(repository.getSessionById(session.id)).resolves.toMatchObject({
      updatedAt: assistantTurn.createdAt,
      lastTurnAt: assistantTurn.createdAt,
    });

    await repository.deleteSession(deletionInput(session));
    await expect(
      repository.saveTurnIfSessionExists(userTurn, session.generationId)
    ).resolves.toBe(false);
    await expect(
      repository.saveAssistantTurnAndTouchSession({ session, turn: assistantTurn })
    ).resolves.toBe(false);
    await expect(repository.getSessionById(session.id)).resolves.toBeNull();
    await expect(repository.listTurnsBySessionId(session.id)).resolves.toEqual([]);
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

    await expect(
      repository.deleteSession(deletionInput(session))
    ).rejects.toThrow('interrupted cascade');
    const storedDuringDeletion = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id)
      .get();
    expect(storedDuringDeletion.exists).toBe(true);
    expect(storedDuringDeletion.data()?.['deletionStartedAt']).toEqual(expect.any(String));
    await expect(repository.getSessionById(session.id)).resolves.toBeNull();
    await expect(repository.listSessionsByUserId(session.userId)).resolves.toEqual([
      expect.objectContaining({ id: session.id, deletionStartedAt: expect.any(String) }),
    ]);

    const saveTurnForGeneration = repository.saveTurnIfSessionExists as unknown as (
      turn: ConversationAssistantTurn,
      expectedGenerationId: string | undefined
    ) => Promise<boolean>;
    await expect(
      saveTurnForGeneration(makeTurn({ id: 'turn-during-delete' }), 'generation-delete')
    ).resolves.toBe(false);

    transactionSpy.mockRestore();
    await expect(
      repository.deleteSession(deletionInput(session))
    ).resolves.toBeUndefined();
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

  it('creates a session only once without overwriting a preparation claim', async () => {
    const queued = makeSession({
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: 1,
      transcriptSha256: '',
      transcriptText: '',
    });
    const created = await repository.createSessionIfAbsent(queued);
    expect(created.status).toBe('created');
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
    expect(
      (await repository.getSessionById(queued.id))?.preparationClaimId
    ).toBe('active-claim');

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
    });
    expect(oldGenerationSave).toBe(false);
    if (secondClaim.status !== 'claimed') return;

    const saved = await repository.saveClaimedPreparationSession({
      session: { ...secondClaim.session, status: 'ready', preparationStage: 'ready' },
      attempt: 2,
      claimId: 'claim-generation-2',
    });
    expect(saved).toBe(true);
    expect((await repository.getSessionById('whatsapp_conv_session_1'))?.status).toBe('ready');
  });

  it('does not let stale claim cleanup remove a newer claim transcript', async () => {
    const claimedByA = {
      ...makeSession({
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationAttempt: 1,
        preparationClaimId: 'claim-a',
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
    expect((await repository.getSessionById('whatsapp_conv_session_1'))?.status).toBe(
      'preparing'
    );
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

    await repository.saveContextSnapshot(
      'whatsapp_conv_session_1',
      'user-123',
      'snapshot-1',
      { messages: [firstMessage, secondMessage], omittedMessages: [] }
    );

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

    await repository.saveContextSnapshot(
      'whatsapp_conv_session_1',
      'user-123',
      'snapshot-1',
      { messages: [secondMessage], omittedMessages: [] }
    );

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
    await repository.saveContextSnapshot(
      'whatsapp_conv_session_1',
      'user-123',
      'snapshot-delete',
      { messages: [message], omittedMessages: [] }
    );
    await repository.saveContextSnapshot(
      'whatsapp_conv_session_1',
      'user-123',
      'snapshot-keep',
      { messages: [message], omittedMessages: [] }
    );

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
    await repository.saveTurn(makeTurn({ id: 'turn-2', role: 'assistant', createdAt: '2026-06-30T10:02:00.000Z' }));
    await repository.saveTurn(makeTurn({ id: 'turn-1', role: 'user', createdAt: '2026-06-30T10:01:00.000Z' }));
    await repository.saveTurn(makeTurn({ id: 'foreign-turn', sessionId: 'other-session' }));
    await repository.saveTurn(
      makeTurn({ id: 'foreign-user-turn', userId: 'other-user', createdAt: '2026-06-30T10:03:00.000Z' })
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
    const invalidShape = await repository.getSessionById('whatsapp_conv_session_invalid_storage_shape');

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

  it('returns null for missing sessions and hydrates defensive defaults', async () => {
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

    expect(empty?.chatDisplayName).toBeUndefined();
    expect(empty?.lastTurnAt).toBeUndefined();
    expect(loaded).toEqual({
      id: 'whatsapp_conv_session_partial',
      userId: '',
      chatId: '',
      status: 'ready',
      range: { from: '', to: '' },
      effectiveRange: { from: '', to: '' },
      model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
      transcriptSha256: '',
      transcriptMessageCount: 0,
      transcriptText: '',
      assistantRoleLabel: 'Assistant',
      omitted: { mediaOnly: 0, failedTranscriptions: 0, pendingTranscriptions: 0, nonText: 0, overLimit: 0 },
      title: '',
      createdAt: '',
      updatedAt: '',
      chatDisplayName: 'Alice',
      lastTurnAt: '2026-06-30T10:03:00.000Z',
    });
    expect(empty?.assistantRoleLabel).toBe('Assistant');
  });

  it('preserves unknown legacy models while defaulting missing model values', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_missing_model')
      .set({
        userId: 'user-123',
      });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc('whatsapp_conv_session_legacy_model')
      .set({
        userId: 'user-123',
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

  it('hydrates assistant turn defaults and optional metadata', async () => {
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc('turn-partial')
      .set({
        sessionId: 'whatsapp_conv_session_1',
        role: 'assistant',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.001 },
        error: { code: 'LLM_ERROR', message: 'failed' },
      });

    const listed = await repository.listTurnsBySessionId('whatsapp_conv_session_1');

    expect(listed).toEqual([
      {
        id: 'turn-partial',
        sessionId: 'whatsapp_conv_session_1',
        userId: '',
        role: 'assistant',
        text: '',
        createdAt: '',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.001 },
        error: { code: 'LLM_ERROR', message: 'failed' },
      },
    ]);
  });
});
