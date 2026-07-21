import type { Firestore, QueryDocumentSnapshot } from '@intexuraos/infra-firestore';
import {
  matrixCorpusKeyedDigestSchema,
  matrixCorpusRfc3339TimestampSchema,
} from '@intexuraos/http-contracts';

import type {
  MatrixCorpusIngestDrainInput,
  MatrixCorpusTerminalDrainInput,
} from '../pubsub/matrixCorpusOutboxDrainer.js';
import {
  matrixCorpusIngestOutboxRecordV1Schema,
  matrixCorpusLeaseV1Schema,
  matrixCorpusTerminalControlOutboxRecordV1Schema,
  type AbandonExpiredRunInput,
  type MatrixCorpusKeyedDigestPort,
} from '../../domain/matrixCorpus/types.js';
import {
  MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION,
  MATRIX_CORPUS_RUN_LEASES_COLLECTION,
  MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION,
} from './matrixCorpusRepository.js';

const NONTERMINAL_LEASE_PHASES = [
  'provisioning',
  'active',
  'quiescing',
  'release_pending',
  'abandon_pending',
] as const;

export const MATRIX_CORPUS_MAX_RECOVERY_SCAN_SIZE = 32;

export interface FirestoreMatrixCorpusRecoveryScannerDeps {
  firestore: Firestore;
  digests: MatrixCorpusKeyedDigestPort;
}

export interface MatrixCorpusRecoveryScanInput {
  now: string;
  limit: number;
}

export interface MatrixCorpusOutboxRecoveryScanInput extends MatrixCorpusRecoveryScanInput {
  ownerDigest: string;
}

export type MatrixCorpusOutboxRecoveryCandidates = Readonly<{
  ingest: readonly MatrixCorpusIngestDrainInput[];
  terminal: readonly MatrixCorpusTerminalDrainInput[];
}>;

/**
 * Performs bounded discovery only. Every candidate is claimed or abandoned through the
 * repository's transaction, which re-reads the current lease/fence/phase before mutation.
 */
export class FirestoreMatrixCorpusRecoveryScanner {
  public constructor(private readonly dependencies: FirestoreMatrixCorpusRecoveryScannerDeps) {}

  public async listOutboxCandidates(
    input: MatrixCorpusOutboxRecoveryScanInput
  ): Promise<MatrixCorpusOutboxRecoveryCandidates> {
    assertScanInput(input);
    if (!matrixCorpusKeyedDigestSchema.safeParse(input.ownerDigest).success) {
      throw new Error('Matrix corpus recovery owner digest is invalid');
    }

    const ingestLimit =
      input.limit >= 4
        ? Math.max(3, Math.floor(input.limit / 2))
        : Math.max(1, Math.floor(input.limit / 2));
    const queryLimit = Math.max(ingestLimit, input.limit);
    const [pendingIngest, expiredIngest, publishedIngest, pendingTerminal, expiredTerminal] =
      await Promise.all([
      this.dependencies.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(ingestLimit)
        .get(),
      this.dependencies.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .where('status', '==', 'claimed')
        .where('claim.expiresAt', '<=', input.now)
        .orderBy('claim.expiresAt', 'asc')
        .limit(ingestLimit)
        .get(),
      this.dependencies.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .where('status', '==', 'published')
        .where('terminalMarker', '==', null)
        .limit(ingestLimit)
        .get(),
      this.dependencies.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(queryLimit)
        .get(),
      this.dependencies.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .where('status', '==', 'claimed')
        .where('claim.expiresAt', '<=', input.now)
        .orderBy('claim.expiresAt', 'asc')
        .limit(queryLimit)
        .get(),
      ]);

    const ingest = this.parseIngestCandidates(
      interleaveRecoveryDocuments(
        pendingIngest.docs,
        expiredIngest.docs,
        publishedIngest.docs
      ),
      input.ownerDigest,
      input.now,
      ingestLimit
    );
    const terminal = this.parseTerminalCandidates(
      interleaveRecoveryDocuments(pendingTerminal.docs, expiredTerminal.docs),
      input.ownerDigest,
      input.limit - ingest.length
    );
    return { ingest, terminal };
  }

  public async listExpiredLeaseCandidates(
    input: MatrixCorpusRecoveryScanInput
  ): Promise<readonly AbandonExpiredRunInput[]> {
    assertScanInput(input);
    const snapshot = await this.dependencies.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .where('phase', 'in', NONTERMINAL_LEASE_PHASES)
      .where('expiresAt', '<=', input.now)
      .orderBy('expiresAt', 'asc')
      .limit(input.limit)
      .get();

    const candidates: AbandonExpiredRunInput[] = [];
    for (const document of snapshot.docs) {
      const parsed = matrixCorpusLeaseV1Schema.safeParse(document.data());
      if (!parsed.success) continue;
      const lease = parsed.data;
      let expectedSlot: string;
      let expectedRunFence: string;
      try {
        expectedSlot = this.dependencies.digests.digest('imc-lease-slot-v1', [
          lease.runtimeAudience,
          lease.userId,
        ]);
        expectedRunFence = this.dependencies.digests.digest('imc-run-fence-v1', [
          lease.runtimeAudience,
          lease.userId,
          lease.runId,
        ]);
      } catch {
        continue;
      }
      if (document.id !== expectedSlot || lease.runFenceDigest !== expectedRunFence) continue;
      candidates.push({
        runtimeAudience: lease.runtimeAudience,
        observedRunId: lease.runId,
        observedUserId: lease.userId,
        observedLeaseFence: lease.leaseFence,
      });
    }
    return candidates;
  }

  private parseIngestCandidates(
    documents: readonly QueryDocumentSnapshot[],
    ownerDigest: string,
    now: string,
    limit: number
  ): MatrixCorpusIngestDrainInput[] {
    const candidates: MatrixCorpusIngestDrainInput[] = [];
    const seen = new Set<string>();
    for (const document of documents) {
      if (candidates.length >= limit || seen.has(document.id)) continue;
      seen.add(document.id);
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(document.data());
      if (!parsed.success || parsed.data.ingestOutboxId !== document.id) continue;
      const outbox = parsed.data;
      const authority = this.deriveAuthority(outbox.runId, outbox.userId);
      if (authority === null) continue;
      const base = {
        runtimeAudience: 'home-dev',
        runId: outbox.runId,
        userId: outbox.userId,
        leaseFence: outbox.leaseFence,
        leaseSlotDigest: authority.leaseSlotDigest,
        runFenceDigest: authority.runFenceDigest,
        ownerDigest,
        ingestOutboxId: outbox.ingestOutboxId,
        payloadDigest: outbox.payloadDigest,
      } as const;
      if (outbox.status === 'published') {
        const claim = outbox.claim as NonNullable<typeof outbox.claim>;
        const publisherReceiptDigest = outbox.publisherReceiptDigest as string;
        const publishedAt = outbox.publishedAt as string;
        const reuseClaimExpiry =
          claim.ownerDigest === ownerDigest && Date.parse(claim.expiresAt) > Date.parse(now)
            ? claim.expiresAt
            : undefined;
        candidates.push({
          ...base,
          purpose: 'terminal_marker_recovery',
          ...(reuseClaimExpiry === undefined ? {} : { claimExpiresAt: reuseClaimExpiry }),
          publisherReceiptDigest,
          publishedAt,
        });
      } else {
        candidates.push({ ...base, purpose: 'publish' });
      }
    }
    return candidates;
  }

  private parseTerminalCandidates(
    documents: readonly QueryDocumentSnapshot[],
    ownerDigest: string,
    limit: number
  ): MatrixCorpusTerminalDrainInput[] {
    const candidates: MatrixCorpusTerminalDrainInput[] = [];
    const seen = new Set<string>();
    for (const document of documents) {
      if (candidates.length >= limit || seen.has(document.id)) continue;
      seen.add(document.id);
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(document.data());
      if (!parsed.success || parsed.data.terminalControlId !== document.id) continue;
      const outbox = parsed.data;
      const authority = this.deriveAuthority(outbox.runId, outbox.userId);
      if (authority === null) continue;
      candidates.push({
        runtimeAudience: 'home-dev',
        runId: outbox.runId,
        userId: outbox.userId,
        leaseFence: outbox.leaseFence,
        leaseSlotDigest: authority.leaseSlotDigest,
        runFenceDigest: authority.runFenceDigest,
        ownerDigest,
        terminalControlId: outbox.terminalControlId,
        eventId: outbox.eventId,
        payloadDigest: outbox.payloadDigest,
      });
    }
    return candidates;
  }

  private deriveAuthority(
    runId: string,
    userId: string
  ): Readonly<{ leaseSlotDigest: string; runFenceDigest: string }> | null {
    try {
      const leaseSlotDigest = this.dependencies.digests.digest('imc-lease-slot-v1', [
        'home-dev',
        userId,
      ]);
      const runFenceDigest = this.dependencies.digests.digest('imc-run-fence-v1', [
        'home-dev',
        userId,
        runId,
      ]);
      if (
        !matrixCorpusKeyedDigestSchema.safeParse(leaseSlotDigest).success ||
        !matrixCorpusKeyedDigestSchema.safeParse(runFenceDigest).success
      )
        return null;
      return { leaseSlotDigest, runFenceDigest };
    } catch {
      return null;
    }
  }
}

function interleaveRecoveryDocuments(
  ...groups: readonly (readonly QueryDocumentSnapshot[])[]
): QueryDocumentSnapshot[] {
  const documents: QueryDocumentSnapshot[] = [];
  const length = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < length; index += 1) {
    for (const group of groups) {
      const document = group[index];
      if (document !== undefined) documents.push(document);
    }
  }
  return documents;
}

function assertScanInput(input: MatrixCorpusRecoveryScanInput): void {
  if (
    !matrixCorpusRfc3339TimestampSchema.safeParse(input.now).success ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MATRIX_CORPUS_MAX_RECOVERY_SCAN_SIZE
  ) {
    throw new Error('Matrix corpus recovery scan input is invalid');
  }
}
