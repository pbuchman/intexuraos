import { z } from 'zod';
import type { CanonicalMatrixCorpus } from './types.js';

export const MATRIX_CORPUS_PREFLIGHT_CHECKS = [
  'revision',
  'services',
  'user',
  'account_tuple',
  'matrix',
  'whatsapp',
  'capability',
  'catalog',
  'models',
  'run_lease',
  'artifact',
] as const;

export type MatrixCorpusPreflightCheck = (typeof MATRIX_CORPUS_PREFLIGHT_CHECKS)[number];

export const MATRIX_CORPUS_PREFLIGHT_FAILURE_CODES = [
  'REVISION_INVALID',
  'REVISION_MISMATCH',
  'IMPLEMENTATION_PATHS_DIRTY',
  'PRODUCTION_RUNTIME_REQUIRED',
  'SERVICES_NOT_READY',
  'USER_NOT_READY',
  'ACCOUNT_TUPLE_INVALID',
  'MATRIX_NOT_READY',
  'WHATSAPP_NOT_READY',
  'CAPABILITY_BOUNDARY_NOT_READY',
  'CATALOG_INVALID',
  'MODEL_BINDING_INVALID',
  'RUN_CONFLICT',
  'ARTIFACT_ROOT_NOT_READY',
  'PREFLIGHT_UNEXPECTED_FAILURE',
] as const;

export type MatrixCorpusPreflightFailureCode =
  (typeof MATRIX_CORPUS_PREFLIGHT_FAILURE_CODES)[number];

const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);

export const MatrixCorpusPreflightSnapshotSchema = z
  .object({
    requestedRevision: sha,
    deployedRevision: sha,
    localCriticalPathsClean: z.boolean(),
    remoteCriticalPathsClean: z.boolean(),
    runtimeAudience: z.string().min(1).max(32),
    environmentAlias: z.string().min(1).max(32),
    protectedConfigReady: z.boolean(),
    servicesReady: z.boolean(),
    clocksReady: z.boolean(),
    userReady: z.boolean(),
    accountTupleCount: z.number().int().min(0).max(2),
    matrixReady: z.boolean(),
    whatsappReady: z.boolean(),
    capabilityBoundaryReady: z.boolean(),
    strictMockToolCount: z.number().int().min(0).max(100),
    catalogDigest: digest,
    scenarioCount: z.number().int().min(0).max(20),
    turnCount: z.number().int().min(0).max(400),
    catalogMatchesTracked: z.boolean(),
    agentModel: z.string().min(1).max(128),
    evaluatorModel: z.string().min(1).max(128),
    modelBoundaryReady: z.boolean(),
    runAdmission: z.enum([
      'absent',
      'terminal_artifact_ready',
      'terminal_artifact_failed',
      'terminal_artifact_unknown',
      'blocked',
      'not_ready',
    ]),
    artifactRootReady: z.boolean(),
    artifactCapacityReady: z.boolean(),
    accountAlias: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u),
  })
  .strict();

export type MatrixCorpusPreflightSnapshot = z.infer<typeof MatrixCorpusPreflightSnapshotSchema>;

export interface MatrixCorpusPreflightReadPort {
  /** Read-only by contract. Implementations must not create probes or temporary files. */
  readSnapshot(): Promise<unknown>;
}

export type MatrixCorpusPreflightResult =
  | {
      readonly ok: true;
      readonly exitCode: 0;
      readonly checks: readonly MatrixCorpusPreflightCheck[];
      readonly snapshot: MatrixCorpusPreflightSnapshot;
      readonly catalog: CanonicalMatrixCorpus;
    }
  | {
      readonly ok: false;
      readonly exitCode: 2;
      readonly code: MatrixCorpusPreflightFailureCode;
    };

function failed(code: MatrixCorpusPreflightFailureCode): MatrixCorpusPreflightResult {
  return { ok: false, exitCode: 2, code };
}

export async function runMatrixCorpusPreflight(input: {
  readonly read: MatrixCorpusPreflightReadPort;
  readonly loadCatalog: () => Promise<CanonicalMatrixCorpus>;
}): Promise<MatrixCorpusPreflightResult> {
  try {
    const [snapshotCandidate, catalog] = await Promise.all([
      input.read.readSnapshot(),
      input.loadCatalog(),
    ]);
    const parsed = MatrixCorpusPreflightSnapshotSchema.safeParse(snapshotCandidate);
    if (!parsed.success) return failed('REVISION_INVALID');
    const snapshot = parsed.data;

    if (snapshot.requestedRevision !== snapshot.deployedRevision) {
      return failed('REVISION_MISMATCH');
    }
    if (!snapshot.localCriticalPathsClean || !snapshot.remoteCriticalPathsClean) {
      return failed('IMPLEMENTATION_PATHS_DIRTY');
    }
    if (snapshot.runtimeAudience !== 'hetzner-prod' || snapshot.environmentAlias !== 'prod') {
      return failed('PRODUCTION_RUNTIME_REQUIRED');
    }
    if (!snapshot.servicesReady || !snapshot.protectedConfigReady || !snapshot.clocksReady) {
      return failed('SERVICES_NOT_READY');
    }
    if (!snapshot.userReady) return failed('USER_NOT_READY');
    if (snapshot.accountTupleCount !== 1) return failed('ACCOUNT_TUPLE_INVALID');
    if (!snapshot.matrixReady) return failed('MATRIX_NOT_READY');
    if (!snapshot.whatsappReady) return failed('WHATSAPP_NOT_READY');
    if (!snapshot.capabilityBoundaryReady || snapshot.strictMockToolCount !== 11) {
      return failed('CAPABILITY_BOUNDARY_NOT_READY');
    }
    if (
      !snapshot.catalogMatchesTracked ||
      snapshot.scenarioCount !== 20 ||
      snapshot.turnCount !== 59 ||
      snapshot.catalogDigest !== catalog.catalogDigest
    ) {
      return failed('CATALOG_INVALID');
    }
    if (
      !snapshot.modelBoundaryReady ||
      snapshot.agentModel !== catalog.agentModel ||
      snapshot.evaluatorModel !== catalog.evaluatorModel
    ) {
      return failed('MODEL_BINDING_INVALID');
    }
    if (snapshot.runAdmission === 'blocked' || snapshot.runAdmission === 'not_ready') {
      return failed('RUN_CONFLICT');
    }
    if (!snapshot.artifactRootReady || !snapshot.artifactCapacityReady) {
      return failed('ARTIFACT_ROOT_NOT_READY');
    }

    return {
      ok: true,
      exitCode: 0,
      checks: MATRIX_CORPUS_PREFLIGHT_CHECKS,
      snapshot,
      catalog,
    };
  } catch {
    return failed('PREFLIGHT_UNEXPECTED_FAILURE');
  }
}
