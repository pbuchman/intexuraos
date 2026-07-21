import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Timestamp,
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import { WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION } from '../../infra/firestore/conversationAssistantRepository.js';
import { calculateConversationAssistantPreparedSnapshotIntegrity } from '../../domain/conversation-assistant/preparedSnapshotIntegrity.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  createConversationAssistantContextAttachmentRepository,
} from '../../infra/firestore/conversationAssistantContextAttachmentRepository.js';
import { createPrivateWhatsAppErasureRepository } from '../../infra/firestore/privateWhatsAppErasureRepository.js';
import { PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION } from '../../infra/firestore/privateWhatsAppRepository.js';
import { fakePreparedContextAttachmentSnapshot } from '../fakes.js';

const USER_ID = 'user-access-repo';
const SESSION_ID = 'session-access-repo';
const GENERATION_ID = 'generation-access-repo';
const ATTACHMENT_ID = 'attachment-access-repo';
const SNAPSHOT_ID = 'snapshot-access-repo';
const CAPTURED_AT = '2026-07-02T12:00:00.000Z';
const NOW = '2026-07-02T12:00:00.000Z';
const SOURCE_ACCOUNT_GENERATION = 'source-generation-access-repo';
const PREVIOUS_CONTEXT_CHAIN_SHA256 = 'a'.repeat(64);
const VALID_INTEGRITY = calculateConversationAssistantPreparedSnapshotIntegrity({
  transcriptText: '',
  messages: [],
  omittedMessages: [],
  corrections: [],
  previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
});

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    generationId: GENERATION_ID,
    chatId: 'chat:source-access-repo:!direct',
    sourceAccountId: 'source-access-repo',
    sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
    status: 'active',
    createdAt: '2026-07-01T10:00:00.000Z',
    transcriptMessageCount: 7,
    omitted: {
      mediaOnly: 1,
      failedTranscriptions: 1,
      pendingTranscriptions: 0,
      nonText: 2,
      overLimit: 0,
    },
    continuation: {
      sourceAccountId: 'source-access-repo',
      contextVersion: 2,
      contextEventThrough: '2026-07-01T09:00:00.000Z',
      contextChangeThrough: 5,
      contextChainSha256: 'a'.repeat(64),
      displayTimeZone: 'Europe/Warsaw',
      nextTurnSequence: 3,
      nextConversationRevision: 2,
      completedConversationRevision: 1,
      attachmentCount: 1,
      totalAttachedMessageCount: 2,
      totalAttachedOmittedCount: 0,
    },
    ...overrides,
  };
}

function attachment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    sessionGenerationId: GENERATION_ID,
    sourceAccountId: 'source-access-repo',
    sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
    chatId: 'chat:source-access-repo:!direct',
    preparationRequestId: 'request-access-repo',
    preparationRequestFingerprint: 'fingerprint-access-repo',
    status: 'ready',
    initialContextFrom: '2026-07-01T00:00:00.000Z',
    baseContextVersion: 1,
    baseEventThrough: '2026-07-01T09:00:00.000Z',
    capturedAt: Timestamp.fromDate(new Date(CAPTURED_AT)),
    baseChangeSeq: 5,
    cutoffChangeSeq: 8,
    captureRange: {
      from: '2026-07-01T09:00:00.000Z',
      to: Timestamp.fromDate(new Date(CAPTURED_AT)),
    },
    counts: {
      included: 2,
      omitted: 0,
      newlyAvailable: 2,
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
    snapshotId: SNAPSHOT_ID,
    chunkManifest: { chunkIds: ['chunk-0'], chunkCount: 1 },
    deltaTranscriptSha256: VALID_INTEGRITY.deltaTranscriptSha256,
    previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
    resultingContextChainSha256: VALID_INTEGRITY.resultingContextChainSha256,
    estimatedInputTokens: 20,
    requiresConfirmation: false,
    preparationAttempt: 1,
    expireAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
    ...overrides,
  };
}

function seedPreparedSnapshot(
  fakeFirestore: ReturnType<typeof createFakeFirestore>,
  resultingContextChainSha256: string,
  overrides: Partial<ReturnType<typeof fakePreparedContextAttachmentSnapshot>> = {}
): void {
  const prepared = {
    ...fakePreparedContextAttachmentSnapshot(),
    deltaTranscriptSha256: VALID_INTEGRITY.deltaTranscriptSha256,
    previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
    resultingContextChainSha256,
    ...overrides,
  };
  fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
    {
      id: 'chunk-0',
      data: {
        userId: USER_ID,
        sessionId: SESSION_ID,
        sessionGenerationId: GENERATION_ID,
        sourceAccountId: 'source-access-repo',
        sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
        attachmentId: ATTACHMENT_ID,
        snapshotId: SNAPSHOT_ID,
        chunkIndex: 0,
        chunkCount: 1,
        encoding: 'base64-json',
        payload: Buffer.from(JSON.stringify(prepared), 'utf8').toString('base64'),
        expireAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
      },
    },
  ]);
}

describe('conversationAssistantContextAttachmentRepository access', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createConversationAssistantContextAttachmentRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createConversationAssistantContextAttachmentRepository();
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: session() },
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      {
        id: USER_ID,
        data: {
          userId: USER_ID,
          sourceAccountId: 'source-access-repo',
          generationId: SOURCE_ACCOUNT_GENERATION,
          status: 'active',
        },
      },
    ]);
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [{ id: ATTACHMENT_ID, data: attachment() }]
    );
  });

  afterEach(() => {
    resetFirestore();
  });

  it('gets only an owned attachment from the current session generation', async () => {
    await expect(
      repository.getOwnedContextAttachment({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toMatchObject({
      status: 'found',
      currentContextVersion: 2,
      attachment: { id: ATTACHMENT_ID, status: 'ready' },
    });
    await expect(
      repository.getOwnedContextAttachment({
        userId: 'foreign',
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'not_found' });

    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
      { id: SESSION_ID, data: session({ generationId: 'new-generation' }) },
    ]);
    await expect(
      repository.getOwnedContextAttachment({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('hides attachment metadata, preview, and history immediately after erasure starts', async () => {
    seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256);
    const erasure = createPrivateWhatsAppErasureRepository();
    await expect(
      erasure.start({
        sourceAccountId: 'source-access-repo',
        userId: USER_ID,
        erasureRequestId: 'erasure-access-read-fence',
        now: '2026-07-21T10:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, value: { status: 'created' } });

    await expect(
      repository.getOwnedContextAttachment({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: '2026-07-21T10:00:00.000Z',
      })
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.listOwnedContextHistory({ userId: USER_ID, sessionId: SESSION_ID })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('reassembles and validates the immutable prepared snapshot from manifested chunks', async () => {
    const prepared = {
      ...fakePreparedContextAttachmentSnapshot(),
      deltaTranscriptSha256: VALID_INTEGRITY.deltaTranscriptSha256,
      previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
      resultingContextChainSha256: VALID_INTEGRITY.resultingContextChainSha256,
    };
    const payload = Buffer.from(JSON.stringify(prepared), 'utf8').toString('base64');
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
      {
        id: 'chunk-0',
        data: {
          userId: USER_ID,
          sessionId: SESSION_ID,
          sessionGenerationId: GENERATION_ID,
          sourceAccountId: 'source-access-repo',
          sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
          attachmentId: ATTACHMENT_ID,
          snapshotId: SNAPSHOT_ID,
          chunkIndex: 0,
          chunkCount: 1,
          encoding: 'base64-json',
          payload,
          expireAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        },
      },
    ]);

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toMatchObject({
      status: 'found',
      currentContextVersion: 2,
      snapshot: { resultingContextChainSha256: VALID_INTEGRITY.resultingContextChainSha256 },
    });
  });

  it('returns no private body after a ready draft expires while native TTL sweep is delayed', async () => {
    seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256, {
      transcriptText: 'private body that must not escape',
    });
    for (const expiredAttachment of [
      attachment({ expireAt: Timestamp.fromDate(new Date('2026-07-02T11:59:59.000Z')) }),
      attachment({ status: 'expired' }),
    ]) {
      fakeFirestore.seedCollection(
        WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
        [{ id: ATTACHMENT_ID, data: expiredAttachment }]
      );
      const result = await repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      });
      expect(result).toEqual({ status: 'not_found' });
      expect(JSON.stringify(result)).not.toContain('private body that must not escape');
    }
  });

  it('keeps a committed snapshot readable only after attachment and chunk TTL are removed', async () => {
    seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256);
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [{ id: ATTACHMENT_ID, data: attachment({ status: 'committed', expireAt: undefined }) }]
    );
    const chunkRef = fakeFirestore
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc('chunk-0');
    const chunk = (await chunkRef.get()).data();
    if (chunk === undefined) throw new Error('Expected prepared chunk');
    const durableChunk = { ...chunk };
    Reflect.deleteProperty(durableChunk, 'expireAt');
    await chunkRef.set(durableChunk);

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toMatchObject({ status: 'found' });
    await chunkRef.update({ expireAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')) });
    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toEqual({ status: 'snapshot_unavailable' });
  });

  it('records completed chain verification only after the snapshot hashes match', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantContextAttachmentRepository({
      telemetry: { record },
    });
    seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256);

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toMatchObject({ status: 'found' });
    expect(record).toHaveBeenCalledWith({
      operation: 'chain_verification',
      outcome: 'completed',
    });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(
      new RegExp(
        `${USER_ID}|${SESSION_ID}|${ATTACHMENT_ID}|${VALID_INTEGRITY.resultingContextChainSha256}`
      )
    );
  });

  it('records a hash mismatch without exposing the hashes', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantContextAttachmentRepository({
      telemetry: { record },
    });
    seedPreparedSnapshot(fakeFirestore, 'd'.repeat(64));

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toEqual({ status: 'snapshot_unavailable' });
    expect(record).toHaveBeenCalledWith({
      operation: 'chain_verification',
      outcome: 'mismatch',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('d'.repeat(64));
  });

  it('rejects transcript tampering that preserves every embedded hash and emits no content', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantContextAttachmentRepository({
      telemetry: { record },
    });
    seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256, {
      transcriptText: 'tampered transcript content',
    });

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toEqual({ status: 'snapshot_unavailable' });
    expect(record).toHaveBeenCalledWith({
      operation: 'chain_verification',
      outcome: 'mismatch',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('tampered transcript content');
  });

  it('does not report completed verification when the snapshot is absent', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    repository = createConversationAssistantContextAttachmentRepository({
      telemetry: { record },
    });
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, []);

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toEqual({ status: 'snapshot_unavailable' });
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps a verified snapshot available when telemetry rejects', async () => {
    const record = vi.fn().mockRejectedValue(new Error('metrics unavailable'));
    repository = createConversationAssistantContextAttachmentRepository({
      telemetry: { record },
    });
    seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256);

    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toMatchObject({ status: 'found' });
    expect(record).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'missing chunk', chunks: [] },
    {
      name: 'foreign chunk',
      chunks: [
        {
          id: 'chunk-0',
          data: {
            userId: 'foreign',
            sessionId: SESSION_ID,
            sessionGenerationId: GENERATION_ID,
            attachmentId: ATTACHMENT_ID,
            snapshotId: SNAPSHOT_ID,
            chunkIndex: 0,
            chunkCount: 1,
            encoding: 'base64-json',
            payload: Buffer.from('{}').toString('base64'),
          },
        },
      ],
    },
    {
      name: 'invalid JSON',
      chunks: [
        {
          id: 'chunk-0',
          data: {
            userId: USER_ID,
            sessionId: SESSION_ID,
            sessionGenerationId: GENERATION_ID,
            attachmentId: ATTACHMENT_ID,
            snapshotId: SNAPSHOT_ID,
            chunkIndex: 0,
            chunkCount: 1,
            encoding: 'base64-json',
            payload: Buffer.from('{').toString('base64'),
          },
        },
      ],
    },
  ])('fails snapshot load closed for $name', async ({ chunks }) => {
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
      chunks
    );
    await expect(
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      })
    ).resolves.toEqual({ status: 'snapshot_unavailable' });
  });

  it('fails snapshot load closed for ownership, metadata, manifest, and payload faults', async () => {
    const load = (userId = USER_ID): Promise<unknown> =>
      repository.loadOwnedContextAttachmentPreparedSnapshot({
        userId,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
        now: NOW,
      });

    await expect(load('foreign')).resolves.toEqual({ status: 'not_found' });

    for (const invalidAttachment of [
      attachment({ status: 'queued' }),
      attachment({ snapshotId: undefined }),
      attachment({ chunkManifest: undefined }),
      attachment({ chunkManifest: { chunkIds: [], chunkCount: 0 } }),
    ]) {
      fakeFirestore.seedCollection(
        WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
        [{ id: ATTACHMENT_ID, data: invalidAttachment }]
      );
      await expect(load()).resolves.toEqual({ status: 'snapshot_unavailable' });
    }

    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [{ id: ATTACHMENT_ID, data: attachment() }]
    );
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
      {
        id: 'chunk-0',
        data: {
          userId: USER_ID,
          sessionId: SESSION_ID,
          sessionGenerationId: GENERATION_ID,
          attachmentId: ATTACHMENT_ID,
          snapshotId: SNAPSHOT_ID,
          chunkIndex: 0,
          chunkCount: 1,
          encoding: 'base64-json',
          payload: '',
        },
      },
    ]);
    await expect(load()).resolves.toEqual({ status: 'snapshot_unavailable' });
  });

  it('rejects malformed canonical payloads, serialized shapes, and optional event ranges', async () => {
    const validPrepared = {
      ...fakePreparedContextAttachmentSnapshot(),
      deltaTranscriptSha256: VALID_INTEGRITY.deltaTranscriptSha256,
      previousContextChainSha256: PREVIOUS_CONTEXT_CHAIN_SHA256,
      resultingContextChainSha256: VALID_INTEGRITY.resultingContextChainSha256,
    };
    const encode = (value: unknown): string =>
      Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString(
        'base64'
      );
    const cases = [
      { label: 'non-canonical base64', payload: 'not-base64' },
      { label: 'invalid JSON', payload: encode('{') },
      { label: 'non-record JSON', payload: encode(null) },
      {
        label: 'non-string confirmation token',
        payload: encode({ ...validPrepared, confirmationToken: 42 }),
      },
      { label: 'non-record event range', payload: encode({ ...validPrepared, eventRange: null }) },
      {
        label: 'non-string event range start',
        payload: encode({ ...validPrepared, eventRange: { from: 1, to: CAPTURED_AT } }),
      },
      {
        label: 'non-string event range end',
        payload: encode({ ...validPrepared, eventRange: { from: CAPTURED_AT, to: 1 } }),
      },
    ];

    for (const scenario of cases) {
      seedPreparedSnapshot(fakeFirestore, VALID_INTEGRITY.resultingContextChainSha256);
      await fakeFirestore
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
        .doc('chunk-0')
        .update({ payload: scenario.payload });

      await expect(
        repository.loadOwnedContextAttachmentPreparedSnapshot({
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: ATTACHMENT_ID,
          now: NOW,
        }),
        scenario.label
      ).resolves.toEqual({ status: 'snapshot_unavailable' });
    }
  });

  it('expires and removes only an owned uncommitted draft idempotently', async () => {
    fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION, [
      {
        id: 'chunk-0',
        data: {
          userId: USER_ID,
          sessionId: SESSION_ID,
          sessionGenerationId: GENERATION_ID,
          sourceAccountId: 'source-access-repo',
          sourceAccountGeneration: SOURCE_ACCOUNT_GENERATION,
          attachmentId: ATTACHMENT_ID,
        },
      },
      { id: 'foreign-chunk', data: { attachmentId: 'foreign' } },
    ]);

    await expect(
      repository.deleteOwnedContextAttachmentDraft({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'deleted' });
    await expect(
      repository.deleteOwnedContextAttachmentDraft({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'deleted' });
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('chunk-0')
          .get()
      ).exists
    ).toBe(false);
    expect(
      (
        await fakeFirestore
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc('foreign-chunk')
          .get()
      ).exists
    ).toBe(true);
  });

  it('does not delete committed or foreign attachments', async () => {
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [{ id: ATTACHMENT_ID, data: attachment({ status: 'committed', expireAt: undefined }) }]
    );
    await expect(
      repository.deleteOwnedContextAttachmentDraft({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'committed' });
    await expect(
      repository.deleteOwnedContextAttachmentDraft({
        userId: 'foreign',
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('fails deletion closed for missing metadata and deletes a manifest-less draft', async () => {
    await expect(
      repository.deleteOwnedContextAttachmentDraft({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'missing-attachment',
      })
    ).resolves.toEqual({ status: 'not_found' });

    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [
        {
          id: ATTACHMENT_ID,
          data: attachment({ status: 'queued', chunkManifest: undefined }),
        },
      ]
    );
    await expect(
      repository.deleteOwnedContextAttachmentDraft({
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toEqual({ status: 'deleted' });
  });

  it('lists the initial snapshot followed by committed updates in context-version order', async () => {
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [
        {
          id: 'update-2',
          data: attachment({
            status: 'committed',
            baseContextVersion: 1,
            committedAt: '2026-07-03T00:00:00.000Z',
            committedTurnId: 'turn-3',
            expireAt: undefined,
          }),
        },
        {
          id: 'draft',
          data: attachment({ status: 'ready' }),
        },
        {
          id: 'update-1',
          data: attachment({
            status: 'committed',
            baseContextVersion: 0,
            committedAt: '2026-07-02T00:00:00.000Z',
            committedTurnId: 'turn-2',
            expireAt: undefined,
            counts: {
              included: 0,
              omitted: 2,
              newlyAvailable: 0,
              edited: 2,
              redacted: 0,
              deleted: 0,
              reactionsChanged: 0,
              lateIngested: 0,
              completedTranscriptions: 1,
            },
            omitted: {
              mediaOnly: 1,
              failedTranscriptions: 0,
              pendingTranscriptions: 1,
              nonText: 0,
              overLimit: 0,
            },
          }),
        },
      ]
    );

    await expect(
      repository.listOwnedContextHistory({ userId: USER_ID, sessionId: SESSION_ID })
    ).resolves.toEqual({
      status: 'found',
      snapshots: [
        {
          kind: 'initial',
          contextVersion: 0,
          capturedAt: '2026-07-01T10:00:00.000Z',
          messageCount: 7,
          excludedCount: 4,
          correctionCount: 0,
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 1,
            pendingTranscriptions: 0,
            nonText: 2,
            overLimit: 0,
          },
        },
        expect.objectContaining({
          kind: 'update',
          contextVersion: 1,
          messageCount: 0,
          excludedCount: 2,
          correctionCount: 3,
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 0,
            pendingTranscriptions: 1,
            nonText: 0,
            overLimit: 0,
          },
          captureRange: {
            from: '2026-07-01T09:00:00.000Z',
            to: '2026-07-02T12:00:00.000Z',
          },
          attachmentId: 'update-1',
          linkedTurnId: 'turn-2',
        }),
        expect.objectContaining({
          kind: 'update',
          contextVersion: 2,
          attachmentId: 'update-2',
          linkedTurnId: 'turn-3',
        }),
      ],
    });
    await expect(
      repository.listOwnedContextHistory({ userId: 'foreign', sessionId: SESSION_ID })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('skips stale-generation history and orders equal versions with optional links and ranges', async () => {
    fakeFirestore.seedCollection(
      WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
      [
        {
          id: 'same-version-b',
          data: attachment({
            status: 'committed',
            baseContextVersion: 0,
            expireAt: undefined,
          }),
        },
        {
          id: 'wrong-generation',
          data: attachment({
            status: 'committed',
            sessionGenerationId: 'replacement-generation',
            expireAt: undefined,
          }),
        },
        {
          id: 'same-version-a',
          data: attachment({
            status: 'committed',
            baseContextVersion: 0,
            expireAt: undefined,
            eventRange: {
              from: '2026-07-01T10:00:00.000Z',
              to: '2026-07-02T11:00:00.000Z',
            },
          }),
        },
      ]
    );

    const result = await repository.listOwnedContextHistory({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });

    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('Expected context history');
    expect(result.snapshots.slice(1).map((snapshot) => snapshot.attachmentId)).toEqual([
      'same-version-a',
      'same-version-b',
    ]);
    expect(result.snapshots[1]).toMatchObject({
      eventRange: {
        from: '2026-07-01T10:00:00.000Z',
        to: '2026-07-02T11:00:00.000Z',
      },
    });
    expect(result.snapshots.slice(1).every((snapshot) => snapshot.linkedTurnId === undefined)).toBe(
      true
    );
  });

  it('fails history closed for malformed initial snapshot metadata after the read fence', async () => {
    for (const invalidSession of [
      session({ generationId: undefined }),
      session({ createdAt: null }),
      session({ omitted: null }),
    ]) {
      fakeFirestore.seedCollection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION, [
        { id: SESSION_ID, data: invalidSession },
      ]);
      await expect(
        repository.listOwnedContextHistory({ userId: USER_ID, sessionId: SESSION_ID })
      ).resolves.toEqual({ status: 'not_found' });
    }
  });
});
