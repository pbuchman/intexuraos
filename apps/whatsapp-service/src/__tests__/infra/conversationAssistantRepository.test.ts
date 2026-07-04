import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createConversationAssistantRepository,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
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
    model: 'or:google/gemini-3.5-flash',
    transcriptSha256: 'hash',
    transcriptMessageCount: 1,
    transcriptText: '[2026-06-30T10:00:00.000Z] Alice: hello',
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

  it('stores private transcript text on sessions and lists only the owning user sessions', async () => {
    await repository.saveSession(makeSession());
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

    expect(loaded?.transcriptText).toContain('Alice: hello');
    expect(listed.map((session) => session.id)).toEqual(['whatsapp_conv_session_1']);
    expect(storedDoc.data()?.['transcriptText']).toContain('Alice: hello');
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

  it('loads a session snapshot with turns from one repository call', async () => {
    await repository.saveSession(makeSession());
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
    expect(snapshot?.turns.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2']);
    expect(missing).toBeNull();
    expect(foreign).toBeNull();
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
      model: '',
      transcriptSha256: '',
      transcriptMessageCount: 0,
      transcriptText: '',
      omitted: { mediaOnly: 0, failedTranscriptions: 0, pendingTranscriptions: 0, nonText: 0, overLimit: 0 },
      title: '',
      createdAt: '',
      updatedAt: '',
      chatDisplayName: 'Alice',
      lastTurnAt: '2026-06-30T10:03:00.000Z',
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
