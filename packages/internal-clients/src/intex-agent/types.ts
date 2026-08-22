import type {
  MatrixCorpusAgentModel,
  MatrixCorpusEvaluatorModel,
  MatrixCorpusSignedControlMutationV1,
  MatrixCorpusSignedTerminalControlV1,
} from '@intexuraos/http-contracts';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';
import type { MatrixCorpusClientResult } from '../whatsapp-service/types.js';

export interface IntexAgentServiceClientConfig {
  readonly baseUrl: string;
  readonly internalAuthToken: string;
  readonly logger: InternalHttpClientLogger;
  readonly defaultTimeoutMs?: number;
  readonly pathPrefix?: string;
  readonly authorizationHeaderProvider?: () => Promise<string>;
}

export interface MatrixCorpusIdentityInput {
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
}

export type MatrixCorpusAdmissionResult =
  | {
      readonly kind: 'admission_ready';
      readonly current:
        | 'absent'
        | 'terminal_artifact_ready'
        | 'terminal_artifact_failed'
        | 'terminal_artifact_unknown';
    }
  | {
      readonly kind: 'admission_blocked';
      readonly reason:
        | 'preflight'
        | 'running'
        | 'finalizing'
        | 'artifact_pending'
        | 'artifact_staged';
    }
  | { readonly kind: 'not_ready' };

export interface MatrixCorpusRegisterContextRequest {
  readonly runtimeAudience: 'hetzner-prod';
  readonly userId: string;
  readonly leaseFence: string;
  readonly catalogDigest: string;
  readonly agentModel: MatrixCorpusAgentModel;
  readonly evaluatorModel: MatrixCorpusEvaluatorModel;
  readonly expectedTimeZone: 'Europe/Warsaw';
}

export interface MatrixCorpusAuthorizedRequest<T> {
  readonly runId: string;
  readonly authorization: MatrixCorpusSignedControlMutationV1;
  readonly request: T;
}

export interface MatrixCorpusContextResult {
  readonly disposition: 'applied' | 'already_applied';
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
  readonly promptPreferencesVersion: number;
  readonly promptPreferencesDigest: string;
  readonly agentModel: MatrixCorpusAgentModel;
  readonly userTimeZone: string;
  readonly expiresAt: string;
}

export interface MatrixCorpusFinalizeRequest extends Record<string, unknown> {
  readonly runtimeAudience: 'hetzner-prod';
  readonly userId: string;
  readonly leaseFence: string;
  readonly expectedRevision: number;
  readonly artifactStageDigest: string;
  readonly terminalCandidate: Readonly<Record<string, unknown>>;
}

export interface MatrixCorpusFinalizeResult {
  readonly disposition: 'applied' | 'already_applied';
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
  readonly tombstoneDigest: string;
  readonly scenarioContextCount: number;
  readonly finalizedAt: string;
}

export type MatrixCorpusControlStatusResult =
  | { readonly kind: 'not_ready' }
  | {
      readonly kind: 'status';
      readonly runId: string;
      readonly userId: string;
      readonly leaseFence: string;
      readonly lifecycle: 'preflight' | 'running' | 'finalizing' | 'completed' | 'stopped';
      readonly revision: number;
      readonly contextReady: true;
      readonly manifestReady: true;
      readonly preflightProjectionReady: boolean;
      readonly retentionReconciled: boolean;
      readonly contextFinalizationTombstoneDigest: string | null;
      readonly terminalCandidateDigest: string | null;
      readonly artifactStageDigest: string | null;
      readonly terminalControlEventId: string | null;
    };

export interface MatrixCorpusEvidenceInput extends MatrixCorpusIdentityInput {
  readonly scenarioId: string;
  readonly sessionId: string;
  readonly eventRevision: number;
}

export type MatrixCorpusScenarioStatusResult =
  | { readonly kind: 'not_ready' }
  | {
      readonly kind: 'status';
      readonly runId: string;
      readonly userId: string;
      readonly leaseFence: string;
      readonly scenarioId: string;
      readonly sessionId: string;
      readonly eventRevision: number;
      readonly lifecycle: 'running' | 'completed' | 'stopped';
      readonly pendingConfirmationId: string | null;
    };

export type MatrixCorpusFinalizationReadinessResult =
  | { readonly kind: 'not_ready' }
  | {
      readonly kind: 'ready';
      readonly runId: string;
      readonly userId: string;
      readonly leaseFence: string;
      readonly revision: number;
      readonly projectionDigest: string;
      readonly artifactStageDigest: string;
    };

export interface MatrixCorpusSafeToolEvidence {
  readonly event: 'selected' | 'mock_completed' | 'mock_failed' | 'unexpected_known_no_execution';
  readonly toolName: string;
  readonly turnIndex: number;
  readonly ordinal: number;
  readonly facts: readonly { readonly name: string; readonly value: number | boolean | string }[];
}

export interface MatrixCorpusSafeAgentUsage {
  readonly turnIndex: number;
  readonly stage:
    | 'intent_classification'
    | 'calendar_update_planning'
    | 'agent_generation'
    | 'response_schema_repair';
  readonly callOrdinal: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costNanoUsd: number;
}

export type MatrixCorpusSafeTurnTerminal =
  | {
      readonly status: 'completed';
      readonly turnIndex: number;
      readonly replyCount: number;
      readonly replyDigests: readonly string[];
      readonly terminalMarkerDigest: string;
      readonly recordedAt: string;
    }
  | {
      readonly status: 'failed';
      readonly turnIndex: number;
      readonly failureCode:
        | 'AMBIGUOUS_EXTERNAL_EFFECT'
        | 'REPLY_PUBLICATION_REJECTED'
        | 'EXECUTION_REJECTED';
      readonly terminalMarkerDigest: string;
      readonly recordedAt: string;
    };

export interface MatrixCorpusEvidenceResult {
  readonly version: 1;
  readonly eventRevision: number;
  readonly toolEvidence: readonly MatrixCorpusSafeToolEvidence[];
  readonly agentUsage: readonly MatrixCorpusSafeAgentUsage[];
  readonly agentUsageTotals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly costNanoUsd: number;
  };
  readonly sessionProof: {
    readonly status:
      | 'active'
      | 'waiting_for_user'
      | 'completed'
      | 'unsupported'
      | 'expired'
      | 'cancelled'
      | 'superseded';
    readonly startReason:
      | 'no_active_session'
      | 'previous_completed'
      | 'previous_expired'
      | 'previous_superseded'
      | 'user_requested_new_session';
    readonly userMessageCount: number;
    readonly sessionStartedCount: number;
    readonly supersededSessionCount: number;
  };
  readonly turnTerminals: readonly MatrixCorpusSafeTurnTerminal[];
  readonly strictMockProof: {
    readonly version: 1;
    readonly status: 'passed';
    readonly executionMode: 'strict_mock_tools';
    readonly mockProfileDigest: string;
    readonly productionExecutorResolutions: 0;
    readonly productionExecutorAdmissions: 0;
  };
}

export type MatrixCorpusProjectionRequest =
  | { readonly kind: 'create'; readonly record: Readonly<Record<string, unknown>> }
  | {
      readonly kind: 'cas';
      readonly userId: string;
      readonly leaseFence: string;
      readonly command: Readonly<Record<string, unknown>>;
    };

export interface MatrixCorpusProjectionResult {
  readonly disposition: 'applied' | 'already_applied';
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
  readonly revision: number;
  readonly lifecycle: 'preflight' | 'running' | 'finalizing' | 'completed' | 'stopped';
  readonly verdict: 'pending' | 'passed' | 'failed' | 'not_evaluated';
}

export type MatrixCorpusArtifactDeliveryCommand = Readonly<Record<string, unknown>>;

export interface MatrixCorpusArtifactDeliveryResult extends MatrixCorpusProjectionResult {
  readonly artifactDelivery:
    | {
        readonly status: 'pending' | 'staged' | 'ready';
        readonly failureCode: null;
        readonly updatedAt: string;
      }
    | {
        readonly status: 'failed';
        readonly failureCode:
          | 'REPORT_STAGING_INTERRUPTED'
          | 'REPORT_STAGING_FAILED'
          | 'REPORT_VALIDATION_FAILED'
          | 'REPORT_PUBLICATION_FAILED';
        readonly updatedAt: string;
      }
    | {
        readonly status: 'unknown';
        readonly failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT';
        readonly updatedAt: string;
      };
}

export interface MatrixCorpusCleanupRequest {
  readonly targetRunId: string;
  readonly targetLeaseFence: string;
  readonly updatedAt: string;
}

export interface MatrixCorpusRetentionRecord {
  readonly runId: string;
  readonly leaseFence: string;
  readonly startedAt: string;
  readonly lifecycle: 'preflight' | 'running' | 'finalizing' | 'completed' | 'stopped';
  readonly verdict: 'pending' | 'passed' | 'failed' | 'not_evaluated';
  readonly artifactDelivery: 'pending' | 'staged' | 'ready' | 'failed' | 'unknown';
  readonly completedAt: string | null;
  readonly isCurrent: boolean;
}

export interface MatrixCorpusRetentionPlanResult extends MatrixCorpusIdentityInput {
  readonly kind: 'retention_plan';
  readonly records: readonly MatrixCorpusRetentionRecord[];
}

export interface IntexMatrixCorpusCleanupResult {
  readonly disposition: 'applied' | 'already_applied';
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
  readonly currentRevision: number;
  readonly retentionReconciled: true;
  readonly removed: Readonly<
    Record<
      | 'runs'
      | 'sessions'
      | 'events'
      | 'confirmations'
      | 'ingestReceipts'
      | 'scenarioProjections'
      | 'scenarioContexts'
      | 'runContexts'
      | 'manifests',
      number
    >
  >;
}

export interface MatrixCorpusTerminalControlInput {
  readonly runId: string;
  readonly envelope: MatrixCorpusSignedTerminalControlV1;
}

export interface MatrixCorpusTerminalControlResult {
  readonly kind: 'acknowledged';
  readonly runId: string;
  readonly leaseFence: string;
  readonly requestEventId: string;
  readonly requestPayloadDigest: string;
  readonly winner: Readonly<Record<string, unknown>>;
}

export interface IntexAgentServiceClient {
  getMatrixCorpusCurrentAcceptance(
    userId: string
  ): Promise<MatrixCorpusClientResult<MatrixCorpusAdmissionResult>>;
  registerMatrixCorpusContext(
    input: MatrixCorpusAuthorizedRequest<MatrixCorpusRegisterContextRequest>
  ): Promise<MatrixCorpusClientResult<MatrixCorpusContextResult>>;
  finalizeMatrixCorpusContext(
    input: MatrixCorpusAuthorizedRequest<MatrixCorpusFinalizeRequest>
  ): Promise<MatrixCorpusClientResult<MatrixCorpusFinalizeResult>>;
  getMatrixCorpusControlStatus(
    input: MatrixCorpusIdentityInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusControlStatusResult>>;
  getMatrixCorpusEvidence(
    input: MatrixCorpusEvidenceInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusEvidenceResult>>;
  getMatrixCorpusScenarioStatus(
    input: MatrixCorpusIdentityInput & { readonly scenarioId: string }
  ): Promise<MatrixCorpusClientResult<MatrixCorpusScenarioStatusResult>>;
  getMatrixCorpusFinalizationReadiness(
    input: MatrixCorpusIdentityInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusFinalizationReadinessResult>>;
  getMatrixCorpusRetentionPlan(
    input: MatrixCorpusIdentityInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusRetentionPlanResult>>;
  mutateMatrixCorpusProjection(
    input: MatrixCorpusAuthorizedRequest<MatrixCorpusProjectionRequest>
  ): Promise<MatrixCorpusClientResult<MatrixCorpusProjectionResult>>;
  mutateMatrixCorpusArtifactDelivery(
    input: MatrixCorpusIdentityInput & { readonly command: MatrixCorpusArtifactDeliveryCommand }
  ): Promise<MatrixCorpusClientResult<MatrixCorpusArtifactDeliveryResult>>;
  applyMatrixCorpusTerminalControl(
    input: MatrixCorpusTerminalControlInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusTerminalControlResult>>;
  cleanupMatrixCorpusRun(
    input: MatrixCorpusIdentityInput & { readonly request: MatrixCorpusCleanupRequest }
  ): Promise<MatrixCorpusClientResult<IntexMatrixCorpusCleanupResult>>;
}
