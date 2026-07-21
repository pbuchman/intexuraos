export interface MatrixCorpusRunManifestScenarioBindingV1 {
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  sessionId: string;
}

export interface MatrixCorpusTerminalCandidateV1 {
  version: 1;
  runId: string;
  userId: string;
  leaseFence: string;
  outcome: 'completed_passed' | 'completed_failed' | 'stopped_not_evaluated';
  projectionDigest: string;
  artifactStageRevision: number;
  artifactCandidateDigest: string;
  createdAt: string;
}

export interface MatrixCorpusArtifactStageV1 {
  revision: number;
  jsonCandidateDigest: string;
  markdownCandidateDigest: string;
  compositeDigest: string;
  stagedAt: string;
}

export interface MatrixCorpusRunManifestV1 {
  version: 1;
  runtimeAudience: 'home-dev';
  runId: string;
  userId: string;
  leaseFence: string;
  catalogDigest: string;
  scenarioBindings: MatrixCorpusRunManifestScenarioBindingV1[];
  artifactStage: MatrixCorpusArtifactStageV1 | null;
  terminalCandidate: MatrixCorpusTerminalCandidateV1 | null;
  createdAt: string;
}

export interface MatrixCorpusRunManifestIdentity {
  runId: string;
  userId: string;
  leaseFence: string;
}

export type MatrixCorpusManifestFailureCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CORRELATED_REPLAY_CONFLICT'
  | 'BINDING_CONFLICT'
  | 'BINDING_LIMIT_EXCEEDED'
  | 'INVALID_STATE'
  | 'CORRUPT_MANIFEST';

export type MatrixCorpusManifestMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      manifest: MatrixCorpusRunManifestV1;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusManifestFailureCode }>;

export type MatrixCorpusManifestGetResult =
  | Readonly<{ ok: true; manifest: MatrixCorpusRunManifestV1 }>
  | Readonly<{ ok: false; code: MatrixCorpusManifestFailureCode }>;

export interface MatrixCorpusManifestRepository {
  createOrGet(manifest: MatrixCorpusRunManifestV1): Promise<MatrixCorpusManifestMutationResult>;
  appendScenarioBinding(input: Readonly<{
    identity: MatrixCorpusRunManifestIdentity;
    binding: MatrixCorpusRunManifestScenarioBindingV1;
  }>): Promise<MatrixCorpusManifestMutationResult>;
  getExact(identity: MatrixCorpusRunManifestIdentity): Promise<MatrixCorpusManifestGetResult>;
}
