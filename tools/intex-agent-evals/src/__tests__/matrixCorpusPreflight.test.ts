import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  MATRIX_CORPUS_PREFLIGHT_CHECKS,
  runMatrixCorpusPreflight,
  type MatrixCorpusPreflightSnapshot,
} from '../matrixCorpus/preflight.js';
import { loadCanonicalMatrixCorpus } from '../matrixCorpus/catalog.js';
import type { CanonicalMatrixCorpus } from '../matrixCorpus/types.js';

const REVISION = 'a'.repeat(40);
const SCENARIOS_DIRECTORY = fileURLToPath(new URL('../../scenarios/', import.meta.url));
const loadCatalog = async (): Promise<CanonicalMatrixCorpus> =>
  await loadCanonicalMatrixCorpus(SCENARIOS_DIRECTORY);

async function passingSnapshot(): Promise<MatrixCorpusPreflightSnapshot> {
  const catalog = await loadCatalog();
  return {
    requestedRevision: REVISION,
    deployedRevision: REVISION,
    localCriticalPathsClean: true,
    remoteCriticalPathsClean: true,
    runtimeAudience: 'hetzner-prod',
    environmentAlias: 'prod',
    protectedConfigReady: true,
    servicesReady: true,
    clocksReady: true,
    userReady: true,
    accountTupleCount: 1,
    matrixReady: true,
    whatsappReady: true,
    capabilityBoundaryReady: true,
    strictMockToolCount: 11,
    catalogDigest: catalog.catalogDigest,
    scenarioCount: 20,
    turnCount: 60,
    catalogMatchesTracked: true,
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    modelBoundaryReady: true,
    runAdmission: 'absent',
    artifactRootReady: true,
    artifactCapacityReady: true,
    accountAlias: 'operator-test',
  };
}

describe('runMatrixCorpusPreflight', () => {
  it('returns the complete closed PASS snapshot without invoking any mutating port', async () => {
    const snapshot = await passingSnapshot();
    const mutators = Object.fromEntries(
      [
        'provision',
        'lease',
        'context',
        'projection',
        'capability',
        'message',
        'llm',
        'artifact',
      ].map((name) => [
        name,
        vi.fn(() => {
          throw new Error(`mutator:${name}`);
        }),
      ])
    );
    const result = await runMatrixCorpusPreflight({
      read: { readSnapshot: vi.fn(async () => structuredClone(snapshot)) },
      loadCatalog,
    });

    expect(result).toMatchObject({ ok: true, exitCode: 0, checks: MATRIX_CORPUS_PREFLIGHT_CHECKS });
    for (const mutate of Object.values(mutators)) expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['deployedRevision', 'b'.repeat(40), 'REVISION_MISMATCH'],
    ['localCriticalPathsClean', false, 'IMPLEMENTATION_PATHS_DIRTY'],
    ['remoteCriticalPathsClean', false, 'IMPLEMENTATION_PATHS_DIRTY'],
    ['runtimeAudience', 'home-dev', 'PRODUCTION_RUNTIME_REQUIRED'],
    ['environmentAlias', 'dev', 'PRODUCTION_RUNTIME_REQUIRED'],
    ['servicesReady', false, 'SERVICES_NOT_READY'],
    ['protectedConfigReady', false, 'SERVICES_NOT_READY'],
    ['clocksReady', false, 'SERVICES_NOT_READY'],
    ['userReady', false, 'USER_NOT_READY'],
    ['accountTupleCount', 0, 'ACCOUNT_TUPLE_INVALID'],
    ['accountTupleCount', 2, 'ACCOUNT_TUPLE_INVALID'],
    ['matrixReady', false, 'MATRIX_NOT_READY'],
    ['whatsappReady', false, 'WHATSAPP_NOT_READY'],
    ['capabilityBoundaryReady', false, 'CAPABILITY_BOUNDARY_NOT_READY'],
    ['strictMockToolCount', 10, 'CAPABILITY_BOUNDARY_NOT_READY'],
    ['scenarioCount', 19, 'CATALOG_INVALID'],
    ['turnCount', 58, 'CATALOG_INVALID'],
    ['catalogMatchesTracked', false, 'CATALOG_INVALID'],
    ['modelBoundaryReady', false, 'MODEL_BINDING_INVALID'],
    ['runAdmission', 'blocked', 'RUN_CONFLICT'],
    ['runAdmission', 'not_ready', 'RUN_CONFLICT'],
    ['artifactRootReady', false, 'ARTIFACT_ROOT_NOT_READY'],
    ['artifactCapacityReady', false, 'ARTIFACT_ROOT_NOT_READY'],
  ] as const)('fails closed when %s is invalid', async (key, value, code) => {
    const snapshot = { ...(await passingSnapshot()), [key]: value };
    const result = await runMatrixCorpusPreflight({
      read: { readSnapshot: async () => snapshot },
      loadCatalog,
    });
    expect(result).toEqual({ ok: false, exitCode: 2, code });
  });

  it('maps malformed snapshots and raw failures to closed codes without reflecting details', async () => {
    await expect(
      runMatrixCorpusPreflight({
        read: { readSnapshot: async () => ({ privateToken: 'sentinel' }) },
        loadCatalog,
      })
    ).resolves.toEqual({ ok: false, exitCode: 2, code: 'REVISION_INVALID' });

    await expect(
      runMatrixCorpusPreflight({
        read: {
          readSnapshot: async () => {
            throw new Error('private-sentinel');
          },
        },
        loadCatalog,
      })
    ).resolves.toEqual({ ok: false, exitCode: 2, code: 'PREFLIGHT_UNEXPECTED_FAILURE' });
  });
});
