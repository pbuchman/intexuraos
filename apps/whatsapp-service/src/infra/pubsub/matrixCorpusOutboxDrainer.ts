import { createHash } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Parsed union checks remain explicit at external acknowledgement boundaries. */
import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusTerminalControlV1,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedIngestV1Schema,
  matrixCorpusSignedTerminalControlV1Schema,
  type MatrixCorpusAttestationClaimsV1,
  type MatrixCorpusSignedIngestV1,
  type MatrixCorpusSignedTerminalControlV1,
} from '@intexuraos/http-contracts';
import { z } from 'zod';

import type { EventPublisherPort } from '../../domain/whatsapp/ports/eventPublisher.js';
import {
  acknowledgeResultSchema,
  claimPendingIngestOutboxInputSchema,
  claimPendingTerminalControlOutboxInputSchema,
  claimRenewResultSchema,
  ingestClaimResultSchema,
  renewIngestOutboxClaimInputSchema,
  renewTerminalControlOutboxClaimInputSchema,
  terminalClaimResultSchema,
  terminalControlAcknowledgementResultSchema,
  type ClaimPendingIngestOutboxInput,
  type ClaimPendingTerminalControlOutboxInput,
} from '../../domain/matrixCorpus/types.js';
import type { MatrixCorpusRepository } from '../../domain/matrixCorpus/ports/matrixCorpusRepository.js';
import type {
  MatrixCorpusSignedEnvelopeStore,
  SignedIngestEnvelopeStoreInput,
  SignedTerminalEnvelopeStoreInput,
} from '../../domain/matrixCorpus/ports/signedEnvelopeStore.js';
import {
  matrixCorpusPostTerminalControlResultSchema,
  matrixCorpusTurnTerminalResultSchema,
  type IntexAgentMatrixCorpusClient,
} from '../../domain/matrixCorpus/ports/intexAgentMatrixCorpusClient.js';

const CLAIM_TTL_MILLISECONDS = 60_000;
const CLAIM_RENEWAL_THRESHOLD_MILLISECONDS = 10_000;
const ATTESTATION_TTL_MILLISECONDS = 300_000;

export type MatrixCorpusOutboxDrainResult = Readonly<{
  status: 'delivered' | 'retryable' | 'rejected';
}>;

type MatrixCorpusIngestDrainBase = Omit<
  ClaimPendingIngestOutboxInput,
  'purpose' | 'now' | 'claimExpiresAt'
>;
export type MatrixCorpusIngestDrainInput =
  | (MatrixCorpusIngestDrainBase & Readonly<{ purpose?: 'publish' }>)
  | (MatrixCorpusIngestDrainBase &
      Readonly<{
        purpose: 'terminal_marker_recovery';
        claimExpiresAt?: string;
        publisherReceiptDigest: string;
        publishedAt: string;
      }>);
export type MatrixCorpusTerminalDrainInput = Omit<
  ClaimPendingTerminalControlOutboxInput,
  'now' | 'claimExpiresAt'
>;

type DeliveryRepository = Pick<
  MatrixCorpusRepository,
  | 'claimPendingIngestOutbox'
  | 'renewIngestOutboxClaim'
  | 'acknowledgeIngestOutbox'
  | 'claimPendingTerminalControlOutbox'
  | 'renewTerminalControlOutboxClaim'
  | 'acknowledgeTerminalControl'
>;

type AttestationSignInput = Readonly<{
  kind: MatrixCorpusAttestationClaimsV1['kind'];
  eventId: string;
  leaseFence: string;
  payloadDigest: string;
  issuedAt: string;
  expiresAt: string;
  payload: MatrixCorpusAttestationClaimsV1['payload'];
}>;

const signedIngestPreparationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('reserved'),
      generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('ready'),
      generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
      envelope: matrixCorpusSignedIngestV1Schema,
    })
    .strict(),
]);
const signedTerminalPreparationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('reserved'),
      generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('ready'),
      generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
      envelope: matrixCorpusSignedTerminalControlV1Schema,
    })
    .strict(),
]);

export interface MatrixCorpusOutboxDrainerDeps {
  repository: DeliveryRepository;
  publisher: Pick<EventPublisherPort, 'publishMatrixCorpusIngest'>;
  intexAgentClient: Pick<
    IntexAgentMatrixCorpusClient,
    'getTurnTerminal' | 'postTerminalControl'
  >;
  signedEnvelopeStore: MatrixCorpusSignedEnvelopeStore;
  sign: (
    input: AttestationSignInput
  ) => Promise<Readonly<{ ok: true; attestation: string }> | Readonly<{ ok: false; code: string }>>;
  now: () => string;
}

export interface MatrixCorpusOutboxDrainer {
  drainIngest(input: MatrixCorpusIngestDrainInput): Promise<MatrixCorpusOutboxDrainResult>;
  drainTerminalControl(
    input: MatrixCorpusTerminalDrainInput
  ): Promise<MatrixCorpusOutboxDrainResult>;
}

export function createMatrixCorpusOutboxDrainer(
  deps: MatrixCorpusOutboxDrainerDeps
): MatrixCorpusOutboxDrainer {
  const inFlightIngest = new Map<string, Promise<EnvelopeResolution<MatrixCorpusSignedIngestV1>>>();
  const inFlightTerminal = new Map<
    string,
    Promise<EnvelopeResolution<MatrixCorpusSignedTerminalControlV1>>
  >();
  return {
    async drainIngest(input): Promise<MatrixCorpusOutboxDrainResult> {
      const commandTime = deps.now();
      const purpose = input.purpose ?? 'publish';
      const requestedClaimExpiresAt =
        input.purpose === 'terminal_marker_recovery' && input.claimExpiresAt !== undefined
          ? input.claimExpiresAt
          : addMilliseconds(commandTime, CLAIM_TTL_MILLISECONDS);
      const claimCommand = claimPendingIngestOutboxInputSchema.safeParse({
        ...baseAuthority(input),
        ingestOutboxId: input.ingestOutboxId,
        payloadDigest: input.payloadDigest,
        purpose,
        now: commandTime,
        claimExpiresAt: requestedClaimExpiresAt,
      });
      if (!claimCommand.success) return rejected();

      let unparsedClaim: unknown;
      try {
        unparsedClaim = await deps.repository.claimPendingIngestOutbox(claimCommand.data);
      } catch {
        return retryable();
      }
      const parsedClaim = ingestClaimResultSchema.safeParse(unparsedClaim);
      if (!parsedClaim.success) return rejected();
      const claim = parsedClaim.data;
      if (!hasIngestClaimPayload(claim))
        return claim.code === 'CORRUPT_STATE' ? rejected() : retryable();
      if (!matchesIngestClaim(input, claim)) return rejected();
      if (!hasCanonicalIngestDigest(claim.payload, claim.payloadDigest)) return rejected();

      const deliveryTime = deps.now();
      const liveClaimExpiry = await renewIngestClaimIfNeeded(
        deps,
        input,
        claim,
        deliveryTime
      );
      if (liveClaimExpiry === undefined) return retryable();
      if (input.purpose === 'terminal_marker_recovery') {
        return await recoverPublishedIngest(
          deps,
          input,
          claim,
          liveClaimExpiry
        );
      }
      const resolvedEnvelope = await singleFlight(
        inFlightIngest,
        `${input.runFenceDigest}:${input.ingestOutboxId}:${claim.payloadDigest}:${liveClaimExpiry}`,
        async () => await resolveIngestEnvelope(deps, input, claim, liveClaimExpiry, deliveryTime)
      );
      if (!resolvedEnvelope.ok) return { status: resolvedEnvelope.status };
      const envelope = resolvedEnvelope.envelope;

      let publishResult: Awaited<ReturnType<EventPublisherPort['publishMatrixCorpusIngest']>>;
      try {
        publishResult = await deps.publisher.publishMatrixCorpusIngest(envelope);
      } catch {
        return retryable();
      }
      if (!publishResult.ok) return retryable();
      const parsedPublisherDigest = matrixCorpusSha256DigestSchema.safeParse(
        publishResult.value.publisherReceiptDigest
      );
      if (!parsedPublisherDigest.success) return retryable();

      const acknowledgedAt = deps.now();
      let unparsedAcknowledgement: unknown;
      try {
        unparsedAcknowledgement = await deps.repository.acknowledgeIngestOutbox({
          ...baseAuthority(input),
          ingestOutboxId: input.ingestOutboxId,
          ingestReceiptId: claim.payload.context.ingestReceiptId,
          payloadDigest: claim.payloadDigest,
          claimPurpose: 'publish',
          expectedClaimExpiresAt: liveClaimExpiry,
          now: acknowledgedAt,
          outcome: {
            kind: 'publication_acknowledged',
            publisherReceiptDigest: parsedPublisherDigest.data,
            publishedAt: acknowledgedAt,
          },
        });
      } catch {
        return retryable();
      }
      const acknowledgement = acknowledgeResultSchema.safeParse(unparsedAcknowledgement);
      if (!acknowledgement.success || !hasIngestAcknowledgement(acknowledgement.data))
        return retryable();
      return matchesIngestAcknowledgement(input, claim.payloadDigest, acknowledgement.data)
        ? delivered()
        : rejected();
    },

    async drainTerminalControl(input): Promise<MatrixCorpusOutboxDrainResult> {
      const commandTime = deps.now();
      const claimCommand = claimPendingTerminalControlOutboxInputSchema.safeParse({
        ...input,
        now: commandTime,
        claimExpiresAt: addMilliseconds(commandTime, CLAIM_TTL_MILLISECONDS),
      });
      if (!claimCommand.success) return rejected();

      let unparsedClaim: unknown;
      try {
        unparsedClaim = await deps.repository.claimPendingTerminalControlOutbox(claimCommand.data);
      } catch {
        return retryable();
      }
      const parsedClaim = terminalClaimResultSchema.safeParse(unparsedClaim);
      if (!parsedClaim.success) return rejected();
      const claim = parsedClaim.data;
      if (!hasTerminalClaimPayload(claim))
        return claim.code === 'CORRUPT_STATE' ? rejected() : retryable();
      if (!matchesTerminalClaim(input, claim)) return rejected();
      if (!hasCanonicalTerminalDigest(claim.payload, claim.payloadDigest)) return rejected();

      const deliveryTime = deps.now();
      const liveClaimExpiry = await renewTerminalClaimIfNeeded(
        deps,
        input,
        claim,
        deliveryTime
      );
      if (liveClaimExpiry === undefined) return retryable();
      const resolvedEnvelope = await singleFlight(
        inFlightTerminal,
        `${input.runFenceDigest}:${input.terminalControlId}:${claim.payloadDigest}:${liveClaimExpiry}`,
        async () => await resolveTerminalEnvelope(deps, input, claim, liveClaimExpiry, deliveryTime)
      );
      if (!resolvedEnvelope.ok) return { status: resolvedEnvelope.status };
      const envelope = resolvedEnvelope.envelope;

      let unparsedResponse: unknown;
      try {
        unparsedResponse = await deps.intexAgentClient.postTerminalControl({
          runId: input.runId,
          envelope,
        });
      } catch {
        return retryable();
      }
      const response = matrixCorpusPostTerminalControlResultSchema.safeParse(unparsedResponse);
      if (!response.success || response.data.kind === 'not_ready') return retryable();
      if (
        response.data.runId !== input.runId ||
        response.data.leaseFence !== input.leaseFence ||
        response.data.requestEventId !== claim.eventId ||
        response.data.requestPayloadDigest !== claim.payloadDigest
      )
        return rejected();

      const acknowledgedAt = deps.now();
      let unparsedAcknowledgement: unknown;
      try {
        unparsedAcknowledgement = await deps.repository.acknowledgeTerminalControl({
          ...baseAuthority(input),
          requestTerminalControlId: claim.terminalControlId,
          requestEventId: claim.eventId,
          requestPayloadDigest: claim.payloadDigest,
          expectedClaimExpiresAt: liveClaimExpiry,
          authoritativeWinner: response.data.winner,
          now: acknowledgedAt,
        });
      } catch {
        return retryable();
      }
      const acknowledgement = terminalControlAcknowledgementResultSchema.safeParse(
        unparsedAcknowledgement
      );
      if (!acknowledgement.success || !hasTerminalAcknowledgement(acknowledgement.data))
        return retryable();
      return matchesTerminalAcknowledgement(input, claim.payloadDigest, acknowledgement.data)
        ? delivered()
        : rejected();
    },
  };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function baseAuthority(
  input: MatrixCorpusIngestDrainInput | MatrixCorpusTerminalDrainInput
): Readonly<{
  runtimeAudience: 'hetzner-prod';
  runId: string;
  userId: string;
  leaseFence: string;
  leaseSlotDigest: string;
  runFenceDigest: string;
  ownerDigest: string;
}> {
  return {
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
    leaseSlotDigest: input.leaseSlotDigest,
    runFenceDigest: input.runFenceDigest,
    ownerDigest: input.ownerDigest,
  };
}

function hasIngestClaimPayload(
  claim: ReturnType<typeof ingestClaimResultSchema.parse>
): claim is Extract<typeof claim, Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>> {
  return claim.code === 'OUTBOX_CLAIMED' || claim.code === 'ALREADY_APPLIED';
}

function hasTerminalClaimPayload(
  claim: ReturnType<typeof terminalClaimResultSchema.parse>
): claim is Extract<typeof claim, Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>> {
  return claim.code === 'OUTBOX_CLAIMED' || claim.code === 'ALREADY_APPLIED';
}

function hasIngestAcknowledgement(
  acknowledgement: ReturnType<typeof acknowledgeResultSchema.parse>
): acknowledgement is Extract<
  typeof acknowledgement,
  Readonly<{ code: 'OUTBOX_ACKNOWLEDGED' | 'ALREADY_APPLIED' }>
> {
  return acknowledgement.code === 'OUTBOX_ACKNOWLEDGED' || acknowledgement.code === 'ALREADY_APPLIED';
}

function hasTerminalAcknowledgement(
  acknowledgement: ReturnType<typeof terminalControlAcknowledgementResultSchema.parse>
): acknowledgement is Extract<
  typeof acknowledgement,
  Readonly<{ code: 'OUTBOX_ACKNOWLEDGED' | 'ALREADY_APPLIED' }>
> {
  return acknowledgement.code === 'OUTBOX_ACKNOWLEDGED' || acknowledgement.code === 'ALREADY_APPLIED';
}

function matchesIngestClaim(
  input: MatrixCorpusIngestDrainInput,
  claim: Extract<
    ReturnType<typeof ingestClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >
): boolean {
  return (
    claim.ingestOutboxId === input.ingestOutboxId &&
    claim.runId === input.runId &&
    claim.leaseFence === input.leaseFence &&
    claim.ownerDigest === input.ownerDigest &&
    claim.purpose === (input.purpose ?? 'publish') &&
    claim.payloadDigest === input.payloadDigest &&
    claim.payload.context.runId === input.runId &&
    claim.payload.context.leaseFence === input.leaseFence &&
    claim.payload.ordinaryIngest.userId === input.userId
  );
}

async function recoverPublishedIngest(
  deps: MatrixCorpusOutboxDrainerDeps,
  input: Extract<
    MatrixCorpusIngestDrainInput,
    Readonly<{ purpose: 'terminal_marker_recovery' }>
  >,
  claim: Extract<
    ReturnType<typeof ingestClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >,
  liveClaimExpiry: string
): Promise<MatrixCorpusOutboxDrainResult> {
  if (
    !matrixCorpusSha256DigestSchema.safeParse(input.publisherReceiptDigest).success ||
    !matrixCorpusRfc3339TimestampSchema.safeParse(input.publishedAt).success
  )
    return rejected();
  let unparsedTerminal: unknown;
  try {
    unparsedTerminal = await deps.intexAgentClient.getTurnTerminal({
      runtimeAudience: input.runtimeAudience,
      runId: input.runId,
      userId: input.userId,
      leaseFence: input.leaseFence,
      scenarioId: claim.payload.context.scenarioId,
      turnIndex: claim.payload.context.turnIndex,
    });
  } catch {
    return retryable();
  }
  const terminal = matrixCorpusTurnTerminalResultSchema.safeParse(unparsedTerminal);
  if (!terminal.success || terminal.data.kind === 'not_ready') return retryable();
  if (
    terminal.data.runId !== input.runId ||
    terminal.data.userId !== input.userId ||
    terminal.data.leaseFence !== input.leaseFence ||
    terminal.data.scenarioId !== claim.payload.context.scenarioId ||
    terminal.data.turnIndex !== claim.payload.context.turnIndex
  )
    return rejected();

  const acknowledgedAt = deps.now();
  let unparsedAcknowledgement: unknown;
  try {
    unparsedAcknowledgement = await deps.repository.acknowledgeIngestOutbox({
      ...baseAuthority(input),
      ingestOutboxId: input.ingestOutboxId,
      ingestReceiptId: claim.payload.context.ingestReceiptId,
      payloadDigest: claim.payloadDigest,
      claimPurpose: 'terminal_marker_recovery',
      expectedClaimExpiresAt: liveClaimExpiry,
      now: acknowledgedAt,
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest: input.publisherReceiptDigest,
        publishedAt: input.publishedAt,
        terminalMarker: {
          kind: terminal.data.status,
          digest: terminal.data.terminalMarkerDigest,
          recordedAt: terminal.data.recordedAt,
        },
        replyOrDeliveryWorkInFlight: 0,
      },
    });
  } catch {
    return retryable();
  }
  const acknowledgement = acknowledgeResultSchema.safeParse(unparsedAcknowledgement);
  if (!acknowledgement.success || !hasIngestAcknowledgement(acknowledgement.data))
    return retryable();
  return matchesIngestAcknowledgement(input, claim.payloadDigest, acknowledgement.data)
    ? delivered()
    : rejected();
}

function matchesTerminalClaim(
  input: MatrixCorpusTerminalDrainInput,
  claim: Extract<
    ReturnType<typeof terminalClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >
): boolean {
  return (
    claim.terminalControlId === input.terminalControlId &&
    claim.eventId === input.eventId &&
    claim.runId === input.runId &&
    claim.leaseFence === input.leaseFence &&
    claim.ownerDigest === input.ownerDigest &&
    claim.payloadDigest === input.payloadDigest &&
    claim.payload.userId === input.userId
  );
}

function hasCanonicalIngestDigest(
  payload: Parameters<typeof canonicalMatrixCorpusIngestPayloadV1>[0],
  expectedDigest: string
): boolean {
  return sha256(canonicalMatrixCorpusIngestPayloadV1(payload)) === expectedDigest;
}

function hasCanonicalTerminalDigest(
  payload: Parameters<typeof canonicalMatrixCorpusTerminalControlV1>[0],
  expectedDigest: string
): boolean {
  return sha256(canonicalMatrixCorpusTerminalControlV1(payload)) === expectedDigest;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

type EnvelopeResolution<T> =
  | Readonly<{ ok: true; envelope: T }>
  | Readonly<{ ok: false; status: 'retryable' | 'rejected' }>;

async function resolveIngestEnvelope(
  deps: MatrixCorpusOutboxDrainerDeps,
  input: MatrixCorpusIngestDrainInput,
  claim: Extract<
    ReturnType<typeof ingestClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >,
  liveClaimExpiry: string,
  observedAt: string
): Promise<EnvelopeResolution<MatrixCorpusSignedIngestV1>> {
  const storeInput: SignedIngestEnvelopeStoreInput = {
    ...baseAuthority(input),
    ingestOutboxId: input.ingestOutboxId,
    payloadDigest: claim.payloadDigest,
    expectedClaimExpiresAt: liveClaimExpiry,
  };
  const proposedIssuedAt = addMilliseconds(liveClaimExpiry, -CLAIM_TTL_MILLISECONDS);
  const proposedExpiresAt = addMilliseconds(proposedIssuedAt, ATTESTATION_TTL_MILLISECONDS);
  let unparsedPreparation: unknown;
  try {
    unparsedPreparation = await deps.signedEnvelopeStore.prepareIngest({
      ...storeInput,
      proposedIssuedAt,
      proposedExpiresAt,
    });
  } catch {
    return { ok: false, status: 'retryable' };
  }
  const preparation = signedIngestPreparationSchema.safeParse(unparsedPreparation);
  if (!preparation.success) return { ok: false, status: 'rejected' };
  if (!isUsableAttestationWindow(preparation.data, observedAt))
    return { ok: false, status: 'retryable' };
  if (preparation.data.kind === 'ready')
    return parseMatchingIngestEnvelope(preparation.data.envelope, claim);

  let signed: Awaited<ReturnType<MatrixCorpusOutboxDrainerDeps['sign']>>;
  try {
    signed = await deps.sign({
      kind: 'matrix_corpus_ingest',
      eventId: claim.payload.context.ingestReceiptId,
      leaseFence: claim.leaseFence,
      payloadDigest: claim.payloadDigest,
      issuedAt: preparation.data.issuedAt,
      expiresAt: preparation.data.expiresAt,
      payload: claim.payload,
    });
  } catch {
    return { ok: false, status: 'rejected' };
  }
  if (!signed.ok) return { ok: false, status: 'rejected' };
  const candidate = matrixCorpusSignedIngestV1Schema.safeParse({
    version: 1,
    kind: 'matrix_corpus_ingest',
    ingestReceiptId: claim.payload.context.ingestReceiptId,
    leaseFence: claim.leaseFence,
    payloadDigest: claim.payloadDigest,
    attestation: signed.attestation,
  });
  if (!candidate.success) return { ok: false, status: 'rejected' };
  let completed: unknown;
  try {
    completed = await deps.signedEnvelopeStore.completeIngest({
      ...storeInput,
      generation: preparation.data.generation,
      issuedAt: preparation.data.issuedAt,
      expiresAt: preparation.data.expiresAt,
      envelope: candidate.data,
    });
  } catch {
    return { ok: false, status: 'retryable' };
  }
  const parsedCompletion = signedIngestPreparationSchema.safeParse(completed);
  if (!parsedCompletion.success || parsedCompletion.data.kind !== 'ready')
    return { ok: false, status: 'rejected' };
  if (
    parsedCompletion.data.issuedAt !== preparation.data.issuedAt ||
    parsedCompletion.data.expiresAt !== preparation.data.expiresAt ||
    parsedCompletion.data.generation !== preparation.data.generation
  )
    return { ok: false, status: 'rejected' };
  return parseMatchingIngestEnvelope(parsedCompletion.data.envelope, claim);
}

async function resolveTerminalEnvelope(
  deps: MatrixCorpusOutboxDrainerDeps,
  input: MatrixCorpusTerminalDrainInput,
  claim: Extract<
    ReturnType<typeof terminalClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >,
  liveClaimExpiry: string,
  observedAt: string
): Promise<EnvelopeResolution<MatrixCorpusSignedTerminalControlV1>> {
  const storeInput: SignedTerminalEnvelopeStoreInput = {
    ...baseAuthority(input),
    terminalControlId: input.terminalControlId,
    eventId: input.eventId,
    payloadDigest: claim.payloadDigest,
    expectedClaimExpiresAt: liveClaimExpiry,
  };
  const proposedIssuedAt = addMilliseconds(liveClaimExpiry, -CLAIM_TTL_MILLISECONDS);
  const proposedExpiresAt = addMilliseconds(proposedIssuedAt, ATTESTATION_TTL_MILLISECONDS);
  let unparsedPreparation: unknown;
  try {
    unparsedPreparation = await deps.signedEnvelopeStore.prepareTerminal({
      ...storeInput,
      proposedIssuedAt,
      proposedExpiresAt,
    });
  } catch {
    return { ok: false, status: 'retryable' };
  }
  const preparation = signedTerminalPreparationSchema.safeParse(unparsedPreparation);
  if (!preparation.success) return { ok: false, status: 'rejected' };
  if (!isUsableAttestationWindow(preparation.data, observedAt))
    return { ok: false, status: 'retryable' };
  if (preparation.data.kind === 'ready')
    return parseMatchingTerminalEnvelope(preparation.data.envelope, claim);

  let signed: Awaited<ReturnType<MatrixCorpusOutboxDrainerDeps['sign']>>;
  try {
    signed = await deps.sign({
      kind: 'matrix_corpus_terminal_control',
      eventId: claim.eventId,
      leaseFence: claim.leaseFence,
      payloadDigest: claim.payloadDigest,
      issuedAt: preparation.data.issuedAt,
      expiresAt: preparation.data.expiresAt,
      payload: claim.payload,
    });
  } catch {
    return { ok: false, status: 'rejected' };
  }
  if (!signed.ok) return { ok: false, status: 'rejected' };
  const candidate = matrixCorpusSignedTerminalControlV1Schema.safeParse({
    version: 1,
    kind: 'matrix_corpus_terminal_control',
    eventId: claim.eventId,
    leaseFence: claim.leaseFence,
    payloadDigest: claim.payloadDigest,
    attestation: signed.attestation,
  });
  if (!candidate.success) return { ok: false, status: 'rejected' };
  let completed: unknown;
  try {
    completed = await deps.signedEnvelopeStore.completeTerminal({
      ...storeInput,
      generation: preparation.data.generation,
      issuedAt: preparation.data.issuedAt,
      expiresAt: preparation.data.expiresAt,
      envelope: candidate.data,
    });
  } catch {
    return { ok: false, status: 'retryable' };
  }
  const parsedCompletion = signedTerminalPreparationSchema.safeParse(completed);
  if (!parsedCompletion.success || parsedCompletion.data.kind !== 'ready')
    return { ok: false, status: 'rejected' };
  if (
    parsedCompletion.data.issuedAt !== preparation.data.issuedAt ||
    parsedCompletion.data.expiresAt !== preparation.data.expiresAt ||
    parsedCompletion.data.generation !== preparation.data.generation
  )
    return { ok: false, status: 'rejected' };
  return parseMatchingTerminalEnvelope(parsedCompletion.data.envelope, claim);
}

function isUsableAttestationWindow(
  window: Readonly<{ issuedAt: string; expiresAt: string }>,
  observedAt: string
): boolean {
  const issuedAt = Date.parse(window.issuedAt);
  const expiresAt = Date.parse(window.expiresAt);
  const observed = Date.parse(observedAt);
  return (
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= ATTESTATION_TTL_MILLISECONDS &&
    observed >= issuedAt - 30_000 &&
    observed <= expiresAt + 30_000
  );
}

async function singleFlight<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing !== undefined) return await existing;
  const current = operation();
  inFlight.set(key, current);
  try {
    return await current;
  } finally {
    inFlight.delete(key);
  }
}

function parseMatchingIngestEnvelope(
  stored: unknown,
  claim: Extract<
    ReturnType<typeof ingestClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >
): EnvelopeResolution<MatrixCorpusSignedIngestV1> {
  const parsed = matrixCorpusSignedIngestV1Schema.safeParse(stored);
  return parsed.success &&
    parsed.data.ingestReceiptId === claim.payload.context.ingestReceiptId &&
    parsed.data.leaseFence === claim.leaseFence &&
    parsed.data.payloadDigest === claim.payloadDigest
    ? { ok: true, envelope: parsed.data }
    : { ok: false, status: 'rejected' };
}

function parseMatchingTerminalEnvelope(
  stored: unknown,
  claim: Extract<
    ReturnType<typeof terminalClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >
): EnvelopeResolution<MatrixCorpusSignedTerminalControlV1> {
  const parsed = matrixCorpusSignedTerminalControlV1Schema.safeParse(stored);
  return parsed.success &&
    parsed.data.eventId === claim.eventId &&
    parsed.data.leaseFence === claim.leaseFence &&
    parsed.data.payloadDigest === claim.payloadDigest
    ? { ok: true, envelope: parsed.data }
    : { ok: false, status: 'rejected' };
}

async function renewIngestClaimIfNeeded(
  deps: MatrixCorpusOutboxDrainerDeps,
  input: MatrixCorpusIngestDrainInput,
  claim: Extract<
    ReturnType<typeof ingestClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >,
  observedAt: string
): Promise<string | undefined> {
  if (Date.parse(claim.claimExpiresAt) - Date.parse(observedAt) > CLAIM_RENEWAL_THRESHOLD_MILLISECONDS)
    return claim.claimExpiresAt;
  const renewalCommand = renewIngestOutboxClaimInputSchema.parse({
    ...baseAuthority(input),
    ingestOutboxId: input.ingestOutboxId,
    payloadDigest: input.payloadDigest,
    purpose: input.purpose ?? 'publish',
    expectedClaimExpiresAt: claim.claimExpiresAt,
    newClaimExpiresAt: addMilliseconds(observedAt, CLAIM_TTL_MILLISECONDS),
    now: observedAt,
  });
  try {
    const parsed = claimRenewResultSchema.safeParse(
      await deps.repository.renewIngestOutboxClaim(renewalCommand)
    );
    if (!parsed.success || !('claimExpiresAt' in parsed.data)) return undefined;
    return parsed.data.outboxKind === 'ingest' &&
      parsed.data.ingestOutboxId === input.ingestOutboxId &&
      parsed.data.runId === input.runId &&
      parsed.data.leaseFence === input.leaseFence &&
      parsed.data.ownerDigest === input.ownerDigest &&
      parsed.data.purpose === (input.purpose ?? 'publish') &&
      parsed.data.previousClaimExpiresAt === claim.claimExpiresAt
      ? parsed.data.claimExpiresAt
      : undefined;
  } catch {
    return undefined;
  }
}

async function renewTerminalClaimIfNeeded(
  deps: MatrixCorpusOutboxDrainerDeps,
  input: MatrixCorpusTerminalDrainInput,
  claim: Extract<
    ReturnType<typeof terminalClaimResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_CLAIMED' | 'ALREADY_APPLIED' }>
  >,
  observedAt: string
): Promise<string | undefined> {
  if (Date.parse(claim.claimExpiresAt) - Date.parse(observedAt) > CLAIM_RENEWAL_THRESHOLD_MILLISECONDS)
    return claim.claimExpiresAt;
  const renewalCommand = renewTerminalControlOutboxClaimInputSchema.parse({
    ...baseAuthority(input),
    terminalControlId: input.terminalControlId,
    eventId: input.eventId,
    payloadDigest: input.payloadDigest,
    expectedClaimExpiresAt: claim.claimExpiresAt,
    newClaimExpiresAt: addMilliseconds(observedAt, CLAIM_TTL_MILLISECONDS),
    now: observedAt,
  });
  try {
    const parsed = claimRenewResultSchema.safeParse(
      await deps.repository.renewTerminalControlOutboxClaim(renewalCommand)
    );
    if (!parsed.success || !('claimExpiresAt' in parsed.data)) return undefined;
    return parsed.data.outboxKind === 'terminal' &&
      parsed.data.terminalControlId === input.terminalControlId &&
      parsed.data.eventId === input.eventId &&
      parsed.data.runId === input.runId &&
      parsed.data.leaseFence === input.leaseFence &&
      parsed.data.ownerDigest === input.ownerDigest &&
      parsed.data.previousClaimExpiresAt === claim.claimExpiresAt
      ? parsed.data.claimExpiresAt
      : undefined;
  } catch {
    return undefined;
  }
}

function matchesIngestAcknowledgement(
  input: MatrixCorpusIngestDrainInput,
  payloadDigest: string,
  acknowledgement: Extract<
    ReturnType<typeof acknowledgeResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_ACKNOWLEDGED' | 'ALREADY_APPLIED' }>
  >
): boolean {
  return (
    acknowledgement.outboxKind === 'ingest' &&
    acknowledgement.ingestOutboxId === input.ingestOutboxId &&
    acknowledgement.runId === input.runId &&
    acknowledgement.leaseFence === input.leaseFence &&
    acknowledgement.payloadDigest === payloadDigest &&
    acknowledgement.outcome.kind ===
      (input.purpose === 'terminal_marker_recovery'
        ? 'terminal_marker_acknowledged'
        : 'publication_acknowledged')
  );
}

function matchesTerminalAcknowledgement(
  input: MatrixCorpusTerminalDrainInput,
  payloadDigest: string,
  acknowledgement: Extract<
    ReturnType<typeof terminalControlAcknowledgementResultSchema.parse>,
    Readonly<{ code: 'OUTBOX_ACKNOWLEDGED' | 'ALREADY_APPLIED' }>
  >
): boolean {
  return (
    acknowledgement.outboxKind === 'terminal' &&
    acknowledgement.requestTerminalControlId === input.terminalControlId &&
    acknowledgement.requestEventId === input.eventId &&
    acknowledgement.runId === input.runId &&
    acknowledgement.leaseFence === input.leaseFence &&
    acknowledgement.requestPayloadDigest === payloadDigest
  );
}

function delivered(): MatrixCorpusOutboxDrainResult {
  return { status: 'delivered' };
}

function retryable(): MatrixCorpusOutboxDrainResult {
  return { status: 'retryable' };
}

function rejected(): MatrixCorpusOutboxDrainResult {
  return { status: 'rejected' };
}
