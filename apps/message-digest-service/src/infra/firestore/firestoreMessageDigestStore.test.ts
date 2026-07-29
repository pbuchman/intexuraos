import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeFirestore,
  type FakeFirestore,
  type Firestore,
} from '@intexuraos/infra-firestore';
import type { MessageDigestStore } from '../../domain/ports/messageDigestStore.js';
import type { MessageDigestWhatsAppClient } from '../../domain/ports/messageDigestClients.js';
import { prepareMessageDigestRun } from '../../domain/usecases/prepareMessageDigestRun.js';
import { reserveMessageDigestRun } from '../../domain/usecases/reserveMessageDigestRun.js';
import { updateMessageDigest } from '../../domain/usecases/updateMessageDigest.js';
import { getMessageDigestDeliveryOutboxId } from '../../domain/messageDigestIds.js';
import {
  acquireMessageDigestDeliveryAuthorization,
  releaseMessageDigestDeliveryAuthorization,
} from '../../domain/usecases/authorizeMessageDigestDelivery.js';
import { createRunPreparationTokenCodec } from '../security/runPreparationToken.js';
import {
  createMessageDigestCursorCodec,
  MESSAGE_DIGEST_DEFINITIONS_COLLECTION,
  MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION,
  MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION,
  MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION,
  MESSAGE_DIGEST_RUNS_COLLECTION,
  MESSAGE_DIGEST_STATES_COLLECTION,
  MessageDigestDefinitionDocumentSchema,
  MessageDigestDispatchOutboxDocumentSchema,
  MessageDigestErasureRequestDocumentSchema,
  MessageDigestMigrationActivationDocumentSchema,
  MessageDigestRunDocumentSchema,
  MessageDigestStateDocumentSchema,
  type MessageDigestDefinitionDocument,
  type MessageDigestDispatchOutboxDocument,
  type MessageDigestRunDocument,
  type MessageDigestStateDocument,
} from './messageDigestDocuments.js';
import { LEGACY_DIGEST_ARCHIVE_COLLECTIONS } from './firestoreLegacyDigestArchive.js';
import { createFirestoreMessageDigestStore } from './firestoreMessageDigestStore.js';

const AUTHORIZATION_PAYLOAD_JSON = JSON.stringify({
  type: 'whatsapp.message.send',
  runId: 'mdr_run_001',
  idempotencyKey: 'message-digest:mdr_run_001',
});
const AUTHORIZATION_PAYLOAD_DIGEST = createHash('sha256')
  .update(AUTHORIZATION_PAYLOAD_JSON, 'utf8')
  .digest('hex');

interface DeliveryAuthorizationStore {
  claimDeliveryAuthorization(input: {
    userId: string;
    definitionId: string;
    runId: string;
    idempotencyKey: string;
    payloadDigest: string;
    ownerDigest: string;
    now: string;
    expiresAt: string;
  }): Promise<
    | { ok: true; disposition: 'acquired' | 'existing'; fence: number; expiresAt: string }
    | { ok: false; code: 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'LEASE_BUSY' }
  >;
  releaseDeliveryAuthorization(input: {
    userId: string;
    definitionId: string;
    runId: string;
    payloadDigest: string;
    ownerDigest: string;
    fence: number;
    now: string;
  }): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' }>;
}

describe('FirestoreMessageDigestStore', () => {
  let fake: FakeFirestore;
  let store: ReturnType<typeof createFirestoreMessageDigestStore>;

  beforeEach(() => {
    ({ fake, store } = createStoreHarness());
    const domainStore: MessageDigestStore = store;
    expect(domainStore).toBe(store);
  });

  it('creates definition and state atomically and replays only the same request idempotently', async () => {
    const definition = makeDefinition();
    const initialState = makeState();

    await expect(store.createDefinition({ definition, state: initialState })).resolves.toEqual({
      ok: true,
      disposition: 'created',
      definition,
    });
    await expect(store.createDefinition({ definition, state: initialState })).resolves.toEqual({
      ok: true,
      disposition: 'existing',
      definition,
    });
    await expect(
      store.createDefinition({
        definition: { ...definition, createRequestIdDigest: 'f'.repeat(64) },
        state: initialState,
      })
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });

    expect(fake.getAllData().get(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)?.size).toBe(1);
    expect(fake.getAllData().get(MESSAGE_DIGEST_STATES_COLLECTION)?.size).toBe(1);
  });

  it('keeps get/list owner-isolated and binds cursors to the exact query fingerprint', async () => {
    await createDefinition(store, makeDefinition({ definitionId: 'md_definition_001' }));
    await createDefinition(
      store,
      makeDefinition({
        definitionId: 'md_definition_002',
        updatedAt: '2026-07-27T01:00:00.000Z',
      })
    );
    await createDefinition(
      store,
      makeDefinition({
        definitionId: 'md_foreign_001',
        userId: 'synthetic-user-foreign',
      })
    );

    await expect(
      store.getOwnedDefinition('synthetic-user-foreign', 'md_definition_001')
    ).resolves.toBeNull();
    const first = await store.listOwnedDefinitions({
      userId: 'synthetic-user-001',
      limit: 1,
      queryFingerprint: 'definitions-default-v1',
    });
    expect(first.items.map((item) => item.definitionId)).toEqual(['md_definition_002']);
    expect(first.nextCursor).toMatch(/^mdc1\./u);

    const second = await store.listOwnedDefinitions({
      userId: 'synthetic-user-001',
      limit: 1,
      cursor: first.nextCursor ?? undefined,
      queryFingerprint: 'definitions-default-v1',
    });
    expect(second.items.map((item) => item.definitionId)).toEqual(['md_definition_001']);
    await expect(
      store.listOwnedDefinitions({
        userId: 'synthetic-user-001',
        limit: 1,
        cursor: first.nextCursor ?? undefined,
        queryFingerprint: 'different-query',
      })
    ).rejects.toThrow('INVALID_CURSOR');
  });

  it('reads one owner-isolated definition and state snapshot for run preparation', async () => {
    const definition = makeDefinition({ revision: 3 });
    const state = makeState({ revision: 5, continuityMemoryMarkdown: 'Bounded continuity.' });
    await store.createDefinition({ definition, state });

    await expect(
      store.getOwnedRunContext('synthetic-user-001', 'md_definition_001')
    ).resolves.toEqual({ definition, state });
    await expect(
      store.getOwnedRunContext('synthetic-user-foreign', 'md_definition_001')
    ).resolves.toBeNull();
    await expect(
      store.getOwnedRunContext('synthetic-user-001', 'md_missing_001')
    ).resolves.toBeNull();
  });

  it('applies bounded definition search, chat, effective status, sort, and direction filters', async () => {
    seedDefinitions(fake, [
      makeDefinition({
        definitionId: 'md_fishing_group',
        name: 'Fishing daily',
        nameSortKey: 'fishing daily',
        nextRunAt: '2026-07-28T08:00:00.000Z',
      }),
      makeDefinition({
        definitionId: 'md_fishing_direct',
        name: 'Fishing contact',
        nameSortKey: 'fishing contact',
        source: { ...makeDefinition().source, chatType: 'direct' },
        nextRunAt: '2026-07-28T09:00:00.000Z',
      }),
      makeDefinition({
        definitionId: 'md_attention_group',
        name: 'Attention group',
        nameSortKey: 'attention group',
        listStatus: 'needs_attention',
        attentionCode: 'DELIVERY_SETUP_REQUIRED',
        nextRunAt: '2026-07-28T10:00:00.000Z',
      }),
      makeDefinition({
        definitionId: 'md_deleting_group',
        name: 'Fishing deleted',
        nameSortKey: 'fishing deleted',
        status: 'deleting',
        listStatus: 'paused',
        activeErasureRequestId: 'mde_deleting_group_001',
      }),
    ]);

    await expect(
      store.listOwnedDefinitions({
        userId: 'synthetic-user-001',
        query: 'fishing',
        chatType: 'group',
        status: 'active',
        sort: 'name',
        direction: 'asc',
        limit: 10,
        queryFingerprint: 'search-group-active-v1',
      })
    ).resolves.toMatchObject({
      items: [{ definitionId: 'md_fishing_group' }],
      nextCursor: null,
    });

    await expect(
      store.listOwnedDefinitions({
        userId: 'synthetic-user-001',
        status: 'needs_attention',
        sort: 'nextRunAt',
        direction: 'desc',
        limit: 10,
        queryFingerprint: 'attention-next-run-v1',
      })
    ).resolves.toMatchObject({
      items: [{ definitionId: 'md_attention_group' }],
      nextCursor: null,
    });
  });

  it('uses CAS updates, permits source replacement before a run, and locks it after reservation', async () => {
    await createDefinition(store);
    const source = {
      ...makeDefinition().source,
      chatId: 'synthetic-chat-replacement',
      displayName: 'Replacement chat',
      sourceRevision: 'synthetic-source-revision-2',
    };

    const updated = await store.updateDefinition({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 1,
      updatedAt: '2026-07-27T02:00:00.000Z',
      patch: {
        name: 'Renamed digest',
        nameSortKey: 'renamed digest',
        source,
        resetCheckpointAt: '2026-07-27T01:00:00.000Z',
        nextRunAt: '2026-07-28T01:00:00.000Z',
      },
    });
    expect(updated).toMatchObject({
      ok: true,
      definition: { revision: 2, name: 'Renamed digest', source },
    });
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:01:00.000Z',
        patch: { name: 'Stale', nameSortKey: 'stale' },
      })
    ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });

    await reserveRun(store, {
      run: makeRun({
        definitionRevision: 2,
        sourceSnapshot: source,
        windowStart: '2026-07-27T01:00:00.000Z',
      }),
      definitionRevision: 2,
      stateRevision: 2,
    });
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 2,
        updatedAt: '2026-07-27T03:00:00.000Z',
        patch: {
          source: { ...source, chatId: 'synthetic-chat-too-late' },
          resetCheckpointAt: '2026-07-27T02:00:00.000Z',
          nextRunAt: '2026-07-28T01:00:00.000Z',
        },
      })
    ).resolves.toEqual({ ok: false, code: 'SOURCE_LOCKED' });
  });

  it('preserves an observed needs-attention projection during an unrelated edit', async () => {
    await createDefinition(
      store,
      makeDefinition({
        listStatus: 'needs_attention',
        attentionCode: 'DELIVERY_SETUP_REQUIRED',
      })
    );

    const result = await store.updateDefinition({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 1,
      updatedAt: '2026-07-27T02:00:00.000Z',
      patch: { name: 'Renamed only', nameSortKey: 'renamed only' },
    });

    expect(result).toMatchObject({
      ok: true,
      definition: {
        listStatus: 'needs_attention',
        attentionCode: 'DELIVERY_SETUP_REQUIRED',
      },
    });
  });

  it('CAS-edits complete schedules and preserves checkpoint state', async () => {
    await createDefinition(store);

    const updated = await store.updateDefinition({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 1,
      updatedAt: '2026-07-27T12:00:00.000Z',
      patch: {
        schedule: { kind: 'weekdays', localTime: '08:15', timeZone: 'Europe/Warsaw' },
        nextRunAt: '2026-07-28T06:15:00.000Z',
      },
    });

    expect(updated).toMatchObject({
      ok: true,
      definition: {
        revision: 2,
        schedule: { kind: 'weekdays', localTime: '08:15', timeZone: 'Europe/Warsaw' },
        checkpointAt: '2026-07-27T00:00:00.000Z',
        nextRunAt: '2026-07-28T06:15:00.000Z',
      },
    });
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T12:01:00.000Z',
        patch: {
          schedule: {
            kind: 'weekly',
            weekday: 'friday',
            localTime: '09:30',
            timeZone: 'Europe/Warsaw',
          },
          nextRunAt: '2026-07-31T07:30:00.000Z',
        },
      })
    ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    await expect(
      store.getOwnedRunContext('synthetic-user-001', 'md_definition_001')
    ).resolves.toMatchObject({
      state: { checkpointAt: '2026-07-27T00:00:00.000Z', revision: 1 },
    });
  });

  it('rejects pausing while a run owns the pending window and preserves both documents', async () => {
    await createDefinition(store);
    await reserveRun(store);

    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:01:00.000Z',
        patch: { status: 'paused', listStatus: 'paused', attentionCode: null },
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_IN_PROGRESS' });
    await expect(
      store.getOwnedRunContext('synthetic-user-001', 'md_definition_001')
    ).resolves.toMatchObject({
      definition: {
        status: 'active',
        listStatus: 'active',
        revision: 1,
        checkpointAt: '2026-07-27T00:00:00.000Z',
      },
      state: {
        revision: 2,
        checkpointAt: '2026-07-27T00:00:00.000Z',
        pendingWindow: { runId: 'mdr_run_001' },
      },
    });
  });

  it('lists due active definitions in bounded stable order and excludes paused/deleting records', async () => {
    seedDefinitions(fake, [
      makeDefinition({ definitionId: 'md_due_002', nextRunAt: '2026-07-27T10:00:00.000Z' }),
      makeDefinition({
        definitionId: 'md_due_001',
        schedule: {
          kind: 'weekly',
          weekday: 'monday',
          localTime: '09:00',
          timeZone: 'UTC',
        },
        nextRunAt: '2026-07-27T09:00:00.000Z',
      }),
      makeDefinition({
        definitionId: 'md_due_after_cutoff_001',
        nextRunAt: '2026-07-27T12:30:00.000Z',
      }),
      makeDefinition({
        definitionId: 'md_paused_001',
        status: 'paused',
        listStatus: 'paused',
        nextRunAt: '2026-07-27T08:00:00.000Z',
      }),
      makeDefinition({
        definitionId: 'md_deleting_001',
        status: 'deleting',
        listStatus: 'paused',
        activeErasureRequestId: 'mde_deleting_due_001',
        nextRunAt: '2026-07-27T07:00:00.000Z',
      }),
      makeDefinition({ definitionId: 'md_future_001', nextRunAt: '2026-07-28T01:00:00.000Z' }),
    ]);

    const first = await store.listDueDefinitions({
      now: '2026-07-27T12:00:00.000Z',
      limit: 1,
    });
    expect(first.items.map((item) => item.definitionId)).toEqual(['md_due_001']);
    expect(first.nextCursor).not.toBeNull();

    const moved = makeDefinition({
      definitionId: 'md_due_001',
      nextRunAt: '2026-07-27T09:00:00.000Z',
      updatedAt: '2026-07-27T11:00:00.000Z',
    });
    seedDefinitions(fake, [moved]);
    const second = await store.listDueDefinitions({
      now: '2026-07-27T13:00:00.000Z',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.definitionId)).toEqual(['md_due_002']);
    expect(second.nextCursor).toBeNull();
  });

  it('lists retryable dispatches and pending delivery receipts with stable bounded cursors', async () => {
    fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: 'mdo_ready_001', data: makeOutbox({ outboxId: 'mdo_ready_001' }) },
      { id: 'mdo_ready_002', data: makeOutbox({ outboxId: 'mdo_ready_002' }) },
      {
        id: 'mdo_future_001',
        data: makeOutbox({
          outboxId: 'mdo_future_001',
          nextAttemptAt: '2026-07-27T03:00:00.000Z',
        }),
      },
      {
        id: 'mdo_published_001',
        data: makeOutbox({
          outboxId: 'mdo_published_001',
          status: 'published',
          publishedAt: '2026-07-27T01:01:00.000Z',
        }),
      },
    ]);
    seedRuns(fake, [
      completedRunForReconciliation('mdr_pending_001', 'pending'),
      completedRunForReconciliation('mdr_pending_002', 'pending'),
      completedRunForReconciliation('mdr_sent_001', 'sent'),
    ]);

    const firstDispatchPage = await store.listReadyDispatches({
      now: '2026-07-27T02:00:00.000Z',
      limit: 1,
    });
    expect(firstDispatchPage.items.map((item) => item.outboxId)).toEqual(['mdo_ready_001']);
    expect(firstDispatchPage.nextCursor).toEqual(expect.any(String));
    await expect(
      store.listReadyDispatches({
        now: '2026-07-27T02:00:00.000Z',
        limit: 2,
        cursor: firstDispatchPage.nextCursor ?? undefined,
      })
    ).resolves.toMatchObject({ items: [{ outboxId: 'mdo_ready_002' }], nextCursor: null });

    const firstDeliveryPage = await store.listPendingDeliveryRuns({
      now: '2026-07-27T02:00:00.000Z',
      limit: 1,
    });
    expect(firstDeliveryPage.items.map((item) => item.runId)).toEqual(['mdr_pending_001']);
    expect(firstDeliveryPage.nextCursor).toEqual(expect.any(String));
    await expect(
      store.listPendingDeliveryRuns({
        now: '2026-07-27T02:00:00.000Z',
        limit: 2,
        cursor: firstDeliveryPage.nextCursor ?? undefined,
      })
    ).resolves.toMatchObject({ items: [{ runId: 'mdr_pending_002' }], nextCursor: null });
  });

  it('serializes simultaneous manual/tick reservation and persists exact payload bytes and hash', async () => {
    await createDefinition(store);
    const manual = reservationInput();
    const scheduled = reservationInput({
      run: makeRun({
        runId: 'mdr_scheduled_001',
        trigger: 'scheduled',
        requestIdDigest: 'd'.repeat(64),
      }),
      outbox: makeOutbox({ outboxId: 'mdo_scheduled_001', runId: 'mdr_scheduled_001' }),
    });

    const results = await Promise.all([store.reserveRun(manual), store.reserveRun(scheduled)]);
    expect(results.filter((result) => result.ok && result.disposition === 'reserved')).toHaveLength(
      1
    );
    expect(
      results.filter((result) => !result.ok && result.code === 'RUN_IN_PROGRESS')
    ).toHaveLength(1);

    const winner = results.find((result) => result.ok && result.disposition === 'reserved');
    if (winner === undefined || !winner.ok) throw new Error('Expected reservation winner');
    const replayInput = winner.run.runId === manual.run.runId ? manual : scheduled;
    await expect(store.reserveRun(replayInput)).resolves.toMatchObject({
      ok: true,
      disposition: 'existing',
      run: { runId: winner.run.runId },
    });

    const storedOutbox = Array.from(
      fake.getAllData().get(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)?.values() ?? []
    )[0] as Record<string, unknown> | undefined;
    expect(storedOutbox?.['payloadJson']).toBe(replayInput.outbox.payloadJson);
    expect(storedOutbox?.['payloadDigest']).toBe(
      createHash('sha256').update(replayInput.outbox.payloadJson, 'utf8').digest('hex')
    );
    await expect(
      store.getOwnedDefinition('synthetic-user-001', 'md_definition_001')
    ).resolves.toMatchObject({
      latestRun: {
        runId: winner.run.runId,
        startedAt: winner.run.createdAt,
        generationStatus: 'queued',
        processingStage: 'queued',
        deliveryStatus: 'not_sent',
      },
      delivery: {
        readinessObservationVersion: 'synthetic-readiness-v2',
        readinessObservedAt: '2026-07-27T01:00:00.000Z',
      },
    });
  });

  it('acquires, renews, and fences a run lease', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    const acquired = await store.claimRunLease({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest,
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:05:00.000Z',
    });
    expect(acquired).toMatchObject({ ok: true, disposition: 'acquired', fence: 1 });
    await expect(
      store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest: 'f'.repeat(64),
        now: '2026-07-27T02:01:00.000Z',
        expiresAt: '2026-07-27T02:06:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_BUSY' });
    await expect(
      store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:03:00.000Z',
        expiresAt: '2026-07-27T02:08:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, expiresAt: '2026-07-27T02:08:00.000Z' });
    await expect(
      store.markRunProcessingStage({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:04:00.000Z',
        processingStage: 'aggregating',
      })
    ).resolves.toEqual({ ok: true });
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      generationStatus: 'processing',
      processingStage: 'aggregating',
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({
      latestRun: {
        runId: 'mdr_run_001',
        generationStatus: 'processing',
        processingStage: 'aggregating',
        deliveryStatus: 'not_sent',
      },
    });
    await expect(
      store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 2,
        now: '2026-07-27T02:04:00.000Z',
        expiresAt: '2026-07-27T02:09:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });

    const recoveredOwner = 'a'.repeat(64);
    await expect(
      store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest: recoveredOwner,
        now: '2026-07-27T02:08:00.000Z',
        expiresAt: '2026-07-27T02:11:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'acquired', fence: 2 });
    await expect(
      store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:08:01.000Z',
        expiresAt: '2026-07-27T02:11:01.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
  });

  it('completion atomically advances its checkpoint and creates the delivery outbox', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);

    await expect(
      store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:04:00.000Z',
        generationStatus: 'completed',
        output: {
          headline: 'Synthetic completion',
          summaryMarkdown: '- A bounded synthetic fact.',
          evidenceMessageRefs: ['1'.repeat(64)],
          continuityMemoryMarkdown: 'Synthetic continuity.',
          effectiveMessageCount: 1,
          promptVersion: '1.0.0',
          model: 'or:synthetic/model',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
        },
        deliveryOutbox: makeDeliveryOutbox(),
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'completed' });

    const savedState = readDocument(fake, MESSAGE_DIGEST_STATES_COLLECTION, 'md_definition_001');
    expect(savedState).toMatchObject({
      checkpointAt: '2026-07-27T02:00:00.000Z',
      pendingWindow: null,
      precedingRunId: 'mdr_run_001',
    });
    const savedDefinition = readDocument(
      fake,
      MESSAGE_DIGEST_DEFINITIONS_COLLECTION,
      'md_definition_001'
    );
    expect(savedDefinition).toMatchObject({
      checkpointAt: '2026-07-27T02:00:00.000Z',
      lastRunAt: '2026-07-27T02:04:00.000Z',
      latestRun: {
        runId: 'mdr_run_001',
        generationStatus: 'completed',
        processingStage: 'completed',
        deliveryStatus: 'pending',
      },
    });
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      generationStatus: 'completed',
      delivery: { status: 'pending' },
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, 'mdo_delivery_001')
    ).toMatchObject({
      kind: 'whatsapp_delivery',
      status: 'pending',
      runId: 'mdr_run_001',
    });

    const deliveryObservation = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      expectedErasureEpoch: 0,
      observedAt: '2026-07-27T02:05:00.000Z',
      delivery: { status: 'sent' as const, acceptedAt: '2026-07-27T02:04:30.000Z' },
    };
    await expect(store.recordRunDeliveryState(deliveryObservation)).resolves.toMatchObject({
      ok: true,
      disposition: 'updated',
      run: { delivery: { status: 'sent', acceptedAt: '2026-07-27T02:04:30.000Z' } },
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({
      latestRun: {
        runId: 'mdr_run_001',
        generationStatus: 'completed',
        processingStage: 'completed',
        deliveryStatus: 'sent',
      },
    });
    await expect(store.recordRunDeliveryState(deliveryObservation)).resolves.toMatchObject({
      ok: true,
      disposition: 'existing',
    });
    await expect(
      store.recordRunDeliveryState({
        ...deliveryObservation,
        delivery: {
          status: 'failed',
          failedAt: '2026-07-27T02:05:00.000Z',
          failureCode: 'DELIVERY_DISABLED',
        },
      })
    ).resolves.toEqual({ ok: false, code: 'DELIVERY_CONFLICT' });
  });

  it('fences every worker mutation after definition erasure starts', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);
    const activeDefinition = MessageDigestDefinitionDocumentSchema.parse(
      readDocument(fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    );
    seedDefinitions(fake, [
      MessageDigestDefinitionDocumentSchema.parse({
        ...activeDefinition,
        status: 'deleting',
        listStatus: 'paused',
        erasureEpoch: activeDefinition.erasureEpoch + 1,
        activeErasureRequestId: 'mde_erasure_started_001',
        updatedAt: '2026-07-27T02:01:00.000Z',
      }),
    ]);

    await expect(
      store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        now: '2026-07-27T02:02:00.000Z',
        expiresAt: '2026-07-27T02:07:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:02:00.000Z',
        expiresAt: '2026-07-27T02:07:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      store.markRunProcessingStage({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:02:00.000Z',
        processingStage: 'aggregating',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:02:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
        deliveryOutbox: makeDeliveryOutbox(),
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      store.claimDispatch({
        outboxId: 'mdo_run_request_001',
        ownerDigest: '9'.repeat(64),
        now: '2026-07-27T02:02:00.000Z',
        expiresAt: '2026-07-27T02:07:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
  });

  it('quiesces active run and dispatch leases before erasing any definition content', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const runOwnerDigest = 'e'.repeat(64);
    const dispatchOwnerDigest = '9'.repeat(64);
    await claim(store, runOwnerDigest);
    await store.claimDispatch({
      outboxId: 'mdo_run_request_001',
      ownerDigest: dispatchOwnerDigest,
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:05:00.000Z',
    });

    const erasureInput = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: 'mde_quiescing_001',
      requestIdDigest: '6'.repeat(64),
      now: '2026-07-27T02:01:00.000Z',
      limit: 10,
    };
    await expect(store.startOrResumeDefinitionErasure(erasureInput)).resolves.toMatchObject({
      ok: true,
      status: 'in_progress',
      deletedThisCall: 0,
      request: { stage: 'quiescing', erasureEpoch: 1 },
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({
      status: 'deleting',
      erasureEpoch: 1,
      activeErasureRequestId: 'mde_quiescing_001',
    });
    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        erasureRequestId: 'mde_competing_001',
        requestIdDigest: '7'.repeat(64),
        now: '2026-07-27T02:01:30.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'ERASURE_CONFLICT' });
    expect(
      fake.getAllData().get(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION)?.get('mde_competing_001')
    ).toBeUndefined();
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toBeDefined();
    expect(
      readDocument(fake, MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, 'mdo_run_request_001')
    ).toBeDefined();

    await expect(
      store.failRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest: runOwnerDigest,
        fence: 1,
        failedAt: '2026-07-27T02:02:00.000Z',
        safeFailureCode: 'SOURCE_CHANGED',
        pauseDefinition: true,
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      store.recordDispatchResult({
        outboxId: 'mdo_run_request_001',
        ownerDigest: dispatchOwnerDigest,
        fence: 1,
        now: '2026-07-27T02:02:00.000Z',
        outcome: { status: 'retry', nextAttemptAt: '2026-07-27T02:10:00.000Z' },
      })
    ).resolves.toEqual({ ok: true });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, 'mdo_run_request_001')
    ).toMatchObject({ status: 'terminal', terminalCode: 'ERASURE_STARTED', claim: null });

    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:04:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      deletedThisCall: 0,
      request: { stage: 'quiescing' },
    });
    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      deletedThisCall: 0,
      request: { stage: 'runs' },
    });
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toBeDefined();
  });

  it('keeps erasure quiesced when an in-flight dispatch heartbeats past its first claim', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = '9'.repeat(64);
    await store.claimDispatch({
      outboxId: 'mdo_run_request_001',
      ownerDigest,
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:02:00.000Z',
    });

    await expect(
      store.renewDispatchClaim({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:01:00.000Z',
        expiresAt: '2026-07-27T02:04:00.000Z',
      })
    ).resolves.toEqual({ ok: true, expiresAt: '2026-07-27T02:04:00.000Z' });

    const erasureInput = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: 'mde_heartbeat_001',
      requestIdDigest: '8'.repeat(64),
      now: '2026-07-27T02:02:30.000Z',
      limit: 10,
    };
    await expect(store.startOrResumeDefinitionErasure(erasureInput)).resolves.toMatchObject({
      ok: true,
      status: 'in_progress',
      deletedThisCall: 0,
      request: { stage: 'quiescing' },
    });
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toBeDefined();

    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:04:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      deletedThisCall: 0,
      request: { stage: 'runs' },
    });
  });

  it('owner- and fence-guards the durable WhatsApp delivery authorization lease', async () => {
    seedDeliveryAuthorizationContext(fake);
    const authorizationStore = store as unknown as DeliveryAuthorizationStore;
    const firstClaim = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      ownerDigest: 'd'.repeat(64),
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:02:00.000Z',
    };

    await expect(authorizationStore.claimDeliveryAuthorization(firstClaim)).resolves.toEqual({
      ok: true,
      disposition: 'acquired',
      fence: 1,
      expiresAt: firstClaim.expiresAt,
    });
    await expect(
      authorizationStore.claimDeliveryAuthorization({
        ...firstClaim,
        now: '2026-07-27T02:00:30.000Z',
        expiresAt: '2026-07-27T02:02:30.000Z',
      })
    ).resolves.toEqual({
      ok: true,
      disposition: 'existing',
      fence: 1,
      expiresAt: '2026-07-27T02:02:30.000Z',
    });
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      updatedAt: '2026-07-27T02:00:30.000Z',
      deliveryAuthorization: {
        ownerDigest: firstClaim.ownerDigest,
        fence: 1,
        renewedAt: '2026-07-27T02:00:30.000Z',
        expiresAt: '2026-07-27T02:02:30.000Z',
        releasedAt: null,
      },
    });
    await expect(
      authorizationStore.releaseDeliveryAuthorization({
        userId: firstClaim.userId,
        definitionId: firstClaim.definitionId,
        runId: firstClaim.runId,
        payloadDigest: 'b'.repeat(64),
        ownerDigest: firstClaim.ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:31.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
    await expect(
      authorizationStore.claimDeliveryAuthorization({
        ...firstClaim,
        ownerDigest: 'e'.repeat(64),
        now: '2026-07-27T02:01:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_BUSY' });
    await expect(
      authorizationStore.releaseDeliveryAuthorization({
        userId: firstClaim.userId,
        definitionId: firstClaim.definitionId,
        runId: firstClaim.runId,
        payloadDigest: firstClaim.payloadDigest,
        ownerDigest: firstClaim.ownerDigest,
        fence: 2,
        now: '2026-07-27T02:01:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
    await expect(
      authorizationStore.releaseDeliveryAuthorization({
        userId: firstClaim.userId,
        definitionId: firstClaim.definitionId,
        runId: firstClaim.runId,
        payloadDigest: firstClaim.payloadDigest,
        ownerDigest: firstClaim.ownerDigest,
        fence: 1,
        now: '2026-07-27T02:01:00.000Z',
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      authorizationStore.claimDeliveryAuthorization({
        ...firstClaim,
        ownerDigest: 'e'.repeat(64),
        now: '2026-07-27T02:01:01.000Z',
        expiresAt: '2026-07-27T02:03:01.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'acquired', fence: 2 });

    for (const invalid of [
      { ...firstClaim, userId: 'synthetic-user-foreign' },
      { ...firstClaim, idempotencyKey: 'message-digest:mdr_wrong_001' },
      { ...firstClaim, runId: 'mdr_missing_001' },
    ]) {
      await expect(authorizationStore.claimDeliveryAuthorization(invalid)).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it.each([
    {
      name: 'changed payload bytes',
      claimPayloadDigest: 'b'.repeat(64),
      outbox: {},
    },
    {
      name: 'non-delivery outbox kind',
      claimPayloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      outbox: { kind: 'run_request' as const },
    },
    {
      name: 'foreign outbox owner',
      claimPayloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      outbox: { userId: 'synthetic-user-foreign' },
    },
    {
      name: 'different outbox run',
      claimPayloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      outbox: { runId: 'mdr_run_other' },
    },
  ])('denies $name before creating a delivery authorization lease', async (testCase) => {
    const local = createStoreHarness();
    seedDeliveryAuthorizationContext(local.fake, testCase.outbox);

    await expect(
      local.store.claimDeliveryAuthorization({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        idempotencyKey: 'message-digest:mdr_run_001',
        payloadDigest: testCase.claimPayloadDigest,
        ownerDigest: 'd'.repeat(64),
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:02:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    expect(readDocument(local.fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      deliveryAuthorization: null,
    });
  });

  it('reclaims an unreleased expired delivery authorization for the same owner with a higher fence', async () => {
    seedDeliveryAuthorizationContext(fake);
    const authorizationStore = store as unknown as DeliveryAuthorizationStore;
    const firstClaim = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      ownerDigest: 'd'.repeat(64),
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:02:00.000Z',
    };

    await expect(authorizationStore.claimDeliveryAuthorization(firstClaim)).resolves.toMatchObject({
      ok: true,
      disposition: 'acquired',
      fence: 1,
    });
    await expect(
      authorizationStore.claimDeliveryAuthorization({
        ...firstClaim,
        now: '2026-07-27T02:02:00.000Z',
        expiresAt: '2026-07-27T02:04:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'acquired', fence: 2 });
    await expect(
      authorizationStore.releaseDeliveryAuthorization({
        userId: firstClaim.userId,
        definitionId: firstClaim.definitionId,
        runId: firstClaim.runId,
        payloadDigest: firstClaim.payloadDigest,
        ownerDigest: firstClaim.ownerDigest,
        fence: 1,
        now: '2026-07-27T02:02:01.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
  });

  it('blocks erasure on an active delivery authorization and denies every claim after DELETE starts', async () => {
    seedDeliveryAuthorizationContext(fake);
    const authorizationStore = store as unknown as DeliveryAuthorizationStore;
    const claimInput = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      ownerDigest: 'd'.repeat(64),
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:03:00.000Z',
    };
    await authorizationStore.claimDeliveryAuthorization(claimInput);
    const erasureInput = {
      userId: claimInput.userId,
      definitionId: claimInput.definitionId,
      erasureRequestId: 'mde_delivery_fence_001',
      requestIdDigest: '7'.repeat(64),
      now: '2026-07-27T02:01:00.000Z',
      limit: 10,
    };

    await expect(store.startOrResumeDefinitionErasure(erasureInput)).resolves.toMatchObject({
      ok: true,
      request: { stage: 'quiescing' },
      deletedThisCall: 0,
    });
    await expect(
      authorizationStore.claimDeliveryAuthorization({
        ...claimInput,
        ownerDigest: 'e'.repeat(64),
        now: '2026-07-27T02:01:30.000Z',
        expiresAt: '2026-07-27T02:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    await expect(
      authorizationStore.claimDeliveryAuthorization({
        ...claimInput,
        now: '2026-07-27T02:01:31.000Z',
        expiresAt: '2026-07-27T02:04:01.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:02:30.000Z',
      })
    ).resolves.toMatchObject({ request: { stage: 'quiescing' } });
    await expect(
      authorizationStore.releaseDeliveryAuthorization({
        userId: claimInput.userId,
        definitionId: claimInput.definitionId,
        runId: claimInput.runId,
        payloadDigest: claimInput.payloadDigest,
        ownerDigest: claimInput.ownerDigest,
        fence: 1,
        now: '2026-07-27T02:02:31.000Z',
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:02:32.000Z',
      })
    ).resolves.toMatchObject({ request: { stage: 'runs' }, deletedThisCall: 0 });
  });

  it('lets erasure pass an unreleased delivery authorization exactly when its lease expires', async () => {
    seedDeliveryAuthorizationContext(fake);
    const authorizationStore = store as unknown as DeliveryAuthorizationStore;
    await authorizationStore.claimDeliveryAuthorization({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      ownerDigest: 'd'.repeat(64),
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:03:00.000Z',
    });
    const erasureInput = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: 'mde_expired_delivery_fence_001',
      requestIdDigest: '6'.repeat(64),
      now: '2026-07-27T02:01:00.000Z',
      limit: 10,
    };

    await expect(store.startOrResumeDefinitionErasure(erasureInput)).resolves.toMatchObject({
      request: { stage: 'quiescing' },
      deletedThisCall: 0,
    });
    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:02:59.999Z',
      })
    ).resolves.toMatchObject({ request: { stage: 'quiescing' }, deletedThisCall: 0 });
    await expect(
      store.startOrResumeDefinitionErasure({
        ...erasureInput,
        now: '2026-07-27T02:03:00.000Z',
      })
    ).resolves.toMatchObject({ request: { stage: 'runs' }, deletedThisCall: 0 });
  });

  it('denies a delayed published delivery through the real authorization store after erasure starts', async () => {
    seedDeliveryAuthorizationContext(fake, {
      status: 'published',
      publishedAt: '2026-07-27T02:00:00.000Z',
    });
    const identity = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      ownerDigest: 'd'.repeat(64),
    };

    const beforeErasure = await acquireMessageDigestDeliveryAuthorization(identity, {
      store,
      now: () => '2026-07-27T02:00:01.000Z',
    });
    expect(beforeErasure).toMatchObject({ ok: true, disposition: 'authorized', fence: 1 });
    if (!beforeErasure.ok || beforeErasure.disposition !== 'authorized') return;
    await expect(
      releaseMessageDigestDeliveryAuthorization(
        { ...identity, fence: beforeErasure.fence },
        { store, now: () => '2026-07-27T02:00:02.000Z' }
      )
    ).resolves.toEqual({ ok: true, disposition: 'released' });

    await expect(
      store.startOrResumeDefinitionErasure({
        userId: identity.userId,
        definitionId: identity.definitionId,
        erasureRequestId: 'mde_delayed_published_delivery_001',
        requestIdDigest: '5'.repeat(64),
        now: '2026-07-27T02:00:03.000Z',
        limit: 10,
      })
    ).resolves.toMatchObject({ ok: true, request: { stage: 'runs' } });
    await expect(
      acquireMessageDigestDeliveryAuthorization(
        { ...identity, ownerDigest: 'e'.repeat(64) },
        { store, now: () => '2026-07-27T02:00:04.000Z' }
      )
    ).resolves.toEqual({ ok: true, disposition: 'denied' });
  });

  it('retains the exact pending window and active lifecycle after a retryable failed run', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);

    await store.failRun({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest,
      fence: 1,
      failedAt: '2026-07-27T02:04:00.000Z',
      safeFailureCode: 'SOURCE_CHANGED',
      pauseDefinition: false,
    });

    expect(readDocument(fake, MESSAGE_DIGEST_STATES_COLLECTION, 'md_definition_001')).toMatchObject(
      {
        checkpointAt: '2026-07-27T00:00:00.000Z',
        pendingWindow: { runId: 'mdr_run_001', windowEnd: '2026-07-27T02:00:00.000Z' },
      }
    );
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      generationStatus: 'failed',
      processingStage: 'failed',
      safeFailureCode: 'SOURCE_CHANGED',
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({
      status: 'active',
      listStatus: 'active',
      attentionCode: null,
      latestRun: {
        runId: 'mdr_run_001',
        generationStatus: 'failed',
        processingStage: 'failed',
        deliveryStatus: 'not_sent',
      },
    });
  });

  it('atomically pauses an unrecoverable failed run while retaining its exact pending window', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);
    const stateBefore = readDocument(fake, MESSAGE_DIGEST_STATES_COLLECTION, 'md_definition_001');

    await expect(
      store.failRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        failedAt: '2026-07-27T02:04:00.000Z',
        safeFailureCode: 'SOURCE_TOO_LARGE',
        pauseDefinition: true,
      })
    ).resolves.toEqual({ ok: true });

    expect(readDocument(fake, MESSAGE_DIGEST_STATES_COLLECTION, 'md_definition_001')).toEqual(
      stateBefore
    );
    expect(readDocument(fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      generationStatus: 'failed',
      processingStage: 'failed',
      safeFailureCode: 'SOURCE_TOO_LARGE',
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({
      status: 'paused',
      listStatus: 'needs_attention',
      attentionCode: 'SOURCE_TOO_LARGE',
      latestRun: {
        runId: 'mdr_run_001',
        generationStatus: 'failed',
        processingStage: 'failed',
        deliveryStatus: 'not_sent',
      },
    });
  });

  it('atomically releases only an unrecoverable failed pending window on explicit resume', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);
    await store.failRun({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest,
      fence: 1,
      failedAt: '2026-07-27T02:04:00.000Z',
      safeFailureCode: 'SOURCE_TOO_LARGE',
      pauseDefinition: true,
    });
    const before = await store.getOwnedRunContext('synthetic-user-001', 'md_definition_001');
    if (before === null) throw new Error('Expected failed run context');

    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: before.definition.revision,
        updatedAt: '2026-07-27T02:05:00.000Z',
        patch: {
          status: 'active',
          listStatus: 'active',
          attentionCode: null,
          releaseFailedPendingWindow: true,
        },
      })
    ).resolves.toMatchObject({ ok: true, definition: { status: 'active' } });

    await expect(
      store.getOwnedRunContext('synthetic-user-001', 'md_definition_001')
    ).resolves.toMatchObject({
      definition: {
        checkpointAt: before.definition.checkpointAt,
        nextRunAt: before.definition.nextRunAt,
      },
      state: {
        revision: before.state.revision + 1,
        checkpointAt: before.state.checkpointAt,
        continuityMemoryMarkdown: before.state.continuityMemoryMarkdown,
        pendingWindow: null,
      },
    });
  });

  it('continues exactly from the checkpoint after SOURCE_TOO_LARGE, explicit Resume, prepare, and reserve', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);
    await store.failRun({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest,
      fence: 1,
      failedAt: '2026-07-27T02:04:00.000Z',
      safeFailureCode: 'SOURCE_TOO_LARGE',
      pauseDefinition: true,
    });
    const failed = await store.getOwnedRunContext('synthetic-user-001', 'md_definition_001');
    if (failed === null) throw new Error('Expected failed run context');
    const checkpoint = failed.state.checkpointAt;
    const validateSource = vi.fn<MessageDigestWhatsAppClient['validateSource']>(async () => ({
      ok: true,
      value: {
        sourceAccountId: failed.definition.source.sourceAccountId,
        generationId: failed.definition.source.generationId,
        chatId: failed.definition.source.chatId,
        chatType: failed.definition.source.chatType,
        displayName: failed.definition.source.displayName,
        messageCount: 42,
        sourceRevision: failed.definition.source.sourceRevision,
      },
    }));
    const getDeliveryReadiness = vi
      .fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: 'ready',
          observationVersion: 'resume-readiness-v2',
          observedAt: '2026-07-27T02:05:00.000Z',
        },
      })
      .mockResolvedValue({
        ok: true,
        value: {
          status: 'ready',
          observationVersion: 'prepared-readiness-v3',
          observedAt: '2026-07-27T03:00:00.000Z',
        },
      });

    await expect(
      updateMessageDigest(
        {
          userId: 'synthetic-user-001',
          definitionId: 'md_definition_001',
          expectedRevision: failed.definition.revision,
          patch: { status: 'active' },
        },
        {
          store,
          whatsappClient: { validateSource, getDeliveryReadiness },
          now: (): string => '2026-07-27T02:05:00.000Z',
        }
      )
    ).resolves.toMatchObject({ ok: true, definition: { status: 'active' } });

    const resumed = await store.getOwnedRunContext('synthetic-user-001', 'md_definition_001');
    if (resumed === null) throw new Error('Expected resumed run context');
    expect(resumed.state).toMatchObject({ checkpointAt: checkpoint, pendingWindow: null });
    expect(resumed.definition.checkpointAt).toBe(checkpoint);

    const preparationTokens = createRunPreparationTokenCodec({
      currentKey: { version: 'synthetic-v1', secret: 'synthetic-run-preparation-secret' },
      now: (): number => Date.parse('2026-07-27T03:00:00.000Z'),
      ttlMs: 5 * 60 * 1000,
    });
    const prepared = await prepareMessageDigestRun(
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
      {
        store,
        whatsappClient: { getDeliveryReadiness },
        preparationTokens,
        now: (): string => '2026-07-27T03:00:00.000Z',
      }
    );
    expect(prepared).toMatchObject({
      ok: true,
      preparation: { window: { start: checkpoint, end: '2026-07-27T03:00:00.000Z' } },
    });
    if (!prepared.ok) throw new Error(prepared.code);

    const reserved = await reserveMessageDigestRun(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        requestId: 'synthetic-resume-request-001',
        preparationToken: prepared.preparation.token,
      },
      {
        store,
        whatsappClient: { getDeliveryReadiness },
        preparationTokens,
        now: (): string => '2026-07-27T03:00:01.000Z',
      }
    );

    expect(reserved).toMatchObject({
      ok: true,
      disposition: 'reserved',
      run: { windowStart: checkpoint, windowEnd: '2026-07-27T03:00:00.000Z' },
    });
    expect(reserved).not.toMatchObject({ ok: false, code: 'RUN_IN_PROGRESS' });
    const afterReservation = await store.getOwnedRunContext(
      'synthetic-user-001',
      'md_definition_001'
    );
    expect(afterReservation).toMatchObject({
      state: {
        checkpointAt: checkpoint,
        pendingWindow: { windowStart: checkpoint, windowEnd: '2026-07-27T03:00:00.000Z' },
      },
    });
  });

  it('retries a failed generation in place and idempotently preserves its frozen reservation', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = 'e'.repeat(64);
    await claim(store, ownerDigest);
    await store.failRun({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest,
      fence: 1,
      failedAt: '2026-07-27T02:04:00.000Z',
      safeFailureCode: 'LLM_UNAVAILABLE',
      pauseDefinition: false,
    });
    const outbox = retryOutbox('mdo_generation_retry_001', 'run_request');

    await expect(
      store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox,
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'retried',
      run: {
        runId: 'mdr_run_001',
        generationStatus: 'queued',
        processingStage: 'queued',
        safeFailureCode: null,
        windowStart: '2026-07-27T00:00:00.000Z',
        windowEnd: '2026-07-27T02:00:00.000Z',
      },
    });
    await expect(
      store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox,
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'existing' });
    await expect(
      store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:01.000Z',
        outbox: retryOutbox('mdo_generation_retry_002', 'run_request'),
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_IN_PROGRESS' });
    await expect(
      store.getOwnedRunContext('synthetic-user-001', 'md_definition_001')
    ).resolves.toMatchObject({
      definition: {
        checkpointAt: '2026-07-27T00:00:00.000Z',
        latestRun: { runId: 'mdr_run_001', generationStatus: 'queued' },
      },
      state: {
        checkpointAt: '2026-07-27T00:00:00.000Z',
        pendingWindow: { runId: 'mdr_run_001', windowEnd: '2026-07-27T02:00:00.000Z' },
      },
    });
  });

  it('retries definitive delivery from byte-identical persisted content and refuses another winner', async () => {
    const record = makeDefinition({ hasRuns: true });
    seedDefinitions(fake, [record]);
    const pendingRun = completedRunForReconciliation('mdr_delivery_retry_001', 'pending');
    const failedRun = MessageDigestRunDocumentSchema.parse({
      ...pendingRun,
      delivery: {
        ...pendingRun.delivery,
        status: 'failed',
        failureCode: 'MAPPING_MISSING',
        failedAt: '2026-07-27T02:04:00.000Z',
        nextCheckAt: null,
      },
      updatedAt: '2026-07-27T02:04:00.000Z',
    });
    seedRuns(fake, [failedRun]);
    const original = retryOutbox('mdo_delivery_original_001', 'whatsapp_delivery', {
      runId: failedRun.runId,
      status: 'published',
      publishedAt: '2026-07-27T02:03:00.000Z',
    });
    fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: original.outboxId, data: original },
    ]);
    const retry = retryOutbox('mdo_delivery_retry_001', 'whatsapp_delivery', {
      runId: failedRun.runId,
      payloadJson: original.payloadJson,
      payloadDigest: original.payloadDigest,
    });

    await expect(
      store.getOwnedDispatch({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedRun.runId,
        outboxId: original.outboxId,
      })
    ).resolves.toEqual(original);
    await expect(
      store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedRun.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: retry,
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'retried',
      run: {
        generationStatus: 'completed',
        delivery: { status: 'pending', failureCode: null, failedAt: null },
      },
    });
    expect(
      readDocument(fake, MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, retry.outboxId)
    ).toMatchObject({
      payloadJson: original.payloadJson,
      payloadDigest: original.payloadDigest,
      status: 'pending',
    });
    await expect(
      store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedRun.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: retry,
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'existing' });
    await expect(
      store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedRun.runId,
        retriedAt: '2026-07-27T02:05:01.000Z',
        originalOutboxId: original.outboxId,
        outbox: retryOutbox('mdo_delivery_retry_002', 'whatsapp_delivery', {
          runId: failedRun.runId,
          payloadJson: original.payloadJson,
          payloadDigest: original.payloadDigest,
        }),
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_IN_PROGRESS' });
  });

  it('claims and records one dispatch with an exact owner/fence', async () => {
    await createDefinition(store);
    await reserveRun(store);
    const ownerDigest = '9'.repeat(64);
    const claimed = await store.claimDispatch({
      outboxId: 'mdo_run_request_001',
      ownerDigest,
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:05:00.000Z',
    });
    expect(claimed).toMatchObject({ ok: true, disposition: 'claimed', fence: 1 });
    await expect(
      store.recordDispatchResult({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 2,
        now: '2026-07-27T02:01:00.000Z',
        outcome: { status: 'published', publishedAt: '2026-07-27T02:01:00.000Z' },
      })
    ).resolves.toEqual({ ok: false, code: 'CLAIM_LOST' });
    await expect(
      store.recordDispatchResult({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:01:00.000Z',
        outcome: { status: 'published', publishedAt: '2026-07-27T02:01:00.000Z' },
      })
    ).resolves.toEqual({ ok: true });
  });

  it('returns only owner-visible canonical run history with a fingerprint-bound cursor', async () => {
    seedRuns(fake, [
      makeRun(),
      completedRunForReconciliation('mdr_completed_sent_001', 'sent'),
      makeRun({ runId: 'mdr_audit_001', recordRole: 'audit' }),
      stagedLegacyRun('mdr_staged_001', '2026-07-27T02:00:00.000Z', 'mdm_staged_001'),
      makeRun({ runId: 'mdr_foreign_001', userId: 'synthetic-user-foreign' }),
    ]);

    await expect(
      store.getOwnedRun({
        userId: 'synthetic-user-foreign',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
      })
    ).resolves.toBeNull();
    const listed = await store.listOwnedRuns({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      limit: 10,
      queryFingerprint: 'runs-default-v1',
    });
    expect(listed.items.map((item) => item.runId)).toEqual([
      'mdr_run_001',
      'mdr_completed_sent_001',
    ]);
    await expect(
      store.listOwnedRuns({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        limit: 10,
        windowStartFrom: '2026-07-27T00:00:00.000Z',
        windowStartBefore: '2026-07-27T00:30:00.000Z',
        generationStatus: 'completed',
        deliveryStatus: 'sent',
        direction: 'asc',
        queryFingerprint: 'runs-filtered-v1',
      })
    ).resolves.toMatchObject({ items: [{ runId: 'mdr_completed_sent_001' }] });
  });

  it('finds only one activated owned group definition by its exact legacy alias', async () => {
    seedDefinitions(fake, [
      makeDefinition({
        definitionId: 'md_alias_active_001',
        activeMigrationId: 'mdm_migration_001',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_migrating_001',
        status: 'migrating',
        listStatus: 'paused',
        activeMigrationId: null,
        legacyAlias: { groupKey: 'synthetic-hidden-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_direct_001',
        activeMigrationId: 'mdm_direct_001',
        legacyAlias: { groupKey: 'synthetic-direct-group' },
        source: { ...makeDefinition().source, chatType: 'direct' },
      }),
      makeDefinition({
        definitionId: 'md_alias_unactivated_001',
        activeMigrationId: null,
        legacyAlias: { groupKey: 'synthetic-unactivated-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_foreign_001',
        userId: 'synthetic-user-foreign',
        activeMigrationId: 'mdm_foreign_001',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({ definitionId: 'md_generic_group_001' }),
    ]);

    await expect(
      store.getOwnedDefinitionByLegacyAlias({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
      })
    ).resolves.toMatchObject({ definitionId: 'md_alias_active_001' });
    for (const legacyGroupKey of [
      'synthetic-hidden-group',
      'synthetic-direct-group',
      'synthetic-unactivated-group',
      'missing-group',
    ]) {
      await expect(
        store.getOwnedDefinitionByLegacyAlias({
          userId: 'synthetic-user-001',
          legacyGroupKey,
        })
      ).resolves.toBeNull();
    }
  });

  it('fails closed when two activated definitions claim the same owned legacy alias', async () => {
    seedDefinitions(fake, [
      makeDefinition({
        definitionId: 'md_alias_duplicate_001',
        activeMigrationId: 'mdm_duplicate_001',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_duplicate_002',
        activeMigrationId: 'mdm_duplicate_002',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
    ]);

    await expect(
      store.getOwnedDefinitionByLegacyAlias({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
      })
    ).rejects.toThrow('AMBIGUOUS_LEGACY_ALIAS');
  });

  it('detects duplicate activated aliases after more than three filtered distractors', async () => {
    seedDefinitions(fake, [
      makeDefinition({
        definitionId: 'md_alias_unactivated_101',
        activeMigrationId: null,
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_direct_101',
        activeMigrationId: 'mdm_direct_101',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
        source: { ...makeDefinition().source, chatType: 'direct' },
      }),
      makeDefinition({
        definitionId: 'md_alias_unactivated_102',
        activeMigrationId: null,
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_unactivated_103',
        activeMigrationId: null,
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_active_101',
        activeMigrationId: 'mdm_active_101',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
      makeDefinition({
        definitionId: 'md_alias_active_102',
        activeMigrationId: 'mdm_active_102',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
    ]);

    await expect(
      store.getOwnedDefinitionByLegacyAlias({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
      })
    ).rejects.toThrow('AMBIGUOUS_LEGACY_ALIAS');
  });

  it('lists only visible completed scheduled legacy runs with bounded signed pagination', async () => {
    seedDefinitions(fake, [
      makeDefinition({
        activeMigrationId: 'mdm_migration_001',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
    ]);
    seedRuns(fake, [
      legacyCompletedRun('mdr_legacy_001', '2026-07-25T07:00:00.000Z'),
      legacyCompletedRun('mdr_legacy_002', '2026-07-26T07:00:00.000Z'),
      legacyCompletedRun('mdr_legacy_003', '2026-07-27T07:00:00.000Z'),
      stagedLegacyRun('mdr_legacy_staged_001', '2026-07-27T07:00:00.000Z', 'mdm_migration_001'),
      legacyCompletedRun('mdr_legacy_audit_001', '2026-07-27T07:00:00.000Z', {
        recordRole: 'audit',
      }),
      legacyCompletedRun('mdr_legacy_manual_001', '2026-07-27T07:00:00.000Z', {
        trigger: 'manual',
      }),
      makeRun({ runId: 'mdr_legacy_queued_001', trigger: 'scheduled' }),
      legacyCompletedRun('mdr_legacy_foreign_001', '2026-07-27T07:00:00.000Z', {
        userId: 'synthetic-user-foreign',
      }),
    ]);

    const first = await store.listOwnedLegacyRuns({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      activeMigrationId: 'mdm_migration_001',
      legacyGroupKey: 'synthetic-fishing-group',
      scheduledBoundaryFrom: '2026-07-25T00:00:00.000Z',
      scheduledBoundaryBefore: '2026-07-28T00:00:00.000Z',
      limit: 2,
      queryFingerprint: 'legacy-runs-v1',
    });
    expect(first.items.map((item) => item.runId)).toEqual(['mdr_legacy_003', 'mdr_legacy_002']);
    expect(first.nextCursor).toMatch(/^mdc1\./u);

    const second = await store.listOwnedLegacyRuns({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      activeMigrationId: 'mdm_migration_001',
      legacyGroupKey: 'synthetic-fishing-group',
      scheduledBoundaryFrom: '2026-07-25T00:00:00.000Z',
      scheduledBoundaryBefore: '2026-07-28T00:00:00.000Z',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
      queryFingerprint: 'legacy-runs-v1',
    });
    expect(second).toMatchObject({ items: [{ runId: 'mdr_legacy_001' }], nextCursor: null });
    await expect(
      store.listOwnedLegacyRuns({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        activeMigrationId: 'mdm_migration_001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 2,
        cursor: first.nextCursor ?? undefined,
        queryFingerprint: 'different-query',
      })
    ).rejects.toThrow('INVALID_CURSOR');
  });

  it('paginates equal run windows by immutable run ID and rejects cursor reuse', async () => {
    seedRuns(fake, [
      makeRun({ runId: 'mdr_equal_001' }),
      makeRun({ runId: 'mdr_equal_003' }),
      makeRun({ runId: 'mdr_equal_002' }),
    ]);

    const first = await store.listOwnedRuns({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      limit: 2,
      direction: 'desc',
      queryFingerprint: 'runs-equal-window-v1',
    });
    expect(first.items.map((item) => item.runId)).toEqual(['mdr_equal_003', 'mdr_equal_002']);
    expect(first.nextCursor).toMatch(/^mdc1\./u);

    const second = await store.listOwnedRuns({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
      direction: 'desc',
      queryFingerprint: 'runs-equal-window-v1',
    });
    expect(second.items.map((item) => item.runId)).toEqual(['mdr_equal_001']);
    expect(second.nextCursor).toBeNull();

    await expect(
      store.listOwnedRuns({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        limit: 2,
        cursor: first.nextCursor ?? undefined,
        direction: 'asc',
        queryFingerprint: 'runs-equal-window-reversed-v1',
      })
    ).rejects.toThrow('INVALID_CURSOR');
  });

  it('erases in bounded batches, leaves a content-free tombstone, and never creates activation records', async () => {
    await createDefinition(store);
    seedRuns(fake, [
      makeRun({ runId: 'mdr_erase_001' }),
      makeRun({ runId: 'mdr_erase_002' }),
      makeRun({ runId: 'mdr_erase_003' }),
    ]);
    fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      {
        id: 'mdo_erase_001',
        data: makeOutbox({ outboxId: 'mdo_erase_001', runId: 'mdr_erase_001' }),
      },
      {
        id: 'mdo_erase_002',
        data: makeOutbox({ outboxId: 'mdo_erase_002', runId: 'mdr_erase_002' }),
      },
    ]);

    let result = await store.startOrResumeDefinitionErasure({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: 'mde_request_001',
      requestIdDigest: '7'.repeat(64),
      now: '2026-07-27T03:00:00.000Z',
      limit: 1,
    });
    expect(result).toMatchObject({
      ok: true,
      status: 'in_progress',
      deletedThisCall: 0,
      request: { stage: 'runs' },
    });

    for (
      let attempt = 0;
      attempt < 12 && result.ok && result.status !== 'completed';
      attempt += 1
    ) {
      result = await store.startOrResumeDefinitionErasure({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        erasureRequestId: 'mde_request_001',
        requestIdDigest: '7'.repeat(64),
        now: new Date(Date.parse('2026-07-27T03:00:00.000Z') + (attempt + 1) * 1000).toISOString(),
        limit: 1,
      });
      if (result.ok) expect(result.deletedThisCall).toBeLessThanOrEqual(1);
    }

    expect(result).toMatchObject({ ok: true, status: 'completed' });
    expect(fake.getAllData().get(MESSAGE_DIGEST_RUNS_COLLECTION)?.size ?? 0).toBe(0);
    expect(fake.getAllData().get(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)?.size ?? 0).toBe(0);
    expect(fake.getAllData().get(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)?.size ?? 0).toBe(0);
    expect(fake.getAllData().get(MESSAGE_DIGEST_STATES_COLLECTION)?.size ?? 0).toBe(0);
    const tombstone = readDocument(
      fake,
      MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION,
      'mde_request_001'
    );
    expect(tombstone).toMatchObject({ stage: 'completed', cursor: null });
    expect(JSON.stringify(tombstone)).not.toContain('Synthetic daily digest');
    expect(fake.getAllData().get(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION)).toBeUndefined();
    await expect(
      store.getOwnedErasureRequest('synthetic-user-foreign', 'mde_request_001')
    ).resolves.toBeNull();
    await expect(
      store.getOwnedErasureRequest('synthetic-user-001', 'mde_request_001')
    ).resolves.toMatchObject({ stage: 'completed', userId: 'synthetic-user-001' });
  });

  it('erases only the migrated alias archive and activation while preserving WhatsApp source data', async () => {
    await createDefinition(
      store,
      makeDefinition({
        activeMigrationId: 'mdm_fishing_001',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      })
    );
    fake.seedCollection(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION, [
      {
        id: 'mdm_fishing_001',
        data: MessageDigestMigrationActivationDocumentSchema.parse({
          version: 1,
          migrationId: 'mdm_fishing_001',
          userId: 'synthetic-user-001',
          definitionId: 'md_definition_001',
          legacyGroupKey: 'synthetic-fishing-group',
          status: 'active',
          leaseOwnerDigest: null,
          leaseExpiresAt: null,
          step: 'activated',
          cutoverDeadline: '2026-07-28T00:00:00.000Z',
          baselineHash: 'b'.repeat(64),
          replayHash: 'c'.repeat(64),
          verificationHash: 'd'.repeat(64),
          safeCounts: { canonicalRuns: 143 },
          createdAt: '2026-07-27T01:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
        }),
      },
      {
        id: 'mdm_foreign_001',
        data: MessageDigestMigrationActivationDocumentSchema.parse({
          version: 1,
          migrationId: 'mdm_foreign_001',
          userId: 'synthetic-user-foreign',
          definitionId: 'md_foreign_001',
          status: 'preparing',
          leaseOwnerDigest: null,
          leaseExpiresAt: null,
          step: 'created',
          cutoverDeadline: '2026-07-28T00:00:00.000Z',
          baselineHash: null,
          replayHash: null,
          safeCounts: {},
          createdAt: '2026-07-27T01:00:00.000Z',
          updatedAt: '2026-07-27T01:00:00.000Z',
        }),
      },
    ]);
    for (const collection of Object.values(LEGACY_DIGEST_ARCHIVE_COLLECTIONS)) {
      fake.seedCollection(collection, [
        {
          id: `${collection}-owned`,
          data: {
            userId: 'synthetic-user-001',
            groupKey: 'synthetic-fishing-group',
            privatePayload: `${collection}-private`,
          },
        },
        {
          id: `${collection}-other-alias`,
          data: {
            userId: 'synthetic-user-001',
            groupKey: 'synthetic-other-group',
            privatePayload: 'must-remain',
          },
        },
        {
          id: `${collection}-foreign`,
          data: {
            userId: 'synthetic-user-foreign',
            groupKey: 'synthetic-fishing-group',
            privatePayload: 'must-remain',
          },
        },
      ]);
    }
    fake.seedCollection('whatsapp_messages', [
      {
        id: 'source-message-owned',
        data: {
          userId: 'synthetic-user-001',
          chatId: 'synthetic-chat-001',
          text: 'WhatsApp source must remain',
        },
      },
    ]);

    let result = await store.startOrResumeDefinitionErasure({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: 'mde_migrated_001',
      requestIdDigest: '8'.repeat(64),
      now: '2026-07-28T03:00:00.000Z',
      limit: 1,
    });
    for (
      let attempt = 0;
      attempt < 20 && result.ok && result.status !== 'completed';
      attempt += 1
    ) {
      result = await store.startOrResumeDefinitionErasure({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        erasureRequestId: 'mde_migrated_001',
        requestIdDigest: '8'.repeat(64),
        now: new Date(Date.parse('2026-07-28T03:00:00.000Z') + (attempt + 1) * 1000).toISOString(),
        limit: 1,
      });
      if (result.ok) expect(result.deletedThisCall).toBeLessThanOrEqual(1);
    }

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      request: { stage: 'completed', deletedCounts: { legacy: 4 } },
    });
    expect(
      fake.getAllData().get(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION)?.has('mdm_fishing_001')
    ).toBe(false);
    expect(
      fake.getAllData().get(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION)?.has('mdm_foreign_001')
    ).toBe(true);
    for (const collection of Object.values(LEGACY_DIGEST_ARCHIVE_COLLECTIONS)) {
      expect(fake.getAllData().get(collection)?.has(`${collection}-owned`)).toBe(false);
      expect(fake.getAllData().get(collection)?.has(`${collection}-other-alias`)).toBe(true);
      expect(fake.getAllData().get(collection)?.has(`${collection}-foreign`)).toBe(true);
    }
    expect(fake.getAllData().get('whatsapp_messages')?.get('source-message-owned')).toEqual({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-001',
      text: 'WhatsApp source must remain',
    });
  });

  it('rejects incoherent create pairs and validates bounded query inputs and cursors', async () => {
    const definition = makeDefinition();
    await expect(
      store.createDefinition({
        definition,
        state: makeState({ definitionId: 'md_different_001' }),
      })
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });
    await expect(
      store.createDefinition({
        definition,
        state: makeState({ userId: 'synthetic-user-foreign' }),
      })
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });
    await expect(
      store.createDefinition({
        definition,
        state: makeState({ checkpointAt: '2026-07-27T00:01:00.000Z' }),
      })
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });

    fake.seedCollection(MESSAGE_DIGEST_STATES_COLLECTION, [
      { id: definition.definitionId, data: makeState() },
    ]);
    await expect(store.createDefinition({ definition, state: makeState() })).resolves.toEqual({
      ok: false,
      code: 'CREATE_CONFLICT',
    });
    await expect(
      store.getOwnedDefinition('synthetic-user-001', 'md_missing_001')
    ).resolves.toBeNull();

    await expect(
      store.listOwnedDefinitions({
        userId: 'synthetic-user-001',
        query: 'fishing',
        sort: 'updatedAt',
        limit: 10,
        queryFingerprint: 'invalid-query-sort',
      })
    ).rejects.toThrow('INVALID_QUERY');
    await expect(
      store.listOwnedDefinitions({
        userId: 'synthetic-user-001',
        limit: 0,
        queryFingerprint: 'invalid-limit',
      })
    ).rejects.toThrow('INVALID_LIMIT');
    await expect(store.listDueDefinitions({ now: 'not-a-timestamp', limit: 1 })).rejects.toThrow(
      'INVALID_TIMESTAMP'
    );
    await expect(
      store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_missing_001',
        ownerDigest: 'e'.repeat(64),
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:00:00.000Z',
      })
    ).rejects.toThrow('INVALID_LEASE');

    await expect(
      store.listDueDefinitions({
        now: '2026-07-27T12:00:00.000Z',
        limit: 1,
        cursor: 'invalid-cursor',
      })
    ).rejects.toThrow('INVALID_CURSOR');
    await expect(
      store.listReadyDispatches({
        now: '2026-07-27T12:00:00.000Z',
        limit: 1,
        cursor: 'invalid-cursor',
      })
    ).rejects.toThrow('INVALID_CURSOR');
    await expect(
      store.listPendingDeliveryRuns({
        now: '2026-07-27T12:00:00.000Z',
        limit: 1,
        cursor: 'invalid-cursor',
      })
    ).rejects.toThrow('INVALID_CURSOR');
    await expect(
      store.listOwnedRuns({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        limit: 1,
        cursor: 'invalid-cursor',
        queryFingerprint: 'runs-invalid-cursor',
      })
    ).rejects.toThrow('INVALID_CURSOR');
  });

  it('covers owner isolation and every supported definition update shape', async () => {
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_missing_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { name: 'Missing', nameSortKey: 'missing' },
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    seedDefinitions(fake, [makeDefinition({ definitionId: 'md_missing_state_001' })]);
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_missing_state_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: {},
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    await createDefinition(
      store,
      makeDefinition({ definitionId: 'md_foreign_update_001', userId: 'synthetic-user-foreign' })
    );
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_foreign_update_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: {},
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    await createDefinition(
      store,
      makeDefinition({
        definitionId: 'md_deleting_update_001',
        status: 'deleting',
        listStatus: 'paused',
        activeErasureRequestId: 'mde_deleting_update_001',
      })
    );
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_deleting_update_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: {},
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    await createDefinition(store);
    const replacement = {
      ...makeDefinition().source,
      chatId: 'synthetic-chat-replacement',
      sourceRevision: 'synthetic-source-replacement',
    };
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { source: replacement },
      })
    ).resolves.toEqual({ ok: false, code: 'SOURCE_LOCKED' });
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { source: replacement, resetCheckpointAt: '2026-07-27T01:00:00.000Z' },
      })
    ).resolves.toEqual({ ok: false, code: 'SOURCE_LOCKED' });

    const paused = await store.updateDefinition({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 1,
      updatedAt: '2026-07-27T02:01:00.000Z',
      patch: {
        status: 'paused',
        instructions: {
          templateId: 'custom',
          text: 'Summarize only the bounded synthetic facts.',
          revision: '2.0.0',
        },
        schedule: { kind: 'daily', localTime: '04:00', timeZone: 'Europe/Warsaw' },
        delivery: {
          type: 'whatsapp_primary',
          readinessObservationVersion: 'synthetic-readiness-v3',
          readinessObservedAt: '2026-07-27T02:00:00.000Z',
        },
      },
    });
    expect(paused).toMatchObject({
      ok: true,
      definition: {
        status: 'paused',
        listStatus: 'paused',
        attentionCode: null,
        instructions: { templateId: 'custom' },
      },
    });
    await expect(
      store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 2,
        updatedAt: '2026-07-27T02:02:00.000Z',
        patch: { status: 'active' },
      })
    ).resolves.toMatchObject({
      ok: true,
      definition: { status: 'active', listStatus: 'active', attentionCode: null },
    });
  });

  it('rejects incoherent and stale run reservations at every transaction fence', async () => {
    const mismatchedInputs = [
      reservationInput({
        run: makeRun({ userId: 'synthetic-user-foreign' }),
      }),
      reservationInput({
        run: makeRun({ definitionId: 'md_definition_other' }),
      }),
      reservationInput({
        outbox: makeOutbox({ userId: 'synthetic-user-foreign' }),
      }),
      reservationInput({
        outbox: makeOutbox({ definitionId: 'md_definition_other' }),
      }),
      reservationInput({
        outbox: makeOutbox({ runId: 'mdr_run_other' }),
      }),
      reservationInput({
        run: makeRun({ definitionRevision: 2 }),
      }),
    ];
    for (const input of mismatchedInputs) {
      const harness = createStoreHarness();
      await expect(harness.store.reserveRun(input)).resolves.toEqual({
        ok: false,
        code: 'RUN_CONFLICT',
      });
    }

    const missing = createStoreHarness();
    await expect(missing.store.reserveRun(reservationInput())).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const missingState = createStoreHarness();
    seedDefinitions(missingState.fake, [makeDefinition()]);
    await expect(missingState.store.reserveRun(reservationInput())).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const occupiedOutbox = createStoreHarness();
    await createDefinition(occupiedOutbox.store);
    occupiedOutbox.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: 'mdo_run_request_001', data: makeOutbox() },
    ]);
    await expect(occupiedOutbox.store.reserveRun(reservationInput())).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const foreign = createStoreHarness();
    await createDefinition(foreign.store, makeDefinition({ userId: 'synthetic-user-foreign' }));
    await expect(foreign.store.reserveRun(reservationInput())).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const paused = createStoreHarness();
    await createDefinition(
      paused.store,
      makeDefinition({ status: 'paused', listStatus: 'paused' })
    );
    await expect(paused.store.reserveRun(reservationInput())).resolves.toEqual({
      ok: false,
      code: 'NOT_ACTIVE',
    });

    for (const input of [
      reservationInput({
        definitionRevision: 2,
        run: makeRun({ definitionRevision: 2 }),
      }),
      reservationInput({ stateRevision: 2 }),
      { ...reservationInput(), expectedErasureEpoch: 1 },
    ]) {
      const stale = createStoreHarness();
      await createDefinition(stale.store);
      await expect(stale.store.reserveRun(input)).resolves.toEqual({
        ok: false,
        code: 'REVISION_CONFLICT',
      });
    }

    const readiness = createStoreHarness();
    await createDefinition(readiness.store);
    await expect(
      readiness.store.reserveRun({
        ...reservationInput(),
        expectedReadinessObservationVersion: 'stale-readiness',
      })
    ).resolves.toEqual({ ok: false, code: 'READINESS_CHANGED' });

    const invalidWindows = [
      reservationInput({ windowStart: '2026-07-26T23:00:00.000Z' }),
      reservationInput({
        run: makeRun({ instructionRevision: 'stale-instructions' }),
      }),
    ];
    for (const input of invalidWindows) {
      const invalidWindow = createStoreHarness();
      await createDefinition(invalidWindow.store);
      await expect(invalidWindow.store.reserveRun(input)).resolves.toEqual({
        ok: false,
        code: 'RUN_CONFLICT',
      });
    }

    const incompleteReplay = createStoreHarness();
    await createDefinition(incompleteReplay.store);
    seedRuns(incompleteReplay.fake, [makeRun()]);
    await expect(incompleteReplay.store.reserveRun(reservationInput())).resolves.toEqual({
      ok: false,
      code: 'RUN_CONFLICT',
    });
  });

  it('returns explicit worker outcomes for missing, foreign, terminal, replayed, and expired leases', async () => {
    const ownerDigest = 'e'.repeat(64);
    const missing = createStoreHarness();
    await expect(
      missing.store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_missing_001',
        ownerDigest,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      missing.store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_missing_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      missing.store.markRunProcessingStage({
        userId: 'synthetic-user-001',
        runId: 'mdr_missing_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        processingStage: 'repairing',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      missing.store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_missing_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:00:00.000Z',
        generationStatus: 'skipped_no_activity',
        output: completedOutput(),
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      missing.store.failRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_missing_001',
        ownerDigest,
        fence: 1,
        failedAt: '2026-07-27T02:00:00.000Z',
        safeFailureCode: 'SOURCE_UNAVAILABLE',
        pauseDefinition: true,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const foreign = createStoreHarness();
    seedRuns(foreign.fake, [makeRun()]);
    await expect(
      foreign.store.claimRunLease({
        userId: 'synthetic-user-foreign',
        runId: 'mdr_run_001',
        ownerDigest,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      foreign.store.renewRunLease({
        userId: 'synthetic-user-foreign',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      foreign.store.markRunProcessingStage({
        userId: 'synthetic-user-foreign',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        processingStage: 'aggregating',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      foreign.store.completeRun({
        userId: 'synthetic-user-foreign',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:00:00.000Z',
        generationStatus: 'skipped_no_activity',
        output: completedOutput(),
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      foreign.store.failRun({
        userId: 'synthetic-user-foreign',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        failedAt: '2026-07-27T02:00:00.000Z',
        safeFailureCode: 'SOURCE_UNAVAILABLE',
        pauseDefinition: true,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const terminal = createStoreHarness();
    seedRuns(terminal.fake, [completedRunForReconciliation('mdr_run_001', 'sent')]);
    await expect(
      terminal.store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_TERMINAL' });
    await expect(
      terminal.store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_TERMINAL' });
    await expect(
      terminal.store.markRunProcessingStage({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        processingStage: 'repairing',
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_TERMINAL' });
    await expect(
      terminal.store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:00:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
        deliveryOutbox: makeDeliveryOutbox(),
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'existing' });

    const leased = createStoreHarness();
    await createDefinition(leased.store);
    await reserveRun(leased.store);
    await claim(leased.store, ownerDigest);
    await expect(
      leased.store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        now: '2026-07-27T02:01:00.000Z',
        expiresAt: '2026-07-27T02:06:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'existing', fence: 1 });
    await expect(
      leased.store.markRunProcessingStage({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:06:00.000Z',
        processingStage: 'repairing',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
    await expect(
      leased.store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 2,
        completedAt: '2026-07-27T02:02:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
        deliveryOutbox: makeDeliveryOutbox(),
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
    await expect(
      leased.store.failRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 2,
        failedAt: '2026-07-27T02:02:00.000Z',
        safeFailureCode: 'SOURCE_UNAVAILABLE',
        pauseDefinition: true,
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
    await expect(
      leased.store.failRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        failedAt: '2026-07-27T02:06:00.000Z',
        safeFailureCode: 'SOURCE_UNAVAILABLE',
        pauseDefinition: true,
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });
    expect(readDocument(leased.fake, MESSAGE_DIGEST_RUNS_COLLECTION, 'mdr_run_001')).toMatchObject({
      generationStatus: 'processing',
      safeFailureCode: null,
    });
    expect(
      readDocument(leased.fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({ status: 'active', listStatus: 'active', attentionCode: null });

    const skipped = createStoreHarness();
    await createDefinition(skipped.store);
    await reserveRun(skipped.store);
    await claim(skipped.store, ownerDigest);
    await expect(
      skipped.store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:04:00.000Z',
        generationStatus: 'skipped_no_activity',
        output: {
          headline: null,
          summaryMarkdown: null,
          evidenceMessageRefs: [],
          continuityMemoryMarkdown: null,
          effectiveMessageCount: 0,
          promptVersion: '1.0.0',
          model: 'or:synthetic/model',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'completed',
      run: { generationStatus: 'skipped_no_activity', delivery: { status: 'not_sent' } },
    });
  });

  it('handles dispatch absence, readiness, contention, retry, and terminal outcomes', async () => {
    const ownerDigest = '9'.repeat(64);
    const claimInput = {
      outboxId: 'mdo_run_request_001',
      ownerDigest,
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:05:00.000Z',
    };

    const missing = createStoreHarness();
    await expect(missing.store.claimDispatch(claimInput)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(
      missing.store.recordDispatchResult({
        outboxId: 'mdo_missing_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:01:00.000Z',
        outcome: { status: 'terminal', terminalCode: 'MISSING_PAYLOAD' },
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const terminal = createStoreHarness();
    terminal.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      {
        id: 'mdo_run_request_001',
        data: makeOutbox({
          status: 'terminal',
          terminalCode: 'PERMANENT_FAILURE',
        }),
      },
    ]);
    await expect(terminal.store.claimDispatch(claimInput)).resolves.toEqual({
      ok: false,
      code: 'TERMINAL',
    });

    const orphan = createStoreHarness();
    orphan.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: 'mdo_run_request_001', data: makeOutbox() },
    ]);
    await expect(orphan.store.claimDispatch(claimInput)).resolves.toEqual({
      ok: false,
      code: 'RESERVATION_LOST',
    });

    const future = createStoreHarness();
    await createDefinition(future.store);
    future.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      {
        id: 'mdo_run_request_001',
        data: makeOutbox({ nextAttemptAt: '2026-07-27T03:00:00.000Z' }),
      },
    ]);
    await expect(future.store.claimDispatch(claimInput)).resolves.toEqual({
      ok: false,
      code: 'NOT_READY',
    });

    const contended = createStoreHarness();
    await createDefinition(contended.store);
    contended.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: 'mdo_run_request_001', data: makeOutbox() },
    ]);
    await expect(contended.store.claimDispatch(claimInput)).resolves.toMatchObject({
      ok: true,
      disposition: 'claimed',
      fence: 1,
    });
    await expect(
      contended.store.claimDispatch({
        ...claimInput,
        now: '2026-07-27T02:01:00.000Z',
        expiresAt: '2026-07-27T02:06:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'existing', fence: 1 });
    await expect(
      contended.store.claimDispatch({
        ...claimInput,
        ownerDigest: '8'.repeat(64),
        now: '2026-07-27T02:01:00.000Z',
        expiresAt: '2026-07-27T02:06:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'CLAIM_BUSY' });
    await expect(
      contended.store.recordDispatchResult({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:02:00.000Z',
        outcome: { status: 'retry', nextAttemptAt: '2026-07-27T02:10:00.000Z' },
      })
    ).resolves.toEqual({ ok: true });
    expect(
      readDocument(contended.fake, MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, 'mdo_run_request_001')
    ).toMatchObject({ status: 'pending', nextAttemptAt: '2026-07-27T02:10:00.000Z', claim: null });

    const permanent = createStoreHarness();
    await createDefinition(permanent.store);
    permanent.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: 'mdo_run_request_001', data: makeOutbox() },
    ]);
    await permanent.store.claimDispatch(claimInput);
    await expect(
      permanent.store.recordDispatchResult({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:02:00.000Z',
        outcome: { status: 'terminal', terminalCode: 'PAYLOAD_INVALID' },
      })
    ).resolves.toEqual({ ok: true });
    expect(
      readDocument(permanent.fake, MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, 'mdo_run_request_001')
    ).toMatchObject({ status: 'terminal', terminalCode: 'PAYLOAD_INVALID', claim: null });
  });

  it('rotates fresh pending delivery observations so later due rows are reachable', async () => {
    const rotating = createStoreHarness();
    seedDefinitions(rotating.fake, [makeDefinition()]);
    seedRuns(rotating.fake, [
      completedRunForReconciliation('mdr_pending_001', 'pending'),
      completedRunForReconciliation('mdr_pending_002', 'pending'),
    ]);

    const first = await rotating.store.listPendingDeliveryRuns({
      now: '2026-07-27T02:05:00.000Z',
      limit: 1,
    });
    expect(first.items.map((run) => run.runId)).toEqual(['mdr_pending_001']);

    const observation = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_pending_001',
      expectedErasureEpoch: 0,
      expectedReconciliationAttempts: 0,
      observedAt: '2026-07-27T02:05:00.000Z',
      nextCheckAt: '2026-07-27T02:06:00.000Z',
      observation: 'missing' as const,
    };
    await expect(
      rotating.store.recordRunDeliveryObservation({
        ...observation,
        nextCheckAt: observation.observedAt,
      })
    ).rejects.toThrow('INVALID_NEXT_CHECK');
    await expect(rotating.store.recordRunDeliveryObservation(observation)).resolves.toMatchObject({
      ok: true,
      disposition: 'updated',
      run: {
        delivery: {
          status: 'pending',
          reconciliationAttempts: 1,
          nextCheckAt: '2026-07-27T02:06:00.000Z',
          missingSince: '2026-07-27T02:05:00.000Z',
        },
      },
    });
    await expect(
      rotating.store.recordRunDeliveryObservation({
        ...observation,
        expectedReconciliationAttempts: 1,
        observedAt: '2026-07-27T02:06:00.000Z',
        nextCheckAt: '2026-07-27T02:08:00.000Z',
        observation: 'pending',
      })
    ).resolves.toMatchObject({
      ok: true,
      run: {
        delivery: {
          reconciliationAttempts: 2,
          nextCheckAt: '2026-07-27T02:08:00.000Z',
          missingSince: null,
        },
      },
    });
    await expect(rotating.store.recordRunDeliveryObservation(observation)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_CONFLICT',
    });

    const next = await rotating.store.listPendingDeliveryRuns({
      now: '2026-07-27T02:05:00.000Z',
      limit: 1,
    });
    expect(next.items.map((run) => run.runId)).toEqual(['mdr_pending_002']);

    const erased = createStoreHarness();
    seedDefinitions(erased.fake, [makeDefinition({ erasureEpoch: 1 })]);
    seedRuns(erased.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    await expect(erased.store.recordRunDeliveryObservation(observation)).resolves.toEqual({
      ok: false,
      code: 'RESERVATION_LOST',
    });

    const absent = createStoreHarness();
    await expect(absent.store.recordRunDeliveryObservation(observation)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('records ambiguous and failed delivery observations monotonically and owner-safely', async () => {
    const observationBase = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_pending_001',
      expectedErasureEpoch: 0,
      observedAt: '2026-07-27T02:05:00.000Z',
    };
    const invalidEpoch = createStoreHarness();
    await expect(
      invalidEpoch.store.recordRunDeliveryState({
        ...observationBase,
        expectedErasureEpoch: -1,
        delivery: { status: 'ambiguous' },
      })
    ).rejects.toThrow('INVALID_ERASURE_EPOCH');

    const missing = createStoreHarness();
    await expect(
      missing.store.recordRunDeliveryState({
        ...observationBase,
        delivery: { status: 'ambiguous' },
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const ambiguous = createStoreHarness();
    seedDefinitions(ambiguous.fake, [makeDefinition()]);
    seedRuns(ambiguous.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    const ambiguousObservation = {
      ...observationBase,
      delivery: {
        status: 'ambiguous' as const,
        acceptedAt: '2026-07-27T02:04:30.000Z',
      },
    };
    await expect(
      ambiguous.store.recordRunDeliveryState(ambiguousObservation)
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'updated',
      run: {
        delivery: { status: 'ambiguous', acceptedAt: '2026-07-27T02:04:30.000Z' },
      },
    });
    await expect(
      ambiguous.store.recordRunDeliveryState(ambiguousObservation)
    ).resolves.toMatchObject({ ok: true, disposition: 'existing' });

    const failed = createStoreHarness();
    seedDefinitions(failed.fake, [makeDefinition()]);
    seedRuns(failed.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    const failedObservation = {
      ...observationBase,
      delivery: {
        status: 'failed' as const,
        failedAt: '2026-07-27T02:04:45.000Z',
        failureCode: 'DELIVERY_DISABLED',
      },
    };
    await expect(failed.store.recordRunDeliveryState(failedObservation)).resolves.toMatchObject({
      ok: true,
      disposition: 'updated',
      run: { delivery: { status: 'failed', failureCode: 'DELIVERY_DISABLED' } },
    });
    await expect(failed.store.recordRunDeliveryState(failedObservation)).resolves.toMatchObject({
      ok: true,
      disposition: 'existing',
    });

    const stale = createStoreHarness();
    seedDefinitions(stale.fake, [makeDefinition({ erasureEpoch: 1 })]);
    seedRuns(stale.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    await expect(
      stale.store.recordRunDeliveryState({
        ...observationBase,
        delivery: { status: 'ambiguous' },
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });

    const incomplete = createStoreHarness();
    seedDefinitions(incomplete.fake, [makeDefinition()]);
    seedRuns(incomplete.fake, [makeRun({ runId: 'mdr_pending_001' })]);
    await expect(
      incomplete.store.recordRunDeliveryState({
        ...observationBase,
        delivery: { status: 'ambiguous' },
      })
    ).resolves.toEqual({ ok: false, code: 'DELIVERY_CONFLICT' });
  });

  it('fails closed for malformed legacy lookups and incoherent definition state transitions', async () => {
    await expect(
      store.getOwnedDefinitionByLegacyAlias({
        userId: ' ',
        legacyGroupKey: 'synthetic-fishing-group',
      })
    ).resolves.toBeNull();

    const pausedAlias = createStoreHarness();
    seedDefinitions(pausedAlias.fake, [
      makeDefinition({
        status: 'paused',
        listStatus: 'paused',
        activeMigrationId: 'mdm_paused_alias_001',
        legacyAlias: { groupKey: 'synthetic-fishing-group' },
      }),
    ]);
    await expect(
      pausedAlias.store.getOwnedDefinitionByLegacyAlias({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
      })
    ).resolves.toMatchObject({ status: 'paused' });

    const names = createStoreHarness();
    seedDefinitions(names.fake, [
      makeDefinition({
        definitionId: 'md_alpha_001',
        name: 'Alpha',
        nameSortKey: 'alpha',
      }),
      makeDefinition({
        definitionId: 'md_beta_001',
        name: 'Beta',
        nameSortKey: 'beta',
      }),
    ]);
    await expect(
      names.store.listOwnedDefinitions({
        userId: 'synthetic-user-001',
        sort: 'name',
        limit: 1,
        queryFingerprint: 'names-default-direction-v1',
      })
    ).resolves.toMatchObject({
      items: [{ definitionId: 'md_alpha_001' }],
      nextCursor: expect.stringMatching(/^mdc1\./u),
    });

    const migrating = createStoreHarness();
    seedDefinitions(migrating.fake, [
      makeDefinition({ status: 'migrating', listStatus: 'paused' }),
    ]);
    migrating.fake.seedCollection(MESSAGE_DIGEST_STATES_COLLECTION, [
      { id: 'md_definition_001', data: makeState() },
    ]);
    await expect(
      migrating.store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { status: 'paused' },
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const pendingWindow = {
      runId: 'mdr_run_001',
      trigger: 'manual' as const,
      requestIdDigest: 'b'.repeat(64),
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-27T02:00:00.000Z',
      definitionRevision: 1,
      stateRevision: 1,
      erasureEpoch: 0,
      reservedAt: '2026-07-27T01:00:00.000Z',
    };
    const pausedAttention = makeDefinition({
      status: 'paused',
      listStatus: 'needs_attention',
      attentionCode: 'SOURCE_UNAVAILABLE',
      hasRuns: true,
    });

    const missingPendingRun = createStoreHarness();
    seedDefinitions(missingPendingRun.fake, [pausedAttention]);
    missingPendingRun.fake.seedCollection(MESSAGE_DIGEST_STATES_COLLECTION, [
      { id: 'md_definition_001', data: makeState({ pendingWindow }) },
    ]);
    await expect(
      missingPendingRun.store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { releaseFailedPendingWindow: true },
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const mismatchedPendingRun = createStoreHarness();
    seedDefinitions(mismatchedPendingRun.fake, [pausedAttention]);
    mismatchedPendingRun.fake.seedCollection(MESSAGE_DIGEST_STATES_COLLECTION, [
      { id: 'md_definition_001', data: makeState({ pendingWindow }) },
    ]);
    seedRuns(mismatchedPendingRun.fake, [
      makeRun({
        userId: 'synthetic-user-foreign',
        generationStatus: 'failed',
        processingStage: 'failed',
        safeFailureCode: 'SOURCE_UNAVAILABLE',
        completedAt: '2026-07-27T01:30:00.000Z',
      }),
    ]);
    await expect(
      mismatchedPendingRun.store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { releaseFailedPendingWindow: true },
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const attentionProjection = createStoreHarness();
    seedDefinitions(attentionProjection.fake, [pausedAttention]);
    attentionProjection.fake.seedCollection(MESSAGE_DIGEST_STATES_COLLECTION, [
      { id: 'md_definition_001', data: makeState() },
    ]);
    await expect(
      attentionProjection.store.updateDefinition({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 1,
        updatedAt: '2026-07-27T02:00:00.000Z',
        patch: { listStatus: 'needs_attention' },
      })
    ).resolves.toMatchObject({
      ok: true,
      definition: { listStatus: 'needs_attention', attentionCode: 'SOURCE_UNAVAILABLE' },
    });
  });

  it('fences orphaned workers and rejects every incoherent completion outbox', async () => {
    const ownerDigest = 'e'.repeat(64);
    const orphaned = createStoreHarness();
    seedRuns(orphaned.fake, [makeRun()]);
    await expect(
      orphaned.store.claimRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      orphaned.store.renewRunLease({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      orphaned.store.markRunProcessingStage({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        processingStage: 'aggregating',
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      orphaned.store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:00:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
        deliveryOutbox: makeDeliveryOutbox(),
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });
    await expect(
      orphaned.store.failRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        failedAt: '2026-07-27T02:00:00.000Z',
        safeFailureCode: 'SOURCE_UNAVAILABLE',
        pauseDefinition: false,
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });

    const occupiedDelivery = createStoreHarness();
    await createDefinition(occupiedDelivery.store);
    await reserveRun(occupiedDelivery.store);
    await claim(occupiedDelivery.store, ownerDigest);
    const deliveryOutbox = makeDeliveryOutbox();
    occupiedDelivery.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: deliveryOutbox.outboxId, data: deliveryOutbox },
    ]);
    await expect(
      occupiedDelivery.store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:04:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
        deliveryOutbox,
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });

    await expect(
      store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:04:00.000Z',
        generationStatus: 'skipped_no_activity',
        output: completedOutput(),
        deliveryOutbox: makeDeliveryOutbox(),
      })
    ).rejects.toThrow('INVALID_COMPLETION_OUTBOX');
    await expect(
      store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:04:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
      })
    ).rejects.toThrow('INVALID_COMPLETION_OUTBOX');
    await expect(
      store.completeRun({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest,
        fence: 1,
        completedAt: '2026-07-27T02:04:00.000Z',
        generationStatus: 'completed',
        output: completedOutput(),
        deliveryOutbox: makeDeliveryOutbox({ userId: 'synthetic-user-foreign' }),
      })
    ).rejects.toThrow('INVALID_COMPLETION_OUTBOX');
  });

  it('returns explicit read, retry, dispatch-renewal, and dispatch-result failure outcomes', async () => {
    await expect(
      store.getOwnedDispatch({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        outboxId: 'mdo_missing_001',
      })
    ).resolves.toBeNull();
    const visibleDispatch = makeOutbox();
    fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: visibleDispatch.outboxId, data: visibleDispatch },
    ]);
    await expect(
      store.getOwnedDispatch({
        userId: 'synthetic-user-foreign',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        outboxId: visibleDispatch.outboxId,
      })
    ).resolves.toBeNull();

    const generationOutbox = retryOutbox('mdo_generation_defensive_001', 'run_request');
    await expect(
      store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox: retryOutbox('mdo_generation_invalid_001', 'run_request', {
          userId: 'synthetic-user-foreign',
        }),
      })
    ).resolves.toEqual({ ok: false, code: 'RETRY_CONFLICT' });
    await expect(
      store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox: generationOutbox,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const foreignGeneration = createStoreHarness();
    seedDefinitions(foreignGeneration.fake, [makeDefinition({ userId: 'synthetic-user-foreign' })]);
    foreignGeneration.fake.seedCollection(MESSAGE_DIGEST_STATES_COLLECTION, [
      { id: 'md_definition_001', data: makeState() },
    ]);
    seedRuns(foreignGeneration.fake, [makeRun()]);
    await expect(
      foreignGeneration.store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox: generationOutbox,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const failedGeneration = makeRun({
      generationStatus: 'failed',
      processingStage: 'failed',
      safeFailureCode: 'LLM_UNAVAILABLE',
      completedAt: '2026-07-27T02:04:00.000Z',
      updatedAt: '2026-07-27T02:04:00.000Z',
    });
    const conflictingGeneration = createStoreHarness();
    await createDefinition(conflictingGeneration.store);
    seedRuns(conflictingGeneration.fake, [failedGeneration]);
    conflictingGeneration.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      {
        id: generationOutbox.outboxId,
        data: retryOutbox(generationOutbox.outboxId, 'run_request', {
          payloadJson: JSON.stringify({ type: 'different-generation-retry' }),
        }),
      },
    ]);
    await expect(
      conflictingGeneration.store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox: generationOutbox,
      })
    ).resolves.toEqual({ ok: false, code: 'RETRY_CONFLICT' });

    const lostGeneration = createStoreHarness();
    await createDefinition(lostGeneration.store);
    seedRuns(lostGeneration.fake, [failedGeneration]);
    await expect(
      lostGeneration.store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox: generationOutbox,
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });

    const activeGeneration = createStoreHarness();
    await createDefinition(activeGeneration.store);
    await reserveRun(activeGeneration.store);
    await expect(
      activeGeneration.store.retryFailedGeneration({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        outbox: generationOutbox,
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_IN_PROGRESS' });

    const failedDelivery = makeFailedDeliveryRun();
    const original = retryOutbox('mdo_original_defensive_001', 'whatsapp_delivery', {
      runId: failedDelivery.runId,
      status: 'published',
      publishedAt: '2026-07-27T02:03:00.000Z',
    });
    const deliveryRetry = retryOutbox('mdo_delivery_defensive_001', 'whatsapp_delivery', {
      runId: failedDelivery.runId,
      payloadJson: original.payloadJson,
      payloadDigest: original.payloadDigest,
    });
    await expect(
      store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedDelivery.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: retryOutbox('mdo_delivery_invalid_001', 'whatsapp_delivery', {
          userId: 'synthetic-user-foreign',
        }),
      })
    ).resolves.toEqual({ ok: false, code: 'RETRY_CONFLICT' });
    await expect(
      store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedDelivery.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: deliveryRetry,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const foreignDelivery = createStoreHarness();
    seedDefinitions(foreignDelivery.fake, [
      makeDefinition({ userId: 'synthetic-user-foreign', hasRuns: true }),
    ]);
    seedRuns(foreignDelivery.fake, [failedDelivery]);
    foreignDelivery.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: original.outboxId, data: original },
    ]);
    await expect(
      foreignDelivery.store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedDelivery.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: deliveryRetry,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const conflictingDelivery = createStoreHarness();
    seedDefinitions(conflictingDelivery.fake, [makeDefinition({ hasRuns: true })]);
    seedRuns(conflictingDelivery.fake, [failedDelivery]);
    conflictingDelivery.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: original.outboxId, data: original },
      {
        id: deliveryRetry.outboxId,
        data: retryOutbox(deliveryRetry.outboxId, 'whatsapp_delivery', {
          runId: failedDelivery.runId,
          payloadJson: JSON.stringify({ type: 'different-delivery-retry' }),
        }),
      },
    ]);
    await expect(
      conflictingDelivery.store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedDelivery.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: deliveryRetry,
      })
    ).resolves.toEqual({ ok: false, code: 'RETRY_CONFLICT' });

    const deletingDelivery = createStoreHarness();
    seedDefinitions(deletingDelivery.fake, [
      makeDefinition({
        status: 'deleting',
        listStatus: 'paused',
        activeErasureRequestId: 'mde_delivery_delete_001',
        hasRuns: true,
      }),
    ]);
    seedRuns(deletingDelivery.fake, [failedDelivery]);
    deletingDelivery.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: original.outboxId, data: original },
    ]);
    await expect(
      deletingDelivery.store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedDelivery.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: deliveryRetry,
      })
    ).resolves.toEqual({ ok: false, code: 'RESERVATION_LOST' });

    const pausedDelivery = createStoreHarness();
    seedDefinitions(pausedDelivery.fake, [
      makeDefinition({ status: 'paused', listStatus: 'paused', hasRuns: true }),
    ]);
    seedRuns(pausedDelivery.fake, [completedRunForReconciliation('mdr_run_001', 'sent')]);
    pausedDelivery.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: original.outboxId, data: original },
    ]);
    await expect(
      pausedDelivery.store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: deliveryRetry,
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_IN_PROGRESS' });

    const mismatchedOriginal = createStoreHarness();
    seedDefinitions(mismatchedOriginal.fake, [makeDefinition({ hasRuns: true })]);
    seedRuns(mismatchedOriginal.fake, [failedDelivery]);
    mismatchedOriginal.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      {
        id: original.outboxId,
        data: retryOutbox(original.outboxId, 'run_request', {
          runId: failedDelivery.runId,
          status: 'published',
          publishedAt: '2026-07-27T02:03:00.000Z',
        }),
      },
    ]);
    await expect(
      mismatchedOriginal.store.retryFailedDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: failedDelivery.runId,
        retriedAt: '2026-07-27T02:05:00.000Z',
        originalOutboxId: original.outboxId,
        outbox: deliveryRetry,
      })
    ).resolves.toEqual({ ok: false, code: 'RETRY_CONFLICT' });

    const ownerDigest = '9'.repeat(64);
    const missingRenewal = createStoreHarness();
    await expect(
      missingRenewal.store.renewDispatchClaim({
        outboxId: 'mdo_missing_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    missingRenewal.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      { id: 'mdo_run_request_001', data: makeOutbox() },
    ]);
    await expect(
      missingRenewal.store.renewDispatchClaim({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:00:00.000Z',
        expiresAt: '2026-07-27T02:05:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'CLAIM_LOST' });

    const orphanedResult = createStoreHarness();
    orphanedResult.fake.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
      {
        id: 'mdo_run_request_001',
        data: makeOutbox({
          attempts: 1,
          claim: {
            ownerDigest,
            fence: 1,
            expiresAt: '2026-07-27T02:05:00.000Z',
          },
        }),
      },
    ]);
    await expect(
      orphanedResult.store.recordDispatchResult({
        outboxId: 'mdo_run_request_001',
        ownerDigest,
        fence: 1,
        now: '2026-07-27T02:01:00.000Z',
        outcome: { status: 'retry', nextAttemptAt: '2026-07-27T02:10:00.000Z' },
      })
    ).resolves.toEqual({ ok: false, code: 'CLAIM_LOST' });
  });

  it('covers paused delivery reconciliation and every owner-visible run discriminator', async () => {
    const deliveryBase = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_pending_001',
      expectedErasureEpoch: 0,
      observedAt: '2026-07-27T02:05:00.000Z',
    };
    const foreignState = createStoreHarness();
    seedDefinitions(foreignState.fake, [makeDefinition()]);
    seedRuns(foreignState.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    await expect(
      foreignState.store.recordRunDeliveryState({
        ...deliveryBase,
        userId: 'synthetic-user-foreign',
        delivery: { status: 'ambiguous' },
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const pausedState = createStoreHarness();
    seedDefinitions(pausedState.fake, [
      makeDefinition({ status: 'paused', listStatus: 'paused', hasRuns: true }),
    ]);
    seedRuns(pausedState.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    const ambiguousWithoutAcceptance = {
      ...deliveryBase,
      delivery: { status: 'ambiguous' as const },
    };
    await expect(
      pausedState.store.recordRunDeliveryState(ambiguousWithoutAcceptance)
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'updated',
      run: { delivery: { status: 'ambiguous', acceptedAt: null } },
    });
    await expect(
      pausedState.store.recordRunDeliveryState(ambiguousWithoutAcceptance)
    ).resolves.toMatchObject({ ok: true, disposition: 'existing' });

    const projected = createStoreHarness();
    seedDefinitions(projected.fake, [
      makeDefinition({
        hasRuns: true,
        latestRun: {
          runId: 'mdr_previous_001',
          startedAt: '2026-07-26T01:00:00.000Z',
          generationStatus: 'completed',
          processingStage: 'completed',
          deliveryStatus: 'sent',
        },
      }),
    ]);
    seedRuns(projected.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    await expect(
      projected.store.recordRunDeliveryState({
        ...deliveryBase,
        delivery: { status: 'sent', acceptedAt: '2026-07-27T02:04:30.000Z' },
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'updated' });
    expect(
      readDocument(projected.fake, MESSAGE_DIGEST_DEFINITIONS_COLLECTION, 'md_definition_001')
    ).toMatchObject({ latestRun: { runId: 'mdr_previous_001' } });

    const observationBase = {
      ...deliveryBase,
      expectedReconciliationAttempts: 0,
      nextCheckAt: '2026-07-27T02:06:00.000Z',
      observation: 'unavailable' as const,
    };
    await expect(
      store.recordRunDeliveryObservation({
        ...observationBase,
        expectedReconciliationAttempts: -1,
      })
    ).rejects.toThrow('INVALID_DELIVERY_OBSERVATION');

    const foreignObservation = createStoreHarness();
    seedDefinitions(foreignObservation.fake, [makeDefinition()]);
    seedRuns(foreignObservation.fake, [
      completedRunForReconciliation('mdr_pending_001', 'pending'),
    ]);
    await expect(
      foreignObservation.store.recordRunDeliveryObservation({
        ...observationBase,
        userId: 'synthetic-user-foreign',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const pausedObservation = createStoreHarness();
    seedDefinitions(pausedObservation.fake, [
      makeDefinition({ status: 'paused', listStatus: 'paused', hasRuns: true }),
    ]);
    seedRuns(pausedObservation.fake, [completedRunForReconciliation('mdr_pending_001', 'pending')]);
    await expect(
      pausedObservation.store.recordRunDeliveryObservation(observationBase)
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'updated',
      run: { delivery: { reconciliationAttempts: 1, missingSince: null } },
    });

    const visibility = createStoreHarness();
    seedRuns(visibility.fake, [
      makeRun({ runId: 'mdr_visible_001' }),
      makeRun({ runId: 'mdr_foreign_definition_001' }),
      legacyCompletedRun('mdr_audit_001', '2026-07-27T01:00:00.000Z', {
        recordRole: 'audit',
      }),
      stagedLegacyRun('mdr_staged_001', '2026-07-27T01:00:00.000Z', 'mdm_staged_001'),
    ]);
    await expect(
      visibility.store.getOwnedRun({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_visible_001',
      })
    ).resolves.toMatchObject({ runId: 'mdr_visible_001' });
    await expect(
      visibility.store.getOwnedRun({
        userId: 'synthetic-user-foreign',
        definitionId: 'md_definition_001',
        runId: 'mdr_visible_001',
      })
    ).resolves.toBeNull();
    await expect(
      visibility.store.getOwnedRun({
        userId: 'synthetic-user-001',
        definitionId: 'md_other_001',
        runId: 'mdr_foreign_definition_001',
      })
    ).resolves.toBeNull();
    await expect(
      visibility.store.getOwnedRun({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_audit_001',
      })
    ).resolves.toBeNull();
    await expect(
      visibility.store.getOwnedRun({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_staged_001',
      })
    ).resolves.toBeNull();
  });

  it('validates legacy-run selectors and rejects unowned activation snapshots', async () => {
    const input = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      activeMigrationId: 'mdm_migration_001',
      legacyGroupKey: 'synthetic-fishing-group',
      limit: 10,
      queryFingerprint: 'legacy-defensive-v1',
    };
    await expect(
      store.listOwnedLegacyRuns({ ...input, activeMigrationId: 'invalid' })
    ).rejects.toThrow('INVALID_MIGRATION_ID');
    await expect(
      store.listOwnedLegacyRuns({ ...input, legacyGroupKey: 'Invalid Group' })
    ).rejects.toThrow('INVALID_LEGACY_ALIAS');
    await expect(store.listOwnedLegacyRuns(input)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    const foreign = createStoreHarness();
    seedDefinitions(foreign.fake, [
      makeDefinition({
        userId: 'synthetic-user-foreign',
        activeMigrationId: input.activeMigrationId,
        legacyAlias: { groupKey: input.legacyGroupKey },
      }),
    ]);
    await expect(foreign.store.listOwnedLegacyRuns(input)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    const paused = createStoreHarness();
    seedDefinitions(paused.fake, [
      makeDefinition({
        status: 'paused',
        listStatus: 'paused',
        activeMigrationId: input.activeMigrationId,
        legacyAlias: { groupKey: input.legacyGroupKey },
      }),
    ]);
    await expect(paused.store.listOwnedLegacyRuns(input)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('fails closed for missing delivery authorizations and every erasure ownership conflict', async () => {
    const authorizationInput = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
      ownerDigest: '1'.repeat(64),
      now: '2026-07-27T02:00:00.000Z',
      expiresAt: '2026-07-27T02:05:00.000Z',
    };
    const missingOutbox = createStoreHarness();
    seedDefinitions(missingOutbox.fake, [makeDefinition({ hasRuns: true })]);
    seedRuns(missingOutbox.fake, [completedRunForReconciliation('mdr_run_001', 'pending')]);
    await expect(
      missingOutbox.store.claimDeliveryAuthorization(authorizationInput)
    ).resolves.toEqual({ ok: false, code: 'NOT_AUTHORIZED' });

    const releaseInput = {
      userId: authorizationInput.userId,
      definitionId: authorizationInput.definitionId,
      runId: authorizationInput.runId,
      payloadDigest: authorizationInput.payloadDigest,
      ownerDigest: authorizationInput.ownerDigest,
      fence: 1,
      now: '2026-07-27T02:01:00.000Z',
    };
    await expect(store.releaseDeliveryAuthorization(releaseInput)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const foreignRelease = createStoreHarness();
    seedDeliveryAuthorizationContext(foreignRelease.fake);
    await foreignRelease.store.claimDeliveryAuthorization(authorizationInput);
    await expect(
      foreignRelease.store.releaseDeliveryAuthorization({
        ...releaseInput,
        userId: 'synthetic-user-foreign',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const released = createStoreHarness();
    seedDeliveryAuthorizationContext(released.fake);
    await released.store.claimDeliveryAuthorization(authorizationInput);
    await expect(released.store.releaseDeliveryAuthorization(releaseInput)).resolves.toEqual({
      ok: true,
    });
    await expect(
      released.store.releaseDeliveryAuthorization({
        ...releaseInput,
        now: '2026-07-27T02:02:00.000Z',
      })
    ).resolves.toEqual({ ok: true });

    const expired = createStoreHarness();
    seedDeliveryAuthorizationContext(expired.fake);
    await expired.store.claimDeliveryAuthorization(authorizationInput);
    await expect(
      expired.store.releaseDeliveryAuthorization({
        ...releaseInput,
        now: '2026-07-27T02:06:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'LEASE_LOST' });

    await expect(
      store.getOwnedErasureRequest('synthetic-user-001', 'mde_missing_001')
    ).resolves.toBeNull();
    await expect(
      store.startOrResumeDefinitionErasure({
        userId: 'synthetic-user-001',
        definitionId: 'md_missing_001',
        erasureRequestId: 'mde_missing_001',
        requestIdDigest: '7'.repeat(64),
        now: '2026-07-27T03:00:00.000Z',
        limit: 1,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const foreignErasure = createStoreHarness();
    await createDefinition(
      foreignErasure.store,
      makeDefinition({ userId: 'synthetic-user-foreign' })
    );
    await expect(
      foreignErasure.store.startOrResumeDefinitionErasure({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        erasureRequestId: 'mde_foreign_001',
        requestIdDigest: '7'.repeat(64),
        now: '2026-07-27T03:00:00.000Z',
        limit: 1,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const deletingErasure = createStoreHarness();
    seedDefinitions(deletingErasure.fake, [
      makeDefinition({
        status: 'deleting',
        listStatus: 'paused',
        activeErasureRequestId: 'mde_existing_001',
      }),
    ]);
    await expect(
      deletingErasure.store.startOrResumeDefinitionErasure({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        erasureRequestId: 'mde_new_001',
        requestIdDigest: '7'.repeat(64),
        now: '2026-07-27T03:00:00.000Z',
        limit: 1,
      })
    ).resolves.toEqual({ ok: false, code: 'ERASURE_CONFLICT' });

    const requestInput = {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      erasureRequestId: 'mde_legacy_001',
      requestIdDigest: '7'.repeat(64),
      now: '2026-07-27T03:00:00.000Z',
      limit: 1,
    };
    const conflictingRequest = createStoreHarness();
    conflictingRequest.fake.seedCollection(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION, [
      {
        id: requestInput.erasureRequestId,
        data: makeErasureRequest({ requestIdDigest: '8'.repeat(64) }),
      },
    ]);
    await expect(
      conflictingRequest.store.startOrResumeDefinitionErasure(requestInput)
    ).resolves.toEqual({ ok: false, code: 'ERASURE_CONFLICT' });

    const duplicateActivations = createStoreHarness();
    duplicateActivations.fake.seedCollection(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION, [
      { id: requestInput.erasureRequestId, data: makeErasureRequest() },
    ]);
    duplicateActivations.fake.seedCollection(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION, [
      {
        id: 'mdm_duplicate_erase_001',
        data: makeMigrationActivation({ migrationId: 'mdm_duplicate_erase_001' }),
      },
      {
        id: 'mdm_duplicate_erase_002',
        data: makeMigrationActivation({ migrationId: 'mdm_duplicate_erase_002' }),
      },
    ]);
    await expect(
      duplicateActivations.store.startOrResumeDefinitionErasure(requestInput)
    ).rejects.toThrow('MIGRATION_ACTIVATION_CONFLICT');

    const mismatchedActivation = createStoreHarness();
    mismatchedActivation.fake.seedCollection(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION, [
      { id: requestInput.erasureRequestId, data: makeErasureRequest() },
    ]);
    mismatchedActivation.fake.seedCollection(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION, [
      {
        id: 'mdm_document_001',
        data: makeMigrationActivation({ migrationId: 'mdm_payload_001' }),
      },
    ]);
    await expect(
      mismatchedActivation.store.startOrResumeDefinitionErasure(requestInput)
    ).rejects.toThrow('MIGRATION_ACTIVATION_CONFLICT');

    const noLegacyAlias = createStoreHarness();
    noLegacyAlias.fake.seedCollection(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION, [
      { id: requestInput.erasureRequestId, data: makeErasureRequest() },
    ]);
    noLegacyAlias.fake.seedCollection(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION, [
      {
        id: 'mdm_no_legacy_001',
        data: makeMigrationActivation({ migrationId: 'mdm_no_legacy_001' }),
      },
    ]);
    await expect(
      noLegacyAlias.store.startOrResumeDefinitionErasure(requestInput)
    ).resolves.toMatchObject({
      ok: true,
      status: 'completed',
      request: { stage: 'completed' },
    });
    await expect(
      noLegacyAlias.store.startOrResumeDefinitionErasure({
        ...requestInput,
        now: '2026-07-27T03:01:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'completed',
      deletedThisCall: 0,
      request: { stage: 'completed' },
    });
  });
});

function makeDefinition(
  overrides: Partial<MessageDigestDefinitionDocument> = {}
): MessageDigestDefinitionDocument {
  return MessageDigestDefinitionDocumentSchema.parse({
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Synthetic daily digest',
    nameSortKey: 'synthetic daily digest',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Synthetic group',
      sourceRevision: 'synthetic-source-revision',
    },
    instructions: {
      templateId: 'fishing_group',
      text: 'Write a concrete Polish digest using only facts from this synthetic source window.',
      revision: '1.0.0',
    },
    schedule: { kind: 'daily', localTime: '03:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'synthetic-readiness-v1',
      readinessObservedAt: '2026-07-27T00:00:00.000Z',
    },
    checkpointAt: '2026-07-27T00:00:00.000Z',
    nextRunAt: '2026-07-28T01:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  });
}

function makeState(
  overrides: Partial<MessageDigestStateDocument> = {}
): MessageDigestStateDocument {
  return MessageDigestStateDocumentSchema.parse({
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    revision: 1,
    checkpointAt: '2026-07-27T00:00:00.000Z',
    continuityMemoryMarkdown: '',
    precedingRunId: null,
    precedingRunHash: null,
    pendingWindow: null,
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  });
}

function makeRun(overrides: Partial<MessageDigestRunDocument> = {}): MessageDigestRunDocument {
  const definition = makeDefinition();
  return MessageDigestRunDocumentSchema.parse({
    version: 1,
    runId: 'mdr_run_001',
    userId: definition.userId,
    definitionId: definition.definitionId,
    definitionNameSnapshot: definition.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: 1,
    instructionRevision: '1.0.0',
    trigger: 'manual',
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-27T00:00:00.000Z',
    windowEnd: '2026-07-27T02:00:00.000Z',
    scheduledBoundary: '2026-07-27T02:00:00.000Z',
    generationStatus: 'queued',
    processingStage: 'queued',
    lease: null,
    attempts: 0,
    sourceSnapshot: definition.source,
    instructionsSnapshot: definition.instructions,
    scheduleSnapshot: definition.schedule,
    headline: null,
    summaryMarkdown: null,
    evidenceMessageRefs: [],
    continuityMemoryMarkdown: null,
    effectiveMessageCount: null,
    promptVersion: null,
    model: null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary',
      status: 'not_sent',
      idempotencyKey: 'message_digest_run_001',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
    completedAt: null,
    ...overrides,
  });
}

function makeOutbox(
  overrides: Partial<MessageDigestDispatchOutboxDocument> = {}
): MessageDigestDispatchOutboxDocument {
  const runId = overrides.runId ?? 'mdr_run_001';
  const payloadJson = JSON.stringify({ runId, type: 'message-digest.run' });
  return MessageDigestDispatchOutboxDocumentSchema.parse({
    version: 1,
    outboxId: 'mdo_run_request_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId,
    kind: 'run_request',
    status: 'pending',
    payloadJson,
    payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    attempts: 0,
    nextAttemptAt: '2026-07-27T01:00:00.000Z',
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
    expiresAt: 1_775_000_000,
    ...overrides,
  });
}

function retryOutbox(
  outboxId: string,
  kind: MessageDigestDispatchOutboxDocument['kind'],
  overrides: Partial<MessageDigestDispatchOutboxDocument> = {}
): MessageDigestDispatchOutboxDocument {
  const runId = overrides.runId ?? 'mdr_run_001';
  const payloadJson =
    overrides.payloadJson ??
    JSON.stringify({
      type: kind === 'run_request' ? 'message-digest.run' : 'whatsapp.message.send',
      runId,
      idempotencyKey: `message-digest:${runId}`,
      timestamp: '2026-07-27T02:00:00.000Z',
    });
  return MessageDigestDispatchOutboxDocumentSchema.parse({
    version: 1,
    outboxId,
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId,
    kind,
    status: 'pending',
    payloadJson,
    payloadDigest:
      overrides.payloadDigest ?? createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    attempts: 0,
    nextAttemptAt: '2026-07-27T02:05:00.000Z',
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt: '2026-07-27T02:05:00.000Z',
    updatedAt: '2026-07-27T02:05:00.000Z',
    expiresAt: 1_777_000_000,
    ...overrides,
  });
}

function makeDeliveryOutbox(
  overrides: Partial<MessageDigestDispatchOutboxDocument> = {}
): MessageDigestDispatchOutboxDocument {
  const payloadJson = JSON.stringify({ type: 'whatsapp.message.send', runId: 'mdr_run_001' });
  return makeOutbox({
    outboxId: 'mdo_delivery_001',
    kind: 'whatsapp_delivery',
    payloadJson,
    payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    nextAttemptAt: '2026-07-27T02:04:00.000Z',
    createdAt: '2026-07-27T02:04:00.000Z',
    updatedAt: '2026-07-27T02:04:00.000Z',
    ...overrides,
  });
}

function completedRunForReconciliation(
  runId: string,
  deliveryStatus: 'pending' | 'sent'
): MessageDigestRunDocument {
  return makeRun({
    runId,
    generationStatus: 'completed',
    processingStage: 'completed',
    headline: 'Synthetic completion',
    summaryMarkdown: '- A bounded synthetic fact.',
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    delivery: {
      type: 'whatsapp_primary',
      status: deliveryStatus,
      idempotencyKey: `message-digest:${runId}`,
      acceptedAt: deliveryStatus === 'sent' ? '2026-07-27T01:02:00.000Z' : null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: deliveryStatus === 'pending' ? '2026-07-27T01:02:00.000Z' : null,
      missingSince: null,
    },
    completedAt: '2026-07-27T01:02:00.000Z',
    updatedAt: '2026-07-27T01:02:00.000Z',
  });
}

function makeFailedDeliveryRun(): MessageDigestRunDocument {
  const pending = completedRunForReconciliation('mdr_run_001', 'pending');
  return MessageDigestRunDocumentSchema.parse({
    ...pending,
    delivery: {
      ...pending.delivery,
      status: 'failed',
      acceptedAt: null,
      failedAt: '2026-07-27T02:04:00.000Z',
      failureCode: 'MAPPING_MISSING',
      nextCheckAt: null,
      missingSince: null,
    },
    updatedAt: '2026-07-27T02:04:00.000Z',
  });
}

function makeErasureRequest(
  overrides: Partial<ReturnType<typeof MessageDigestErasureRequestDocumentSchema.parse>> = {}
): ReturnType<typeof MessageDigestErasureRequestDocumentSchema.parse> {
  return MessageDigestErasureRequestDocumentSchema.parse({
    version: 1,
    erasureRequestId: 'mde_legacy_001',
    requestIdDigest: '7'.repeat(64),
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    erasureEpoch: 1,
    stage: 'legacy',
    cursor: null,
    deletedCounts: { runs: 0, outbox: 0, state: 0, definition: 0, legacy: 0 },
    createdAt: '2026-07-27T02:00:00.000Z',
    updatedAt: '2026-07-27T02:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    ...overrides,
  });
}

function makeMigrationActivation(
  overrides: Partial<ReturnType<typeof MessageDigestMigrationActivationDocumentSchema.parse>> = {}
): ReturnType<typeof MessageDigestMigrationActivationDocumentSchema.parse> {
  return MessageDigestMigrationActivationDocumentSchema.parse({
    version: 1,
    migrationId: 'mdm_legacy_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    legacyGroupKey: null,
    status: 'preparing',
    leaseOwnerDigest: null,
    leaseExpiresAt: null,
    step: 'created',
    cutoverDeadline: '2026-07-28T00:00:00.000Z',
    baselineHash: null,
    replayHash: null,
    verificationHash: null,
    safeCounts: {},
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
    ...overrides,
  });
}

function legacyCompletedRun(
  runId: string,
  scheduledBoundary: string,
  overrides: Partial<MessageDigestRunDocument> = {}
): MessageDigestRunDocument {
  return MessageDigestRunDocumentSchema.parse({
    ...completedRunForReconciliation(runId, 'sent'),
    trigger: 'scheduled',
    scheduledBoundary,
    ...overrides,
  });
}

function stagedLegacyRun(
  runId: string,
  scheduledBoundary: string,
  migrationId: string
): MessageDigestRunDocument {
  const completed = completedRunForReconciliation(runId, 'sent');
  return MessageDigestRunDocumentSchema.parse({
    ...completed,
    trigger: 'scheduled',
    scheduledBoundary,
    visibilityMigrationId: migrationId,
    migrationDate: scheduledBoundary.slice(0, 10),
    provenance: 'legacy_mobile_notification',
    deliveryMode: 'silent',
    predecessorRunHash: null,
    runHash: 'e'.repeat(64),
    sourceWatermarkHash: null,
    sourceCandidateHash: null,
    candidateHash: 'f'.repeat(64),
    delivery: {
      ...completed.delivery,
      status: 'not_sent',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      nextCheckAt: null,
      missingSince: null,
    },
  });
}

function completedOutput(): Parameters<
  ReturnType<typeof createFirestoreMessageDigestStore>['completeRun']
>[0]['output'] {
  return {
    headline: 'Synthetic completion',
    summaryMarkdown: '- A bounded synthetic fact.',
    evidenceMessageRefs: ['1'.repeat(64)],
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
  };
}

function reservationInput(
  overrides: {
    run?: MessageDigestRunDocument;
    outbox?: MessageDigestDispatchOutboxDocument;
    definitionRevision?: number;
    stateRevision?: number;
    windowStart?: string;
  } = {}
): Parameters<ReturnType<typeof createFirestoreMessageDigestStore>['reserveRun']>[0] {
  const run =
    overrides.run ??
    makeRun(overrides.windowStart === undefined ? {} : { windowStart: overrides.windowStart });
  const outbox = overrides.outbox ?? makeOutbox({ runId: run.runId });
  return {
    userId: run.userId,
    definitionId: run.definitionId,
    expectedDefinitionRevision: overrides.definitionRevision ?? 1,
    expectedStateRevision: overrides.stateRevision ?? 1,
    expectedErasureEpoch: 0,
    expectedReadinessObservationVersion: 'synthetic-readiness-v1',
    readinessObservation: {
      observationVersion: 'synthetic-readiness-v2',
      observedAt: '2026-07-27T01:00:00.000Z',
    },
    nextRunAt: '2026-07-28T01:00:00.000Z',
    run,
    outbox,
  };
}

async function createDefinition(
  target: ReturnType<typeof createFirestoreMessageDigestStore>,
  definition = makeDefinition()
): Promise<void> {
  const result = await target.createDefinition({
    definition,
    state: makeState({ definitionId: definition.definitionId, userId: definition.userId }),
  });
  if (!result.ok) throw new Error(result.code);
}

async function reserveRun(
  target: ReturnType<typeof createFirestoreMessageDigestStore>,
  overrides: Parameters<typeof reservationInput>[0] = {}
): Promise<void> {
  const result = await target.reserveRun(reservationInput(overrides));
  if (!result.ok) throw new Error(result.code);
}

async function claim(
  target: ReturnType<typeof createFirestoreMessageDigestStore>,
  ownerDigest: string
): Promise<void> {
  const result = await target.claimRunLease({
    userId: 'synthetic-user-001',
    runId: 'mdr_run_001',
    ownerDigest,
    now: '2026-07-27T02:00:00.000Z',
    expiresAt: '2026-07-27T02:05:00.000Z',
  });
  if (!result.ok) throw new Error(result.code);
}

function seedDefinitions(
  fakeFirestore: FakeFirestore,
  definitions: MessageDigestDefinitionDocument[]
): void {
  fakeFirestore.seedCollection(
    MESSAGE_DIGEST_DEFINITIONS_COLLECTION,
    definitions.map((definition) => ({ id: definition.definitionId, data: definition }))
  );
}

function seedRuns(fakeFirestore: FakeFirestore, runs: MessageDigestRunDocument[]): void {
  fakeFirestore.seedCollection(
    MESSAGE_DIGEST_RUNS_COLLECTION,
    runs.map((run) => ({ id: run.runId, data: run }))
  );
}

function seedDeliveryAuthorizationContext(
  fakeFirestore: FakeFirestore,
  outboxOverrides: Partial<MessageDigestDispatchOutboxDocument> = {}
): void {
  seedDefinitions(fakeFirestore, [makeDefinition({ hasRuns: true })]);
  seedRuns(fakeFirestore, [completedRunForReconciliation('mdr_run_001', 'pending')]);
  const outboxId = getMessageDigestDeliveryOutboxId('mdr_run_001');
  fakeFirestore.seedCollection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION, [
    {
      id: outboxId,
      data: makeDeliveryOutbox({
        outboxId,
        payloadJson: AUTHORIZATION_PAYLOAD_JSON,
        payloadDigest: AUTHORIZATION_PAYLOAD_DIGEST,
        ...outboxOverrides,
      }),
    },
  ]);
}

function readDocument(
  fakeFirestore: FakeFirestore,
  collection: string,
  id: string
): Record<string, unknown> {
  const document = fakeFirestore.getAllData().get(collection)?.get(id);
  if (document === undefined) throw new Error(`Missing ${collection}/${id}`);
  return document;
}

function createStoreHarness(): {
  fake: FakeFirestore;
  store: ReturnType<typeof createFirestoreMessageDigestStore>;
} {
  const fake = createFakeFirestore();
  const store = createFirestoreMessageDigestStore({
    firestore: fake as unknown as Firestore,
    cursorCodec: createMessageDigestCursorCodec({
      secret: 'synthetic-store-cursor-secret',
      now: () => Date.parse('2026-07-27T12:00:00.000Z'),
    }),
  });
  return { fake, store };
}
