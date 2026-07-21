import type { Firestore } from '@intexuraos/infra-firestore';

import { digestArtifactCandidates } from '../../domain/testRuns/stateMachine.js';
import type {
  MatrixCorpusManifestFailureCode,
  MatrixCorpusManifestGetResult,
  MatrixCorpusManifestMutationResult,
  MatrixCorpusManifestRepository,
  MatrixCorpusArtifactStageV1,
  MatrixCorpusRunManifestIdentity,
  MatrixCorpusRunManifestScenarioBindingV1,
  MatrixCorpusRunManifestV1,
  MatrixCorpusTerminalCandidateV1,
} from '../../domain/matrixCorpus/ports/matrixCorpusManifestRepository.js';

export const INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION =
  'intex_agent_matrix_corpus_run_manifests';

const MAX_SCENARIO_BINDINGS = 20;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const FENCE_PATTERN = /^[1-9][0-9]{0,19}$/u;
const manifestKeys = [
  'artifactStage',
  'catalogDigest',
  'createdAt',
  'leaseFence',
  'runId',
  'runtimeAudience',
  'scenarioBindings',
  'terminalCandidate',
  'userId',
  'version',
] as const;
const artifactStageKeys = [
  'compositeDigest',
  'jsonCandidateDigest',
  'markdownCandidateDigest',
  'revision',
  'stagedAt',
] as const;
const bindingKeys = ['scenarioId', 'scenarioLabel', 'scenarioNumber', 'sessionId'] as const;
const candidateKeys = [
  'artifactCandidateDigest',
  'artifactStageRevision',
  'createdAt',
  'leaseFence',
  'outcome',
  'projectionDigest',
  'runId',
  'userId',
  'version',
] as const;
const terminalOutcomes = new Set([
  'completed_passed',
  'completed_failed',
  'stopped_not_evaluated',
]);

export interface FirestoreMatrixCorpusManifestRepositoryDeps {
  firestore: Firestore;
}

export class FirestoreMatrixCorpusManifestRepository
  implements MatrixCorpusManifestRepository
{
  private readonly firestore: Firestore;

  constructor(deps: FirestoreMatrixCorpusManifestRepositoryDeps) {
    this.firestore = deps.firestore;
  }

  async createOrGet(
    manifest: MatrixCorpusRunManifestV1
  ): Promise<MatrixCorpusManifestMutationResult> {
    if (!isValidIdentity(manifest)) return failure('INVALID_INPUT');
    const ref = this.manifestRef(manifest.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const existing = parseMatrixCorpusRunManifestDocument(snapshot.data());
        if (existing === undefined) return failure('CORRUPT_MANIFEST');
        if (!sameRegistration(existing, manifest))
          return failure('CORRELATED_REPLAY_CONFLICT');
        return success('already_applied', existing);
      }
      if (!isValidManifest(manifest) || manifest.scenarioBindings.length !== 0)
        return failure('INVALID_INPUT');
      transaction.set(ref, cloneManifest(manifest));
      return success('applied', manifest);
    });
  }

  async appendScenarioBinding(
    input: Parameters<MatrixCorpusManifestRepository['appendScenarioBinding']>[0]
  ): Promise<MatrixCorpusManifestMutationResult> {
    if (!isValidIdentity(input.identity)) return failure('INVALID_INPUT');
    const ref = this.manifestRef(input.identity.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return failure('NOT_FOUND');
      const existing = parseMatrixCorpusRunManifestDocument(snapshot.data());
      if (existing === undefined) return failure('CORRUPT_MANIFEST');
      if (!sameIdentity(existing, input.identity))
        return failure('CORRELATED_REPLAY_CONFLICT');
      if (existing.terminalCandidate !== null) return failure('INVALID_STATE');

      const previous = existing.scenarioBindings.find(
        (binding) => binding.scenarioId === input.binding.scenarioId
      );
      if (previous !== undefined)
        return sameBinding(previous, input.binding)
          ? success('already_applied', existing)
          : failure('BINDING_CONFLICT');
      if (existing.scenarioBindings.length >= MAX_SCENARIO_BINDINGS)
        return failure('BINDING_LIMIT_EXCEEDED');
      if (!isValidBinding(input.binding)) return failure('BINDING_CONFLICT');
      if (
        input.binding.scenarioNumber !== existing.scenarioBindings.length + 1 ||
        existing.scenarioBindings.some(
          (binding) =>
            binding.scenarioNumber === input.binding.scenarioNumber ||
            binding.sessionId === input.binding.sessionId
        )
      )
        return failure('BINDING_CONFLICT');

      const updated: MatrixCorpusRunManifestV1 = {
        ...existing,
        scenarioBindings: [...existing.scenarioBindings, { ...input.binding }],
      };
      transaction.set(ref, updated);
      return success('applied', updated);
    });
  }

  async getExact(
    identity: MatrixCorpusRunManifestIdentity
  ): Promise<MatrixCorpusManifestGetResult> {
    if (!isValidIdentity(identity)) return failure('INVALID_INPUT');
    const snapshot = await this.manifestRef(identity.runId).get();
    if (!snapshot.exists) return failure('NOT_FOUND');
    const manifest = parseMatrixCorpusRunManifestDocument(snapshot.data());
    if (manifest === undefined) return failure('CORRUPT_MANIFEST');
    if (!sameIdentity(manifest, identity)) return failure('CORRELATED_REPLAY_CONFLICT');
    return { ok: true, manifest: cloneManifest(manifest) };
  }

  private manifestRef(
    runId: string
  ): ReturnType<ReturnType<Firestore['collection']>['doc']> {
    return this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(runId);
  }
}

function failure(
  code: MatrixCorpusManifestFailureCode
): Readonly<{ ok: false; code: MatrixCorpusManifestFailureCode }> {
  return { ok: false, code } as const;
}

function success(
  disposition: 'applied' | 'already_applied',
  manifest: MatrixCorpusRunManifestV1
): MatrixCorpusManifestMutationResult {
  return { ok: true, disposition, manifest: cloneManifest(manifest) };
}

function sameRegistration(
  existing: MatrixCorpusRunManifestV1,
  proposed: MatrixCorpusRunManifestV1
): boolean {
  return (
    sameIdentity(existing, proposed) &&
    (existing as { runtimeAudience: string }).runtimeAudience ===
      (proposed as { runtimeAudience: string }).runtimeAudience &&
    existing.catalogDigest === proposed.catalogDigest &&
    existing.artifactStage === null &&
    proposed.artifactStage === null &&
    existing.terminalCandidate === null &&
    proposed.terminalCandidate === null &&
    proposed.scenarioBindings.length === 0
  );
}

function sameIdentity(
  manifest: MatrixCorpusRunManifestV1,
  identity: MatrixCorpusRunManifestIdentity
): boolean {
  return (
    manifest.runId === identity.runId &&
    manifest.userId === identity.userId &&
    manifest.leaseFence === identity.leaseFence
  );
}

function sameBinding(
  left: MatrixCorpusRunManifestScenarioBindingV1,
  right: MatrixCorpusRunManifestScenarioBindingV1
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.scenarioNumber === right.scenarioNumber &&
    left.scenarioLabel === right.scenarioLabel &&
    left.sessionId === right.sessionId
  );
}

function isValidIdentity(value: MatrixCorpusRunManifestIdentity): boolean {
  return (
    SAFE_ID_PATTERN.test(value.runId) &&
    SAFE_ID_PATTERN.test(value.userId) &&
    FENCE_PATTERN.test(value.leaseFence)
  );
}

function isValidManifest(value: MatrixCorpusRunManifestV1): boolean {
  return (
    (value as { version: number }).version === 1 &&
    (value as { runtimeAudience: string }).runtimeAudience === 'home-dev' &&
    isValidIdentity(value) &&
    SHA_256_PATTERN.test(value.catalogDigest) &&
    value.scenarioBindings.length <= MAX_SCENARIO_BINDINGS &&
    value.scenarioBindings.every(isValidBinding) &&
    hasUniqueBindings(value.scenarioBindings) &&
    isValidArtifactStage(value.artifactStage) &&
    isValidTerminalCandidate(value.terminalCandidate, value) &&
    isValidArtifactCandidateBinding(value.artifactStage, value.terminalCandidate) &&
    isRfc3339(value.createdAt)
  );
}

function isValidArtifactStage(value: MatrixCorpusArtifactStageV1 | null): boolean {
  return (
    value === null ||
    (Number.isSafeInteger(value.revision) &&
      value.revision >= 1 &&
      SHA_256_PATTERN.test(value.jsonCandidateDigest) &&
      SHA_256_PATTERN.test(value.markdownCandidateDigest) &&
      SHA_256_PATTERN.test(value.compositeDigest) &&
      value.compositeDigest ===
        digestArtifactCandidates(
          value.jsonCandidateDigest,
          value.markdownCandidateDigest
        ) &&
      isRfc3339(value.stagedAt))
  );
}

function isValidArtifactCandidateBinding(
  stage: MatrixCorpusArtifactStageV1 | null,
  candidate: MatrixCorpusTerminalCandidateV1 | null
): boolean {
  return (
    candidate === null ||
    (stage !== null &&
      candidate.artifactStageRevision === stage.revision &&
      candidate.artifactCandidateDigest === stage.compositeDigest)
  );
}

function isValidBinding(value: MatrixCorpusRunManifestScenarioBindingV1): boolean {
  return (
    SAFE_ID_PATTERN.test(value.scenarioId) &&
    SAFE_ID_PATTERN.test(value.sessionId) &&
    Number.isInteger(value.scenarioNumber) &&
    value.scenarioNumber >= 1 &&
    value.scenarioNumber <= MAX_SCENARIO_BINDINGS &&
    value.scenarioLabel.length >= 1 &&
    value.scenarioLabel.length <= 128 &&
    value.scenarioLabel.trim() === value.scenarioLabel
  );
}

function hasUniqueBindings(bindings: readonly MatrixCorpusRunManifestScenarioBindingV1[]): boolean {
  const scenarioIds = new Set<string>();
  const scenarioNumbers = new Set<number>();
  const sessionIds = new Set<string>();
  for (const binding of bindings) {
    if (
      scenarioIds.has(binding.scenarioId) ||
      scenarioNumbers.has(binding.scenarioNumber) ||
      sessionIds.has(binding.sessionId)
    )
      return false;
    scenarioIds.add(binding.scenarioId);
    scenarioNumbers.add(binding.scenarioNumber);
    sessionIds.add(binding.sessionId);
  }
  return true;
}

function isValidTerminalCandidate(
  value: MatrixCorpusTerminalCandidateV1 | null,
  manifest: MatrixCorpusRunManifestV1
): boolean {
  if (value === null) return true;
  return (
    (value as { version: number }).version === 1 &&
    sameIdentity(manifest, value) &&
    terminalOutcomes.has(value.outcome) &&
    SHA_256_PATTERN.test(value.projectionDigest) &&
    Number.isInteger(value.artifactStageRevision) &&
    value.artifactStageRevision >= 1 &&
    SHA_256_PATTERN.test(value.artifactCandidateDigest) &&
    isRfc3339(value.createdAt)
  );
}

function isRfc3339(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value);
}

export function parseMatrixCorpusRunManifestDocument(
  value: unknown
): MatrixCorpusRunManifestV1 | undefined {
  if (!hasExactKeys(value, manifestKeys)) return undefined;
  const record = value;
  if (!Array.isArray(record['scenarioBindings'])) return undefined;
  const bindings: MatrixCorpusRunManifestScenarioBindingV1[] = [];
  for (const item of record['scenarioBindings']) {
    if (!hasExactKeys(item, bindingKeys)) return undefined;
    bindings.push(item as unknown as MatrixCorpusRunManifestScenarioBindingV1);
  }
  const terminalCandidate = record['terminalCandidate'];
  if (terminalCandidate !== null && !hasExactKeys(terminalCandidate, candidateKeys))
    return undefined;
  const artifactStage = record['artifactStage'];
  if (artifactStage !== null && !hasExactKeys(artifactStage, artifactStageKeys))
    return undefined;
  const manifest = {
    ...record,
    scenarioBindings: bindings,
    artifactStage,
    terminalCandidate,
  } as unknown as MatrixCorpusRunManifestV1;
  return isValidManifest(manifest) ? manifest : undefined;
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length && expectedKeys.every((key, index) => key === keys[index]);
}

function cloneManifest(manifest: MatrixCorpusRunManifestV1): MatrixCorpusRunManifestV1 {
  return {
    ...manifest,
    scenarioBindings: manifest.scenarioBindings.map((binding) => ({ ...binding })),
    artifactStage: manifest.artifactStage === null ? null : { ...manifest.artifactStage },
    terminalCandidate:
      manifest.terminalCandidate === null ? null : { ...manifest.terminalCandidate },
  };
}
