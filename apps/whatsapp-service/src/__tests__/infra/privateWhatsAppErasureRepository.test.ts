import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ok, type Result } from '@intexuraos/common-core';
import {
  Timestamp,
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import { FakeMediaStorage } from '../fakes.js';
import { processPrivateWhatsAppErasureBatch } from '../../domain/whatsapp/usecases/privateWhatsAppErasure.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';
import type { PrivateWhatsAppErasureWorkItem } from '../../domain/whatsapp/models/PrivateWhatsAppErasure.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
} from '../../infra/firestore/conversationAssistantContextAttachmentRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from '../../infra/firestore/conversationAssistantRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION,
} from '../../infra/firestore/conversationAssistantTurnRequestRepository.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
  PRIVATE_WHATSAPP_SENDERS_COLLECTION,
  PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';
import {
  PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION,
  createPrivateWhatsAppErasureRepository,
} from '../../infra/firestore/privateWhatsAppErasureRepository.js';

const USER_ID = 'user-1';
const SOURCE_ACCOUNT_ID = 'source-1';
const GENERATION_ID = 'generation-1';
const REQUEST_ID = 'erase-1';
const NOW = '2026-07-21T10:00:00.000Z';

function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    generationId: GENERATION_ID,
    phoneNumberNormalized: '48123456789',
    displayName: 'Test',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...overrides,
  };
}

function startInput(overrides: Record<string, string> = {}): {
  sourceAccountId: string;
  userId: string;
  erasureRequestId: string;
  now: string;
} {
  return {
    sourceAccountId: SOURCE_ACCOUNT_ID,
    userId: USER_ID,
    erasureRequestId: REQUEST_ID,
    now: NOW,
    ...overrides,
  };
}

function owned(sourceAccountId = SOURCE_ACCOUNT_ID): Record<string, unknown> {
  return { userId: USER_ID, sourceAccountId };
}

function storedRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    erasureRequestId: REQUEST_ID,
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    accountGeneration: GENERATION_ID,
    status: 'running',
    stage: 'assistant_sessions',
    counts: {
      assistantSessions: 0,
      assistantTurns: 0,
      assistantTranscriptChunks: 0,
      assistantContextChunks: 0,
      assistantContextAttachments: 0,
      assistantTurnRequests: 0,
      sourceContextChanges: 0,
      sourceMessages: 0,
      sourceChats: 0,
      sourceSenders: 0,
      sourceSenderDays: 0,
      privateMediaObjects: 0,
      sourceAccounts: 0,
    },
    attempt: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('privateWhatsAppErasureRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createPrivateWhatsAppErasureRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createPrivateWhatsAppErasureRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  it('atomically creates one durable request and fences the exact account generation', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
    ]);

    const started = await repository.start(startInput());

    expect(started.ok).toBe(true);
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');
    expect(started.value.request).toEqual({
      erasureRequestId: REQUEST_ID,
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      accountGeneration: GENERATION_ID,
      status: 'queued',
      stage: 'assistant_sessions',
      counts: {
        assistantSessions: 0,
        assistantTurns: 0,
        assistantTranscriptChunks: 0,
        assistantContextChunks: 0,
        assistantContextAttachments: 0,
        assistantTurnRequests: 0,
        sourceContextChanges: 0,
        sourceMessages: 0,
        sourceChats: 0,
        sourceSenders: 0,
        sourceSenderDays: 0,
        privateMediaObjects: 0,
        sourceAccounts: 0,
      },
      attempt: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(
      (
        await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).get()
      ).data()
    ).toMatchObject({
      status: 'disabled',
      erasureStatus: 'erasing',
      erasureRequestId: REQUEST_ID,
      generationId: GENERATION_ID,
    });
    await expect(
      repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toEqual({ ok: true, value: started.value.request });
  });

  it('replays the same request and rejects id, account, and generation conflicts', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
    ]);
    const created = await repository.start(startInput());
    const replay = await repository.start(startInput({ now: '2026-07-21T10:01:00.000Z' }));
    const requestIdConflict = await repository.start(
      startInput({ sourceAccountId: 'foreign-source' })
    );
    const activeRequestConflict = await repository.start(
      startInput({ erasureRequestId: 'erase-2' })
    );

    expect(created.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!created.ok || !replay.ok) throw new Error('Expected successful starts');
    expect(replay.value).toEqual({
      status: 'existing',
      request: created.value.status === 'created' ? created.value.request : undefined,
    });
    expect(requestIdConflict).toEqual({ ok: true, value: { status: 'conflict' } });
    expect(activeRequestConflict).toEqual({ ok: true, value: { status: 'conflict' } });

    const missing = await repository.start(
      startInput({ userId: 'missing-user', erasureRequestId: 'erase-missing' })
    );
    expect(missing).toEqual({ ok: true, value: { status: 'not_found' } });

    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: 'mismatch-user',
        data: account({ userId: 'mismatch-user', sourceAccountId: 'different-source' }),
      },
    ]);
    const mismatch = await repository.start(
      startInput({ userId: 'mismatch-user', erasureRequestId: 'erase-mismatch' })
    );
    expect(mismatch).toEqual({ ok: true, value: { status: 'not_found' } });
  });

  it('serializes competing starts so exactly one request owns the fence', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
    ]);

    const [first, second] = await Promise.all([
      repository.start(startInput({ erasureRequestId: 'erase-a' })),
      repository.start(startInput({ erasureRequestId: 'erase-b' })),
    ]);

    expect(first).toMatchObject({ ok: true, value: { status: 'created' } });
    expect(second).toEqual({ ok: true, value: { status: 'conflict' } });
    expect(
      (
        await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).get()
      ).data()?.['erasureRequestId']
    ).toBe('erase-a');
  });

  it('loads status without userId and hides an existing request from a mismatched source account', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account({ generationId: undefined }) },
    ]);
    const started = await repository.start(startInput());
    expect(started.ok).toBe(true);
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');
    expect(started.value.request.accountGeneration).toBe(SOURCE_ACCOUNT_ID);

    await expect(
      repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toMatchObject({ ok: true, value: { userId: USER_ID } });
    await expect(
      repository.get({
        sourceAccountId: 'foreign-source',
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it('fails malformed assistant recovery targets without deleting a replacement session', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      {
        id: REQUEST_ID,
        data: storedRequest({
          stage: 'assistant_sessions',
          activeAssistantSessionId: 'replacement-session',
        }),
      },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: 'replacement-session',
        data: { userId: 'foreign-user', continuation: null },
      },
    ]);
    const skipped = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: 0,
      batchSize: 20,
    });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok || skipped.value.status !== 'advanced') throw new Error('Expected advanced');
    expect(skipped.value.request.counts.assistantSessions).toBe(0);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc('replacement-session')
          .get()
      ).exists
    ).toBe(true);

    fakeFirestore.clear();
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      {
        id: REQUEST_ID,
        data: storedRequest({
          stage: 'assistant_sessions',
          activeAssistantSessionId: 'malformed-session',
        }),
      },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: 'malformed-session',
        data: { userId: USER_ID, continuation: { sourceAccountId: 42 } },
      },
    ]);
    await expect(
      repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 0,
        batchSize: 20,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'advanced', request: { counts: { assistantSessions: 0 } } },
    });

    fakeFirestore.clear();
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      {
        id: REQUEST_ID,
        data: storedRequest({
          status: 'failed',
          failureCode: 'INVALID_STORED_REQUEST',
        }),
      },
    ]);
    const reloadedFailure = await repository.get({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      erasureRequestId: REQUEST_ID,
    });
    expect(reloadedFailure).toMatchObject({
      ok: true,
      value: { failureCode: 'INVALID_STORED_REQUEST' },
    });
  });

  it('uses a top-level session source account as the authoritative ownership fence', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      {
        id: REQUEST_ID,
        data: storedRequest({
          stage: 'assistant_sessions',
          activeAssistantSessionId: 'session-with-conflicting-ownership',
        }),
      },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: 'session-with-conflicting-ownership',
        data: {
          userId: USER_ID,
          sourceAccountId: 'replacement-source',
          continuation: { sourceAccountId: SOURCE_ACCOUNT_ID },
          chatId: 'owned-chat',
        },
      },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
      { id: 'owned-chat', data: owned() },
    ]);

    const skipped = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: 0,
      batchSize: 20,
    });

    expect(skipped).toMatchObject({
      ok: true,
      value: { status: 'advanced', request: { counts: { assistantSessions: 0 } } },
    });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc('session-with-conflicting-ownership')
          .get()
      ).exists
    ).toBe(true);
  });

  it.each([
    { sourceAccountGeneration: GENERATION_ID, expectedDeleted: 1 },
    { sourceAccountGeneration: undefined, expectedDeleted: 1 },
    { sourceAccountGeneration: 'replacement-generation', expectedDeleted: 0 },
  ])(
    'fences a directly owned session by source generation $sourceAccountGeneration',
    async ({ sourceAccountGeneration, expectedDeleted }) => {
      fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
        {
          id: REQUEST_ID,
          data: storedRequest({
            stage: 'assistant_sessions',
            activeAssistantSessionId: 'direct-session',
          }),
        },
      ]);
      fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
        {
          id: 'direct-session',
          data: {
            userId: USER_ID,
            sourceAccountId: SOURCE_ACCOUNT_ID,
            ...(sourceAccountGeneration === undefined ? {} : { sourceAccountGeneration }),
            continuation: { sourceAccountId: 'foreign-source' },
          },
        },
      ]);

      const advanced = await repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 0,
        batchSize: 20,
      });

      expect(advanced).toMatchObject({
        ok: true,
        value: {
          status: 'advanced',
          request: { counts: { assistantSessions: expectedDeleted } },
        },
      });
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
            .doc('direct-session')
            .get()
        ).exists
      ).toBe(expectedDeleted === 0);
    }
  );

  it('rejects inconsistent stored stages and missing assistant targets as persistence corruption', async () => {
    for (const data of [
      storedRequest({ stage: 'completed' }),
      storedRequest({ stage: 'assistant_turns' }),
    ]) {
      fakeFirestore.clear();
      fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
        { id: REQUEST_ID, data },
      ]);
      const result = await repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 0,
        batchSize: 20,
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
    }
    fakeFirestore.clear();
  });

  it('deletes every owned source and assistant document in bounded retry-safe batches', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
      { id: 'foreign-user', data: account({ userId: 'foreign-user', sourceAccountId: 'foreign' }) },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: 'session-1',
        data: {
          userId: USER_ID,
          generationId: 'session-generation-1',
          continuation: { sourceAccountId: SOURCE_ACCOUNT_ID },
        },
      },
      {
        id: 'session-foreign',
        data: {
          userId: USER_ID,
          generationId: 'session-generation-foreign',
          continuation: { sourceAccountId: 'foreign' },
        },
      },
      {
        id: 'session-legacy',
        data: {
          userId: USER_ID,
          generationId: 'session-generation-legacy',
          chatId: 'legacy-chat',
        },
      },
    ]);
    for (const [collectionName, prefix] of [
      [WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION, 'turn'],
      [WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION, 'transcript'],
      [WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, 'context'],
      [WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION, 'attachment'],
      [WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION, 'request'],
    ] as const) {
      fakeFirestore.seedCollection(collectionName, [
        {
          id: `${prefix}-1`,
          data: { sessionId: 'session-1', sessionGenerationId: 'session-generation-1' },
        },
        {
          id: `${prefix}-2`,
          data: { sessionId: 'session-1', sessionGenerationId: 'session-generation-1' },
        },
        {
          id: `${prefix}-foreign`,
          data: {
            sessionId: 'session-foreign',
            sessionGenerationId: 'session-generation-foreign',
          },
        },
        {
          id: `${prefix}-legacy`,
          data: { sessionId: 'session-legacy', sessionGenerationId: 'session-generation-legacy' },
        },
      ]);
    }
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
      { id: 'legacy-chat', data: owned() },
    ]);
    for (const collectionName of [
      PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
      PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
      PRIVATE_WHATSAPP_CHATS_COLLECTION,
      PRIVATE_WHATSAPP_SENDERS_COLLECTION,
      PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
    ]) {
      fakeFirestore.seedCollection(collectionName, [
        { id: `${collectionName}-1`, data: owned() },
        { id: `${collectionName}-2`, data: owned() },
        { id: `${collectionName}-foreign`, data: owned('foreign') },
      ]);
    }
    const started = await repository.start(startInput());
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');

    let request = started.value.request;
    for (let eventCount = 0; request.status !== 'completed' && eventCount < 100; eventCount += 1) {
      const beforeCount = Array.from(fakeFirestore.getAllData().values()).reduce(
        (sum, documents) => sum + documents.size,
        0
      );
      let advanced = await repository.advanceOneBatch({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        userId: USER_ID,
        erasureRequestId: REQUEST_ID,
        expectedAttempt: request.attempt,
        batchSize: 1,
        now: `2026-07-21T10:${String(eventCount + 1).padStart(2, '0')}:00.000Z`,
      });
      if (advanced.ok && advanced.value.status === 'private_media') {
        advanced = await repository.commitPrivateMediaBatch({
          ...startInput(),
          expectedAttempt: request.attempt,
          ...(advanced.value.cursor === undefined
            ? {}
            : { expectedCursor: advanced.value.cursor }),
          batch: { status: 'empty', deletedCount: 0 },
        });
      }
      expect(advanced.ok).toBe(true);
      if (!advanced.ok || advanced.value.status === 'stale' || advanced.value.status === 'not_found') {
        throw new Error('Expected progress');
      }
      request = advanced.value.request;
      const afterCount = Array.from(fakeFirestore.getAllData().values()).reduce(
        (sum, documents) => sum + documents.size,
        0
      );
      expect(beforeCount - afterCount).toBeLessThanOrEqual(1);
    }

    expect(request).toMatchObject({
      status: 'completed',
      stage: 'completed',
      counts: {
        assistantSessions: 2,
        assistantTurns: 3,
        assistantTranscriptChunks: 3,
        assistantContextChunks: 3,
        assistantContextAttachments: 3,
        assistantTurnRequests: 3,
        sourceContextChanges: 2,
        sourceMessages: 2,
        sourceChats: 3,
        sourceSenders: 2,
        sourceSenderDays: 2,
        privateMediaObjects: 0,
        sourceAccounts: 1,
      },
    });
    expect(request.completedAt).toBeDefined();
    const storedTerminal = (
      await fakeFirestore
        .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION)
        .doc(REQUEST_ID)
        .get()
    ).data();
    expect(storedTerminal?.['identityPseudonymized']).toBe(true);
    expect(storedTerminal?.['expireAt']).toBeInstanceOf(Timestamp);
    expect((storedTerminal?.['expireAt'] as Timestamp).toMillis()).toBe(
      Date.parse(request.completedAt ?? '') + 30 * 24 * 60 * 60 * 1000
    );
    expect(storedTerminal?.['erasureRequestId']).not.toBe(REQUEST_ID);
    expect(storedTerminal?.['userId']).not.toBe(USER_ID);
    expect(storedTerminal?.['sourceAccountId']).not.toBe(SOURCE_ACCOUNT_ID);
    expect(storedTerminal?.['accountGeneration']).not.toBe(GENERATION_ID);
    expect(JSON.stringify(storedTerminal)).not.toContain(USER_ID);
    expect(JSON.stringify(storedTerminal)).not.toContain(SOURCE_ACCOUNT_ID);
    expect(JSON.stringify(storedTerminal)).not.toContain(GENERATION_ID);
    const reloaded = await repository.get({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      erasureRequestId: REQUEST_ID,
    });
    expect(reloaded).toMatchObject({
      ok: true,
      value: { status: 'completed', completedAt: expect.any(String) },
    });
    await expect(
      repository.get({
        sourceAccountId: 'foreign-source',
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(repository.start(startInput())).resolves.toMatchObject({
      ok: true,
      value: { status: 'existing', request: { status: 'completed' } },
    });
    for (const collectionName of [
      WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
      WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
      WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION,
      PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
      PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
      PRIVATE_WHATSAPP_CHATS_COLLECTION,
      PRIVATE_WHATSAPP_SENDERS_COLLECTION,
      PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
    ]) {
      const docs = await fakeFirestore.collection(collectionName).get();
      expect(docs.docs.map((doc) => doc.id)).toEqual([expect.stringContaining('foreign')]);
    }
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).get())
        .exists
    ).toBe(false);
  });

  it('does not double-delete or double-count when a completed batch event is delivered again', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      { id: 'message-1', data: owned() },
      { id: 'message-2', data: owned() },
      { id: 'message-3', data: owned() },
    ]);
    const started = await repository.start(startInput());
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');
    let request = started.value.request;
    while (request.stage !== 'source_messages') {
      const advanced = await repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: request.attempt,
        batchSize: 2,
      });
      if (!advanced.ok || advanced.value.status === 'stale' || advanced.value.status === 'not_found') {
        throw new Error('Expected progress');
      }
      request = advanced.value.request;
    }

    const attempt = request.attempt;
    const first = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: attempt,
      batchSize: 2,
    });
    const replay = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: attempt,
      batchSize: 2,
    });

    expect(first.ok).toBe(true);
    if (!first.ok || first.value.status !== 'advanced') throw new Error('Expected advanced');
    expect(first.value.request.counts.sourceMessages).toBe(2);
    expect(replay).toEqual({ ok: true, value: { status: 'stale' } });
    expect((await fakeFirestore.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).get()).size).toBe(
      1
    );
  });

  it('fails closed on a replacement account generation and completes recovery if the old account is absent', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
    ]);
    const started = await repository.start(startInput());
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');
    let request = started.value.request;
    while (request.stage !== 'source_account') {
      let advanced = await repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: request.attempt,
        batchSize: 20,
      });
      if (advanced.ok && advanced.value.status === 'private_media') {
        advanced = await repository.commitPrivateMediaBatch({
          ...startInput(),
          expectedAttempt: request.attempt,
          ...(advanced.value.cursor === undefined
            ? {}
            : { expectedCursor: advanced.value.cursor }),
          batch: { status: 'empty', deletedCount: 0 },
        });
      }
      if (!advanced.ok || advanced.value.status === 'stale' || advanced.value.status === 'not_found') {
        throw new Error('Expected progress');
      }
      request = advanced.value.request;
    }
    await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).set(
      account({ sourceAccountId: 'new-source', generationId: 'new-generation', status: 'active' })
    );
    const failed = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: request.attempt,
      batchSize: 20,
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok || failed.value.status !== 'failed') throw new Error('Expected failure');
    expect(failed.value.request).toMatchObject({
      status: 'failed',
      failureCode: 'ACCOUNT_GENERATION_CHANGED',
    });
    await expect(
      repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { failureCode: 'ACCOUNT_GENERATION_CHANGED' },
    });
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).get())
        .exists
    ).toBe(true);

    fakeFirestore.clear();
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      {
        id: REQUEST_ID,
        data: {
          ...request,
          stage: 'source_account',
          status: 'running',
        },
      },
    ]);
    const recovered = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: request.attempt,
      batchSize: 20,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok || recovered.value.status !== 'completed') {
      throw new Error('Expected completed recovery');
    }
    expect(recovered.value.request.counts.sourceAccounts).toBe(0);
  });

  it('persists a bounded private-media cursor and requires a full zero-object rescan before account deletion', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: account({
          status: 'disabled',
          erasureStatus: 'erasing',
          erasureRequestId: REQUEST_ID,
        }),
      },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      { id: REQUEST_ID, data: storedRequest({ stage: 'private_media' }) },
    ]);

    const pending = await repository.advanceOneBatch({
      ...startInput(),
      expectedAttempt: 0,
      batchSize: 20,
    });
    expect(pending).toMatchObject({
      ok: true,
      value: { status: 'private_media', request: { attempt: 0 } },
    });
    if (pending.ok) expect(pending.value).not.toHaveProperty('cursor');

    type CommitPrivateMediaBatch = (input: {
      sourceAccountId: string;
      userId: string;
      erasureRequestId: string;
      expectedAttempt: number;
      expectedCursor?: string;
      batch:
        | { status: 'advanced'; deletedCount: number; nextCursor: string }
        | { status: 'retry'; deletedCount: number }
        | { status: 'empty'; deletedCount: 0 };
      now: string;
    }) => ReturnType<typeof repository.advanceOneBatch>;
    const commit = (
      repository as typeof repository & { commitPrivateMediaBatch?: CommitPrivateMediaBatch }
    ).commitPrivateMediaBatch;
    expect(commit).toBeDefined();
    if (commit === undefined) return;

    const cursor = 'whatsapp/private/user-1/message-b/original.jpg';
    const advanced = await commit({
      ...startInput(),
      expectedAttempt: 0,
      batch: { status: 'advanced', deletedCount: 2, nextCursor: cursor },
    });
    expect(advanced).toMatchObject({
      ok: true,
      value: {
        status: 'advanced',
        request: {
          stage: 'private_media',
          attempt: 1,
          counts: { privateMediaObjects: 2 },
        },
      },
    });

    const retry = await commit({
      ...startInput(),
      expectedAttempt: 1,
      expectedCursor: cursor,
      batch: { status: 'retry', deletedCount: 1 },
    });
    expect(retry).toMatchObject({
      ok: true,
      value: {
        status: 'advanced',
        request: { attempt: 2, counts: { privateMediaObjects: 3 } },
      },
    });
    await expect(
      repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 2,
        batchSize: 20,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'private_media', cursor },
    });

    const endOfScan = await commit({
      ...startInput(),
      expectedAttempt: 2,
      expectedCursor: cursor,
      batch: { status: 'empty', deletedCount: 0 },
    });
    expect(endOfScan).toMatchObject({
      ok: true,
      value: { status: 'advanced', request: { stage: 'private_media', attempt: 3 } },
    });
    const restartedScan = await repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 3,
        batchSize: 20,
      });
    expect(restartedScan).toMatchObject({
      ok: true,
      value: { status: 'private_media' },
    });
    if (restartedScan.ok) expect(restartedScan.value).not.toHaveProperty('cursor');

    const verifiedEmpty = await commit({
      ...startInput(),
      expectedAttempt: 3,
      batch: { status: 'empty', deletedCount: 0 },
    });
    expect(verifiedEmpty).toMatchObject({
      ok: true,
      value: { status: 'advanced', request: { stage: 'source_account', attempt: 4 } },
    });
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).get())
        .exists
    ).toBe(true);

    await expect(
      commit({
        ...startInput(),
        expectedAttempt: 0,
        batch: { status: 'advanced', deletedCount: 2, nextCursor: cursor },
      })
    ).resolves.toEqual({ ok: true, value: { status: 'stale' } });
  });

  it('erases originals, thumbnails, and orphaned private objects across retries and a late prefix rescan', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: USER_ID, data: account() },
    ]);
    const mediaStorage = new FakeMediaStorage();
    const expectedDeletedPaths: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const uploaded = await mediaStorage.uploadPrivateMedia(
        USER_ID,
        `message-${String(index).padStart(2, '0')}`,
        'original',
        'jpg',
        Buffer.from(`original-${String(index)}`),
        'image/jpeg'
      );
      if (!uploaded.ok) throw new Error('Expected private media upload');
      expectedDeletedPaths.push(uploaded.value.gcsPath);
    }
    const thumbnail = await mediaStorage.uploadPrivateThumbnail(
      USER_ID,
      'message-00',
      'original',
      'jpg',
      Buffer.from('thumbnail'),
      'image/jpeg'
    );
    const orphan = await mediaStorage.uploadPrivateMedia(
      USER_ID,
      'orphan-message',
      'orphan',
      'bin',
      Buffer.from('orphan'),
      'application/octet-stream'
    );
    const foreign = await mediaStorage.uploadPrivateMedia(
      'foreign-user',
      'message-00',
      'original',
      'jpg',
      Buffer.from('foreign'),
      'image/jpeg'
    );
    if (!thumbnail.ok || !orphan.ok || !foreign.ok) {
      throw new Error('Expected private media fixtures');
    }
    expectedDeletedPaths.push(thumbnail.value.gcsPath, orphan.value.gcsPath);

    const started = await repository.start(startInput());
    if (!started.ok || started.value.status !== 'created') throw new Error('Expected created');
    const pending: PrivateWhatsAppErasureWorkItem[] = [
      {
        type: 'whatsapp.private-account.erasure',
        sourceAccountId: SOURCE_ACCOUNT_ID,
        userId: USER_ID,
        erasureRequestId: REQUEST_ID,
        attempt: started.value.request.attempt,
      },
    ];
    const publisher = {
      publishPrivateWhatsAppErasure: (
        event: PrivateWhatsAppErasureWorkItem
      ): Promise<Result<void, WhatsAppError>> => {
        pending.push(event);
        return Promise.resolve(ok(undefined));
      },
    };
    let failedMediaBatch = false;
    let injectedLateObject = false;
    let replayedCompletedBatch = false;
    let completed = false;
    let deliveryCount = 0;

    while (pending.length > 0 && deliveryCount < 100) {
      const event = pending.shift();
      if (event === undefined) throw new Error('Expected queued erasure event');
      const before = await repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      });
      const isCurrentMediaBatch =
        before.ok &&
        before.value?.stage === 'private_media' &&
        before.value.attempt === event.attempt;
      const shouldFailThisBatch = isCurrentMediaBatch && !failedMediaBatch;
      if (shouldFailThisBatch) {
        failedMediaBatch = true;
        mediaStorage.setFailDelete(true);
      }

      const result = await processPrivateWhatsAppErasureBatch(event, {
        repository,
        publisher,
        mediaStorage,
        now: () => NOW,
      });
      mediaStorage.setFailDelete(false);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Expected erasure progress');
      completed ||= result.value.status === 'completed';
      deliveryCount += 1;

      const after = await repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      });
      if (
        isCurrentMediaBatch &&
        !shouldFailThisBatch &&
        !injectedLateObject &&
        after.ok &&
        after.value !== null &&
        after.value.counts.privateMediaObjects >= 20
      ) {
        const late = await mediaStorage.uploadPrivateMedia(
          USER_ID,
          '000-late-message',
          'late-orphan',
          'bin',
          Buffer.from('late'),
          'application/octet-stream'
        );
        if (!late.ok) throw new Error('Expected late private media fixture');
        expectedDeletedPaths.push(late.value.gcsPath);
        injectedLateObject = true;

        await expect(
          processPrivateWhatsAppErasureBatch(event, {
            repository,
            publisher,
            mediaStorage,
            now: () => NOW,
          })
        ).resolves.toEqual(ok({ status: 'replayed' }));
        replayedCompletedBatch = true;
      }
    }

    expect(deliveryCount).toBeLessThan(100);
    expect({ failedMediaBatch, injectedLateObject, replayedCompletedBatch, completed }).toEqual({
      failedMediaBatch: true,
      injectedLateObject: true,
      replayedCompletedBatch: true,
      completed: true,
    });
    const final = await repository.get({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      erasureRequestId: REQUEST_ID,
    });
    expect(final).toMatchObject({
      ok: true,
      value: {
        status: 'completed',
        counts: { privateMediaObjects: expectedDeletedPaths.length, sourceAccounts: 1 },
      },
    });
    expect(
      Array.from(mediaStorage.getAllFiles().keys()).filter((path) =>
        path.startsWith(`whatsapp/private/${USER_ID}/`)
      )
    ).toEqual([]);
    expect(mediaStorage.getAllFiles().has(foreign.value.gcsPath)).toBe(true);
    expect(mediaStorage.getDeletedPaths()).toEqual(expect.arrayContaining(expectedDeletedPaths));
    expect(
      (await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).get())
        .exists
    ).toBe(false);
  });

  it('fails the private-media stage before storage access when the account generation fence changed', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: account({ sourceAccountId: 'replacement-source', generationId: 'replacement' }),
      },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      { id: REQUEST_ID, data: storedRequest({ stage: 'private_media' }) },
    ]);

    await expect(
      repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 0,
        batchSize: 20,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'failed',
        request: {
          status: 'failed',
          failureCode: 'ACCOUNT_GENERATION_CHANGED',
        },
      },
    });
  });

  it('fails a private-media commit if the account generation changes during storage deletion', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: account({ sourceAccountId: 'replacement-source', generationId: 'replacement' }),
      },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      { id: REQUEST_ID, data: storedRequest({ stage: 'private_media' }) },
    ]);

    await expect(
      repository.commitPrivateMediaBatch({
        ...startInput(),
        expectedAttempt: 0,
        batch: { status: 'empty', deletedCount: 0 },
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'failed',
        request: {
          status: 'failed',
          failureCode: 'ACCOUNT_GENERATION_CHANGED',
        },
      },
    });
  });

  it('continues private-media recovery when the old account is already absent', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      { id: REQUEST_ID, data: storedRequest({ stage: 'private_media' }) },
    ]);

    await expect(
      repository.commitPrivateMediaBatch({
        ...startInput(),
        expectedAttempt: 0,
        batch: { status: 'empty', deletedCount: 0 },
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'advanced',
        request: { stage: 'source_account', attempt: 1 },
      },
    });
  });

  it('returns safe missing/stale results and persistence errors for corrupt state and Firestore failures', async () => {
    await expect(
      repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 0,
        batchSize: 20,
      })
    ).resolves.toEqual({ ok: true, value: { status: 'not_found' } });
    await expect(
      repository.commitPrivateMediaBatch({
        ...startInput(),
        expectedAttempt: 0,
        batch: { status: 'empty', deletedCount: 0 },
      })
    ).resolves.toEqual({ ok: true, value: { status: 'not_found' } });

    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      { id: REQUEST_ID, data: { sourceAccountId: SOURCE_ACCOUNT_ID, userId: USER_ID } },
    ]);
    const corrupt = await repository.get({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      erasureRequestId: REQUEST_ID,
    });
    expect(corrupt).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });

    fakeFirestore.clear();
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION, [
      {
        id: REQUEST_ID,
        data: null as unknown as Record<string, unknown>,
      },
    ]);
    await expect(
      repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });

    fakeFirestore.clear();
    fakeFirestore.configure({ errorToThrow: new Error('Firestore unavailable') });
    for (const result of [
      await repository.start(startInput()),
      await repository.get({
        sourceAccountId: SOURCE_ACCOUNT_ID,
        erasureRequestId: REQUEST_ID,
      }),
      await repository.advanceOneBatch({
        ...startInput(),
        expectedAttempt: 0,
        batchSize: 20,
      }),
      await repository.commitPrivateMediaBatch({
        ...startInput(),
        expectedAttempt: 0,
        batch: { status: 'empty', deletedCount: 0 },
      }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_ERROR' } });
    }
  });
});
