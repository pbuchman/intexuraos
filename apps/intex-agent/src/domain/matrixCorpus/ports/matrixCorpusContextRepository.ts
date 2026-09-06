import type {
  MatrixCorpusAgentModel,
  MatrixCorpusEvaluatorModel,
} from '@intexuraos/http-contracts';
import type { MatrixCorpusEncryptedValueV1 } from '../contextCrypto.js';
import type { MatrixCorpusRunManifestV1 } from './matrixCorpusManifestRepository.js';

export interface MatrixCorpusPrivateRunContextV1 {
  version: 1;
  status: 'active';
  runtimeAudience: 'hetzner-prod';
  runId: string;
  userId: string;
  leaseFence: string;
  catalogDigest: string;
  agentModel: MatrixCorpusAgentModel;
  evaluatorModel: MatrixCorpusEvaluatorModel;
  promptPreferencesVersion: number;
  promptPreferencesDigest: string;
  encryptedPromptContext: MatrixCorpusEncryptedValueV1;
  userTimeZone: string;
  createdAt: string;
  expiresAt: string;
  invalidatedAt: string | null;
}

export interface MatrixCorpusPrivateScenarioContextV1 {
  version: 1;
  runtimeAudience: 'hetzner-prod';
  runId: string;
  scenarioId: string;
  userId: string;
  leaseFence: string;
  baselinePromptPreferencesDigest: string;
  overlayVersion: number;
  overlayDigest: string;
  encryptedEffectivePromptContext: MatrixCorpusEncryptedValueV1;
  lastAppliedMutationReceipt: string | null;
  expiresAt: string;
  invalidatedAt: string | null;
}

export interface MatrixCorpusContextFinalizationV1 {
  version: 1;
  status: 'finalized';
  runtimeAudience: 'hetzner-prod';
  runId: string;
  userId: string;
  leaseFence: string;
  scenarioContextCount: number;
  finalizedAt: string;
}

export type MatrixCorpusRunContextRecordV1 =
  | MatrixCorpusPrivateRunContextV1
  | MatrixCorpusContextFinalizationV1;

export interface MatrixCorpusContextIdentity {
  runId: string;
  userId: string;
  leaseFence: string;
}

export type MatrixCorpusContextFailureCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CORRELATED_REPLAY_CONFLICT'
  | 'CORRUPT_CONTEXT'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'FINALIZED'
  | 'MANIFEST_MISMATCH';

export type MatrixCorpusRunContextMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      context: MatrixCorpusRunContextRecordV1;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusContextFailureCode }>;

export type MatrixCorpusScenarioContextMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      context: MatrixCorpusPrivateScenarioContextV1;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusContextFailureCode }>;

export type MatrixCorpusRunContextGetResult =
  | Readonly<{ ok: true; context: MatrixCorpusRunContextRecordV1 }>
  | Readonly<{ ok: false; code: MatrixCorpusContextFailureCode }>;

export type MatrixCorpusScenarioContextGetResult =
  | Readonly<{ ok: true; context: MatrixCorpusPrivateScenarioContextV1 }>
  | Readonly<{ ok: false; code: MatrixCorpusContextFailureCode }>;

export interface MatrixCorpusContextRepository {
  registerRunContextAndManifest(input: Readonly<{
    context: MatrixCorpusPrivateRunContextV1;
    manifest: MatrixCorpusRunManifestV1;
  }>): Promise<MatrixCorpusRunContextMutationResult>;
  registerRunContext(
    context: MatrixCorpusPrivateRunContextV1
  ): Promise<MatrixCorpusRunContextMutationResult>;
  registerScenarioContext(
    context: MatrixCorpusPrivateScenarioContextV1
  ): Promise<MatrixCorpusScenarioContextMutationResult>;
  replaceScenarioContext(input: Readonly<{
    identity: MatrixCorpusContextIdentity & Readonly<{ scenarioId: string }>;
    expectedOverlayVersion: number;
    expectedOverlayDigest: string;
    context: MatrixCorpusPrivateScenarioContextV1;
    now: string;
  }>): Promise<MatrixCorpusScenarioContextMutationResult>;
  getRunContext(
    input: MatrixCorpusContextIdentity & Readonly<{ now: string }>
  ): Promise<MatrixCorpusRunContextGetResult>;
  getScenarioContext(
    input: MatrixCorpusContextIdentity & Readonly<{ scenarioId: string; now: string }>
  ): Promise<MatrixCorpusScenarioContextGetResult>;
  finalizeRunContext(
    input: MatrixCorpusContextIdentity & Readonly<{ now: string }>
  ): Promise<MatrixCorpusRunContextMutationResult>;
}
