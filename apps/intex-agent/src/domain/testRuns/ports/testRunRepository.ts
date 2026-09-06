import type {
  IntexAgentTestRunRecordV1,
  MatrixCorpusTerminalCandidateV1,
  TestRunScenarioProjectionV1,
  TestRunArtifactDeliveryCommandV1,
  TestRunTerminalWinnerV1,
  TestRunProjectionCasCommandV1,
  TestRunTerminalControlCommandV1,
} from '../types.js';
import type { IntexAgentSessionEvent } from '../../sessions/types.js';

export interface TestRunIdentity {
  runId: string;
  userId: string;
  leaseFence: string;
}

export type TestRunRepositoryFailureCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CORRELATED_REPLAY_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'SCENARIO_REVISION_CONFLICT'
  | 'EVENT_WATERMARK_GAP'
  | 'EVIDENCE_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'FINALIZATION_MISMATCH'
  | 'TERMINAL_CONFLICT'
  | 'DOCUMENT_TOO_LARGE'
  | 'STALE_PROJECTION'
  | 'CORRUPT_RECORD';

export type TestRunRepositoryMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      record: IntexAgentTestRunRecordV1;
    }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export type TestRunRepositoryGetResult =
  | Readonly<{ ok: true; record: IntexAgentTestRunRecordV1 }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export type TestRunRepositoryListResult =
  | Readonly<{ ok: true; records: IntexAgentTestRunRecordV1[] }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export type TestRunScenarioReadResult =
  | Readonly<{
      ok: true;
      run: IntexAgentTestRunRecordV1;
      projection: TestRunScenarioProjectionV1;
      events: IntexAgentSessionEvent[];
    }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export type TestRunRepositoryFinalizationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      record: IntexAgentTestRunRecordV1;
      tombstoneDigest: string;
      scenarioContextCount: number;
      finalizedAt: string;
    }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export type TestRunRepositoryAbandonedRecoveryResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      winner: TestRunTerminalWinnerV1;
    }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export interface TestRunCleanupCounts {
  runs: number;
  sessions: number;
  events: number;
  confirmations: number;
  ingestReceipts: number;
  scenarioProjections: number;
  scenarioContexts: number;
  runContexts: number;
  manifests: number;
}

export type TestRunRepositoryCleanupResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      currentRecord: IntexAgentTestRunRecordV1;
      removed: TestRunCleanupCounts;
    }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export type TestRunCurrentAcceptance =
  | Readonly<{
      kind: 'admission_ready';
      current:
        | 'absent'
        | 'terminal_artifact_ready'
        | 'terminal_artifact_failed'
        | 'terminal_artifact_unknown';
    }>
  | Readonly<{
      kind: 'admission_blocked';
      reason: 'preflight' | 'running' | 'finalizing' | 'artifact_pending' | 'artifact_staged';
    }>;

export type TestRunCurrentAcceptanceResult =
  | Readonly<{ ok: true; acceptance: TestRunCurrentAcceptance }>
  | Readonly<{ ok: false; code: TestRunRepositoryFailureCode }>;

export interface TestRunRepository {
  getCurrentAcceptance(userId: string): Promise<TestRunCurrentAcceptanceResult>;
  listLatestForUser(userId: string, limit: number): Promise<TestRunRepositoryListResult>;
  listStagedArtifactsFinishedBefore(input: Readonly<{
    cutoff: string;
    limit: number;
  }>): Promise<TestRunRepositoryListResult>;
  createOrGet(record: IntexAgentTestRunRecordV1): Promise<TestRunRepositoryMutationResult>;
  getExact(identity: TestRunIdentity): Promise<TestRunRepositoryGetResult>;
  getOwned(runId: string, userId: string): Promise<TestRunRepositoryGetResult>;
  getScenarioConsistent(input: Readonly<{
    runId: string;
    scenarioId: string;
    userId: string;
  }>): Promise<TestRunScenarioReadResult>;
  applyArtifactDelivery(input: Readonly<{
    identity: TestRunIdentity;
    command: TestRunArtifactDeliveryCommandV1;
  }>): Promise<TestRunRepositoryMutationResult>;
  cleanupExactRun(input: Readonly<{
    currentIdentity: TestRunIdentity;
    targetIdentity: TestRunIdentity;
    updatedAt: string;
  }>): Promise<TestRunRepositoryCleanupResult>;
  applyProjection(input: Readonly<{
    identity: TestRunIdentity;
    command: TestRunProjectionCasCommandV1;
  }>): Promise<TestRunRepositoryMutationResult>;
  finalizeRun(input: Readonly<{
    identity: TestRunIdentity;
    expectedRevision: number;
    updatedAt: string;
    artifactStageDigest: string;
    terminalCandidate: MatrixCorpusTerminalCandidateV1;
  }>): Promise<TestRunRepositoryFinalizationResult>;
  applyAbandonedRecovery(input: Readonly<{
    identity: TestRunIdentity;
    command: Extract<TestRunTerminalControlCommandV1, { kind: 'abandoned' }>;
  }>): Promise<TestRunRepositoryAbandonedRecoveryResult>;
  applyTerminalControl(input: Readonly<{
    identity: TestRunIdentity;
    command: TestRunTerminalControlCommandV1;
  }>): Promise<TestRunRepositoryMutationResult>;
}
