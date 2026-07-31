export type MessageDigestErasureStage =
  | 'quiescing'
  | 'runs'
  | 'outbox'
  | 'state'
  | 'definition'
  | 'legacy'
  | 'completed';

export interface MessageDigestErasureRequest {
  version: 1;
  erasureRequestId: string;
  requestIdDigest: string;
  userId: string;
  definitionId: string;
  erasureEpoch: number;
  stage: MessageDigestErasureStage;
  cursor: string | null;
  deletedCounts: {
    runs: number;
    outbox: number;
    state: number;
    definition: number;
    legacy: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: number | null;
}

export interface MessageDigestMigrationActivation {
  version: 1;
  migrationId: string;
  userId: string;
  definitionId: string;
  legacyGroupKey?: string | null;
  status: 'preparing' | 'staging' | 'active' | 'rollback_pending' | 'failed';
  leaseOwnerDigest: string | null;
  leaseExpiresAt: string | null;
  step: string;
  cutoverDeadline: string;
  baselineHash: string | null;
  replayHash: string | null;
  verificationHash?: string | null;
  safeCounts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}
