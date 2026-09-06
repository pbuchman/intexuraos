import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';

import type { MatrixCorpusTurnPublicationV1 } from '../../../domain/matrixCorpus/correlation.js';
import type {
  MatrixCorpusIngestReceiptIdentity,
  MatrixCorpusIngestStableKeys,
  MatrixCorpusReceiptMutationResult,
  MatrixCorpusReceiptRecoveryResult,
} from '../../../domain/matrixCorpus/ports/ingestReceiptRepository.js';

import {
  FirestoreIngestReceiptRepository,
  INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION,
} from '../../../infra/firestore/ingestReceiptRepository.js';

const now = '2026-07-20T10:00:00.000Z';

function identity(
  overrides: Readonly<Partial<MatrixCorpusIngestReceiptIdentity>> = {}
): MatrixCorpusIngestReceiptIdentity {
  return {
    ingestReceiptId: 'receipt_1',
    runId: 'run_1',
    scenarioId: 'scenario_1',
    turnIndex: 0,
    leaseFence: '7',
    payloadDigest: '1'.repeat(64),
    ...overrides,
  };
}

function stableKeys(suffix = 'a'): MatrixCorpusIngestStableKeys {
  return {
    sessionId: `session_${suffix}`,
    eventId: `event_${suffix}`,
    toolCallId: `tool_${suffix}`,
    replyId: `reply_${suffix}`,
  };
}

function openPublication(): MatrixCorpusTurnPublicationV1 {
  return {
    version: 1 as const,
    phase: 'open' as const,
    expectedReplyDigests: null,
    replies: [],
    terminal: null,
  };
}

function repository(): Readonly<{
  firestore: Firestore;
  repo: FirestoreIngestReceiptRepository;
}> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  return {
    firestore,
    repo: new FirestoreIngestReceiptRepository({ firestore }),
  };
}

describe('FirestoreIngestReceiptRepository', () => {
  it('atomically reserves stable keys and the first durable processing intent', async () => {
    const { firestore, repo } = repository();

    await expect(
      repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now })
    ).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      receipt: {
        version: 1,
        ...identity(),
        ...stableKeys(),
        state: 'processing',
        failureCode: null,
        publication: openPublication(),
        createdAt: now,
        updatedAt: now,
      },
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc('receipt_1')
      .get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toEqual({
      version: 1,
      ...identity(),
      ...stableKeys(),
      state: 'processing',
      failureCode: null,
      publication: openPublication(),
      createdAt: now,
      updatedAt: now,
    });
    for (const forbiddenField of [
      'userId',
      'text',
      'payload',
      'attestation',
      'capability',
      'providerError',
    ])
      expect(stored.data()).not.toHaveProperty(forbiddenField);
  });

  it('returns first-wins stable keys for exact sequential and concurrent reserve replays', async () => {
    const { repo } = repository();
    const first = repo.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys('first'),
      now,
    });
    const second = repo.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys('second'),
      now: '2026-07-20T10:00:01.000Z',
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      ok: true,
      disposition: 'applied',
      receipt: stableKeys('first'),
    });
    expect(secondResult).toMatchObject({
      ok: true,
      disposition: 'already_applied',
      receipt: stableKeys('first'),
    });
    await expect(
      repo.reserveAndStartProcessing({
        identity: identity(),
        stableKeys: stableKeys('third'),
        now: '2026-07-20T10:00:02.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      receipt: stableKeys('first'),
    });
  });

  it('rejects changed correlated reuse without mutating the first receipt', async () => {
    const { repo } = repository();
    await repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });

    for (const changedIdentity of [
      identity({ runId: 'run_2' }),
      identity({ scenarioId: 'scenario_2' }),
      identity({ turnIndex: 1 }),
      identity({ leaseFence: '8' }),
      identity({ payloadDigest: '2'.repeat(64) }),
    ])
      await expect(
        repo.reserveAndStartProcessing({
          identity: changedIdentity,
          stableKeys: stableKeys('changed'),
          now: '2026-07-20T10:01:00.000Z',
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

    await expect(
      repo.reserveAndStartProcessing({
        identity: identity(),
        stableKeys: stableKeys('later'),
        now: '2026-07-20T10:02:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      receipt: { ...identity(), ...stableKeys(), state: 'processing' },
    });
  });

  it('persists llm_in_flight before provider authority and safety-stops recovery once', async () => {
    const { repo } = repository();
    await repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });

    await expect(
      repo.markLlmInFlight({ identity: identity(), now: '2026-07-20T10:01:00.000Z' })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      receipt: { state: 'llm_in_flight', failureCode: null },
    });
    await expect(
      repo.markLlmInFlight({ identity: identity(), now: '2026-07-20T10:01:01.000Z' })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      receipt: { state: 'llm_in_flight' },
    });
    await expect(
      repo.recoverAfterInterruption({
        identity: identity(),
        now: '2026-07-20T10:02:00.000Z',
        reason: 'execution_failed',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'failed_ambiguous',
      receipt: { state: 'failed', failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT' },
    });
    await expect(
      repo.recoverAfterInterruption({
        identity: identity(),
        now: '2026-07-20T10:03:00.000Z',
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'terminal',
      receipt: { state: 'failed', failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT' },
    });
  });

  it('refuses to terminalize a fresh llm_in_flight receipt from redelivery recovery', async () => {
    const { repo } = repository();
    await repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });
    await repo.markLlmInFlight({ identity: identity(), now: '2026-07-20T10:01:00.000Z' });

    await expect(
      repo.recoverAfterInterruption({
        identity: identity(),
        now: '2026-07-20T10:02:00.000Z',
        reason: 'redelivery',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });

    await expect(
      repo.reserveAndStartProcessing({
        identity: identity(),
        stableKeys: stableKeys(),
        now: '2026-07-20T10:02:01.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      receipt: { state: 'llm_in_flight', failureCode: null },
    });
  });

  it('resumes only idempotent processing work and leaves the receipt unchanged', async () => {
    const { repo } = repository();
    await repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });

    await expect(
      repo.recoverAfterInterruption({
        identity: identity(),
        now: '2026-07-20T10:05:00.000Z',
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'resume_processing',
      receipt: { state: 'processing', updatedAt: now },
    });
  });

  it('retains first-wins failed and completed terminal states across exact and opposite replays', async () => {
    const failed = repository().repo;
    await failed.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });
    await expect(
      failed.fail({
        identity: identity(),
        failureCode: 'MATRIX_CORPUS_NOT_READY',
        now: '2026-07-20T10:01:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      receipt: { state: 'failed', failureCode: 'MATRIX_CORPUS_NOT_READY' },
    });
    await expect(
      failed.fail({
        identity: identity(),
        failureCode: 'MATRIX_CORPUS_NOT_READY',
        now: '2026-07-20T10:02:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });
    await expect(
      failed.fail({
        identity: identity(),
        failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT',
        now: '2026-07-20T10:03:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'TERMINAL_CONFLICT' });
    await expect(
      failed.complete({ identity: identity(), now: '2026-07-20T10:04:00.000Z' })
    ).resolves.toEqual({ ok: false, code: 'TERMINAL_CONFLICT' });

    const completed = repository().repo;
    await completed.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await completed.markLlmInFlight({
      identity: identity(),
      now: '2026-07-20T10:01:00.000Z',
    });
    await completed.beginReplyCompletion({
      identity: identity(),
      expectedReplyDigests: ['2'.repeat(64)],
      now: '2026-07-20T10:01:00.000Z',
    });
    await completed.reserveReplyPublication({
      identity: identity(),
      replyIndex: 0,
      replyDigest: '2'.repeat(64),
      idempotencyKeyDigest: '3'.repeat(64),
      now: '2026-07-20T10:01:00.000Z',
    });
    await completed.acceptReplyPublication({
      identity: identity(),
      replyIndex: 0,
      replyDigest: '2'.repeat(64),
      idempotencyKeyDigest: '3'.repeat(64),
      publicationReceiptDigest: '4'.repeat(64),
      now: '2026-07-20T10:01:00.000Z',
    });
    await expect(
      completed.complete({ identity: identity(), now: '2026-07-20T10:02:00.000Z' })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      receipt: { state: 'completed', failureCode: null },
    });
    await expect(
      completed.complete({ identity: identity(), now: '2026-07-20T10:03:00.000Z' })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });
    await expect(
      completed.fail({
        identity: identity(),
        failureCode: 'MATRIX_CORPUS_NOT_READY',
        now: '2026-07-20T10:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'TERMINAL_CONFLICT' });
  });

  it('rejects missing changed-identity and invalid-state transitions without writes', async () => {
    const { repo } = repository();
    await expect(repo.markLlmInFlight({ identity: identity(), now })).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    await repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });

    type OperationResult = MatrixCorpusReceiptMutationResult | MatrixCorpusReceiptRecoveryResult;
    const operations: readonly (() => Promise<OperationResult>)[] = [
      (): ReturnType<typeof repo.markLlmInFlight> =>
        repo.markLlmInFlight({ identity: identity({ leaseFence: '8' }), now }),
      (): ReturnType<typeof repo.recoverAfterInterruption> =>
        repo.recoverAfterInterruption({
          identity: identity({ runId: 'run_2' }),
          now,
          reason: 'redelivery',
        }),
      (): ReturnType<typeof repo.fail> =>
        repo.fail({
          identity: identity({ payloadDigest: '2'.repeat(64) }),
          failureCode: 'MATRIX_CORPUS_NOT_READY' as const,
          now,
        }),
      (): ReturnType<typeof repo.complete> =>
        repo.complete({ identity: identity({ scenarioId: 'scenario_2' }), now }),
    ];
    for (const operation of operations)
      await expect(operation()).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });

    await expect(repo.complete({ identity: identity(), now })).resolves.toEqual({
      ok: false,
      code: 'INVALID_STATE',
    });
  });

  it('fails closed for semantically corrupt state and failure-code pairs', async () => {
    for (const corruptTerminal of [
      { state: 'completed', failureCode: 'MATRIX_CORPUS_NOT_READY' },
      { state: 'failed', failureCode: null },
      { state: 'processing', failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT' },
    ]) {
      const { firestore, repo } = repository();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
        .doc('receipt_1')
        .set({
          version: 1,
          ...identity(),
          ...stableKeys(),
          ...corruptTerminal,
          publication: openPublication(),
          createdAt: now,
          updatedAt: now,
        });

      await expect(
        repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECEIPT' });
      const stored = await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
        .doc('receipt_1')
        .get();
      expect(stored.data()).toMatchObject(corruptTerminal);
    }
  });

  it('persists the reply publication CAS and closes completion only after provider receipt', async () => {
    const { repo } = repository();
    await repo.reserveAndStartProcessing({ identity: identity(), stableKeys: stableKeys(), now });
    await repo.markLlmInFlight({ identity: identity(), now });
    const replyDigest = '2'.repeat(64);
    const idempotencyKeyDigest = '3'.repeat(64);
    const publicationReceiptDigest = '4'.repeat(64);

    await expect(
      repo.beginReplyCompletion({
        identity: identity(),
        expectedReplyDigests: [replyDigest],
        now,
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      receipt: { publication: { phase: 'completing', expectedReplyDigests: [replyDigest] } },
    });
    await expect(
      repo.reserveReplyPublication({
        identity: identity(),
        replyIndex: 0,
        replyDigest,
        idempotencyKeyDigest,
        now,
      })
    ).resolves.toMatchObject({
      ok: true,
      receipt: { publication: { replies: [{ state: 'reserved', replyIndex: 0 }] } },
    });
    await expect(
      repo.acceptReplyPublication({
        identity: identity(),
        replyIndex: 0,
        replyDigest,
        idempotencyKeyDigest,
        publicationReceiptDigest,
        now,
      })
    ).resolves.toMatchObject({
      ok: true,
      receipt: {
        publication: {
          replies: [{ state: 'accepted', publicationReceiptDigest }],
        },
      },
    });
    await expect(repo.complete({ identity: identity(), now })).resolves.toMatchObject({
      ok: true,
      receipt: {
        state: 'completed',
        publication: {
          phase: 'closed',
          terminal: {
            kind: 'completed',
            replyCount: 1,
            replyDigests: [replyDigest],
            publicationReceiptDigests: [publicationReceiptDigest],
          },
        },
      },
    });
  });

  it('recovers fully accepted publication without republishing and fails reserved ambiguity', async () => {
    const accepted = repository().repo;
    await accepted.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await accepted.markLlmInFlight({ identity: identity(), now });
    await accepted.beginReplyCompletion({
      identity: identity(),
      expectedReplyDigests: ['2'.repeat(64)],
      now,
    });
    await accepted.reserveReplyPublication({
      identity: identity(),
      replyIndex: 0,
      replyDigest: '2'.repeat(64),
      idempotencyKeyDigest: '3'.repeat(64),
      now,
    });
    await accepted.acceptReplyPublication({
      identity: identity(),
      replyIndex: 0,
      replyDigest: '2'.repeat(64),
      idempotencyKeyDigest: '3'.repeat(64),
      publicationReceiptDigest: '4'.repeat(64),
      now,
    });
    await expect(
      accepted.recoverAfterInterruption({
        identity: identity(),
        now,
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'completed_recovered',
      receipt: { state: 'completed', publication: { terminal: { kind: 'completed' } } },
    });

    const ambiguous = repository().repo;
    await ambiguous.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await ambiguous.markLlmInFlight({ identity: identity(), now });
    await ambiguous.beginReplyCompletion({
      identity: identity(),
      expectedReplyDigests: ['2'.repeat(64)],
      now,
    });
    await ambiguous.reserveReplyPublication({
      identity: identity(),
      replyIndex: 0,
      replyDigest: '2'.repeat(64),
      idempotencyKeyDigest: '3'.repeat(64),
      now,
    });
    await expect(
      ambiguous.recoverAfterInterruption({
        identity: identity(),
        now,
        reason: 'execution_failed',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'failed_ambiguous',
      receipt: {
        state: 'failed',
        failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT',
        publication: {
          phase: 'closed',
          terminal: { kind: 'failed', code: 'AMBIGUOUS_EXTERNAL_EFFECT' },
        },
      },
    });
  });

  it('rejects invalid receipt-state and publication transitions without partial writes', async () => {
    const processing = repository().repo;
    await processing.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await expect(
      processing.beginReplyCompletion({
        identity: identity(),
        expectedReplyDigests: ['2'.repeat(64)],
        now,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });

    await processing.markLlmInFlight({ identity: identity(), now });
    await expect(processing.complete({ identity: identity(), now })).resolves.toEqual({
      ok: false,
      code: 'INVALID_STATE',
    });
    await expect(
      processing.beginReplyCompletion({
        identity: identity(),
        expectedReplyDigests: ['invalid'],
        now,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });

    const expectedReplyDigests = ['2'.repeat(64)];
    await expect(
      processing.beginReplyCompletion({ identity: identity(), expectedReplyDigests, now })
    ).resolves.toMatchObject({ ok: true, disposition: 'applied' });
    await expect(
      processing.beginReplyCompletion({
        identity: identity(),
        expectedReplyDigests,
        now: '2026-07-20T10:01:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });

    await processing.fail({
      identity: identity(),
      failureCode: 'MATRIX_CORPUS_EXECUTION_REJECTED',
      now,
    });
    await expect(processing.markLlmInFlight({ identity: identity(), now })).resolves.toEqual({
      ok: false,
      code: 'INVALID_STATE',
    });

    const publicationFailure = repository().repo;
    await publicationFailure.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await publicationFailure.fail({
      identity: identity(),
      failureCode: 'MATRIX_CORPUS_PREPARATION_REJECTED',
      now,
    });

    const ambiguousFailure = repository().repo;
    await ambiguousFailure.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await ambiguousFailure.fail({
      identity: identity(),
      failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT',
      now,
    });

    const invalidClock = repository().repo;
    await invalidClock.reserveAndStartProcessing({
      identity: identity(),
      stableKeys: stableKeys(),
      now,
    });
    await invalidClock.markLlmInFlight({ identity: identity(), now });
    await expect(
      invalidClock.recoverAfterInterruption({
        identity: identity(),
        now: 'invalid',
        reason: 'execution_failed',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });
    await expect(
      invalidClock.fail({
        identity: identity(),
        failureCode: 'MATRIX_CORPUS_EXECUTION_REJECTED',
        now: 'invalid',
      })
    ).resolves.toMatchObject({
      ok: true,
      receipt: { publication: { phase: 'open' } },
    });
  });

  it('maps malformed Firestore receipt shapes to a closed corruption result', async () => {
    for (const corrupt of [
      'not-an-object',
      null,
      [],
      {
        version: 1,
        ...identity(),
        ...stableKeys(),
        state: 'processing',
        failureCode: null,
        publication: openPublication(),
        createdAt: now,
        updatedAt: now,
        extra: true,
      },
    ]) {
      const { firestore, repo } = repository();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
        .doc('receipt_1')
        .set(corrupt as never);

      await expect(repo.markLlmInFlight({ identity: identity(), now })).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECEIPT',
      });
    }
  });
});
