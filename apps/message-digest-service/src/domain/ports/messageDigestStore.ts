import type {
  MessageDigestDefinition,
  MessageDigestInstructions,
  MessageDigestSchedule,
  MessageDigestSource,
  MessageDigestState,
} from '../models/messageDigestDefinition.js';
import type { MessageDigestErasureRequest } from '../models/messageDigestErasure.js';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';

export interface DefinitionUpdatePatch {
  name?: string | undefined;
  nameSortKey?: string | undefined;
  status?: 'active' | 'paused' | undefined;
  listStatus?: 'active' | 'paused' | 'needs_attention' | undefined;
  attentionCode?: string | null | undefined;
  source?: MessageDigestSource | undefined;
  instructions?: MessageDigestInstructions | undefined;
  schedule?: MessageDigestSchedule | undefined;
  delivery?: MessageDigestDefinition['delivery'] | undefined;
  resetCheckpointAt?: string | undefined;
  nextRunAt?: string | undefined;
  releaseFailedPendingWindow?: true | undefined;
}

export interface ReserveRunInput {
  userId: string;
  definitionId: string;
  expectedDefinitionRevision: number;
  expectedStateRevision: number;
  expectedErasureEpoch: number;
  expectedReadinessObservationVersion: string;
  readinessObservation: {
    observationVersion: string;
    observedAt: string;
  };
  nextRunAt: string;
  run: MessageDigestRun;
  outbox: MessageDigestDispatchOutbox;
}

export type MessageDigestCompletionOutput = Pick<
  MessageDigestRun,
  | 'headline'
  | 'summaryMarkdown'
  | 'evidenceMessageRefs'
  | 'continuityMemoryMarkdown'
  | 'effectiveMessageCount'
  | 'promptVersion'
  | 'model'
  | 'usage'
>;

export interface MessageDigestStore {
  createDefinition(input: {
    definition: MessageDigestDefinition;
    state: MessageDigestState;
  }): Promise<
    | {
        ok: true;
        disposition: 'created' | 'existing';
        definition: MessageDigestDefinition;
      }
    | { ok: false; code: 'CREATE_CONFLICT' }
  >;
  getOwnedDefinition(userId: string, definitionId: string): Promise<MessageDigestDefinition | null>;
  getOwnedDefinitionByLegacyAlias(input: {
    userId: string;
    legacyGroupKey: string;
  }): Promise<MessageDigestDefinition | null>;
  getOwnedRunContext(
    userId: string,
    definitionId: string
  ): Promise<{ definition: MessageDigestDefinition; state: MessageDigestState } | null>;
  listOwnedDefinitions(input: {
    userId: string;
    query?: string | undefined;
    chatType?: 'group' | 'direct' | undefined;
    status?: 'active' | 'paused' | 'needs_attention' | undefined;
    sort?: 'name' | 'updatedAt' | 'nextRunAt' | undefined;
    direction?: 'asc' | 'desc' | undefined;
    limit: number;
    cursor?: string | undefined;
    queryFingerprint: string;
  }): Promise<{ items: MessageDigestDefinition[]; nextCursor: string | null }>;
  listDueDefinitions(input: {
    now: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: MessageDigestDefinition[]; nextCursor: string | null }>;
  listReadyDispatches(input: {
    now: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: MessageDigestDispatchOutbox[]; nextCursor: string | null }>;
  listPendingDeliveryRuns(input: {
    now: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: MessageDigestRun[]; nextCursor: string | null }>;
  updateDefinition(input: {
    userId: string;
    definitionId: string;
    expectedRevision: number;
    updatedAt: string;
    patch: DefinitionUpdatePatch;
  }): Promise<
    | { ok: true; definition: MessageDigestDefinition }
    | {
        ok: false;
        code:
          | 'NOT_FOUND'
          | 'REVISION_CONFLICT'
          | 'INVALID_TRANSITION'
          | 'SOURCE_LOCKED'
          | 'RUN_IN_PROGRESS';
      }
  >;
  reserveRun(input: ReserveRunInput): Promise<
    | { ok: true; disposition: 'reserved' | 'existing'; run: MessageDigestRun }
    | {
        ok: false;
        code:
          | 'NOT_FOUND'
          | 'NOT_ACTIVE'
          | 'REVISION_CONFLICT'
          | 'READINESS_CHANGED'
          | 'RUN_IN_PROGRESS'
          | 'RUN_CONFLICT';
      }
  >;
  claimRunLease(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    now: string;
    expiresAt: string;
  }): Promise<
    | { ok: true; disposition: 'acquired' | 'existing'; fence: number; run: MessageDigestRun }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_BUSY' | 'RUN_TERMINAL' | 'RESERVATION_LOST' }
  >;
  renewRunLease(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    expiresAt: string;
  }): Promise<
    | { ok: true; expiresAt: string }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RUN_TERMINAL' | 'RESERVATION_LOST' }
  >;
  markRunProcessingStage(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    processingStage: 'aggregating' | 'repairing';
  }): Promise<
    | { ok: true }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RUN_TERMINAL' | 'RESERVATION_LOST' }
  >;
  completeRun(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    completedAt: string;
    generationStatus: 'completed' | 'skipped_no_activity';
    output: MessageDigestCompletionOutput;
    deliveryOutbox?: MessageDigestDispatchOutbox | undefined;
  }): Promise<
    | { ok: true; disposition: 'completed' | 'existing'; run: MessageDigestRun }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RESERVATION_LOST' }
  >;
  failRun(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    failedAt: string;
    safeFailureCode: string;
    pauseDefinition: boolean;
  }): Promise<
    { ok: true } | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RESERVATION_LOST' }
  >;
  getOwnedDispatch(input: {
    userId: string;
    definitionId: string;
    runId: string;
    outboxId: string;
  }): Promise<MessageDigestDispatchOutbox | null>;
  retryFailedGeneration(input: {
    userId: string;
    definitionId: string;
    runId: string;
    retriedAt: string;
    outbox: MessageDigestDispatchOutbox;
  }): Promise<
    | { ok: true; disposition: 'retried' | 'existing'; run: MessageDigestRun }
    | { ok: false; code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'RUN_IN_PROGRESS' | 'RETRY_CONFLICT' }
  >;
  retryFailedDelivery(input: {
    userId: string;
    definitionId: string;
    runId: string;
    retriedAt: string;
    originalOutboxId: string;
    outbox: MessageDigestDispatchOutbox;
  }): Promise<
    | { ok: true; disposition: 'retried' | 'existing'; run: MessageDigestRun }
    | { ok: false; code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'RUN_IN_PROGRESS' | 'RETRY_CONFLICT' }
  >;
  recordRunDeliveryState(input: {
    userId: string;
    definitionId: string;
    runId: string;
    expectedErasureEpoch: number;
    observedAt: string;
    delivery:
      | { status: 'sent'; acceptedAt: string }
      | { status: 'ambiguous'; acceptedAt?: string | undefined }
      | { status: 'failed'; failedAt: string; failureCode: string };
  }): Promise<
    | { ok: true; disposition: 'updated' | 'existing'; run: MessageDigestRun }
    | { ok: false; code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'DELIVERY_CONFLICT' }
  >;
  recordRunDeliveryObservation(input: {
    userId: string;
    definitionId: string;
    runId: string;
    expectedErasureEpoch: number;
    expectedReconciliationAttempts: number;
    observedAt: string;
    nextCheckAt: string;
    observation: 'pending' | 'missing' | 'unavailable';
  }): Promise<
    | { ok: true; disposition: 'updated' | 'existing'; run: MessageDigestRun }
    | { ok: false; code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'DELIVERY_CONFLICT' }
  >;
  getOwnedRun(input: {
    userId: string;
    definitionId: string;
    runId: string;
  }): Promise<MessageDigestRun | null>;
  listOwnedRuns(input: {
    userId: string;
    definitionId: string;
    limit: number;
    cursor?: string | undefined;
    windowStartFrom?: string | undefined;
    windowStartBefore?: string | undefined;
    generationStatus?: MessageDigestRun['generationStatus'] | undefined;
    deliveryStatus?: MessageDigestRun['delivery']['status'] | undefined;
    direction?: 'asc' | 'desc' | undefined;
    queryFingerprint: string;
  }): Promise<{ items: MessageDigestRun[]; nextCursor: string | null }>;
  listOwnedLegacyRuns(input: {
    userId: string;
    definitionId: string;
    activeMigrationId: string;
    legacyGroupKey: string;
    limit: number;
    cursor?: string | undefined;
    scheduledBoundaryFrom?: string | undefined;
    scheduledBoundaryBefore?: string | undefined;
    queryFingerprint: string;
  }): Promise<{ items: MessageDigestRun[]; nextCursor: string | null }>;
  claimDispatch(input: {
    outboxId: string;
    ownerDigest: string;
    now: string;
    expiresAt: string;
  }): Promise<
    | {
        ok: true;
        disposition: 'claimed' | 'existing';
        fence: number;
        dispatch: MessageDigestDispatchOutbox;
      }
    | {
        ok: false;
        code: 'NOT_FOUND' | 'NOT_READY' | 'CLAIM_BUSY' | 'TERMINAL' | 'RESERVATION_LOST';
      }
  >;
  renewDispatchClaim(input: {
    outboxId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    expiresAt: string;
  }): Promise<
    | { ok: true; expiresAt: string }
    | { ok: false; code: 'NOT_FOUND' | 'CLAIM_LOST' }
  >;
  recordDispatchResult(input: {
    outboxId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    outcome:
      | { status: 'published'; publishedAt: string }
      | { status: 'retry'; nextAttemptAt: string }
      | { status: 'terminal'; terminalCode: string };
  }): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'CLAIM_LOST' }>;
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
    | {
        ok: true;
        disposition: 'acquired' | 'existing';
        fence: number;
        expiresAt: string;
      }
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
  getOwnedErasureRequest(
    userId: string,
    erasureRequestId: string
  ): Promise<MessageDigestErasureRequest | null>;
  startOrResumeDefinitionErasure(input: {
    userId: string;
    definitionId: string;
    erasureRequestId: string;
    requestIdDigest: string;
    now: string;
    limit: number;
  }): Promise<
    | {
        ok: true;
        status: 'in_progress' | 'completed';
        deletedThisCall: number;
        request: MessageDigestErasureRequest;
      }
    | { ok: false; code: 'NOT_FOUND' | 'ERASURE_CONFLICT' }
  >;
}
