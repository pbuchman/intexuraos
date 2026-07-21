import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusIngressRequestV1,
  matrixCorpusCapabilityV1Schema,
  matrixCorpusCapabilityConsumeFactsV1Schema,
  matrixCorpusSafeIdSchema,
  type MatrixCorpusParsedIngressFactsV1,
  type MatrixCorpusVisibleHeaderV1,
} from '@intexuraos/http-contracts';
import type { Firestore } from '@intexuraos/infra-firestore';

import type { MatrixCorpusControlPlane } from '../../domain/matrixCorpus/controlPlane.js';
import type {
  MatrixCorpusIngressPort,
  MatrixCorpusReservedIngressInput,
  MatrixCorpusReservedIngressResult,
} from '../../domain/matrixCorpus/ports/matrixCorpusIngress.js';
import type {
  MatrixCorpusKeyedDigestPort,
  MatrixCorpusSha256Port,
} from '../../domain/matrixCorpus/types.js';
import { digestMatrixCorpusPromptV1 } from '../../domain/matrixCorpus/visibleHeader.js';
import { MATRIX_CORPUS_CAPABILITIES_COLLECTION } from './matrixCorpusRepository.js';

const forwardedCodes = new Set<MatrixCorpusReservedIngressResult['code']>([
  'INGEST_ENQUEUED',
  'ALREADY_APPLIED',
  'CAPABILITY_REPLAY',
  'CAPABILITY_EXPIRED',
  'CAPABILITY_REVOKED',
  'CAPABILITY_MISMATCH',
  'TRANSPORT_REPLAY',
  'LEASE_EXPIRED',
  'STALE_FENCE',
  'PHASE_CONFLICT',
  'NOT_FOUND',
]);

export interface FirestoreMatrixCorpusIngressDependencies {
  readonly firestore: Firestore;
  readonly controlPlane: Pick<MatrixCorpusControlPlane, 'consumeCapabilityAndEnqueueIngest'>;
  readonly digests: MatrixCorpusKeyedDigestPort;
  readonly sha256: MatrixCorpusSha256Port;
  readonly expectedMatrixRoomBindingDigest: string;
  readonly expectedWhatsAppAccountBindingDigest: string;
  readonly expectedWhatsAppSenderBindingDigest: string;
}

/**
 * Converts one already-parsed reserved WhatsApp message into the signed Matrix-corpus
 * ingress facts. The capability remains the only authority: the Firestore read merely
 * reconstructs the candidate and the transactional consume operation revalidates it.
 */
export class FirestoreMatrixCorpusIngress implements MatrixCorpusIngressPort {
  public constructor(private readonly dependencies: FirestoreMatrixCorpusIngressDependencies) {}

  public async consumeReservedMessage(
    input: MatrixCorpusReservedIngressInput
  ): Promise<MatrixCorpusReservedIngressResult> {
    try {
      const capabilityDigest = this.dependencies.digests.digest('imc-capability-v1', [
        input.message.capability,
      ]);
      const snapshot = await this.dependencies.firestore
        .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
        .doc(capabilityDigest)
        .get();
      if (!snapshot.exists) return { code: 'NOT_FOUND' };
      const capability = matrixCorpusCapabilityV1Schema.safeParse(snapshot.data());
      if (!capability.success) return { code: 'NOT_READY' };
      const stored = capability.data;
      const observedWhatsAppAccountBindingDigest = this.dependencies.digests.digest(
        'imc-lease-slot-v1',
        ['whatsapp-account-binding', input.whatsappAccountId ?? '']
      );
      const observedWhatsAppSenderBindingDigest = this.dependencies.digests.digest(
        'imc-lease-slot-v1',
        ['whatsapp-sender-binding', input.senderPhoneNumber]
      );
      if (
        stored.capabilityDigest !== capabilityDigest ||
        stored.userId !== input.userId ||
        stored.scenarioNumber !== input.message.scenarioNumber ||
        stored.phase !== input.message.phase ||
        stored.matrixRoomBindingDigest !==
          this.dependencies.expectedMatrixRoomBindingDigest ||
        stored.whatsappAccountBindingDigest !==
          this.dependencies.expectedWhatsAppAccountBindingDigest ||
        stored.whatsappAccountBindingDigest !== observedWhatsAppAccountBindingDigest ||
        stored.whatsappSenderBindingDigest !==
          this.dependencies.expectedWhatsAppSenderBindingDigest ||
        stored.whatsappSenderBindingDigest !== observedWhatsAppSenderBindingDigest ||
        digestMatrixCorpusPromptV1({
          body: input.message.naturalBody,
          startNewSession: input.message.startNewSession,
        }) !== stored.promptDigest
      ) {
        return { code: 'CAPABILITY_MISMATCH' };
      }

      const parsedIngress = toParsedIngress(input.message);
      if (parsedIngress === null || !visibleTurnMatchesCapability(input.message, stored.turnIndex))
        return { code: 'CAPABILITY_MISMATCH' };
      const transportMessageIdDigest = this.dependencies.digests.digest('imc-transport-v1', [
        input.transportMessageId,
      ]);
      const ingestReceiptId = `imc_ingest_receipt_v1_${transportMessageIdDigest}`;
      const ingestOutboxId = `imc_ingest_outbox_v1_${transportMessageIdDigest}`;
      if (
        !matrixCorpusSafeIdSchema.safeParse(ingestReceiptId).success ||
        !matrixCorpusSafeIdSchema.safeParse(ingestOutboxId).success
      )
        return { code: 'NOT_READY' };

      const payload = {
        version: 1 as const,
        kind: 'matrix_corpus_ingest_payload' as const,
        ordinaryIngest: {
          type: 'intex.message.ingest' as const,
          userId: input.userId,
          messageId: input.transportMessageId,
          text: input.message.textAfterHeaderRemoval,
          sourceType: 'whatsapp_text' as const,
          timestamp: input.timestamp,
        },
        context: {
          version: 1 as const,
          kind: 'matrix_corpus' as const,
          runtimeAudience: 'home-dev' as const,
          leaseFence: stored.leaseFence,
          ingestReceiptId,
          runId: stored.runId,
          scenarioId: stored.scenarioId,
          scenarioNumber: stored.scenarioNumber,
          scenarioLabel: stored.scenarioLabel,
          turnIndex: stored.turnIndex,
          phase: stored.phase,
          startNewSession: input.message.startNewSession,
          promptNormalizationVersion: stored.promptNormalizationVersion,
          promptDigest: stored.promptDigest,
          expectedSessionId: stored.expectedSessionId,
          pendingConfirmationId: stored.pendingConfirmationId,
          expectedDecision: stored.expectedDecision,
          mockProfile: stored.mockProfile,
          mockProfileDigest: stored.mockProfileDigest,
          expectedToolSchedule: stored.expectedToolSchedule,
          currentDateTime: stored.currentDateTime,
          timeZone: stored.timeZone,
        },
      };
      const payloadDigest = this.dependencies.sha256.digestCanonical(
        canonicalMatrixCorpusIngestPayloadV1(payload)
      );
      const ingressRequest = {
        version: 1 as const,
        capabilityDigest,
        transportMessageIdDigest,
        userId: input.userId,
        matrixRoomBindingDigest: stored.matrixRoomBindingDigest,
        whatsappAccountBindingDigest: stored.whatsappAccountBindingDigest,
        whatsappSenderBindingDigest: stored.whatsappSenderBindingDigest,
        parsedIngress,
        promptDigest: stored.promptDigest,
        expectedSessionId: stored.expectedSessionId,
        pendingConfirmationId: stored.pendingConfirmationId,
        expectedDecision: stored.expectedDecision,
        ordinaryMessageId: input.transportMessageId,
        ordinaryTimestamp: input.timestamp,
        ingestReceiptId,
        payloadDigest,
        ingestOutboxId,
      };
      const facts = matrixCorpusCapabilityConsumeFactsV1Schema.parse({
        version: 1,
        ingressRequest,
        ingressRequestDigest: this.dependencies.sha256.digestCanonical(
          canonicalMatrixCorpusIngressRequestV1(ingressRequest)
        ),
        payload,
      });
      const result = await this.dependencies.controlPlane.consumeCapabilityAndEnqueueIngest({
        rawCapability: input.message.capability,
        transportMessageId: input.transportMessageId,
        facts,
      });
      return isForwardedCode(result.code)
        ? { code: result.code }
        : { code: 'NOT_READY' };
    } catch {
      return { code: 'NOT_READY' };
    }
  }
}

function isForwardedCode(code: string): code is MatrixCorpusReservedIngressResult['code'] {
  return forwardedCodes.has(code as MatrixCorpusReservedIngressResult['code']);
}

function visibleTurnMatchesCapability(message: MatrixCorpusVisibleHeaderV1, turnIndex: number): boolean {
  return message.phase === 'start'
    ? turnIndex === 0
    : message.phase === 'turn'
      ? message.turnIndex === turnIndex + 1
      : true;
}

function toParsedIngress(
  message: MatrixCorpusVisibleHeaderV1
): MatrixCorpusParsedIngressFactsV1 | null {
  if (message.phase === 'start') {
    return {
      version: 1 as const,
      phase: 'start' as const,
      scenarioNumber: message.scenarioNumber,
      scenarioTotal: 20 as const,
      turnIndex: null,
      turnTotal: null,
      startNewSession: true as const,
    };
  }
  if (message.phase === 'turn') {
    return {
      version: 1 as const,
      phase: 'turn' as const,
      scenarioNumber: message.scenarioNumber,
      scenarioTotal: 20 as const,
      turnIndex: message.turnIndex,
      turnTotal: message.turnTotal,
      startNewSession: false as const,
    };
  }
  return {
    version: 1,
    phase: 'confirmation',
    scenarioNumber: message.scenarioNumber,
    scenarioTotal: 20,
    turnIndex: null,
    turnTotal: null,
    startNewSession: false,
  };
}
