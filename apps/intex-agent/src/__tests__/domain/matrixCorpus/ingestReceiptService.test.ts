import { createHash } from 'node:crypto';

import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  canonicalMatrixCorpusIngestPayloadV1,
  type MatrixCorpusAttestationClaimsV1,
  type MatrixCorpusAttestedIngestPayloadV1,
} from '@intexuraos/http-contracts';

import { createMatrixCorpusIngestReceiptService } from '../../../domain/matrixCorpus/ingestReceiptService.js';
import type { MatrixCorpusExecutionService } from '../../../domain/matrixCorpus/matrixCorpusExecutionService.js';
import type { MatrixCorpusMessageHandler } from '../../../domain/matrixCorpus/matrixCorpusMessageHandler.js';
import type {
  MatrixCorpusIngestReceiptIdentity,
  MatrixCorpusIngestStableKeys,
} from '../../../domain/matrixCorpus/ports/ingestReceiptRepository.js';
import {
  FirestoreIngestReceiptRepository,
  INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION,
} from '../../../infra/firestore/ingestReceiptRepository.js';

const issuedAt = '2026-07-20T10:00:00.000Z';

type IngestClaims = Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function payload(
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusAttestedIngestPayloadV1 {
  return {
    version: 1,
    kind: 'matrix_corpus_ingest_payload',
    ordinaryIngest: {
      type: 'intex.message.ingest',
      userId: 'private_user_fixture',
      messageId: 'private_message_fixture',
      text: 'private natural-text fixture',
      sourceType: 'whatsapp_text',
      timestamp: issuedAt,
    },
    context: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'home-dev',
      leaseFence: '7',
      ingestReceiptId: 'receipt_1',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario one',
      turnIndex: 0,
      phase: 'start',
      startNewSession: true,
      promptNormalizationVersion: 1,
      promptDigest: '1'.repeat(64),
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: {
        version: 1,
        calls: [],
        forbiddenSelections: [],
        unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
      },
      mockProfileDigest: '2'.repeat(64),
      expectedToolSchedule: [],
      currentDateTime: issuedAt,
      timeZone: 'Europe/Warsaw',
      ...overrides,
    },
  };
}

function claims(payloadValue = payload()): IngestClaims {
  return {
    version: 1,
    kind: 'matrix_corpus_ingest',
    issuer: 'whatsapp-service',
    audience: 'intex-agent',
    runtimeAudience: 'home-dev',
    keyVersion: 'key_v1',
    eventId: payloadValue.context.ingestReceiptId,
    leaseFence: payloadValue.context.leaseFence,
    payloadDigest: sha256(canonicalMatrixCorpusIngestPayloadV1(payloadValue)),
    issuedAt,
    expiresAt: '2026-07-20T10:05:00.000Z',
    payload: payloadValue,
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

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred Vitest mocks remain directly assertable
function fixture(options: Readonly<{ withExecution?: boolean; operationTime?: string }> = {}) {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const repository = new FirestoreIngestReceiptRepository({ firestore });
  const generateStableKeys = vi.fn(() => stableKeys());
  const messageHandler = {
    prepareVerifiedIngest: vi.fn<MatrixCorpusMessageHandler['prepareVerifiedIngest']>(async () => ({
      ok: true,
      disposition: 'applied',
      sessionId: 'session_a',
      eventSequence: 1,
    })),
  };
  const executionService = {
    executeVerifiedIngest: vi.fn<MatrixCorpusExecutionService['executeVerifiedIngest']>(
      async (input) => {
        const identity = receiptIdentity(input.claims);
        await repository.beginReplyCompletion({
          identity,
          expectedReplyDigests: ['3'.repeat(64)],
          now: issuedAt,
        });
        await repository.reserveReplyPublication({
          identity,
          replyIndex: 0,
          replyDigest: '3'.repeat(64),
          idempotencyKeyDigest: '4'.repeat(64),
          now: issuedAt,
        });
        await repository.acceptReplyPublication({
          identity,
          replyIndex: 0,
          replyDigest: '3'.repeat(64),
          idempotencyKeyDigest: '4'.repeat(64),
          publicationReceiptDigest: '5'.repeat(64),
          now: issuedAt,
        });
        return { ok: true as const };
      }
    ),
    recoverVerifiedIngest: vi.fn(async (input: { claims: IngestClaims }) => {
      const identity = receiptIdentity(input.claims);
      await repository.acceptReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        publicationReceiptDigest: '5'.repeat(64),
        now: options.operationTime ?? issuedAt,
      });
      return { ok: true as const };
    }),
  };
  const terminalRecorder = {
    recordTerminal: vi.fn(async () => ({ ok: true as const, disposition: 'applied' as const })),
  };
  const service = createMatrixCorpusIngestReceiptService({
    repository,
    terminalRecorder,
    generateStableKeys,
    messageHandler,
    ...(options.withExecution === true ? { executionService } : {}),
    now: () => options.operationTime ?? issuedAt,
  });
  return {
    firestore,
    repository,
    generateStableKeys,
    messageHandler,
    executionService,
    terminalRecorder,
    service,
  };
}

describe('Matrix corpus ingest receipt service', () => {
  it('completes a prepared ingest through the composed strict execution service', async () => {
    const { firestore, executionService, service } = fixture({ withExecution: true });

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: true,
      state: 'completed',
      correlationCount: 1,
    });
    expect(executionService.executeVerifiedIngest).toHaveBeenCalledWith({
      claims: claims(),
      stableKeys: stableKeys(),
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc('receipt_1')
      .get();
    expect(stored.data()).toMatchObject({ state: 'completed', failureCode: null });
  });

  it('terminalizes a closed execution rejection and safety-stops an ambiguous throw', async () => {
    const rejectedFixture = fixture({ withExecution: true });
    rejectedFixture.executionService.executeVerifiedIngest.mockResolvedValue({
      ok: false,
      code: 'PROFILE_REJECTED',
    });
    await expect(rejectedFixture.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
    await expect(
      rejectedFixture.repository.recoverAfterInterruption({
        identity: receiptIdentity(claims()),
        now: issuedAt,
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      receipt: { state: 'failed', failureCode: 'MATRIX_CORPUS_EXECUTION_REJECTED' },
    });

    const ambiguousFixture = fixture({ withExecution: true });
    ambiguousFixture.executionService.executeVerifiedIngest.mockRejectedValue(
      new Error('private provider or publisher error')
    );
    await expect(ambiguousFixture.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
    await expect(
      ambiguousFixture.repository.recoverAfterInterruption({
        identity: receiptIdentity(claims()),
        now: issuedAt,
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      receipt: { state: 'failed', failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT' },
    });
  });

  it('recovers a reply reserved by the original execution before handling its throw', async () => {
    const { repository, executionService, service } = fixture({ withExecution: true });
    executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      throw new Error('private crash after publication reservation');
    });

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: true,
      state: 'duplicate',
      correlationCount: 1,
    });
    expect(executionService.recoverVerifiedIngest).toHaveBeenCalledOnce();
  });

  it('keeps an ambiguously published reserved reply retryable instead of closing the turn', async () => {
    const { repository, executionService, service } = fixture({ withExecution: true });
    executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      return { ok: false, code: 'REPLY_PUBLICATION_REJECTED' };
    });

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
    await expect(
      repository.reserveAndStartProcessing({
        identity: receiptIdentity(claims()),
        stableKeys: stableKeys(),
        now: issuedAt,
      })
    ).resolves.toMatchObject({ ok: true, receipt: { state: 'llm_in_flight' } });
  });

  it('keeps a reserved reply retryable when exact recovery is also ambiguous', async () => {
    const { repository, executionService, service } = fixture({ withExecution: true });
    executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      throw new Error('private crash after uncertain publication');
    });
    executionService.recoverVerifiedIngest.mockRejectedValueOnce(
      new Error('private retry publication ambiguity')
    );

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
    await expect(
      repository.reserveAndStartProcessing({
        identity: receiptIdentity(claims()),
        stableKeys: stableKeys(),
        now: issuedAt,
      })
    ).resolves.toMatchObject({ ok: true, receipt: { state: 'llm_in_flight' } });
  });

  it('terminalizes every new verified ingest as not-ready before any product execution seam', async () => {
    const { firestore, generateStableKeys, messageHandler, service } = fixture();

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: true,
      state: 'not_ready',
      correlationCount: 1,
    });
    expect(generateStableKeys).toHaveBeenCalledTimes(1);
    expect(messageHandler.prepareVerifiedIngest).toHaveBeenCalledWith({
      claims: claims(),
      stableKeys: stableKeys(),
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc('receipt_1')
      .get();
    expect(stored.data()).toMatchObject({
      ...stableKeys(),
      state: 'failed',
      failureCode: 'MATRIX_CORPUS_NOT_READY',
    });
    for (const forbiddenField of ['userId', 'text', 'payload', 'attestation', 'providerError'])
      expect(stored.data()).not.toHaveProperty(forbiddenField);
  });

  it('terminally rejects a context/session-lane preparation failure', async () => {
    const { firestore, messageHandler, service } = fixture();
    messageHandler.prepareVerifiedIngest.mockResolvedValue({
      ok: false,
      code: 'SESSION_REJECTED',
    });

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc('receipt_1')
      .get();
    expect(stored.data()).toMatchObject({
      state: 'failed',
      failureCode: 'MATRIX_CORPUS_PREPARATION_REJECTED',
    });
  });

  it('returns a safe duplicate while retaining the original stable keys', async () => {
    const { firestore, generateStableKeys, service } = fixture();
    await service.acceptVerifiedIngest(claims());
    generateStableKeys.mockReturnValue(stableKeys('changed'));

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: true,
      state: 'duplicate',
      correlationCount: 1,
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc('receipt_1')
      .get();
    expect(stored.data()).toMatchObject(stableKeys());
  });

  it('rejects a non-ingest claim or canonical payload mismatch before receipt reservation', async () => {
    const { firestore, generateStableKeys, service } = fixture();
    const changedDigest = { ...claims(), payloadDigest: 'f'.repeat(64) };
    const terminalClaim = {
      ...claims(),
      kind: 'matrix_corpus_terminal_control',
    };

    await expect(service.acceptVerifiedIngest(changedDigest)).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });
    await expect(service.acceptVerifiedIngest(terminalClaim)).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });
    expect(generateStableKeys).not.toHaveBeenCalled();
    await expect(
      firestore.collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION).get()
    ).resolves.toMatchObject({ empty: true });
  });

  it('rejects changed correlated replay without changing the first terminal receipt', async () => {
    const { firestore, service } = fixture();
    await service.acceptVerifiedIngest(claims());
    const changedPayload = payload({ runId: 'run_2' });

    await expect(service.acceptVerifiedIngest(claims(changedPayload))).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc('receipt_1')
      .get();
    expect(stored.data()).toMatchObject({ runId: 'run_1', state: 'failed' });
  });

  it('keeps a fresh provider-in-flight duplicate retryable without terminalizing it', async () => {
    const { firestore, repository, service } = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:02:00.000Z',
    });
    const verified = claims();
    const identity = {
      ingestReceiptId: verified.eventId,
      runId: verified.payload.context.runId,
      scenarioId: verified.payload.context.scenarioId,
      turnIndex: verified.payload.context.turnIndex,
      leaseFence: verified.leaseFence,
      payloadDigest: verified.payloadDigest,
    };
    await repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await repository.markLlmInFlight({ identity, now: '2026-07-20T10:01:00.000Z' });

    await expect(service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc(identity.ingestReceiptId)
      .get();
    expect(stored.data()).toMatchObject({ state: 'llm_in_flight', failureCode: null });
  });

  it('grants one execution owner when exact ingests race', async () => {
    const { service, executionService } = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:02:00.000Z',
    });
    const verified = claims();

    const results = await Promise.all([
      service.acceptVerifiedIngest(verified),
      service.acceptVerifiedIngest(verified),
    ]);

    expect(executionService.executeVerifiedIngest).toHaveBeenCalledTimes(1);
    expect(results).toContainEqual({ accepted: true, state: 'completed', correlationCount: 1 });
    expect(results).toContainEqual({ accepted: false, state: 'retry', correlationCount: 1 });
  });

  it('fails a stale provider-in-flight receipt only after the recovery deadline', async () => {
    const { repository, service } = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await repository.markLlmInFlight({ identity, now: '2026-07-20T10:01:00.000Z' });

    await expect(service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
    await expect(
      repository.recoverAfterInterruption({
        identity,
        now: '2026-07-20T10:18:00.000Z',
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'terminal',
      receipt: { state: 'failed', failureCode: 'AMBIGUOUS_EXTERNAL_EFFECT' },
    });
  });

  it('does not race a fresh reserved reply publisher from a duplicate ingest', async () => {
    const { repository, executionService, service } = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:02:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await repository.markLlmInFlight({ identity, now: '2026-07-20T10:01:00.000Z' });
    await repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: '2026-07-20T10:01:30.000Z',
    });
    await repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: '2026-07-20T10:01:30.000Z',
    });

    await expect(service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
    expect(executionService.recoverVerifiedIngest).not.toHaveBeenCalled();
  });

  it('recovers a stale reserved reply through the exact stable publication', async () => {
    const { repository, executionService, service } = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await repository.markLlmInFlight({ identity, now: '2026-07-20T10:01:00.000Z' });
    await repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: '2026-07-20T10:01:30.000Z',
    });
    await repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: '2026-07-20T10:01:30.000Z',
    });

    await expect(service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: true,
      state: 'duplicate',
      correlationCount: 1,
    });
    expect(executionService.recoverVerifiedIngest).toHaveBeenCalledWith({
      claims: verified,
      receipt: expect.objectContaining({ state: 'llm_in_flight' }),
      stableKeys: stableKeys(),
    });
    await expect(
      repository.recoverAfterInterruption({
        identity,
        now: '2026-07-20T10:18:00.000Z',
        reason: 'redelivery',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'terminal',
      receipt: { state: 'completed', failureCode: null },
    });
  });

  it('keeps terminal replays retryable when terminal evidence cannot be recorded', async () => {
    const completed = fixture({ withExecution: true });
    await completed.service.acceptVerifiedIngest(claims());
    completed.terminalRecorder.recordTerminal.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_REJECTED',
    } as never);
    await expect(completed.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });

    const failed = fixture();
    await failed.service.acceptVerifiedIngest(claims());
    failed.terminalRecorder.recordTerminal.mockRejectedValueOnce(
      new Error('private terminal recorder failure')
    );
    await expect(failed.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('accepts a completed receipt replay after terminal evidence is durable', async () => {
    const current = fixture({ withExecution: true });
    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toMatchObject({
      accepted: true,
      state: 'completed',
    });

    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: true,
      state: 'duplicate',
      correlationCount: 1,
    });
  });

  it('rejects an already terminal non-readiness failure as a correlated duplicate', async () => {
    const current = fixture({ withExecution: true });
    current.executionService.executeVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'PROFILE_REJECTED',
    });
    await current.service.acceptVerifiedIngest(claims());

    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
  });

  it('reports repository transition failures without claiming a new terminal correlation', async () => {
    const preparation = fixture();
    preparation.messageHandler.prepareVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'SESSION_REJECTED',
    });
    vi.spyOn(preparation.repository, 'fail').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(preparation.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });

    const unavailable = fixture();
    vi.spyOn(unavailable.repository, 'fail').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(unavailable.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
  });

  it('fails closed when execution ownership cannot be acquired or was already acquired', async () => {
    const rejectedOwner = fixture({ withExecution: true });
    vi.spyOn(rejectedOwner.repository, 'markLlmInFlight').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(rejectedOwner.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });

    const duplicateOwner = fixture({ withExecution: true });
    vi.spyOn(duplicateOwner.repository, 'markLlmInFlight').mockResolvedValueOnce({
      ok: true,
      disposition: 'already_applied',
      receipt: {} as never,
    });
    await expect(duplicateOwner.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('keeps successful execution retryable until completion and terminal evidence are durable', async () => {
    const completion = fixture({ withExecution: true });
    vi.spyOn(completion.repository, 'complete').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(completion.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });

    const evidence = fixture({ withExecution: true });
    evidence.terminalRecorder.recordTerminal.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_REJECTED',
    } as never);
    await expect(evidence.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('does not claim a terminal correlation when execution rejection cannot be persisted', async () => {
    const current = fixture({ withExecution: true });
    current.executionService.executeVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'PROFILE_REJECTED',
    });
    vi.spyOn(current.repository, 'fail').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });

    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });
  });

  it('handles all stale reserved-publication recovery outcomes without double execution', async () => {
    const recoveredButUncommitted = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await recoveredButUncommitted.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await recoveredButUncommitted.repository.markLlmInFlight({ identity, now: issuedAt });
    await recoveredButUncommitted.repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: issuedAt,
    });
    await recoveredButUncommitted.repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: issuedAt,
    });
    vi.spyOn(recoveredButUncommitted.repository, 'complete').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(recoveredButUncommitted.service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });

    const rejectedPublication = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    await rejectedPublication.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await rejectedPublication.repository.markLlmInFlight({ identity, now: issuedAt });
    await rejectedPublication.repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: issuedAt,
    });
    await rejectedPublication.repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: issuedAt,
    });
    rejectedPublication.executionService.recoverVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'REPLY_PUBLICATION_REJECTED',
    } as never);
    await expect(rejectedPublication.service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('keeps stale publication recovery retryable until its terminal evidence is durable', async () => {
    const current = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await current.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await current.repository.markLlmInFlight({ identity, now: issuedAt });
    await current.repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: issuedAt,
    });
    await current.repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: issuedAt,
    });
    current.terminalRecorder.recordTerminal.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_REJECTED',
    } as never);

    await expect(current.service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('falls back from a stale publication correlation rejection to terminal recovery', async () => {
    const current = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await current.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await current.repository.markLlmInFlight({ identity, now: issuedAt });
    await current.repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: issuedAt,
    });
    await current.repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: issuedAt,
    });
    current.executionService.recoverVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATION_REJECTED',
    } as never);

    await expect(current.service.acceptVerifiedIngest(verified)).resolves.toMatchObject({
      accepted: false,
      correlationCount: 1,
    });
  });

  it('does not claim correlation when stale terminal recovery cannot mutate the receipt', async () => {
    const current = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:17:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await current.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await current.repository.markLlmInFlight({ identity, now: issuedAt });
    vi.spyOn(current.repository, 'recoverAfterInterruption').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });

    await expect(current.service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });
  });

  it('recovers a fully published in-flight receipt before the staleness deadline', async () => {
    const current = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:02:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await current.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await current.repository.markLlmInFlight({ identity, now: issuedAt });
    await current.repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: issuedAt,
    });
    await current.repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: issuedAt,
    });
    await current.repository.acceptReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      publicationReceiptDigest: '5'.repeat(64),
      now: issuedAt,
    });

    await expect(current.service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: true,
      state: 'duplicate',
      correlationCount: 1,
    });
    expect(current.executionService.executeVerifiedIngest).not.toHaveBeenCalled();
  });

  it('keeps a recovered published reply retryable until terminal evidence is recorded', async () => {
    const current = fixture({
      withExecution: true,
      operationTime: '2026-07-20T10:02:00.000Z',
    });
    const verified = claims();
    const identity = receiptIdentity(verified);
    await current.repository.reserveAndStartProcessing({
      identity,
      stableKeys: stableKeys(),
      now: issuedAt,
    });
    await current.repository.markLlmInFlight({ identity, now: issuedAt });
    await current.repository.beginReplyCompletion({
      identity,
      expectedReplyDigests: ['3'.repeat(64)],
      now: issuedAt,
    });
    await current.repository.reserveReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      now: issuedAt,
    });
    await current.repository.acceptReplyPublication({
      identity,
      replyIndex: 0,
      replyDigest: '3'.repeat(64),
      idempotencyKeyDigest: '4'.repeat(64),
      publicationReceiptDigest: '5'.repeat(64),
      now: issuedAt,
    });
    current.terminalRecorder.recordTerminal.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_REJECTED',
    } as never);

    await expect(current.service.acceptVerifiedIngest(verified)).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
  });

  it('supports a composed execution service without an optional preparation handler', async () => {
    const current = fixture({ withExecution: true });
    const service = createMatrixCorpusIngestReceiptService({
      repository: current.repository,
      terminalRecorder: current.terminalRecorder,
      generateStableKeys: current.generateStableKeys,
      executionService: current.executionService,
      now: () => issuedAt,
    });

    await expect(service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: true,
      state: 'completed',
      correlationCount: 1,
    });
    expect(current.messageHandler.prepareVerifiedIngest).not.toHaveBeenCalled();
  });

  it('keeps execution-throw recovery retryable when completion or terminal evidence fails', async () => {
    const completion = fixture({ withExecution: true });
    completion.executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await completion.repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await completion.repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      throw new Error('private crash');
    });
    vi.spyOn(completion.repository, 'complete').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(completion.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });

    const evidence = fixture({ withExecution: true });
    evidence.executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await evidence.repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await evidence.repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      throw new Error('private crash');
    });
    evidence.terminalRecorder.recordTerminal.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_REJECTED',
    } as never);
    await expect(evidence.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('falls back to interruption recovery after a closed reserved-publication rejection', async () => {
    const current = fixture({ withExecution: true });
    current.executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await current.repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await current.repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      throw new Error('private crash');
    });
    current.executionService.recoverVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATION_REJECTED',
    } as never);

    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
  });

  it('keeps an execution-throw publication rejection retryable', async () => {
    const current = fixture({ withExecution: true });
    current.executionService.executeVerifiedIngest.mockImplementationOnce(async (input) => {
      const identity = receiptIdentity(input.claims);
      await current.repository.beginReplyCompletion({
        identity,
        expectedReplyDigests: ['3'.repeat(64)],
        now: issuedAt,
      });
      await current.repository.reserveReplyPublication({
        identity,
        replyIndex: 0,
        replyDigest: '3'.repeat(64),
        idempotencyKeyDigest: '4'.repeat(64),
        now: issuedAt,
      });
      throw new Error('private crash');
    });
    current.executionService.recoverVerifiedIngest.mockResolvedValueOnce({
      ok: false,
      code: 'REPLY_PUBLICATION_REJECTED',
    } as never);

    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it('does not claim correlation when interruption recovery itself rejects', async () => {
    const current = fixture({ withExecution: true });
    current.executionService.executeVerifiedIngest.mockRejectedValueOnce(new Error('private crash'));
    vi.spyOn(current.repository, 'recoverAfterInterruption').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });

    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 0,
    });
  });

  it('rejects a not-ready terminal when evidence recording fails', async () => {
    const current = fixture();
    current.terminalRecorder.recordTerminal.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_REJECTED',
    } as never);
    await expect(current.service.acceptVerifiedIngest(claims())).resolves.toEqual({
      accepted: false,
      state: 'rejected',
      correlationCount: 1,
    });
  });
});

function receiptIdentity(input: IngestClaims): MatrixCorpusIngestReceiptIdentity {
  return {
    ingestReceiptId: input.eventId,
    runId: input.payload.context.runId,
    scenarioId: input.payload.context.scenarioId,
    turnIndex: input.payload.context.turnIndex,
    leaseFence: input.leaseFence,
    payloadDigest: input.payloadDigest,
  };
}
