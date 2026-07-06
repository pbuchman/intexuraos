import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import {
  createConversationAssistantRepository,
  TRANSCRIPT_CHUNK_MAX_BYTES,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from '../../infra/firestore/conversationAssistantRepository.js';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';

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
      .doc('whatsapp_conv_session_1_000000')
      .get();
    const secondChunk = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc('whatsapp_conv_session_1_000001')
      .get();

    expect(loaded?.transcriptText).toBe(transcriptText);
    expect(listed.map((session) => session.id)).toEqual(['whatsapp_conv_session_1']);
    expect(storedDoc.data()?.['transcriptText']).toBeUndefined();
    expect(storedDoc.data()?.['transcriptStorage']).toEqual({
      type: 'chunks',
      chunkCount: 2,
      chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
      byteLength: TRANSCRIPT_CHUNK_MAX_BYTES + 1,
    });
    expect(firstChunk.data()).toMatchObject({
      sessionId: 'whatsapp_conv_session_1',
      chunkIndex: 0,
      text: 'a'.repeat(TRANSCRIPT_CHUNK_MAX_BYTES),
    });
    expect(secondChunk.data()).toMatchObject({
      sessionId: 'whatsapp_conv_session_1',
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
      status: 'archived',
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
