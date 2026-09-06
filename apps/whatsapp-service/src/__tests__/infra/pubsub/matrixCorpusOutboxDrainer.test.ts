/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import { createHash } from 'node:crypto';

import { err, ok } from '@intexuraos/common-core';
import { generateKeyPair } from 'jose';
import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusTerminalControlV1,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusTerminalControlV1,
} from '@intexuraos/http-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMatrixCorpusOutboxDrainer } from '../../../infra/pubsub/matrixCorpusOutboxDrainer.js';
import { signMatrixCorpusAttestation } from '../../../domain/matrixCorpus/attestation.js';
import { verifyMatrixCorpusAttestation as verifyWithIntexAgent } from '../../../../../intex-agent/src/domain/matrixCorpus/attestation.js';

const claimStartedAt = '2026-07-20T10:00:00.000Z';
const claimExpiresAt = '2026-07-20T10:01:00.000Z';
const attestationExpiresAt = '2026-07-20T10:05:00.000Z';
const publishedAt = '2026-07-20T10:00:01.000Z';
const leaseSlotDigest = 'a'.repeat(64);
const runFenceDigest = 'b'.repeat(64);
const ownerDigest = 'c'.repeat(64);
const publisherReceiptDigest = 'd'.repeat(64);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ingestPayload(): MatrixCorpusAttestedIngestPayloadV1 {
  return {
    version: 1,
    kind: 'matrix_corpus_ingest_payload',
    ordinaryIngest: {
      type: 'intex.message.ingest',
      userId: 'private_user_fixture',
      messageId: 'private_message_fixture',
      text: 'private natural-text fixture',
      sourceType: 'whatsapp_text',
      timestamp: claimStartedAt,
    },
    context: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
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
      currentDateTime: claimStartedAt,
      timeZone: 'Europe/Warsaw',
    },
  };
}

function terminalPayload(): MatrixCorpusTerminalControlV1 {
  return {
    version: 1,
    kind: 'abandoned',
    eventId: 'terminal_1',
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    createdAt: claimStartedAt,
    tombstoneDigest: null,
    terminalCandidateDigest: null,
    artifactStageDigest: null,
  };
}

function drainIdentity() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
  };
}

function ingestInput() {
  return {
    ...drainIdentity(),
    ingestOutboxId: 'outbox_1',
    payloadDigest: sha256(canonicalMatrixCorpusIngestPayloadV1(ingestPayload())),
  };
}

function terminalRecoveryInput() {
  return {
    ...ingestInput(),
    purpose: 'terminal_marker_recovery' as const,
    claimExpiresAt,
    publisherReceiptDigest,
    publishedAt,
  };
}

function terminalInput() {
  return {
    ...drainIdentity(),
    terminalControlId: 'terminal_1',
    eventId: 'terminal_1',
    payloadDigest: sha256(canonicalMatrixCorpusTerminalControlV1(terminalPayload())),
  };
}

function ingestClaim(
  code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' = 'OUTBOX_CLAIMED',
  expiresAt = claimExpiresAt
) {
  const projection = {
    outboxKind: 'ingest' as const,
    ingestOutboxId: 'outbox_1',
    runId: 'run_1',
    leaseFence: '7',
    ownerDigest,
    purpose: 'publish' as const,
    claimExpiresAt: expiresAt,
    payload: ingestPayload(),
    payloadDigest: ingestInput().payloadDigest,
  };
  return code === 'OUTBOX_CLAIMED'
    ? { code, ...projection }
    : { code, operation: 'claim_ingest' as const, ...projection };
}

function terminalRecoveryClaim() {
  return {
    ...ingestClaim(),
    purpose: 'terminal_marker_recovery' as const,
  };
}

function terminalClaim(
  code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' = 'OUTBOX_CLAIMED',
  expiresAt = claimExpiresAt
) {
  const projection = {
    outboxKind: 'terminal' as const,
    terminalControlId: 'terminal_1',
    eventId: 'terminal_1',
    runId: 'run_1',
    leaseFence: '7',
    ownerDigest,
    claimExpiresAt: expiresAt,
    payload: terminalPayload(),
    payloadDigest: terminalInput().payloadDigest,
  };
  return code === 'OUTBOX_CLAIMED'
    ? { code, ...projection }
    : { code, operation: 'claim_terminal' as const, ...projection };
}

function fixture() {
  let storedIngestEnvelope: unknown = null;
  let storedTerminalEnvelope: unknown = null;
  let ingestWindow: Readonly<{ issuedAt: string; expiresAt: string }> | null = null;
  let terminalWindow: Readonly<{ issuedAt: string; expiresAt: string }> | null = null;
  let ingestGeneration = 0;
  let terminalGeneration = 0;
  const claimPendingIngestOutbox = vi.fn().mockResolvedValue(ingestClaim());
  const renewIngestOutboxClaim = vi.fn();
  const acknowledgeIngestOutbox = vi.fn().mockImplementation(async (input) => ({
    code: 'OUTBOX_ACKNOWLEDGED',
    outboxKind: 'ingest',
    ingestOutboxId: input.ingestOutboxId,
    runId: input.runId,
    leaseFence: input.leaseFence,
    payloadDigest: input.payloadDigest,
    outcome: input.outcome,
    acknowledgedAt: input.outcome.publishedAt,
    drained: false,
  }));
  const claimPendingTerminalControlOutbox = vi.fn().mockResolvedValue(terminalClaim());
  const renewTerminalControlOutboxClaim = vi.fn();
  const acknowledgeTerminalControl = vi.fn().mockImplementation(async (input) => ({
    code: 'OUTBOX_ACKNOWLEDGED',
    outboxKind: 'terminal',
    requestTerminalControlId: input.requestTerminalControlId,
    requestEventId: input.requestEventId,
    runId: input.runId,
    leaseFence: input.leaseFence,
    requestPayloadDigest: input.requestPayloadDigest,
    authoritativeWinner: input.authoritativeWinner,
    leasePhase: input.authoritativeWinner.kind === 'release' ? 'released' : 'abandoned',
  }));
  const publishMatrixCorpusIngest = vi
    .fn()
    .mockResolvedValue(ok({ publisherReceiptDigest }));
  const postTerminalControl = vi.fn().mockResolvedValue({
    kind: 'acknowledged',
    runId: 'run_1',
    leaseFence: '7',
    requestEventId: 'terminal_1',
    requestPayloadDigest: terminalInput().payloadDigest,
    winner: {
      kind: 'abandoned',
      eventId: 'terminal_1',
      payloadDigest: terminalInput().payloadDigest,
      outcome: 'stopped_not_evaluated',
      acknowledgedAt: publishedAt,
    },
  });
  const getTurnTerminal = vi.fn().mockResolvedValue({
    kind: 'terminal',
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    scenarioId: 'scenario_1',
    turnIndex: 0,
    status: 'completed',
    terminalMarkerDigest: 'e'.repeat(64),
    recordedAt: publishedAt,
  });
  const sign = vi.fn().mockResolvedValue({ ok: true, attestation: 'e30.e30.AA' });
  const prepareIngest = vi.fn().mockImplementation(async (input) => {
    if (
      ingestWindow === null ||
      Date.parse(input.proposedIssuedAt) > Date.parse(ingestWindow.expiresAt) + 30_000
    ) {
      ingestGeneration += 1;
      ingestWindow = {
        issuedAt: input.proposedIssuedAt,
        expiresAt: input.proposedExpiresAt,
      };
      storedIngestEnvelope = null;
    }
    return storedIngestEnvelope === null
      ? { kind: 'reserved', generation: ingestGeneration, ...ingestWindow }
      : {
          kind: 'ready',
          generation: ingestGeneration,
          ...ingestWindow,
          envelope: storedIngestEnvelope,
        };
  });
  const completeIngest = vi.fn().mockImplementation(async (input) => {
    storedIngestEnvelope ??= input.envelope;
    return {
      kind: 'ready',
      generation: ingestGeneration,
      ...ingestWindow,
      envelope: storedIngestEnvelope,
    };
  });
  const prepareTerminal = vi.fn().mockImplementation(async (input) => {
    if (
      terminalWindow === null ||
      Date.parse(input.proposedIssuedAt) > Date.parse(terminalWindow.expiresAt) + 30_000
    ) {
      terminalGeneration += 1;
      terminalWindow = {
        issuedAt: input.proposedIssuedAt,
        expiresAt: input.proposedExpiresAt,
      };
      storedTerminalEnvelope = null;
    }
    return storedTerminalEnvelope === null
      ? { kind: 'reserved', generation: terminalGeneration, ...terminalWindow }
      : {
          kind: 'ready',
          generation: terminalGeneration,
          ...terminalWindow,
          envelope: storedTerminalEnvelope,
        };
  });
  const completeTerminal = vi.fn().mockImplementation(async (input) => {
    storedTerminalEnvelope ??= input.envelope;
    return {
      kind: 'ready',
      generation: terminalGeneration,
      ...terminalWindow,
      envelope: storedTerminalEnvelope,
    };
  });
  const now = vi.fn().mockReturnValueOnce(claimStartedAt).mockReturnValue(publishedAt);
  const drainer = createMatrixCorpusOutboxDrainer({
    repository: {
      claimPendingIngestOutbox,
      renewIngestOutboxClaim,
      acknowledgeIngestOutbox,
      claimPendingTerminalControlOutbox,
      renewTerminalControlOutboxClaim,
      acknowledgeTerminalControl,
    },
    publisher: { publishMatrixCorpusIngest },
    intexAgentClient: { getTurnTerminal, postTerminalControl },
    signedEnvelopeStore: {
      prepareIngest,
      completeIngest,
      prepareTerminal,
      completeTerminal,
    },
    sign,
    now,
  });
  return {
    acknowledgeIngestOutbox,
    acknowledgeTerminalControl,
    claimPendingIngestOutbox,
    claimPendingTerminalControlOutbox,
    drainer,
    getTurnTerminal,
    now,
    postTerminalControl,
    publishMatrixCorpusIngest,
    prepareIngest,
    prepareTerminal,
    renewIngestOutboxClaim,
    renewTerminalControlOutboxClaim,
    sign,
    completeIngest,
    completeTerminal,
  };
}

describe('MatrixCorpusOutboxDrainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims signs publishes and acknowledges one immutable ingest event', async () => {
    const current = fixture();

    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'delivered',
    });
    expect(current.claimPendingIngestOutbox).toHaveBeenCalledWith({
      ...ingestInput(),
      purpose: 'publish',
      now: claimStartedAt,
      claimExpiresAt,
    });
    expect(current.sign).toHaveBeenCalledWith({
      kind: 'matrix_corpus_ingest',
      eventId: 'receipt_1',
      leaseFence: '7',
      payloadDigest: ingestInput().payloadDigest,
      issuedAt: claimStartedAt,
      expiresAt: attestationExpiresAt,
      payload: ingestPayload(),
    });
    expect(current.publishMatrixCorpusIngest).toHaveBeenCalledWith({
      version: 1,
      kind: 'matrix_corpus_ingest',
      ingestReceiptId: 'receipt_1',
      leaseFence: '7',
      payloadDigest: ingestInput().payloadDigest,
      attestation: 'e30.e30.AA',
    });
    expect(current.completeIngest).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 1 })
    );
    expect(current.acknowledgeIngestOutbox).toHaveBeenCalledWith({
      ...drainIdentity(),
      ingestOutboxId: 'outbox_1',
      ingestReceiptId: 'receipt_1',
      payloadDigest: ingestInput().payloadDigest,
      claimPurpose: 'publish',
      expectedClaimExpiresAt: claimExpiresAt,
      now: publishedAt,
      outcome: {
        kind: 'publication_acknowledged',
        publisherReceiptDigest,
        publishedAt,
      },
    });
  });

  it('recovers one published ingest from the exact Intex terminal without republishing', async () => {
    const current = fixture();
    current.claimPendingIngestOutbox.mockResolvedValueOnce(terminalRecoveryClaim());

    await expect(current.drainer.drainIngest(terminalRecoveryInput())).resolves.toEqual({
      status: 'delivered',
    });

    expect(current.claimPendingIngestOutbox).toHaveBeenCalledWith({
      ...ingestInput(),
      purpose: 'terminal_marker_recovery',
      now: claimStartedAt,
      claimExpiresAt,
    });
    expect(current.getTurnTerminal).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      scenarioId: 'scenario_1',
      turnIndex: 0,
    });
    expect(current.publishMatrixCorpusIngest).not.toHaveBeenCalled();
    expect(current.sign).not.toHaveBeenCalled();
    expect(current.acknowledgeIngestOutbox).toHaveBeenCalledWith({
      ...drainIdentity(),
      ingestOutboxId: 'outbox_1',
      ingestReceiptId: 'receipt_1',
      payloadDigest: ingestInput().payloadDigest,
      claimPurpose: 'terminal_marker_recovery',
      expectedClaimExpiresAt: claimExpiresAt,
      now: publishedAt,
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest,
        publishedAt,
        terminalMarker: {
          kind: 'completed',
          digest: 'e'.repeat(64),
          recordedAt: publishedAt,
        },
        replyOrDeliveryWorkInFlight: 0,
      },
    });
  });

  it('leaves a claimed ingest pending on safe publish failure or throw', async () => {
    for (const failure of [
      () => Promise.resolve(err({ code: 'INTERNAL_ERROR' as const, message: 'private-error' })),
      () => Promise.reject(new Error('private-throw')),
    ]) {
      const current = fixture();
      current.publishMatrixCorpusIngest.mockImplementationOnce(failure);

      const result = await current.drainer.drainIngest(ingestInput());

      expect(result).toEqual({ status: 'retryable' });
      expect(JSON.stringify(result)).not.toMatch(/private-error|private-throw/);
      expect(current.acknowledgeIngestOutbox).not.toHaveBeenCalled();
    }
  });

  it('reuses the persisted byte-identical signed ingest after claim expiry and acknowledgement loss', async () => {
    const current = fixture();
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const reclaimedAt = '2026-07-20T10:01:01.000Z';
    const reclaimedDeliveryAt = '2026-07-20T10:01:02.000Z';
    const reclaimedExpiry = '2026-07-20T10:02:01.000Z';
    current.acknowledgeIngestOutbox.mockRejectedValueOnce(new Error('response lost'));
    current.claimPendingIngestOutbox
      .mockResolvedValueOnce(ingestClaim())
      .mockResolvedValueOnce(ingestClaim('ALREADY_APPLIED', reclaimedExpiry));
    current.sign.mockImplementation(async (input) =>
      await signMatrixCorpusAttestation(input, {
        keyVersion: 'key_v1',
        privateKey: trusted.privateKey,
      })
    );
    current.now
      .mockReset()
      .mockReturnValueOnce(claimStartedAt)
      .mockReturnValueOnce(publishedAt)
      .mockReturnValueOnce(publishedAt)
      .mockReturnValueOnce(reclaimedAt)
      .mockReturnValueOnce(reclaimedDeliveryAt)
      .mockReturnValue(reclaimedDeliveryAt);

    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'retryable',
    });
    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'delivered',
    });
    expect(current.publishMatrixCorpusIngest).toHaveBeenCalledTimes(2);
    expect(current.publishMatrixCorpusIngest.mock.calls[0]?.[0]).toEqual(
      current.publishMatrixCorpusIngest.mock.calls[1]?.[0]
    );
    expect(current.sign).toHaveBeenCalledTimes(1);
    expect(current.completeIngest).toHaveBeenCalledTimes(1);
    await expect(
      verifyWithIntexAgent(current.publishMatrixCorpusIngest.mock.calls[1]?.[0], {
        keyring: new Map([['key_v1', trusted.publicKey]]),
        now: () => reclaimedDeliveryAt,
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it('single-flights concurrent ingest materialization so only one signing operation runs', async () => {
    const current = fixture();
    current.now.mockReset().mockReturnValue(claimStartedAt);

    const results = await Promise.all([
      current.drainer.drainIngest(ingestInput()),
      current.drainer.drainIngest(ingestInput()),
    ]);

    expect(results).toEqual([{ status: 'delivered' }, { status: 'delivered' }]);
    expect(current.sign).toHaveBeenCalledTimes(1);
    expect(current.completeIngest).toHaveBeenCalledTimes(1);
    expect(current.publishMatrixCorpusIngest.mock.calls[0]?.[0]).toEqual(
      current.publishMatrixCorpusIngest.mock.calls[1]?.[0]
    );
  });

  it('re-materializes the same deterministic bytes from a durable window after crash before completion', async () => {
    const current = fixture();
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    current.completeIngest.mockRejectedValueOnce(new Error('crash boundary'));
    current.sign.mockImplementation(async (input) =>
      await signMatrixCorpusAttestation(input, {
        keyVersion: 'key_v1',
        privateKey: trusted.privateKey,
      })
    );

    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'retryable',
    });
    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'delivered',
    });

    expect(current.sign).toHaveBeenCalledTimes(2);
    expect(current.completeIngest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ generation: 1 })
    );
    expect(current.completeIngest.mock.calls[0]?.[0].envelope).toEqual(
      current.completeIngest.mock.calls[1]?.[0].envelope
    );
  });

  it('re-attests the same logical ingest only after its prior JWS window expires', async () => {
    const current = fixture();
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const reattestedAt = '2026-07-20T10:05:31.000Z';
    const reattestedDeliveryAt = '2026-07-20T10:05:32.000Z';
    const reattestedClaimExpiry = '2026-07-20T10:06:31.000Z';
    current.claimPendingIngestOutbox
      .mockResolvedValueOnce(ingestClaim())
      .mockResolvedValueOnce(ingestClaim('ALREADY_APPLIED', reattestedClaimExpiry));
    current.publishMatrixCorpusIngest
      .mockResolvedValueOnce(
        err({ code: 'INTERNAL_ERROR' as const, message: 'safe publish failure' })
      )
      .mockResolvedValueOnce(ok({ publisherReceiptDigest }));
    current.sign.mockImplementation(async (input) =>
      await signMatrixCorpusAttestation(input, {
        keyVersion: 'key_v1',
        privateKey: trusted.privateKey,
      })
    );
    current.now
      .mockReset()
      .mockReturnValueOnce(claimStartedAt)
      .mockReturnValueOnce(publishedAt)
      .mockReturnValueOnce(reattestedAt)
      .mockReturnValueOnce(reattestedDeliveryAt)
      .mockReturnValue(reattestedDeliveryAt);

    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'retryable',
    });
    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'delivered',
    });

    const firstEnvelope = current.publishMatrixCorpusIngest.mock.calls[0]?.[0];
    const secondEnvelope = current.publishMatrixCorpusIngest.mock.calls[1]?.[0];
    expect(secondEnvelope).toEqual({
      ...firstEnvelope,
      attestation: expect.any(String),
    });
    expect(secondEnvelope?.attestation).not.toBe(firstEnvelope?.attestation);
    expect(current.sign).toHaveBeenCalledTimes(2);
    expect(current.completeIngest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ generation: 2 })
    );
    await expect(
      verifyWithIntexAgent(secondEnvelope, {
        keyring: new Map([['key_v1', trusted.publicKey]]),
        now: () => reattestedDeliveryAt,
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects mismatched claim projection before signing or publishing private payload', async () => {
    const current = fixture();
    current.claimPendingIngestOutbox.mockResolvedValue({
      ...ingestClaim(),
      ingestOutboxId: 'another_outbox',
    });

    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'rejected',
    });
    expect(current.sign).not.toHaveBeenCalled();
    expect(current.publishMatrixCorpusIngest).not.toHaveBeenCalled();
  });

  it('renews a near-expiry ingest claim before signing and acknowledges only the renewed fence', async () => {
    const current = fixture();
    const observedAt = '2026-07-20T10:00:55.000Z';
    const renewedExpiry = '2026-07-20T10:01:55.000Z';
    current.now
      .mockReset()
      .mockReturnValueOnce(claimStartedAt)
      .mockReturnValueOnce(observedAt)
      .mockReturnValue(observedAt);
    current.renewIngestOutboxClaim.mockResolvedValue({
      code: 'OUTBOX_CLAIM_RENEWED',
      outboxKind: 'ingest',
      ingestOutboxId: 'outbox_1',
      runId: 'run_1',
      leaseFence: '7',
      ownerDigest,
      purpose: 'publish',
      previousClaimExpiresAt: claimExpiresAt,
      claimExpiresAt: renewedExpiry,
    });

    await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
      status: 'delivered',
    });
    expect(current.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedAt: observedAt,
        expiresAt: '2026-07-20T10:05:55.000Z',
      })
    );
    expect(current.acknowledgeIngestOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ expectedClaimExpiresAt: renewedExpiry })
    );
  });

  it('rejects an ingest renewal response with changed run fence or purpose before signing', async () => {
    const observedAt = '2026-07-20T10:00:55.000Z';
    const renewedExpiry = '2026-07-20T10:01:55.000Z';
    for (const mismatch of [
      { runId: 'run_changed' },
      { leaseFence: '8' },
      { purpose: 'terminal_marker_recovery' as const },
    ]) {
      const current = fixture();
      current.now.mockReset().mockReturnValueOnce(claimStartedAt).mockReturnValue(observedAt);
      current.renewIngestOutboxClaim.mockResolvedValue({
        code: 'OUTBOX_CLAIM_RENEWED',
        outboxKind: 'ingest',
        ingestOutboxId: 'outbox_1',
        runId: 'run_1',
        leaseFence: '7',
        ownerDigest,
        purpose: 'publish',
        previousClaimExpiresAt: claimExpiresAt,
        claimExpiresAt: renewedExpiry,
        ...mismatch,
      });

      await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
        status: 'retryable',
      });
      expect(current.sign).not.toHaveBeenCalled();
      expect(current.publishMatrixCorpusIngest).not.toHaveBeenCalled();
    }
  });

  it('posts and acknowledges a signed terminal control only after a matching winner', async () => {
    const current = fixture();

    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'delivered',
    });
    expect(current.postTerminalControl).toHaveBeenCalledWith({
      runId: 'run_1',
      envelope: {
        version: 1,
        kind: 'matrix_corpus_terminal_control',
        eventId: 'terminal_1',
        leaseFence: '7',
        payloadDigest: terminalInput().payloadDigest,
        attestation: 'e30.e30.AA',
      },
    });
    expect(current.acknowledgeTerminalControl).toHaveBeenCalledWith({
      ...drainIdentity(),
      requestTerminalControlId: 'terminal_1',
      requestEventId: 'terminal_1',
      requestPayloadDigest: terminalInput().payloadDigest,
      expectedClaimExpiresAt: claimExpiresAt,
      authoritativeWinner: expect.objectContaining({
        kind: 'abandoned',
        eventId: 'terminal_1',
      }),
      now: publishedAt,
    });
  });

  it.each([
    ['runId', 'run_other'],
    ['leaseFence', '8'],
  ] as const)('rejects a schema-valid terminal response with mismatched %s', async (field, value) => {
    const current = fixture();
    current.postTerminalControl.mockResolvedValueOnce({
      kind: 'acknowledged',
      runId: field === 'runId' ? value : 'run_1',
      leaseFence: field === 'leaseFence' ? value : '7',
      requestEventId: 'terminal_1',
      requestPayloadDigest: terminalInput().payloadDigest,
      winner: {
        kind: 'abandoned',
        eventId: 'terminal_1',
        payloadDigest: terminalInput().payloadDigest,
        outcome: 'stopped_not_evaluated',
        acknowledgedAt: publishedAt,
      },
    });

    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'rejected',
    });
    expect(current.acknowledgeTerminalControl).not.toHaveBeenCalled();
  });

  it('keeps terminal delivery pending for not-ready malformed or thrown responses', async () => {
    for (const response of [
      () => Promise.resolve({ kind: 'not_ready' as const }),
      () => Promise.resolve({ kind: 'acknowledged', extra: 'rejected' }),
      () => Promise.reject(new Error('private-provider-error')),
    ]) {
      const current = fixture();
      current.postTerminalControl.mockImplementationOnce(response);

      const result = await current.drainer.drainTerminalControl(terminalInput());

      expect(result).toEqual({ status: 'retryable' });
      expect(JSON.stringify(result)).not.toContain('private-provider-error');
      expect(current.acknowledgeTerminalControl).not.toHaveBeenCalled();
    }
  });

  it('reuses the persisted byte-identical terminal envelope after claim expiry', async () => {
    const current = fixture();
    const reclaimedAt = '2026-07-20T10:01:01.000Z';
    const reclaimedDeliveryAt = '2026-07-20T10:01:02.000Z';
    const reclaimedExpiry = '2026-07-20T10:02:01.000Z';
    current.claimPendingTerminalControlOutbox
      .mockResolvedValueOnce(terminalClaim())
      .mockResolvedValueOnce({
        ...terminalClaim(),
        code: 'ALREADY_APPLIED',
        operation: 'claim_terminal',
        claimExpiresAt: reclaimedExpiry,
      });
    current.postTerminalControl
      .mockResolvedValueOnce({ kind: 'not_ready' })
      .mockResolvedValueOnce({
        kind: 'acknowledged',
        runId: 'run_1',
        leaseFence: '7',
        requestEventId: 'terminal_1',
        requestPayloadDigest: terminalInput().payloadDigest,
        winner: {
          kind: 'abandoned',
          eventId: 'terminal_1',
          payloadDigest: terminalInput().payloadDigest,
          outcome: 'stopped_not_evaluated',
          acknowledgedAt: reclaimedDeliveryAt,
        },
      });
    current.sign
      .mockResolvedValueOnce({ ok: true, attestation: 'e30.e30.first1' })
      .mockResolvedValueOnce({ ok: true, attestation: 'e30.e30.changed1' });
    current.now
      .mockReset()
      .mockReturnValueOnce(claimStartedAt)
      .mockReturnValueOnce(publishedAt)
      .mockReturnValueOnce(reclaimedAt)
      .mockReturnValueOnce(reclaimedDeliveryAt)
      .mockReturnValue(reclaimedDeliveryAt);

    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'retryable',
    });
    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'delivered',
    });

    expect(current.postTerminalControl.mock.calls[0]?.[0].envelope).toEqual(
      current.postTerminalControl.mock.calls[1]?.[0].envelope
    );
    expect(current.sign).toHaveBeenCalledTimes(1);
    expect(current.completeTerminal).toHaveBeenCalledTimes(1);
  });

  it('re-attests the same logical terminal control only after its prior JWS window expires', async () => {
    const current = fixture();
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const reattestedAt = '2026-07-20T10:05:31.000Z';
    const reattestedDeliveryAt = '2026-07-20T10:05:32.000Z';
    const reattestedClaimExpiry = '2026-07-20T10:06:31.000Z';
    current.claimPendingTerminalControlOutbox
      .mockResolvedValueOnce(terminalClaim())
      .mockResolvedValueOnce(terminalClaim('ALREADY_APPLIED', reattestedClaimExpiry));
    current.postTerminalControl
      .mockResolvedValueOnce({ kind: 'not_ready' })
      .mockResolvedValueOnce({
        kind: 'acknowledged',
        runId: 'run_1',
        leaseFence: '7',
        requestEventId: 'terminal_1',
        requestPayloadDigest: terminalInput().payloadDigest,
        winner: {
          kind: 'abandoned',
          eventId: 'terminal_1',
          payloadDigest: terminalInput().payloadDigest,
          outcome: 'stopped_not_evaluated',
          acknowledgedAt: reattestedDeliveryAt,
        },
      });
    current.sign.mockImplementation(async (input) =>
      await signMatrixCorpusAttestation(input, {
        keyVersion: 'key_v1',
        privateKey: trusted.privateKey,
      })
    );
    current.now
      .mockReset()
      .mockReturnValueOnce(claimStartedAt)
      .mockReturnValueOnce(publishedAt)
      .mockReturnValueOnce(reattestedAt)
      .mockReturnValueOnce(reattestedDeliveryAt)
      .mockReturnValue(reattestedDeliveryAt);

    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'retryable',
    });
    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'delivered',
    });

    const firstEnvelope = current.postTerminalControl.mock.calls[0]?.[0].envelope;
    const secondEnvelope = current.postTerminalControl.mock.calls[1]?.[0].envelope;
    expect(secondEnvelope).toEqual({ ...firstEnvelope, attestation: expect.any(String) });
    expect(secondEnvelope.attestation).not.toBe(firstEnvelope.attestation);
    expect(current.sign).toHaveBeenCalledTimes(2);
    expect(current.completeTerminal.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ generation: 2 })
    );
    await expect(
      verifyWithIntexAgent(secondEnvelope, {
        keyring: new Map([['key_v1', trusted.publicKey]]),
        now: () => reattestedDeliveryAt,
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it('renews a near-expiry terminal claim before posting and acknowledges only the renewed fence', async () => {
    const current = fixture();
    const observedAt = '2026-07-20T10:00:55.000Z';
    const renewedExpiry = '2026-07-20T10:01:55.000Z';
    current.now
      .mockReset()
      .mockReturnValueOnce(claimStartedAt)
      .mockReturnValueOnce(observedAt)
      .mockReturnValue(observedAt);
    current.renewTerminalControlOutboxClaim.mockResolvedValue({
      code: 'OUTBOX_CLAIM_RENEWED',
      outboxKind: 'terminal',
      terminalControlId: 'terminal_1',
      eventId: 'terminal_1',
      runId: 'run_1',
      leaseFence: '7',
      ownerDigest,
      previousClaimExpiresAt: claimExpiresAt,
      claimExpiresAt: renewedExpiry,
    });

    await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
      status: 'delivered',
    });
    expect(current.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedAt: observedAt,
        expiresAt: '2026-07-20T10:05:55.000Z',
      })
    );
    expect(current.acknowledgeTerminalControl).toHaveBeenCalledWith(
      expect.objectContaining({ expectedClaimExpiresAt: renewedExpiry })
    );
  });

  it('rejects a terminal renewal response with changed run or fence before signing', async () => {
    const observedAt = '2026-07-20T10:00:55.000Z';
    const renewedExpiry = '2026-07-20T10:01:55.000Z';
    for (const mismatch of [{ runId: 'run_changed' }, { leaseFence: '8' }]) {
      const current = fixture();
      current.now.mockReset().mockReturnValueOnce(claimStartedAt).mockReturnValue(observedAt);
      current.renewTerminalControlOutboxClaim.mockResolvedValue({
        code: 'OUTBOX_CLAIM_RENEWED',
        outboxKind: 'terminal',
        terminalControlId: 'terminal_1',
        eventId: 'terminal_1',
        runId: 'run_1',
        leaseFence: '7',
        ownerDigest,
        previousClaimExpiresAt: claimExpiresAt,
        claimExpiresAt: renewedExpiry,
        ...mismatch,
      });

      await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
        status: 'retryable',
      });
      expect(current.sign).not.toHaveBeenCalled();
      expect(current.postTerminalControl).not.toHaveBeenCalled();
    }
  });

  it('fails ingest closed across invalid claim, publication, and acknowledgement boundaries', async () => {
    const invalid = fixture();
    await expect(
      invalid.drainer.drainIngest({ ...ingestInput(), ownerDigest: 'invalid' })
    ).resolves.toEqual({ status: 'rejected' });

    const cases: {
      expected: 'retryable' | 'rejected';
      configure(current: ReturnType<typeof fixture>): void;
    }[] = [
      {
        expected: 'retryable',
        configure: (current) => {
          current.claimPendingIngestOutbox.mockRejectedValueOnce(new Error('claim unavailable'));
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingIngestOutbox.mockResolvedValueOnce({ private: 'malformed' });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.claimPendingIngestOutbox.mockResolvedValueOnce({ code: 'NOT_FOUND' });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingIngestOutbox.mockResolvedValueOnce({
            code: 'CORRUPT_STATE',
            recordKind: 'ingest_outbox',
          });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingIngestOutbox.mockResolvedValueOnce({
            ...ingestClaim(),
            payload: {
              ...ingestPayload(),
              ordinaryIngest: { ...ingestPayload().ordinaryIngest, text: 'changed' },
            },
          });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.publishMatrixCorpusIngest.mockResolvedValueOnce(
            ok({ publisherReceiptDigest: 'invalid' })
          );
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockRejectedValueOnce(new Error('ack unavailable'));
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockResolvedValueOnce({ private: 'malformed' });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockResolvedValueOnce({ code: 'NOT_FOUND' });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockImplementationOnce(async (input) => ({
            code: 'OUTBOX_ACKNOWLEDGED',
            outboxKind: 'ingest',
            ingestOutboxId: 'outbox_other',
            runId: input.runId,
            leaseFence: input.leaseFence,
            payloadDigest: input.payloadDigest,
            outcome: input.outcome,
            acknowledgedAt: input.outcome.publishedAt,
            drained: false,
          }));
        },
      },
    ];

    for (const testCase of cases) {
      const current = fixture();
      testCase.configure(current);
      await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
        status: testCase.expected,
      });
    }
  });

  it('fails terminal control closed across claim, response, and acknowledgement boundaries', async () => {
    const invalid = fixture();
    await expect(
      invalid.drainer.drainTerminalControl({ ...terminalInput(), ownerDigest: 'invalid' })
    ).resolves.toEqual({ status: 'rejected' });

    const cases: {
      expected: 'retryable' | 'rejected';
      configure(current: ReturnType<typeof fixture>): void;
    }[] = [
      {
        expected: 'retryable',
        configure: (current) => {
          current.claimPendingTerminalControlOutbox.mockRejectedValueOnce(
            new Error('claim unavailable')
          );
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingTerminalControlOutbox.mockResolvedValueOnce({
            private: 'malformed',
          });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.claimPendingTerminalControlOutbox.mockResolvedValueOnce({ code: 'NOT_FOUND' });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingTerminalControlOutbox.mockResolvedValueOnce({
            code: 'CORRUPT_STATE',
            recordKind: 'terminal_outbox',
          });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingTerminalControlOutbox.mockResolvedValueOnce({
            ...terminalClaim(),
            terminalControlId: 'terminal_other',
            eventId: 'terminal_other',
            payload: {
              ...terminalPayload(),
              eventId: 'terminal_other',
            },
          });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.claimPendingTerminalControlOutbox.mockResolvedValueOnce({
            ...terminalClaim(),
            payload: { ...terminalPayload(), createdAt: publishedAt },
          });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeTerminalControl.mockRejectedValueOnce(new Error('ack unavailable'));
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeTerminalControl.mockResolvedValueOnce({ private: 'malformed' });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeTerminalControl.mockResolvedValueOnce({ code: 'NOT_FOUND' });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.acknowledgeTerminalControl.mockImplementationOnce(async (input) => ({
            code: 'OUTBOX_ACKNOWLEDGED',
            outboxKind: 'terminal',
            requestTerminalControlId: 'terminal_other',
            requestEventId: 'terminal_other',
            runId: input.runId,
            leaseFence: input.leaseFence,
            requestPayloadDigest: input.requestPayloadDigest,
            authoritativeWinner: input.authoritativeWinner,
            leasePhase: 'abandoned',
          }));
        },
      },
    ];

    for (const testCase of cases) {
      const current = fixture();
      testCase.configure(current);
      await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
        status: testCase.expected,
      });
    }
  });

  it('fails terminal-marker recovery closed for invalid evidence and acknowledgement states', async () => {
    const invalidInput = fixture();
    invalidInput.claimPendingIngestOutbox.mockResolvedValueOnce(terminalRecoveryClaim());
    await expect(
      invalidInput.drainer.drainIngest({
        ...terminalRecoveryInput(),
        publisherReceiptDigest: 'invalid',
      })
    ).resolves.toEqual({ status: 'rejected' });

    const identityMismatches = [
      { runId: 'run_other' },
      { userId: 'user_other' },
      { leaseFence: '8' },
      { scenarioId: 'scenario_other' },
      { turnIndex: 1 },
    ];
    const cases: {
      expected: 'retryable' | 'rejected';
      configure(current: ReturnType<typeof fixture>): void;
    }[] = [
      {
        expected: 'retryable',
        configure: (current) => {
          current.getTurnTerminal.mockRejectedValueOnce(new Error('evidence unavailable'));
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.getTurnTerminal.mockResolvedValueOnce({ private: 'malformed' });
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.getTurnTerminal.mockResolvedValueOnce({ kind: 'not_ready' });
        },
      },
      ...identityMismatches.map((mismatch) => ({
        expected: 'rejected' as const,
        configure: (current: ReturnType<typeof fixture>) => {
          current.getTurnTerminal.mockResolvedValueOnce({
            kind: 'terminal',
            runId: 'run_1',
            userId: 'private_user_fixture',
            leaseFence: '7',
            scenarioId: 'scenario_1',
            turnIndex: 0,
            status: 'completed',
            terminalMarkerDigest: 'e'.repeat(64),
            recordedAt: publishedAt,
            ...mismatch,
          });
        },
      })),
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockRejectedValueOnce(new Error('ack unavailable'));
        },
      },
      {
        expected: 'retryable',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockResolvedValueOnce({ private: 'malformed' });
        },
      },
      {
        expected: 'rejected',
        configure: (current) => {
          current.acknowledgeIngestOutbox.mockImplementationOnce(async (input) => ({
            code: 'OUTBOX_ACKNOWLEDGED',
            outboxKind: 'ingest',
            ingestOutboxId: 'outbox_other',
            runId: input.runId,
            leaseFence: input.leaseFence,
            payloadDigest: input.payloadDigest,
            outcome: input.outcome,
            acknowledgedAt: input.outcome.publishedAt,
            drained: false,
          }));
        },
      },
    ];

    for (const testCase of cases) {
      const current = fixture();
      current.claimPendingIngestOutbox.mockResolvedValueOnce(terminalRecoveryClaim());
      testCase.configure(current);
      await expect(current.drainer.drainIngest(terminalRecoveryInput())).resolves.toEqual({
        status: testCase.expected,
      });
    }
  });

  it('contains every ingest envelope materialization failure', async () => {
    const cases: {
      expected: 'retryable' | 'rejected';
      configure(current: ReturnType<typeof fixture>): void;
    }[] = [
      { expected: 'retryable', configure: (c) => { c.prepareIngest.mockRejectedValueOnce(new Error('store unavailable')); } },
      { expected: 'rejected', configure: (c) => { c.prepareIngest.mockResolvedValueOnce({ private: 'malformed' }); } },
      { expected: 'retryable', configure: (c) => { c.prepareIngest.mockResolvedValueOnce({ kind: 'reserved', generation: 1, issuedAt: claimStartedAt, expiresAt: claimStartedAt }); } },
      { expected: 'rejected', configure: (c) => { c.prepareIngest.mockResolvedValueOnce({ kind: 'ready', generation: 1, issuedAt: claimStartedAt, expiresAt: attestationExpiresAt, envelope: { version: 1, kind: 'matrix_corpus_ingest', ingestReceiptId: 'receipt_other', leaseFence: '7', payloadDigest: ingestInput().payloadDigest, attestation: 'e30.e30.AA' } }); } },
      { expected: 'rejected', configure: (c) => { c.sign.mockRejectedValueOnce(new Error('sign unavailable')); } },
      { expected: 'rejected', configure: (c) => { c.sign.mockResolvedValueOnce({ ok: false }); } },
      { expected: 'rejected', configure: (c) => { c.sign.mockResolvedValueOnce({ ok: true, attestation: 'invalid' }); } },
      { expected: 'rejected', configure: (c) => { c.completeIngest.mockResolvedValueOnce({ private: 'malformed' }); } },
      { expected: 'rejected', configure: (c) => { c.completeIngest.mockImplementationOnce(async (input) => ({ kind: 'reserved', generation: input.generation, issuedAt: input.issuedAt, expiresAt: input.expiresAt })); } },
      { expected: 'rejected', configure: (c) => { c.completeIngest.mockImplementationOnce(async (input) => ({ kind: 'ready', generation: input.generation + 1, issuedAt: input.issuedAt, expiresAt: input.expiresAt, envelope: input.envelope })); } },
    ];
    for (const testCase of cases) {
      const current = fixture();
      testCase.configure(current);
      await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
        status: testCase.expected,
      });
    }
  });

  it('contains every terminal envelope materialization failure', async () => {
    const cases: {
      expected: 'retryable' | 'rejected';
      configure(current: ReturnType<typeof fixture>): void;
    }[] = [
      { expected: 'retryable', configure: (c) => { c.prepareTerminal.mockRejectedValueOnce(new Error('store unavailable')); } },
      { expected: 'rejected', configure: (c) => { c.prepareTerminal.mockResolvedValueOnce({ private: 'malformed' }); } },
      { expected: 'retryable', configure: (c) => { c.prepareTerminal.mockResolvedValueOnce({ kind: 'reserved', generation: 1, issuedAt: claimStartedAt, expiresAt: claimStartedAt }); } },
      { expected: 'rejected', configure: (c) => { c.prepareTerminal.mockResolvedValueOnce({ kind: 'ready', generation: 1, issuedAt: claimStartedAt, expiresAt: attestationExpiresAt, envelope: { version: 1, kind: 'matrix_corpus_terminal_control', eventId: 'terminal_other', leaseFence: '7', payloadDigest: terminalInput().payloadDigest, attestation: 'e30.e30.AA' } }); } },
      { expected: 'rejected', configure: (c) => { c.sign.mockRejectedValueOnce(new Error('sign unavailable')); } },
      { expected: 'rejected', configure: (c) => { c.sign.mockResolvedValueOnce({ ok: false }); } },
      { expected: 'rejected', configure: (c) => { c.sign.mockResolvedValueOnce({ ok: true, attestation: 'invalid' }); } },
      { expected: 'retryable', configure: (c) => { c.completeTerminal.mockRejectedValueOnce(new Error('store unavailable')); } },
      { expected: 'rejected', configure: (c) => { c.completeTerminal.mockResolvedValueOnce({ private: 'malformed' }); } },
      { expected: 'rejected', configure: (c) => { c.completeTerminal.mockImplementationOnce(async (input) => ({ kind: 'reserved', generation: input.generation, issuedAt: input.issuedAt, expiresAt: input.expiresAt })); } },
      { expected: 'rejected', configure: (c) => { c.completeTerminal.mockImplementationOnce(async (input) => ({ kind: 'ready', generation: input.generation + 1, issuedAt: input.issuedAt, expiresAt: input.expiresAt, envelope: input.envelope })); } },
    ];
    for (const testCase of cases) {
      const current = fixture();
      testCase.configure(current);
      await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
        status: testCase.expected,
      });
    }
  });

  it('contains ingest and terminal claim-renewal dependency failures', async () => {
    const observedAt = '2026-07-20T10:00:55.000Z';
    for (const configure of [
      (current: ReturnType<typeof fixture>) => {
        current.renewIngestOutboxClaim.mockRejectedValueOnce(new Error('renew unavailable'));
      },
      (current: ReturnType<typeof fixture>) => {
        current.renewIngestOutboxClaim.mockResolvedValueOnce({ private: 'malformed' });
      },
    ]) {
      const current = fixture();
      current.now.mockReset().mockReturnValueOnce(claimStartedAt).mockReturnValue(observedAt);
      configure(current);
      await expect(current.drainer.drainIngest(ingestInput())).resolves.toEqual({
        status: 'retryable',
      });
    }
    for (const configure of [
      (current: ReturnType<typeof fixture>) => {
        current.renewTerminalControlOutboxClaim.mockRejectedValueOnce(
          new Error('renew unavailable')
        );
      },
      (current: ReturnType<typeof fixture>) => {
        current.renewTerminalControlOutboxClaim.mockResolvedValueOnce({ private: 'malformed' });
      },
    ]) {
      const current = fixture();
      current.now.mockReset().mockReturnValueOnce(claimStartedAt).mockReturnValue(observedAt);
      configure(current);
      await expect(current.drainer.drainTerminalControl(terminalInput())).resolves.toEqual({
        status: 'retryable',
      });
    }
  });
});
