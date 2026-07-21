import { createHash } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import { LlmModels } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationAssistantTurnRequestRepository,
  StartConversationAssistantTurnRequestRepositoryInput,
} from '../../domain/conversation-assistant/turnRequestPorts.js';
import { calculateConversationAssistantPreparedSnapshotIntegrity } from '../../domain/conversation-assistant/preparedSnapshotIntegrity.js';
import type { ConversationAssistantContextAttachmentPreparedSnapshot } from '../../domain/conversation-assistant/types.js';
import type { PrivateWhatsAppContextChange } from '../../domain/whatsapp/models/PrivateWhatsAppContextJournal.js';
import {
  CONVERSATION_ASSISTANT_TURN_REQUEST_HARD_INPUT_TOKEN_LIMIT,
  WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION,
  createConversationAssistantTurnRequestRepository,
} from '../../infra/firestore/conversationAssistantTurnRequestRepository.js';
import { createPrivateWhatsAppErasureRepository } from '../../infra/firestore/privateWhatsAppErasureRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
} from '../../infra/firestore/conversationAssistantContextAttachmentRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from '../../infra/firestore/conversationAssistantRepository.js';
import { PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION } from '../../infra/firestore/privateWhatsAppRepository.js';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const GENERATION_ID = 'generation-1';
const REQUEST_ID = 'request-1';
const ATTACHMENT_ID = 'attachment-1';
const SNAPSHOT_ID = 'snapshot-1';
const NOW = '2026-07-21T10:00:00.000Z';
const LEASE = '2026-07-21T10:05:00.000Z';
type FakeFirestore = ReturnType<typeof createFakeFirestore>;
type FakeCollectionReference = ReturnType<FakeFirestore['collection']>;
type FakeDocumentReference = ReturnType<FakeCollectionReference['doc']>;
const INITIAL_TRANSCRIPT = 'Immutable initial transcript';
const INITIAL_TRANSCRIPT_SHA256 = createHash('sha256')
  .update(INITIAL_TRANSCRIPT)
  .digest('hex');

function expectedModelReference(
  messageId: string,
  sessionId = SESSION_ID,
  generationId = GENERATION_ID
): string {
  const digest = createHash('sha256')
    .update('intexuraos:whatsapp-conversation-assistant:message-reference:v1')
    .update('\0')
    .update(sessionId)
    .update('\0')
    .update(generationId)
    .update('\0')
    .update(messageId)
    .digest('hex');
  return `wa_msg_${digest}`;
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    chatId: 'chat-1',
    chatDisplayName: 'Test chat',
    status: 'active',
    model: LlmModels.Gemini25Flash,
    generationId: GENERATION_ID,
    sourceAccountId: 'source-1',
    sourceAccountGeneration: 'source-generation-1',
    transcriptSha256: INITIAL_TRANSCRIPT_SHA256,
    range: { from: '2026-07-14T00:00:00.000Z', to: '2026-07-17T00:00:00.000Z' },
    effectiveRange: {
      from: '2026-07-14T08:00:00.000Z',
      to: '2026-07-16T18:00:00.000Z',
    },
    transcriptStorage: {
      type: 'chunks',
      chunkCount: 1,
      chunkSizeBytes: 200_000,
      byteLength: Buffer.byteLength(INITIAL_TRANSCRIPT, 'utf8'),
      snapshotId: INITIAL_TRANSCRIPT_SHA256,
    },
    continuation: {
      sourceAccountId: 'source-1',
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function preparedSnapshot(
  overrides: Partial<ConversationAssistantContextAttachmentPreparedSnapshot> = {}
): ConversationAssistantContextAttachmentPreparedSnapshot {
  const candidate: ConversationAssistantContextAttachmentPreparedSnapshot = {
    transcriptText: '[2026-07-18T08:00:00.000Z] Them: hello',
    messages: [],
    omittedMessages: [],
    corrections: [],
    eventRange: {
      from: '2026-07-18T08:00:00.000Z',
      to: '2026-07-18T08:00:00.000Z',
    },
    counts: {
      included: 2,
      omitted: 1,
      newlyAvailable: 2,
      edited: 1,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
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
    deltaTranscriptSha256: '',
    previousContextChainSha256: 'a'.repeat(64),
    resultingContextChainSha256: '',
    estimatedInputTokens: 23,
    requiresConfirmation: false,
    ...overrides,
  };
  const integrity = calculateConversationAssistantPreparedSnapshotIntegrity(candidate);
  return {
    ...candidate,
    deltaTranscriptSha256: overrides.deltaTranscriptSha256 ?? integrity.deltaTranscriptSha256,
    resultingContextChainSha256:
      overrides.resultingContextChainSha256 ?? integrity.resultingContextChainSha256,
  };
}

function attachment(
  manifest: { chunkIds: string[]; chunkCount: number },
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    sessionGenerationId: GENERATION_ID,
    status: 'ready',
    snapshotId: SNAPSHOT_ID,
    chunkManifest: manifest,
    baseContextVersion: 3,
    baseEventThrough: '2026-07-17T00:00:00.000Z',
    baseChangeSeq: 11,
    cutoffChangeSeq: 19,
    capturedAt: '2026-07-21T09:55:00.000Z',
    captureRange: {
      from: '2026-07-17T00:00:00.000Z',
      to: '2026-07-21T09:55:00.000Z',
    },
    eventRange: {
      from: '2026-07-18T08:00:00.000Z',
      to: '2026-07-18T08:00:00.000Z',
    },
    counts: preparedSnapshot().counts,
    omitted: preparedSnapshot().omitted,
    previousContextChainSha256: preparedSnapshot().previousContextChainSha256,
    deltaTranscriptSha256: preparedSnapshot().deltaTranscriptSha256,
    resultingContextChainSha256: preparedSnapshot().resultingContextChainSha256,
    estimatedInputTokens: 23,
    requiresConfirmation: false,
    expireAt: Timestamp.fromDate(new Date('2026-07-21T10:30:00.000Z')),
    ...overrides,
  };
}

function startInput(
  overrides: Partial<StartConversationAssistantTurnRequestRepositoryInput> = {}
): StartConversationAssistantTurnRequestRepositoryInput {
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    requestFingerprint: 'fingerprint-1',
    question: 'How did the attitude change?',
    claimId: 'claim-1',
    now: NOW,
    leaseExpiresAt: LEASE,
    ...overrides,
  };
}

function promptInput(
  overrides: Partial<
    Parameters<ConversationAssistantTurnRequestRepository['loadPromptSnapshot']>[0]
  > = {}
): Parameters<ConversationAssistantTurnRequestRepository['loadPromptSnapshot']>[0] {
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    expectedSessionGenerationId: GENERATION_ID,
    attempt: 1,
    claimId: 'claim-1',
    now: '2026-07-21T10:01:00.000Z',
    ...overrides,
  };
}

function splitPayload(value: unknown, count: number): string[] {
  const serialized = Buffer.from(JSON.stringify(value), 'utf8');
  const parts: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((serialized.length * index) / count);
    const end = Math.floor((serialized.length * (index + 1)) / count);
    parts.push(serialized.subarray(start, end));
  }
  return parts.map((part) => part.toString('base64'));
}

describe('conversationAssistantTurnRequestRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createConversationAssistantTurnRequestRepository>;

  function resetHarness(sessionDocument: Record<string, unknown> = session()): void {
    resetFirestore();
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createConversationAssistantTurnRequestRepository();
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: sessionDocument },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: {
          userId: USER_ID,
          sourceAccountId: 'source-1',
          generationId: 'source-generation-1',
          status: 'active',
        },
      },
    ]);
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION, [
      {
        id: `${SESSION_ID}_${INITIAL_TRANSCRIPT_SHA256}_000000`,
        data: {
          sessionId: SESSION_ID,
          sessionGenerationId: GENERATION_ID,
          snapshotId: INITIAL_TRANSCRIPT_SHA256,
          chunkIndex: 0,
          text: INITIAL_TRANSCRIPT,
        },
      },
    ]);
  }

  beforeEach(() => {
    resetHarness();
  });

  afterEach(() => {
    resetFirestore();
  });

  async function seedReadyAttachment(
    chunkCount = 1,
    attachmentOverrides: Record<string, unknown> = {},
    snapshotOverrides: Partial<ConversationAssistantContextAttachmentPreparedSnapshot> = {}
  ): Promise<string[]> {
    const snapshot = preparedSnapshot(snapshotOverrides);
    const chunkIds = Array.from(
      { length: chunkCount },
      (_value, index) => `${SESSION_ID}_${SNAPSHOT_ID}_${String(index).padStart(6, '0')}`
    );
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION, [
      {
        id: ATTACHMENT_ID,
        data: attachment(
          { chunkIds, chunkCount },
          {
            previousContextChainSha256: snapshot.previousContextChainSha256,
            deltaTranscriptSha256: snapshot.deltaTranscriptSha256,
            resultingContextChainSha256: snapshot.resultingContextChainSha256,
            ...attachmentOverrides,
          }
        ),
      },
    ]);
    const payloads = splitPayload(snapshot, chunkCount);
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
      chunkIds.map((id, chunkIndex) => ({
        id,
        data: {
          sessionId: SESSION_ID,
          userId: USER_ID,
          sessionGenerationId: GENERATION_ID,
          attachmentId: ATTACHMENT_ID,
          snapshotId: SNAPSHOT_ID,
          chunkIndex,
          chunkCount,
          encoding: 'base64-json',
          payload: payloads[chunkIndex] ?? '',
          expireAt: Timestamp.fromDate(new Date('2026-07-21T10:30:00.000Z')),
        },
      }))
    );
    return chunkIds;
  }

  async function storedRequestDocument(): Promise<{
    ref: { update(data: Record<string, unknown>): Promise<unknown> };
    data(): Record<string, unknown> | undefined;
  }> {
    const snapshot = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
      .where('sessionId', '==', SESSION_ID)
      .get();
    const document = snapshot.docs[0];
    if (document === undefined) throw new Error('Missing request');
    return document;
  }

  it('atomically starts a plain turn and reserves two sequences plus one revision', async () => {
    const result = await repository.startTurnRequest(startInput());

    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') throw new Error('Expected claimed request');
    expect(result.request).toMatchObject({
      id: REQUEST_ID,
      status: 'in_progress',
      attempt: 1,
      conversationRevision: 3,
      acknowledgment: '',
    });
    expect(result.userTurn).toMatchObject({
      sequence: 5,
      conversationRevision: 3,
      kind: 'message',
    });
    const storedSession = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID)
        .get()
    ).data();
    expect(storedSession?.['continuation']).toMatchObject({
      nextTurnSequence: 7,
      nextConversationRevision: 4,
      completedConversationRevision: 2,
      activeTurnRequestId: REQUEST_ID,
      activeTurnLeaseExpiresAt: LEASE,
    });
  });

  it('hides turn-request status and recovery immediately after erasure starts', async () => {
    const started = await repository.startTurnRequest(startInput());
    expect(started.status).toBe('claimed');
    const erasure = createPrivateWhatsAppErasureRepository();
    await expect(
      erasure.start({
        sourceAccountId: 'source-1',
        userId: USER_ID,
        erasureRequestId: 'erasure-turn-request-read-fence',
        now: '2026-07-21T10:00:30.000Z',
      })
    ).resolves.toMatchObject({ ok: true, value: { status: 'created' } });

    await expect(
      repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'retry-after-erasure',
        now: '2026-07-21T10:01:00.000Z',
        leaseExpiresAt: '2026-07-21T10:06:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('commits a ready current attachment, advances both watermarks, and clears every TTL', async () => {
    const chunkIds = await seedReadyAttachment(2);

    const result = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );

    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') throw new Error('Expected claimed request');
    expect(result.request.acknowledgment).toContain('Added 2 new messages');
    expect(result.userTurn).toMatchObject({
      kind: 'context_attachment_question',
      contextAttachmentId: ATTACHMENT_ID,
      contextAttachment: {
        id: ATTACHMENT_ID,
        captureRange: {
          from: '2026-07-17T00:00:00.000Z',
          to: '2026-07-21T09:55:00.000Z',
        },
        counts: { included: 2, excluded: 1, edited: 1 },
        omitted: { mediaOnly: 1 },
      },
    });
    const storedUserTurn = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
        .doc(result.userTurn.id)
        .get()
    ).data();
    expect(storedUserTurn?.['contextAttachment']).toMatchObject({
      captureRange: {
        from: '2026-07-17T00:00:00.000Z',
        to: '2026-07-21T09:55:00.000Z',
      },
      counts: { included: 2, excluded: 1, edited: 1 },
      omitted: { mediaOnly: 1 },
    });
    const storedAttachment = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(ATTACHMENT_ID)
        .get()
    ).data();
    expect(storedAttachment).toMatchObject({
      status: 'committed',
      committedTurnId: result.userTurn.id,
      committedAt: NOW,
    });
    expect(storedAttachment?.['expireAt']).toBeUndefined();
    for (const chunkId of chunkIds) {
      const chunk = (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc(chunkId)
          .get()
      ).data();
      expect(chunk?.['expireAt']).toBeUndefined();
    }
    const storedSession = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID)
        .get()
    ).data();
    expect(storedSession?.['continuation']).toMatchObject({
      contextVersion: 4,
      contextEventThrough: '2026-07-21T09:55:00.000Z',
      contextChangeThrough: 19,
      contextChainSha256: preparedSnapshot().resultingContextChainSha256,
      attachmentCount: 3,
      totalAttachedMessageCount: 14,
      totalAttachedOmittedCount: 2,
    });
  });

  it('normalizes Firestore capture timestamps through ready commit and committed prompt loading', async () => {
    const capturedAt = '2026-07-21T09:55:00.000Z';
    const captureFrom = '2026-07-17T00:00:00.000Z';
    await seedReadyAttachment(1, {
      capturedAt: Timestamp.fromDate(new Date(capturedAt)),
      captureRange: {
        from: Timestamp.fromDate(new Date(captureFrom)),
        to: Timestamp.fromDate(new Date(capturedAt)),
      },
      eventRange: {
        from: Timestamp.fromDate(new Date('2026-07-18T08:00:00.000Z')),
        to: Timestamp.fromDate(new Date('2026-07-18T08:00:00.000Z')),
      },
    });

    const started = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    expect(started.status).toBe('claimed');
    if (started.status !== 'claimed') throw new Error('Expected claimed request');
    expect(started.userTurn.contextAttachment).toMatchObject({
      capturedAt,
      captureRange: { from: captureFrom, to: capturedAt },
      eventRange: {
        from: '2026-07-18T08:00:00.000Z',
        to: '2026-07-18T08:00:00.000Z',
      },
    });
    await expect(repository.loadPromptSnapshot(promptInput())).resolves.toMatchObject({
      status: 'found',
    });
  });

  it('continues a same-generation frozen attachment while its non-erasing account is disabled', async () => {
    await seedReadyAttachment();
    await fakeFirestore
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .doc(USER_ID)
      .update({ status: 'disabled' });

    const started = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    expect(started.status).toBe('claimed');
    if (started.status !== 'claimed') throw new Error('Expected claimed request');
    await expect(repository.loadPromptSnapshot(promptInput())).resolves.toMatchObject({
      status: 'found',
    });
    await expect(
      repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Frozen context remains usable.',
        completedAt: '2026-07-21T10:01:00.000Z',
      })
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('rejects structured snapshot tampering before the attachment commit and emits no content', async () => {
    await seedReadyAttachment();
    const chunkRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`);
    const chunk = (await chunkRef.get()).data();
    const snapshot = JSON.parse(
      Buffer.from(String(chunk?.['payload']), 'base64').toString('utf8')
    ) as Record<string, unknown>;
    snapshot['messages'] = [{ id: 'tampered-message' }];
    await chunkRef.update({
      payload: Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64'),
    });
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantTurnRequestRepository({ telemetry: { record } });

    await expect(
      repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).resolves.toEqual({ status: 'attachment_not_ready' });
    expect(record).toHaveBeenCalledWith({
      operation: 'chain_verification',
      outcome: 'mismatch',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('tampered-message');
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
          .doc(ATTACHMENT_ID)
          .get()
      ).data()?.['status']
    ).toBe('ready');
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
          .get()
      ).size
    ).toBe(0);
  });

  it('replays an identical request and rejects reuse with a different fingerprint', async () => {
    const first = await repository.startTurnRequest(startInput());
    const replay = await repository.startTurnRequest(startInput({ claimId: 'claim-2' }));
    const conflict = await repository.startTurnRequest(
      startInput({ requestFingerprint: 'fingerprint-2', claimId: 'claim-3' })
    );

    expect(first.status).toBe('claimed');
    expect(replay.status).toBe('replay');
    expect(conflict).toEqual({ status: 'conflict' });
    const turns = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .where('sessionId', '==', SESSION_ID)
      .get();
    expect(turns.size).toBe(1);
  });

  it('enforces one active lease and lets the matching request reclaim an expired lease', async () => {
    await repository.startTurnRequest(startInput());

    const blocked = await repository.startTurnRequest(
      startInput({ requestId: 'request-2', requestFingerprint: 'fingerprint-2' })
    );
    expect(blocked).toEqual({ status: 'active_request' });

    const requestDoc = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .where('sessionId', '==', SESSION_ID)
        .get()
    ).docs[0];
    if (requestDoc === undefined) throw new Error('Missing request');
    await requestDoc.ref.update({ leaseExpiresAt: '2026-07-21T09:59:00.000Z' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ 'continuation.activeTurnLeaseExpiresAt': '2026-07-21T09:59:00.000Z' });

    const differentRequest = await repository.startTurnRequest(
      startInput({
        requestId: 'request-2',
        requestFingerprint: 'fingerprint-2',
        claimId: 'claim-for-request-2',
      })
    );
    expect(differentRequest).toEqual({ status: 'active_request' });

    const reclaimed = await repository.startTurnRequest(
      startInput({ claimId: 'claim-2', leaseExpiresAt: '2026-07-21T10:10:00.000Z' })
    );
    expect(reclaimed.status).toBe('claimed');
    if (reclaimed.status !== 'claimed') throw new Error('Expected reclaimed request');
    expect(reclaimed.request).toMatchObject({ attempt: 2, claimId: 'claim-2' });
  });

  it('serializes two tabs so only one distinct request starts', async () => {
    const [first, second] = await Promise.all([
      repository.startTurnRequest(startInput()),
      repository.startTurnRequest(
        startInput({ requestId: 'request-2', requestFingerprint: 'fingerprint-2' })
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual(['active_request', 'claimed']);
  });

  it('reclaims one expired durable request without creating another visible turn', async () => {
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected claimed request');

    const beforeExpiry = await repository.claimTurnRequestRecovery({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      claimId: 'recovery-before-expiry',
      now: '2026-07-21T10:04:00.000Z',
      leaseExpiresAt: '2026-07-21T10:09:00.000Z',
    });
    expect(beforeExpiry).toMatchObject({
      status: 'replay',
      request: { attempt: 1, claimId: 'claim-1' },
    });

    const [firstRecovery, secondRecovery] = await Promise.all([
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-1',
        now: '2026-07-21T10:05:00.000Z',
        leaseExpiresAt: '2026-07-21T10:10:00.000Z',
      }),
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-2',
        now: '2026-07-21T10:05:00.000Z',
        leaseExpiresAt: '2026-07-21T10:10:00.000Z',
      }),
    ]);

    expect([firstRecovery.status, secondRecovery.status].sort()).toEqual(['claimed', 'replay']);
    const claimed = firstRecovery.status === 'claimed' ? firstRecovery : secondRecovery;
    expect(claimed).toMatchObject({
      status: 'claimed',
      request: { attempt: 2, stateVersion: 2 },
      userTurn: { id: started.userTurn.id },
    });
    const turns = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .where('sessionId', '==', SESSION_ID)
      .get();
    expect(turns.size).toBe(1);
  });

  it('renews only the current generation, attempt, claim, active request, and live lease', async () => {
    await repository.startTurnRequest(startInput());

    const renewed = await repository.renewTurnRequestLease({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-07-21T10:01:00.000Z',
      leaseExpiresAt: '2026-07-21T10:06:00.000Z',
    });
    expect(renewed).toMatchObject({
      status: 'renewed',
      request: { leaseExpiresAt: '2026-07-21T10:06:00.000Z' },
    });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(SESSION_ID)
          .get()
      ).data()?.['continuation']
    ).toMatchObject({ activeTurnLeaseExpiresAt: '2026-07-21T10:06:00.000Z' });

    await expect(
      repository.renewTurnRequestLease({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'old-claim',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    ).resolves.toEqual({ status: 'stale' });

    await expect(
      repository.renewTurnRequestLease({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        now: '2026-07-21T10:06:00.000Z',
        leaseExpiresAt: '2026-07-21T10:11:00.000Z',
      })
    ).resolves.toEqual({ status: 'stale' });
  });

  it('fences recovery ownership, missing durable parts, terminal replay, and active-request drift', async () => {
    await expect(
      repository.claimTurnRequestRecovery({
        userId: 'user-2',
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-1',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: 'missing-request',
        claimId: 'recovery-1',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).resolves.toEqual({ status: 'not_found' });

    const owned = await repository.startTurnRequest(startInput());
    if (owned.status !== 'claimed') throw new Error('Expected request');
    await (await storedRequestDocument()).ref.update({ userId: 'user-2' });
    await expect(
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-1',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).resolves.toEqual({ status: 'not_found' });

    resetHarness();
    const missingTurn = await repository.startTurnRequest(startInput());
    if (missingTurn.status !== 'claimed') throw new Error('Expected request');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(missingTurn.userTurn.id)
      .delete();
    await expect(
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-1',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).resolves.toEqual({ status: 'not_found' });

    resetHarness();
    await repository.startTurnRequest(startInput());
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ 'continuation.activeTurnRequestId': 'another-request' });
    await expect(
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-1',
        now: LEASE,
        leaseExpiresAt: '2026-07-21T10:10:00.000Z',
      })
    ).resolves.toEqual({ status: 'busy' });

    resetHarness();
    await repository.startTurnRequest(startInput());
    await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'Completed once',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    await expect(
      repository.claimTurnRequestRecovery({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'recovery-1',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    ).resolves.toMatchObject({
      status: 'replay',
      request: { status: 'completed' },
      assistantTurn: { text: 'Completed once' },
    });
  });

  it('returns not found when lease renewal ownership or durable identity is absent', async () => {
    const renewal = {
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-07-21T10:01:00.000Z',
      leaseExpiresAt: '2026-07-21T10:06:00.000Z',
    };
    await expect(
      repository.renewTurnRequestLease({ ...renewal, userId: 'user-2' })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.renewTurnRequestLease({ ...renewal, requestId: 'missing-request' })
    ).resolves.toEqual({ status: 'not_found' });

    await repository.startTurnRequest(startInput());
    await (await storedRequestDocument()).ref.update({ userId: 'user-2' });
    await expect(repository.renewTurnRequestLease(renewal)).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('loads a prompt only for the current live claim fence', async () => {
    await repository.startTurnRequest(startInput());
    const base = {
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-07-21T10:01:00.000Z',
    };

    await expect(repository.loadPromptSnapshot(base)).resolves.toMatchObject({ status: 'found' });
    await expect(repository.loadPromptSnapshot({ ...base, attempt: 2 })).resolves.toEqual({
      status: 'stale',
    });
    await expect(repository.loadPromptSnapshot({ ...base, claimId: 'old-claim' })).resolves.toEqual(
      { status: 'stale' }
    );
    await expect(repository.loadPromptSnapshot({ ...base, now: LEASE })).resolves.toEqual({
      status: 'stale',
    });
  });

  it('skips the reserved assistant turn even when its stored sequence matches the user turn', async () => {
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected claimed request');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(started.request.assistantTurnId)
      .set({
        sessionId: SESSION_ID,
        userId: USER_ID,
        sessionGenerationId: GENERATION_ID,
        role: 'assistant',
        text: 'Reserved answer must be skipped',
        createdAt: NOW,
        sequence: started.userTurn.sequence,
        conversationRevision: started.request.conversationRevision,
        requestId: REQUEST_ID,
        kind: 'message',
      });

    const loaded = await repository.loadPromptSnapshot(promptInput());

    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('Expected prompt snapshot');
    expect(loaded.snapshot.history).toEqual([]);
    expect(loaded.snapshot.currentQuestion).toBe(started.userTurn.text);
  });

  it.each([
    [{ baseContextVersion: 2 }, undefined, 'attachment_stale'],
    [{ status: 'preparing' }, undefined, 'attachment_not_ready'],
    [
      { expireAt: Timestamp.fromDate(new Date('2026-07-21T09:59:59.000Z')) },
      undefined,
      'attachment_not_ready',
    ],
    [{ requiresConfirmation: true }, undefined, 'confirmation_required'],
    [{ requiresConfirmation: true }, 'wrong-token', 'confirmation_required'],
  ] as const)(
    'fails closed for attachment compatibility and confirmation %#',
    async (attachmentOverrides, confirmationToken, expectedStatus) => {
      const requiresConfirmation =
        'requiresConfirmation' in attachmentOverrides &&
        attachmentOverrides.requiresConfirmation === true;
      await seedReadyAttachment(
        1,
        attachmentOverrides,
        requiresConfirmation ? { requiresConfirmation: true } : {}
      );
      const result = await repository.startTurnRequest(
        startInput({
          contextAttachmentId: ATTACHMENT_ID,
          ...(confirmationToken === undefined ? {} : { confirmationToken }),
        })
      );
      expect(result).toEqual({ status: expectedStatus });
    }
  );

  it('accepts the exact attachment-bound confirmation token', async () => {
    await seedReadyAttachment(
      1,
      { requiresConfirmation: true, confirmationToken: 'confirmation-1' },
      { requiresConfirmation: true, confirmationToken: 'confirmation-1' }
    );

    const result = await repository.startTurnRequest(
      startInput({
        contextAttachmentId: ATTACHMENT_ID,
        confirmationToken: 'confirmation-1',
      })
    );

    expect(result.status).toBe('claimed');
  });

  it('accepts exactly 400 manifested chunks and rejects 401 before moving watermarks', async () => {
    await seedReadyAttachment(400);
    const accepted = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    expect(accepted.status).toBe('claimed');

    resetHarness();
    await seedReadyAttachment(401);
    const rejected = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    expect(rejected).toEqual({ status: 'attachment_not_ready' });
    const stored = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID)
        .get()
    ).data();
    expect(stored?.['continuation']).toMatchObject({ contextVersion: 3 });
  });

  it('fails closed when a manifested chunk is missing or expires during send', async () => {
    const chunkIds = await seedReadyAttachment(2);
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(chunkIds[1] ?? '')
      .delete();
    expect(
      await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).toEqual({ status: 'attachment_not_ready' });

    await seedReadyAttachment(1);
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`)
      .update({ expireAt: Timestamp.fromDate(new Date('2026-07-21T09:59:59.000Z')) });
    expect(
      await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).toEqual({ status: 'attachment_not_ready' });
  });

  it('rejects the hard prompt limit and attachment-generation or deletion races', async () => {
    const oversizedTranscript = '!'.repeat(
      CONVERSATION_ASSISTANT_TURN_REQUEST_HARD_INPUT_TOKEN_LIMIT + 1
    );
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: SESSION_ID,
        data: session({
          transcriptStorage: undefined,
          transcriptText: oversizedTranscript,
          transcriptSha256: createHash('sha256').update(oversizedTranscript).digest('hex'),
        }),
      },
    ]);
    expect(await repository.startTurnRequest(startInput())).toEqual({
      status: 'context_window_exceeded',
    });

    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: session({ generationId: 'generation-2' }) },
    ]);
    await seedReadyAttachment();
    expect(
      await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).toEqual({ status: 'not_found' });
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: session({ deletionStartedAt: NOW }) },
    ]);
    expect(await repository.startTurnRequest(startInput())).toEqual({ status: 'not_found' });
  });

  it('atomically fences turn start after source erasure or replacement', async () => {
    for (const account of [
      undefined,
      {
        userId: USER_ID,
        sourceAccountId: 'source-1',
        generationId: 'source-generation-1',
        status: 'disabled',
        erasureStatus: 'erasing',
      },
      {
        userId: USER_ID,
        sourceAccountId: 'source-replacement',
        generationId: 'source-generation-2',
        status: 'active',
      },
    ]) {
      resetHarness();
      if (account === undefined) {
        await fakeFirestore.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(USER_ID).delete();
      } else {
        fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
          { id: USER_ID, data: account },
        ]);
      }

      expect(await repository.startTurnRequest(startInput())).toEqual({
        status: 'not_found',
      });
      expect(
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
          .get()
      ).toHaveProperty('size', 0);
      expect(
        await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).get()
      ).toHaveProperty('size', 0);
    }

    resetHarness(
      session({
        sourceAccountId: 'source-1',
        sourceAccountGeneration: 'source-generation-1',
      })
    );
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: {
          userId: USER_ID,
          sourceAccountId: 'source-1',
          generationId: 'source-generation-2',
          status: 'active',
        },
      },
    ]);
    expect(await repository.startTurnRequest(startInput())).toEqual({
      status: 'not_found',
    });
  });

  it.each([
    ['load_prompt', 'erasing'],
    ['load_prompt', 'missing'],
    ['load_prompt', 'replacement_generation'],
    ['recover', 'erasing'],
    ['recover', 'missing'],
    ['recover', 'replacement_generation'],
    ['renew', 'erasing'],
    ['renew', 'missing'],
    ['renew', 'replacement_generation'],
    ['retry', 'erasing'],
    ['retry', 'missing'],
    ['retry', 'replacement_generation'],
    ['finalize', 'erasing'],
    ['finalize', 'missing'],
    ['finalize', 'replacement_generation'],
  ] as const)(
    'fails closed for %s when source erasure races as %s after request creation',
    async (operation, accountRace) => {
      resetHarness();
      const started = await repository.startTurnRequest(startInput());
      if (started.status !== 'claimed') throw new Error('Expected claimed request');
      if (operation === 'retry') {
        const failed = await repository.failTurnRequest({
          userId: USER_ID,
          sessionId: SESSION_ID,
          requestId: REQUEST_ID,
          expectedSessionGenerationId: GENERATION_ID,
          attempt: 1,
          claimId: 'claim-1',
          errorBodyText: 'Failed answer',
          error: { code: 'LLM_ERROR' },
          publicErrorMessage: 'The answer could not be generated',
          completedAt: '2026-07-21T10:01:00.000Z',
        });
        if (failed.status !== 'failed') throw new Error('Expected failed request');
      }

      const accountRef = fakeFirestore
        .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
        .doc(USER_ID);
      if (accountRace === 'missing') {
        await accountRef.delete();
      } else if (accountRace === 'replacement_generation') {
        await accountRef.update({ generationId: 'replacement-source-generation' });
      } else {
        await accountRef.update({ status: 'disabled', erasureStatus: 'erasing' });
      }
      const requestBefore = (await storedRequestDocument()).data();
      const sessionRef = fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID);
      const sessionBefore = (await sessionRef.get()).data();
      const turnsBefore = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
        .where('sessionId', '==', SESSION_ID)
        .get();

      let outcome: { status: string };
      switch (operation) {
        case 'load_prompt':
          outcome = await repository.loadPromptSnapshot(promptInput());
          break;
        case 'recover':
          outcome = await repository.claimTurnRequestRecovery({
              userId: USER_ID,
              sessionId: SESSION_ID,
              requestId: REQUEST_ID,
              claimId: 'recovery-claim',
              now: '2026-07-21T10:06:00.000Z',
              leaseExpiresAt: '2026-07-21T10:11:00.000Z',
          });
          break;
        case 'renew':
          outcome = await repository.renewTurnRequestLease({
              userId: USER_ID,
              sessionId: SESSION_ID,
              requestId: REQUEST_ID,
              expectedSessionGenerationId: GENERATION_ID,
              attempt: 1,
              claimId: 'claim-1',
              now: '2026-07-21T10:01:00.000Z',
              leaseExpiresAt: '2026-07-21T10:06:00.000Z',
          });
          break;
        case 'retry':
          outcome = await repository.claimAnswerRetry({
              userId: USER_ID,
              sessionId: SESSION_ID,
              requestId: REQUEST_ID,
              claimId: 'retry-claim',
              now: '2026-07-21T10:02:00.000Z',
              leaseExpiresAt: '2026-07-21T10:07:00.000Z',
          });
          break;
        case 'finalize':
          outcome = await repository.completeTurnRequest({
              userId: USER_ID,
              sessionId: SESSION_ID,
              requestId: REQUEST_ID,
              expectedSessionGenerationId: GENERATION_ID,
              attempt: 1,
              claimId: 'claim-1',
              answerText: 'Must not be persisted',
              completedAt: '2026-07-21T10:01:00.000Z',
          });
          break;
      }

      expect(outcome).toEqual({ status: 'not_found' });
      expect((await storedRequestDocument()).data()).toEqual(requestBefore);
      expect((await sessionRef.get()).data()).toEqual(sessionBefore);
      const turnsAfter = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
        .where('sessionId', '==', SESSION_ID)
        .get();
      expect(turnsAfter.docs.map((doc) => ({ id: doc.id, data: doc.data() }))).toEqual(
        turnsBefore.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
      );
      expect(JSON.stringify(turnsAfter.docs.map((doc) => doc.data()))).not.toContain(
        'Must not be persisted'
      );
    }
  );

  it('rejects the exact canonical Prompt V5 before committing any turn state', async () => {
    const originalContinuation = session()['continuation'];
    const oversizedTranscript = '!'.repeat(
      CONVERSATION_ASSISTANT_TURN_REQUEST_HARD_INPUT_TOKEN_LIMIT + 1
    );
    resetHarness(
      session({
        transcriptStorage: undefined,
        transcriptText: oversizedTranscript,
        transcriptSha256: createHash('sha256').update(oversizedTranscript).digest('hex'),
      })
    );

    expect(await repository.startTurnRequest(startInput())).toEqual({
      status: 'context_window_exceeded',
    });
    expect(
      await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION).get()
    ).toHaveProperty('size', 0);
    expect(
      await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).get()
    ).toHaveProperty('size', 0);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(SESSION_ID)
          .get()
      ).data()?.['continuation']
    ).toEqual(originalContinuation);
  });

  it('keeps a ready attachment and its watermark untouched when exact Prompt V5 is oversized', async () => {
    const originalContinuation = session()['continuation'];
    const chunkIds = await seedReadyAttachment(
      2,
      {},
      {
        transcriptText: '!'.repeat(CONVERSATION_ASSISTANT_TURN_REQUEST_HARD_INPUT_TOKEN_LIMIT + 1),
      }
    );

    expect(
      await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).toEqual({ status: 'context_window_exceeded' });
    const storedAttachment = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(ATTACHMENT_ID)
        .get()
    ).data();
    expect(storedAttachment).toMatchObject({ status: 'ready' });
    expect(storedAttachment).not.toHaveProperty('committedTurnId');
    for (const chunkId of chunkIds) {
      expect(
        (
          await fakeFirestore
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
            .doc(chunkId)
            .get()
        ).data()?.['expireAt']
      ).toBeInstanceOf(Timestamp);
    }
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(SESSION_ID)
          .get()
      ).data()?.['continuation']
    ).toEqual(originalContinuation);
    expect(
      await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).get()
    ).toHaveProperty('size', 0);
  });

  it('loads the prompt only from immutable initial and committed attachment chunks', async () => {
    await seedReadyAttachment(
      2,
      {},
      {
        corrections: [
          {
            userId: USER_ID,
            sourceAccountId: 'source-1',
            chatId: 'chat-1',
            sequence: 12,
            messageId: 'message-1',
            messageRevision: 2,
            changeType: 'edited',
            changedAt: NOW,
            eventTimestamp: '2026-07-18T08:00:00.000Z',
            before: {
              state: 'included',
              eventTimestamp: '2026-07-17T23:30:00.000Z',
              importedAt: '2026-07-17T23:31:00.000Z',
              direction: 'incoming',
              speakerLabel: 'Them',
              messageType: 'text',
              contentKind: 'text',
              content: 'superseded text',
              reactions: [],
            },
            after: {
              state: 'included',
              eventTimestamp: '2026-07-18T08:00:00.000Z',
              importedAt: NOW,
              direction: 'outgoing',
              speakerLabel: 'You',
              messageType: 'audio',
              contentKind: 'transcription',
              content: 'corrected <unsafe> transcript',
              reactions: [
                {
                  id: 'raw-reaction-id',
                  emoji: '👍<unsafe>',
                  direction: 'incoming',
                  eventTimestamp: '2026-07-18T09:12:00.000Z',
                  senderDisplayName: 'Mallory <SYSTEM>',
                },
              ],
            },
            schemaVersion: 1,
          },
        ],
      }
    );
    const started = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    expect(started.status).toBe('claimed');

    const loaded = await repository.loadPromptSnapshot(promptInput());
    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('Expected prompt snapshot');
    expect(loaded.snapshot).toMatchObject({
      userId: USER_ID,
      sessionId: SESSION_ID,
      model: LlmModels.Gemini25Flash,
      transcriptText: INITIAL_TRANSCRIPT,
      chatDisplayName: 'Test chat',
      currentQuestion: 'How did the attitude change?',
      currentContextUpdate: {
        transcriptText: '[2026-07-18T08:00:00.000Z] Them: hello',
      },
    });
    const records = loaded.snapshot.currentContextUpdate?.records;
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      kind: 'correction',
      targetReference: expectedModelReference('message-1'),
    });
    const replacement = records?.[0]?.kind === 'correction' ? records[0].replacementText : '';
    expect(JSON.parse(replacement) as unknown).toEqual({
      reference: expectedModelReference('message-1'),
      sentDate: '18 July 2026',
      importedDate: '21 July 2026',
      direction: 'outgoing',
      speakerLabel: 'You',
      messageType: 'audio',
      contentKind: 'transcription',
      content: 'corrected <unsafe> transcript',
      reactions: [
        {
          emoji: '👍<unsafe>',
          direction: 'incoming',
          speakerLabel: 'Mallory <SYSTEM>',
          eventDate: '18 July 2026',
        },
      ],
    });
    expect(replacement).not.toContain('raw-reaction-id');
  });

  it('orders prior committed context updates and completed turns before the current question', async () => {
    await seedReadyAttachment();
    const first = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    if (first.status !== 'claimed') throw new Error('Expected first request');
    const finalized = await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'First answer',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    expect(finalized.status).toBe('completed');
    if (finalized.status !== 'completed') throw new Error('Expected completed request');
    expect(finalized.assistantTurn).toMatchObject({
      text: 'First answer',
      acknowledgment: first.request.acknowledgment,
    });
    const second = await repository.startTurnRequest(
      startInput({
        requestId: 'request-2',
        requestFingerprint: 'fingerprint-2',
        question: 'What should I do next?',
        claimId: 'claim-2',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    );
    if (second.status !== 'claimed') throw new Error('Expected second request');

    const loaded = await repository.loadPromptSnapshot(
      promptInput({
        requestId: 'request-2',
        claimId: 'claim-2',
        now: '2026-07-21T10:03:00.000Z',
      })
    );

    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('Expected prompt snapshot');
    expect(loaded.snapshot.history).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'How did the attitude change?',
        contextUpdate: expect.objectContaining({
          transcriptText: '[2026-07-18T08:00:00.000Z] Them: hello',
        }),
      }),
      { role: 'assistant', text: 'First answer' },
    ]);
    expect(loaded.snapshot.currentQuestion).toBe('What should I do next?');
    expect(loaded.snapshot.currentContextUpdate).toBeUndefined();
  });

  it('ignores orphaned future revisions during the exact precommit prompt check', async () => {
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION, [
      {
        id: 'orphan-future-turn',
        data: {
          sessionId: SESSION_ID,
          userId: USER_ID,
          sessionGenerationId: GENERATION_ID,
          role: 'assistant',
          text: 'Must not enter the prompt',
          createdAt: NOW,
          sequence: 99,
          conversationRevision: 99,
          requestId: 'orphan-request',
          kind: 'message',
        },
      },
      {
        id: 'old-generation-corrupt-turn',
        data: {
          sessionId: SESSION_ID,
          userId: USER_ID,
          sessionGenerationId: 'old-generation',
          sequence: 100,
          role: 'invalid-but-must-be-skipped',
        },
      },
    ]);

    expect(await repository.startTurnRequest(startInput())).toMatchObject({
      status: 'claimed',
    });
  });

  it('supports the legacy account-generation fallback while retaining the source fence', async () => {
    resetHarness(session({ sourceAccountGeneration: 'source-1' }));
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: {
          userId: USER_ID,
          sourceAccountId: 'source-1',
          status: 'active',
        },
      },
    ]);

    expect(await repository.startTurnRequest(startInput())).toMatchObject({
      status: 'claimed',
    });
  });

  it.each(['unavailable', 'chain_mismatch'] as const)(
    'fails closed before commit when prior immutable attachment context is %s',
    async (scenario) => {
      await seedReadyAttachment();
      const first = await repository.startTurnRequest(
        startInput({ contextAttachmentId: ATTACHMENT_ID })
      );
      if (first.status !== 'claimed') throw new Error('Expected first request');
      await repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      });
      const chunkRef = fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
        .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`);
      if (scenario === 'unavailable') {
        await chunkRef.update({ payload: 'eA==' });
      } else {
        const stored = (await chunkRef.get()).data();
        const tampered = JSON.parse(
          Buffer.from(String(stored?.['payload']), 'base64').toString('utf8')
        ) as ConversationAssistantContextAttachmentPreparedSnapshot;
        tampered.transcriptText = `${tampered.transcriptText} tampered`;
        await chunkRef.update({
          payload: Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64'),
        });
      }

      const beforeTurns = await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
        .get();
      expect(
        await repository.startTurnRequest(
          startInput({
            requestId: 'request-2',
            requestFingerprint: 'fingerprint-2',
            claimId: 'claim-2',
            now: '2026-07-21T10:02:00.000Z',
            leaseExpiresAt: '2026-07-21T10:07:00.000Z',
          })
        )
      ).toEqual({
        status: scenario === 'chain_mismatch' ? 'attachment_not_ready' : 'not_found',
      });
      expect(
        await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).get()
      ).toHaveProperty('size', beforeTurns.size);
    }
  );

  it('prevents the old attempt from finalizing after an expired lease is reclaimed', async () => {
    const first = await repository.startTurnRequest(startInput());
    if (first.status !== 'claimed') throw new Error('Expected first claim');
    const requestDoc = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .where('sessionId', '==', SESSION_ID)
        .get()
    ).docs[0];
    if (requestDoc === undefined) throw new Error('Missing request');
    await requestDoc.ref.update({ leaseExpiresAt: '2026-07-21T09:59:00.000Z' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ 'continuation.activeTurnLeaseExpiresAt': '2026-07-21T09:59:00.000Z' });
    const reclaimed = await repository.startTurnRequest(
      startInput({ claimId: 'claim-2', leaseExpiresAt: '2026-07-21T10:10:00.000Z' })
    );
    if (reclaimed.status !== 'claimed') throw new Error('Expected reclaimed request');

    expect(
      await repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Old answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      })
    ).toEqual({ status: 'stale' });
    expect(
      await repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 2,
        claimId: 'claim-2',
        answerText: 'New answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      })
    ).toMatchObject({ status: 'completed' });
  });

  it('fences finalization by generation, active claim, attempt, lease, and revision', async () => {
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected claimed request');
    const completed = await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'Answer',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    expect(completed.status).toBe('completed');
    if (completed.status !== 'completed') throw new Error('Expected completion');
    expect(completed.assistantTurn).toMatchObject({
      id: started.request.assistantTurnId,
      sequence: 6,
      conversationRevision: 3,
      text: 'Answer',
    });
    expect(
      await repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'old-claim',
        answerText: 'Old answer',
        completedAt: '2026-07-21T10:02:00.000Z',
      })
    ).toEqual({ status: 'stale' });
    const storedSession = (
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID)
        .get()
    ).data();
    expect(storedSession?.['continuation']).toMatchObject({
      completedConversationRevision: 3,
    });
    expect(
      (storedSession?.['continuation'] as Record<string, unknown>)['activeTurnRequestId']
    ).toBeUndefined();
  });

  it('persists one terminal error and answer retry atomically replaces the same assistant turn', async () => {
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected claimed request');
    const failed = await repository.failTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      errorBodyText: 'Try answer again.',
      error: { code: 'LLM_ERROR' },
      publicErrorMessage: 'The answer could not be generated',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    expect(failed.status).toBe('failed');
    if (failed.status !== 'failed') throw new Error('Expected terminal failure');
    expect(failed.assistantTurn).toMatchObject({
      text: 'Try answer again.',
      acknowledgment: '',
    });
    expect(
      await repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toMatchObject({
      status: 'found',
      assistantTurn: {
        error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
      },
    });

    const retry = await repository.claimAnswerRetry({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      claimId: 'claim-2',
      now: '2026-07-21T10:02:00.000Z',
      leaseExpiresAt: '2026-07-21T10:07:00.000Z',
    });
    expect(retry.status).toBe('claimed');
    if (retry.status !== 'claimed') throw new Error('Expected answer retry claim');
    expect(retry.request).toMatchObject({ attempt: 2, conversationRevision: 3 });

    const completed = await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 2,
      claimId: 'claim-2',
      answerText: 'Recovered answer',
      completedAt: '2026-07-21T10:03:00.000Z',
    });
    expect(completed.status).toBe('completed');
    if (completed.status !== 'completed') throw new Error('Expected completion');
    expect(completed.assistantTurn).toMatchObject({
      text: 'Recovered answer',
      acknowledgment: '',
    });
    const turns = await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .where('sessionId', '==', SESSION_ID)
      .get();
    expect(turns.size).toBe(2);
    expect(
      turns.docs.find((turn) => turn.id === started.request.assistantTurnId)?.data()
    ).toMatchObject({
      text: 'Recovered answer',
      conversationRevision: 3,
    });
  });

  it('does not reclaim a deterministic context-window failure', async () => {
    await repository.startTurnRequest(startInput());
    await repository.failTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      errorBodyText: 'This update is too large to include in one question.',
      error: { code: 'CONTEXT_WINDOW_EXCEEDED' },
      publicErrorMessage: 'This update is too large to include in one question.',
      completedAt: '2026-07-21T10:01:00.000Z',
    });

    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    ).toEqual({ status: 'invalid_state' });
  });

  it('recovers durable request state and rejects retry outside failed terminal state', async () => {
    await repository.startTurnRequest(startInput());
    const recovery = await repository.getTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
    });
    expect(recovery.status).toBe('found');
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).toEqual({ status: 'invalid_state' });
  });

  it('keeps prompt, recovery, retry, and finalization ownership-scoped', async () => {
    await repository.startTurnRequest(startInput());

    expect(
      await repository.loadPromptSnapshot(
        promptInput({
          userId: 'user-2',
        })
      )
    ).toEqual({ status: 'not_found' });
    expect(
      await repository.getTurnRequest({
        userId: 'user-2',
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toEqual({ status: 'not_found' });
    expect(
      await repository.claimAnswerRetry({
        userId: 'user-2',
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).toEqual({ status: 'not_found' });
    expect(
      await repository.completeTurnRequest({
        userId: 'user-2',
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      })
    ).toEqual({ status: 'not_found' });
  });

  it('fails closed for stale or incomplete prompt snapshot storage', async () => {
    await repository.startTurnRequest(startInput());
    expect(
      await repository.loadPromptSnapshot(
        promptInput({
          expectedSessionGenerationId: 'generation-2',
        })
      )
    ).toEqual({ status: 'stale' });
    expect(
      await repository.loadPromptSnapshot(
        promptInput({
          requestId: 'missing-request',
        })
      )
    ).toEqual({ status: 'not_found' });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
      .doc(`${SESSION_ID}_${INITIAL_TRANSCRIPT_SHA256}_000000`)
      .delete();
    expect(await repository.loadPromptSnapshot(promptInput())).toEqual({ status: 'stale' });
  });

  it('supports immutable inline initial transcripts while rejecting a missing user turn', async () => {
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      {
        id: SESSION_ID,
        data: session({
          transcriptStorage: undefined,
          transcriptText: 'Inline immutable text',
          transcriptSha256: createHash('sha256').update('Inline immutable text').digest('hex'),
        }),
      },
    ]);
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected request');
    const loaded = await repository.loadPromptSnapshot(promptInput());
    expect(loaded).toMatchObject({
      status: 'found',
      snapshot: { transcriptText: 'Inline immutable text' },
    });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(started.request.userTurnId)
      .delete();
    expect(await repository.loadPromptSnapshot(promptInput())).toEqual({ status: 'stale' });
    expect(
      await repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toEqual({ status: 'not_found' });
  });

  it('rejects tampered initial transcript text, hash, byte length, count, and snapshot before any turn write', async () => {
    const transcriptChunk = (): FakeDocumentReference =>
      fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
        .doc(`${SESSION_ID}_${INITIAL_TRANSCRIPT_SHA256}_000000`);
    const sessionDocument = (): FakeDocumentReference =>
      fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(SESSION_ID);
    const corruptions: { name: string; apply: () => Promise<void> }[] = [
      {
        name: 'invalid hash contract',
        apply: async (): Promise<void> => {
          await sessionDocument().update({ transcriptSha256: 'not-a-sha256' });
        },
      },
      {
        name: 'missing hash contract',
        apply: async (): Promise<void> => {
          await sessionDocument().set(session({ transcriptSha256: undefined }));
        },
      },
      {
        name: 'inline hash mismatch',
        apply: async (): Promise<void> => {
          await sessionDocument().set(
            session({ transcriptStorage: undefined, transcriptText: 'Tampered inline transcript' })
          );
        },
      },
      {
        name: 'invalid storage discriminator',
        apply: async (): Promise<void> => {
          await sessionDocument().set(
            session({
              transcriptStorage: { type: 'inline' },
              transcriptText: INITIAL_TRANSCRIPT,
            })
          );
        },
      },
      {
        name: 'non-object storage manifest',
        apply: async (): Promise<void> => {
          await sessionDocument().set(
            session({ transcriptStorage: null, transcriptText: INITIAL_TRANSCRIPT })
          );
        },
      },
      {
        name: 'text',
        apply: async (): Promise<void> => {
          await transcriptChunk().update({ text: 'X'.repeat(Buffer.byteLength(INITIAL_TRANSCRIPT)) });
        },
      },
      {
        name: 'hash',
        apply: async (): Promise<void> => {
          await sessionDocument().update({ transcriptSha256: 'b'.repeat(64) });
        },
      },
      {
        name: 'byte length',
        apply: async (): Promise<void> => {
          await sessionDocument().update({
            transcriptStorage: {
              ...(session()['transcriptStorage'] as Record<string, unknown>),
              byteLength: Buffer.byteLength(INITIAL_TRANSCRIPT) + 1,
            },
          });
        },
      },
      {
        name: 'chunk count',
        apply: async (): Promise<void> => {
          await sessionDocument().update({
            transcriptStorage: {
              ...(session()['transcriptStorage'] as Record<string, unknown>),
              chunkCount: 0,
            },
          });
        },
      },
      {
        name: 'snapshot id',
        apply: async (): Promise<void> => {
          const invalidSnapshotId = 'c'.repeat(64);
          await sessionDocument().update({
            transcriptStorage: {
              ...(session()['transcriptStorage'] as Record<string, unknown>),
              snapshotId: invalidSnapshotId,
            },
          });
          fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION, [
            {
              id: `${SESSION_ID}_${invalidSnapshotId}_000000`,
              data: {
                sessionId: SESSION_ID,
                sessionGenerationId: GENERATION_ID,
                snapshotId: invalidSnapshotId,
                chunkIndex: 0,
                text: INITIAL_TRANSCRIPT,
              },
            },
          ]);
        },
      },
      {
        name: 'empty chunk bytes',
        apply: async (): Promise<void> => {
          await transcriptChunk().update({ text: '' });
        },
      },
      {
        name: 'oversized chunk bytes',
        apply: async (): Promise<void> => {
          await transcriptChunk().update({ text: 'x'.repeat(200_001) });
        },
      },
      {
        name: 'undersized non-final chunk',
        apply: async (): Promise<void> => {
          await sessionDocument().update({
            transcriptStorage: {
              ...(session()['transcriptStorage'] as Record<string, unknown>),
              chunkCount: 2,
            },
          });
        },
      },
    ];

    for (const corruption of corruptions) {
      resetHarness();
      await corruption.apply();
      expect(await repository.startTurnRequest(startInput()), corruption.name).toEqual({
        status: 'not_found',
      });
      expect(
        await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION).get()
      ).toHaveProperty('size', 0);
      expect(
        await fakeFirestore.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).get()
      ).toHaveProperty('size', 0);
    }
  });

  it('returns completed retry replay and fences busy or revision-mismatched failed retries', async () => {
    await repository.startTurnRequest(startInput());
    await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'Answer',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    ).toMatchObject({ status: 'replay', assistantTurn: { text: 'Answer' } });

    const requestDocument = await storedRequestDocument();
    await requestDocument.ref.update({
      status: 'failed',
      error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
    });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({
        'continuation.activeTurnRequestId': 'request-2',
        'continuation.activeTurnLeaseExpiresAt': '2026-07-21T10:10:00.000Z',
      });
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    ).toEqual({ status: 'busy' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({
        'continuation.activeTurnRequestId': FieldValue.delete(),
        'continuation.activeTurnLeaseExpiresAt': FieldValue.delete(),
        'continuation.completedConversationRevision': 2,
      });
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    ).toEqual({ status: 'invalid_state' });
  });

  it('returns not found for absent durable records and rejects corrupted stored shapes', async () => {
    expect(
      await repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toEqual({ status: 'not_found' });
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).toEqual({ status: 'not_found' });
    expect(
      await repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      })
    ).toEqual({ status: 'not_found' });

    await repository.startTurnRequest(startInput());
    const requestDocument = await storedRequestDocument();
    await requestDocument.ref.update({ status: 'unknown' });
    await expect(
      repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).rejects.toThrow('Invalid Conversation Assistant turn request');
    await requestDocument.ref.update({ status: 'in_progress', attempt: -1 });
    await expect(
      repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).rejects.toThrow('Invalid Conversation Assistant document');

    resetHarness();
    await seedReadyAttachment();
    const started = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    if (started.status !== 'claimed') throw new Error('Expected claimed request');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(started.userTurn.id)
      .update({ 'contextAttachment.counts': null });
    expect(
      await repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toMatchObject({
      status: 'found',
      userTurn: { contextAttachmentId: ATTACHMENT_ID },
    });
  });

  it('rejects missing and malformed continuation state before any durable write', async () => {
    for (const continuation of [
      undefined,
      'invalid',
      { ...(session()['continuation'] as Record<string, unknown>), sourceAccountId: 1 },
      { ...(session()['continuation'] as Record<string, unknown>), contextVersion: -1 },
    ]) {
      resetHarness(session({ continuation }));
      expect(await repository.startTurnRequest(startInput())).toEqual({ status: 'not_found' });
    }
  });

  it('fails closed for malformed ready attachment metadata and payload bytes', async () => {
    const invalidMetadata: Record<string, unknown>[] = [
      { eventRange: undefined },
      { chunkManifest: null },
      { counts: null },
      { omitted: null },
      { captureRange: null },
      { expireAt: 'invalid-date' },
    ];
    for (const overrides of invalidMetadata) {
      resetHarness();
      await seedReadyAttachment(1, overrides);
      const result = await repository.startTurnRequest(
        startInput({ contextAttachmentId: ATTACHMENT_ID })
      );
      if (overrides['eventRange'] === undefined && 'eventRange' in overrides) {
        expect(result.status).toBe('claimed');
      } else {
        expect(result).toEqual({ status: 'attachment_not_ready' });
      }
    }

    for (const payload of ['eA==', 'bnVsbA==']) {
      resetHarness();
      await seedReadyAttachment();
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
        .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`)
        .update({ payload });
      expect(
        await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
      ).toEqual({ status: 'attachment_not_ready' });
    }

    resetHarness();
    await seedReadyAttachment();
    const mismatched = preparedSnapshot({
      counts: { ...preparedSnapshot().counts, included: 99 },
    });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`)
      .update({ payload: Buffer.from(JSON.stringify(mismatched), 'utf8').toString('base64') });
    expect(
      await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).toEqual({ status: 'attachment_not_ready' });
  });

  it('fails closed when immutable committed history metadata or chunks are damaged', async () => {
    for (const mutation of [
      { target: 'attachment', value: { status: 'ready' } },
      { target: 'attachment', value: { chunkManifest: null } },
      { target: 'chunk', value: { expireAt: Timestamp.fromDate(new Date(LEASE)) } },
      { target: 'chunk', value: { payload: 'eA==' } },
    ] as const) {
      resetHarness();
      await seedReadyAttachment();
      const first = await repository.startTurnRequest(
        startInput({ contextAttachmentId: ATTACHMENT_ID })
      );
      if (first.status !== 'claimed') throw new Error('Expected first request');
      await repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      });
      const second = await repository.startTurnRequest(
        startInput({
          requestId: 'request-2',
          requestFingerprint: 'fingerprint-2',
          question: 'Second question',
          claimId: 'claim-2',
          now: '2026-07-21T10:02:00.000Z',
          leaseExpiresAt: '2026-07-21T10:07:00.000Z',
        })
      );
      if (second.status !== 'claimed') throw new Error('Expected second request');
      const ref =
        mutation.target === 'attachment'
          ? fakeFirestore
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
              .doc(ATTACHMENT_ID)
          : fakeFirestore
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
              .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`);
      await ref.update(mutation.value);
      expect(
        await repository.loadPromptSnapshot(
          promptInput({
            requestId: 'request-2',
            claimId: 'claim-2',
            now: '2026-07-21T10:03:00.000Z',
          })
        )
      ).toEqual({ status: 'stale' });
    }

    resetHarness();
    const originalCorrection: PrivateWhatsAppContextChange = {
      userId: USER_ID,
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      sequence: 12,
      messageId: 'message-1',
      messageRevision: 2,
      changeType: 'edited',
      changedAt: NOW,
      eventTimestamp: '2026-07-18T08:00:00.000Z',
      before: { state: 'missing' },
      after: {
        state: 'included',
        eventTimestamp: '2026-07-18T08:00:00.000Z',
        importedAt: NOW,
        direction: 'incoming',
        speakerLabel: 'Them',
        messageType: 'text',
        contentKind: 'text',
        content: 'original correction',
        reactions: [],
      },
      schemaVersion: 1,
    };
    await seedReadyAttachment(1, {}, { corrections: [originalCorrection] });
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantTurnRequestRepository({ telemetry: { record } });
    const first = await repository.startTurnRequest(
      startInput({ contextAttachmentId: ATTACHMENT_ID })
    );
    if (first.status !== 'claimed') throw new Error('Expected first request');
    await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'Answer',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    const second = await repository.startTurnRequest(
      startInput({
        requestId: 'request-2',
        requestFingerprint: 'fingerprint-2',
        question: 'Second question',
        claimId: 'claim-2',
        now: '2026-07-21T10:02:00.000Z',
        leaseExpiresAt: '2026-07-21T10:07:00.000Z',
      })
    );
    if (second.status !== 'claimed') throw new Error('Expected second request');
    const chunkRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`);
    const chunk = (await chunkRef.get()).data();
    const tampered = JSON.parse(
      Buffer.from(String(chunk?.['payload']), 'base64').toString('utf8')
    ) as ConversationAssistantContextAttachmentPreparedSnapshot;
    const correction = tampered.corrections[0];
    if (correction?.after.state !== 'included') throw new Error('Expected included correction');
    correction.after.content = 'tampered correction';
    await chunkRef.update({
      payload: Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64'),
    });

    await expect(
      repository.loadPromptSnapshot(
        promptInput({
          requestId: 'request-2',
          claimId: 'claim-2',
          now: '2026-07-21T10:03:00.000Z',
        })
      )
    ).resolves.toEqual({ status: 'stale' });
    expect(record).toHaveBeenCalledWith({
      operation: 'chain_verification',
      outcome: 'mismatch',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('tampered correction');
  });

  it('projects redaction and deletion tombstones in immutable prompt updates', async () => {
    const tombstone = (
      state: 'redacted' | 'deleted',
      sequence: number
    ): PrivateWhatsAppContextChange => ({
      userId: USER_ID,
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      sequence,
      messageId: `message-${String(sequence)}`,
      messageRevision: 2,
      changeType: state,
      changedAt: NOW,
      eventTimestamp: '2026-07-18T08:00:00.000Z',
      before: { state: 'missing' as const },
      after: {
        state,
        eventTimestamp: '2026-07-18T08:00:00.000Z',
        importedAt: NOW,
        direction: 'incoming' as const,
        speakerLabel: 'Them',
        messageType: 'text' as const,
      },
      schemaVersion: 1 as const,
    });
    await seedReadyAttachment(
      1,
      {},
      {
        corrections: [tombstone('redacted', 12), tombstone('deleted', 13)],
      }
    );
    await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }));

    const loaded = await repository.loadPromptSnapshot(promptInput());
    expect(loaded).toMatchObject({
      status: 'found',
      snapshot: {
        currentContextUpdate: {
          records: [
            {
              kind: 'tombstone',
              targetReference: expectedModelReference('message-12'),
              state: 'redacted',
            },
            {
              kind: 'tombstone',
              targetReference: expectedModelReference('message-13'),
              state: 'deleted',
            },
          ],
        },
      },
    });
  });

  it('supersedes every previously included projection and emits no record for omitted-only history', async () => {
    const included = (
      content: string,
      reactions: NonNullable<
        Extract<PrivateWhatsAppContextChange['after'], { state: 'included' }>['reactions']
      > = []
    ): Extract<PrivateWhatsAppContextChange['after'], { state: 'included' }> => ({
      state: 'included',
      eventTimestamp: '2026-07-18T08:00:00.000Z',
      importedAt: NOW,
      direction: 'incoming',
      speakerLabel: 'Them',
      messageType: 'text',
      contentKind: 'text',
      content,
      reactions,
    });
    const omitted = (): Extract<
      PrivateWhatsAppContextChange['after'],
      { state: 'omitted' }
    > => ({
      state: 'omitted',
      eventTimestamp: '2026-07-18T08:00:00.000Z',
      importedAt: NOW,
      direction: 'incoming',
      speakerLabel: 'Them',
      messageType: 'audio',
      omissionReason: 'pending_transcription',
      reactions: [],
    });
    const change = (
      messageId: string,
      sequence: number,
      changeType: PrivateWhatsAppContextChange['changeType'],
      before: PrivateWhatsAppContextChange['before'],
      after: PrivateWhatsAppContextChange['after']
    ): PrivateWhatsAppContextChange => ({
      userId: USER_ID,
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      sequence,
      messageId,
      messageRevision: 2,
      changeType,
      changedAt: NOW,
      eventTimestamp: '2026-07-18T08:00:00.000Z',
      before,
      after,
      schemaVersion: 1,
    });
    await seedReadyAttachment(
      1,
      {},
      {
        corrections: [
          change(
            'reaction-target',
            12,
            'reaction_changed',
            included('unchanged', [
              {
                id: 'old-reaction',
                emoji: '👍',
                direction: 'incoming',
                eventTimestamp: '2026-07-18T08:10:00.000Z',
                senderDisplayName: 'Them',
              },
            ]),
            included('unchanged', [])
          ),
          change('became-omitted', 13, 'transcription_changed', included('old text'), omitted()),
          change('became-missing', 14, 'edited', included('old text'), { state: 'missing' }),
          change('remained-omitted', 15, 'transcription_changed', omitted(), omitted()),
        ],
      }
    );
    await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }));

    const loaded = await repository.loadPromptSnapshot(promptInput());
    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('Expected prompt snapshot');
    const records = loaded.snapshot.currentContextUpdate?.records ?? [];
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      kind: 'correction',
      targetReference: expectedModelReference('reaction-target'),
    });
    const replacement = records[0]?.kind === 'correction' ? records[0].replacementText : '';
    expect(JSON.parse(replacement) as { reactions?: unknown }).toMatchObject({ reactions: [] });
    expect(records.slice(1)).toEqual([
      {
        kind: 'tombstone',
        targetReference: expectedModelReference('became-omitted'),
        state: 'unavailable',
      },
      {
        kind: 'tombstone',
        targetReference: expectedModelReference('became-missing'),
        state: 'unavailable',
      },
    ]);
    expect(JSON.stringify(records)).not.toContain('remained-omitted');
    expect(JSON.stringify(records)).not.toContain('old text');
    expect(JSON.stringify(records)).not.toContain('old-reaction');
  });

  it('replays completed starts and recovery with usage and terminal assistant errors', async () => {
    await repository.startTurnRequest(startInput());
    await repository.failTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      errorBodyText: 'Try answer again.',
      error: { code: 'LLM_ERROR' },
      publicErrorMessage: 'The answer could not be generated',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    const retry = await repository.claimAnswerRetry({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      claimId: 'claim-2',
      now: '2026-07-21T10:02:00.000Z',
      leaseExpiresAt: '2026-07-21T10:07:00.000Z',
    });
    if (retry.status !== 'claimed') throw new Error('Expected retry');
    await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 2,
      claimId: 'claim-2',
      answerText: 'Answer',
      completedAt: '2026-07-21T10:03:00.000Z',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, costUsd: 0.01 },
    });
    expect(await repository.startTurnRequest(startInput())).toMatchObject({
      status: 'replay',
      assistantTurn: { usage: { totalTokens: 12 } },
    });
    expect(
      await repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toMatchObject({ status: 'found', assistantTurn: { usage: { totalTokens: 12 } } });
  });

  it('rejects replay ownership drift, missing user turns, and corrupt turn roles', async () => {
    await repository.startTurnRequest(startInput());
    const requestDocument = await storedRequestDocument();
    await requestDocument.ref.update({ sessionGenerationId: 'generation-2' });
    expect(await repository.startTurnRequest(startInput())).toEqual({ status: 'not_found' });

    await requestDocument.ref.update({ sessionGenerationId: GENERATION_ID });
    const userTurnId = String(requestDocument.data()?.['userTurnId']);
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(userTurnId)
      .delete();
    expect(await repository.startTurnRequest(startInput())).toEqual({ status: 'not_found' });

    resetHarness();
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected request');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(started.request.userTurnId)
      .update({ role: 'invalid' });
    await expect(
      repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).rejects.toThrow('Invalid Conversation Assistant turn');
  });

  it('rejects durable request ownership drift in prompt, recovery, and answer retry', async () => {
    await repository.startTurnRequest(startInput());
    const requestDocument = await storedRequestDocument();
    await requestDocument.ref.update({ userId: 'user-2' });

    expect(await repository.loadPromptSnapshot(promptInput())).toEqual({ status: 'not_found' });
    expect(
      await repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).toEqual({ status: 'not_found' });
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).toEqual({ status: 'not_found' });
  });

  it('returns retry not found when the durable user turn disappeared', async () => {
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected request');
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(started.request.userTurnId)
      .delete();
    expect(
      await repository.claimAnswerRetry({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        claimId: 'claim-2',
        now: NOW,
        leaseExpiresAt: LEASE,
      })
    ).toEqual({ status: 'not_found' });
  });

  it('replays a completed request even when its assistant turn was concurrently removed', async () => {
    const started = await repository.startTurnRequest(startInput());
    if (started.status !== 'claimed') throw new Error('Expected request');
    await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'Answer',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(started.request.assistantTurnId)
      .delete();
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({
        'continuation.activeTurnRequestId': REQUEST_ID,
        'continuation.activeTurnLeaseExpiresAt': '2026-07-21T10:06:00.000Z',
      });
    const replay = await repository.claimAnswerRetry({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      claimId: 'claim-2',
      now: '2026-07-21T10:02:00.000Z',
      leaseExpiresAt: '2026-07-21T10:07:00.000Z',
    });
    expect(replay.status).toBe('replay');
    expect('assistantTurn' in replay).toBe(false);
    expect(replay).toMatchObject({
      activeTurnRequestId: REQUEST_ID,
      activeTurnLeaseExpiresAt: '2026-07-21T10:06:00.000Z',
    });
  });

  it('covers prompt range fallback, absent label, and invalid range', async () => {
    resetHarness(session({ effectiveRange: undefined, chatDisplayName: undefined }));
    await repository.startTurnRequest(startInput());
    const loaded = await repository.loadPromptSnapshot(promptInput());
    expect(loaded).toMatchObject({
      status: 'found',
      snapshot: {
        range: session()['range'],
        effectiveRange: session()['range'],
        history: [],
      },
    });
    if (loaded.status !== 'found') throw new Error('Expected prompt');
    expect(loaded.snapshot.chatDisplayName).toBeUndefined();

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ range: null });
    expect(await repository.loadPromptSnapshot(promptInput())).toEqual({ status: 'stale' });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ range: { from: '2026-07-14T00:00:00.000Z', to: null } });
    expect(await repository.loadPromptSnapshot(promptInput())).toEqual({ status: 'stale' });

    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(SESSION_ID)
      .update({ range: { from: null, to: '2026-07-17T00:00:00.000Z' } });
    expect(await repository.loadPromptSnapshot(promptInput())).toEqual({ status: 'stale' });
  });

  it('rejects absent inline transcripts and invalid chunk storage before committing a turn', async () => {
    for (const transcriptFields of [
      { transcriptStorage: undefined, transcriptText: undefined },
      { transcriptStorage: { type: 'chunks', chunkCount: -1 } },
      {
        transcriptStorage: {
          type: 'chunks',
          chunkCount: 1,
          chunkSizeBytes: 200_000,
          byteLength: 28,
        },
      },
    ]) {
      resetHarness(session(transcriptFields));
      expect(await repository.startTurnRequest(startInput())).toEqual({
        status: 'not_found',
      });
    }
  });

  it('ignores non-projectable corrections and preserves committed attachments without event ranges', async () => {
    const omittedChange = {
      userId: USER_ID,
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      sequence: 12,
      messageId: 'message-12',
      messageRevision: 2,
      changeType: 'transcription_changed' as const,
      changedAt: NOW,
      eventTimestamp: '2026-07-18T08:00:00.000Z',
      before: { state: 'missing' as const },
      after: {
        state: 'omitted' as const,
        eventTimestamp: '2026-07-18T08:00:00.000Z',
        importedAt: NOW,
        direction: 'incoming' as const,
        speakerLabel: 'Them',
        messageType: 'audio' as const,
        omissionReason: 'pending_transcription' as const,
        reactions: [],
      },
      schemaVersion: 1 as const,
    };
    await seedReadyAttachment(
      1,
      { eventRange: undefined },
      {
        corrections: [omittedChange],
      }
    );
    await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }));
    const loaded = await repository.loadPromptSnapshot(promptInput());
    expect(loaded).toMatchObject({
      status: 'found',
      snapshot: { currentContextUpdate: { records: [] } },
    });
  });

  it('uses ISO TTL values and rejects corrupt prior turn bodies before committing', async () => {
    await seedReadyAttachment(1, { expireAt: '2026-07-21T10:30:00.000Z' });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(`${SESSION_ID}_${SNAPSHOT_ID}_000000`)
      .update({ expireAt: '2026-07-21T10:30:00.000Z' });
    expect(
      await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
    ).toMatchObject({ status: 'claimed' });

    resetHarness();
    const first = await repository.startTurnRequest(startInput());
    if (first.status !== 'claimed') throw new Error('Expected request');
    await repository.completeTurnRequest({
      userId: USER_ID,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      expectedSessionGenerationId: GENERATION_ID,
      attempt: 1,
      claimId: 'claim-1',
      answerText: 'Answer',
      completedAt: '2026-07-21T10:01:00.000Z',
    });
    await fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
      .doc(first.request.assistantTurnId)
      .update({ text: 42 });
    expect(
      await repository.startTurnRequest(
        startInput({
          requestId: 'request-2',
          requestFingerprint: 'fingerprint-2',
          claimId: 'claim-2',
          now: '2026-07-21T10:02:00.000Z',
          leaseExpiresAt: '2026-07-21T10:07:00.000Z',
        })
      )
    ).toEqual({ status: 'not_found' });
  });

  it('rejects invalid count fields, omitted fields, string ids, and missing assistant sequence', async () => {
    for (const overrides of [
      { counts: { ...preparedSnapshot().counts, included: -1 } },
      { omitted: { ...preparedSnapshot().omitted, mediaOnly: -1 } },
    ]) {
      resetHarness();
      await seedReadyAttachment(1, overrides);
      expect(
        await repository.startTurnRequest(startInput({ contextAttachmentId: ATTACHMENT_ID }))
      ).toEqual({ status: 'attachment_not_ready' });
    }

    resetHarness();
    await repository.startTurnRequest(startInput());
    const requestDocument = await storedRequestDocument();
    await requestDocument.ref.update({ id: 1 });
    await expect(
      repository.getTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
      })
    ).rejects.toThrow('Invalid Conversation Assistant document');

    await requestDocument.ref.update({ id: REQUEST_ID, assistantSequence: FieldValue.delete() });
    await expect(
      repository.completeTurnRequest({
        userId: USER_ID,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        expectedSessionGenerationId: GENERATION_ID,
        attempt: 1,
        claimId: 'claim-1',
        answerText: 'Answer',
        completedAt: '2026-07-21T10:01:00.000Z',
      })
    ).rejects.toThrow('Invalid Conversation Assistant turn request sequence');
  });
});
