import { fileURLToPath } from 'node:url';
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));
vi.mock('firebase-admin/auth', () => ({
  FirebaseAuthError: class MockFirebaseAuthError extends Error {},
  getAuth: vi.fn(),
}));

import { loadCanonicalMatrixCorpus } from '../matrixCorpus/catalog.js';
import {
  createMatrixCorpusLiveRuntime,
  inspectArtifactRoot,
  inspectHomeDevRuntime,
  MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS,
  resolveMatrixCorpusPuppetBinding,
  type HomeDevRuntimeInspectionDeps,
  type MatrixCorpusPreparedContext,
} from '../matrixCorpus/liveRuntime.js';
import type { MatrixCorpusPreflightSnapshot } from '../matrixCorpus/preflight.js';
import type { MatrixCorpusRunResult } from '../matrixCorpus/runMatrixCorpus.js';

const scenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    })
  );
});

describe('Matrix corpus live runtime handoff', () => {
  it('keeps preflight read-only and constructs execution only after the exact passed result', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const prepared = preparedContext();
    const read = vi.fn(async () => ({ snapshot: snapshot(catalog.catalogDigest), prepared }));
    const executePrepared = vi.fn(async () => ({
      run: runResult('eval-00000000-0000-4000-8000-000000000001'),
      reportReady: true,
      relativeReportDirectory:
        '.artifacts/intex-agent-evals/eval-00000000-0000-4000-8000-000000000001',
    }));
    const runtime = createMatrixCorpusLiveRuntime({
      loadCatalog: async () => catalog,
      read: { read },
      executePrepared,
    });

    const preflight = await runtime.preflight();

    expect(preflight.ok).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(executePrepared).not.toHaveBeenCalled();
    if (!preflight.ok) throw new Error('expected pass');

    const result = await runtime.execute({
      runId: 'eval-00000000-0000-4000-8000-000000000001',
      preflight,
    });

    expect(result.reportReady).toBe(true);
    expect(executePrepared).toHaveBeenCalledWith({
      runId: 'eval-00000000-0000-4000-8000-000000000001',
      preflight,
      prepared,
    });
  });

  it('fails closed when execution does not receive the exact preflight handoff', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const executePrepared = vi.fn();
    const runtime = createMatrixCorpusLiveRuntime({
      loadCatalog: async () => catalog,
      read: {
        read: async () => ({
          snapshot: snapshot(catalog.catalogDigest),
          prepared: preparedContext(),
        }),
      },
      executePrepared,
    });
    const preflight = await runtime.preflight();
    if (!preflight.ok) throw new Error('expected pass');

    const result = await runtime.execute({ runId: 'eval-1', preflight: { ...preflight } });

    expect(result).toMatchObject({
      reportReady: false,
      run: { exitCode: 2, failureCodes: ['preflight_handoff_invalid'] },
    });
    expect(executePrepared).not.toHaveBeenCalled();
  });
});

describe('production Home Dev runtime inspection', () => {
  it('resolves the current WhatsApp puppet from a limited initial Matrix timeline', () => {
    expect(
      resolveMatrixCorpusPuppetBinding(
        {
          ok: true,
          nextBatch: 'current-cursor',
          limited: true,
          events: [
            {
              type: 'm.room.message',
              sender: '@whatsapp_1:example.test',
              content: { msgtype: 'm.text', body: 'historical reply' },
            },
          ],
        },
        true
      )
    ).toEqual({
      expectedPuppetSender: '@whatsapp_1:example.test',
      accountTupleCount: 1,
    });
  });

  it('accepts only the exact Home Dev host, canonical repository, clean critical paths, and commit', async () => {
    const deps = runtimeInspectionDeps();

    await expect(inspectHomeDevRuntime('/repo/current', deps)).resolves.toEqual({
      ready: true,
      deployedRevision: 'a'.repeat(40),
      criticalPathsClean: true,
    });

    expect(deps.git).toHaveBeenCalledWith(
      '/repo/current',
      expect.arrayContaining(['status', '--porcelain=v1', 'packages/'])
    );
    expect(MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS).toContain('packages/');
  });

  it.each([
    ['wrong host', { hostname: (): string => 'other-host' }],
    ['wrong platform', { platform: (): NodeJS.Platform => 'darwin' }],
    ['wrong repository', { realpath: async (path: string): Promise<string> => path }],
  ] as const)('rejects %s', async (_name, overrides) => {
    const result = await inspectHomeDevRuntime('/repo/current', runtimeInspectionDeps(overrides));
    expect(result.ready).toBe(false);
  });

  it('reports dirty critical paths and rejects an invalid deployed revision', async () => {
    const dirty = runtimeInspectionDeps({
      git: vi.fn(async (_cwd: string, args: readonly string[]) => ({
        stdout: args[0] === 'rev-parse' ? 'invalid\n' : ' M packages/common-core/src/index.ts\n',
      })),
    });

    await expect(inspectHomeDevRuntime('/repo/current', dirty)).resolves.toEqual({
      ready: false,
      deployedRevision: 'invalid',
      criticalPathsClean: false,
    });
  });

  it('rejects a symlink artifact root through the production filesystem inspector', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'matrix-corpus-artifact-root-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'target');
    const link = join(directory, 'artifacts');
    await mkdir(target, { mode: 0o700 });
    await chmod(target, 0o700);
    await symlink(target, link, 'dir');

    const inspected = await inspectArtifactRoot(link);

    expect(inspected.ready).toBe(false);
  });
});

function runtimeInspectionDeps(
  overrides: Partial<HomeDevRuntimeInspectionDeps> = {}
): HomeDevRuntimeInspectionDeps {
  return {
    hostname: () => 'home-dev',
    platform: () => 'linux',
    homedir: () => '/home/test',
    realpath: async (path: string) =>
      path === '/repo/current' || path === '/home/test/deploy/intexuraos'
        ? '/canonical/intexuraos'
        : path,
    git: vi.fn(async (_cwd: string, args: readonly string[]) => ({
      stdout: args[0] === 'rev-parse' ? `${'a'.repeat(40)}\n` : '',
    })),
    ...overrides,
  };
}

function snapshot(catalogDigest: string): MatrixCorpusPreflightSnapshot {
  return {
    requestedRevision: 'a'.repeat(40),
    deployedRevision: 'a'.repeat(40),
    localCriticalPathsClean: true,
    remoteCriticalPathsClean: true,
    runtimeAudience: 'home-dev',
    environmentAlias: 'dev',
    protectedConfigReady: true,
    servicesReady: true,
    clocksReady: true,
    userReady: true,
    accountTupleCount: 1,
    matrixReady: true,
    whatsappReady: true,
    capabilityBoundaryReady: true,
    strictMockToolCount: 11,
    catalogDigest,
    scenarioCount: 20,
    turnCount: 59,
    catalogMatchesTracked: true,
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    modelBoundaryReady: true,
    runAdmission: 'absent',
    artifactRootReady: true,
    artifactCapacityReady: true,
    accountAlias: 'Primary test account',
  } as const;
}

function preparedContext(): MatrixCorpusPreparedContext {
  return {
    account: {
      userId: 'user_1',
      matrixUserId: '@operator:example.test',
      homeserverUrl: 'https://matrix.example.test',
      accessToken: 'private-token',
      targetRoomId: '!room:example.test',
    },
    accountAlias: 'Primary test account',
    expectedPuppetSender: '@whatsapp_1:example.test',
  };
}

function runResult(runId: string): MatrixCorpusRunResult {
  return {
    runId,
    effectiveKind: 'passed' as const,
    exitCode: 0 as const,
    failureCodes: [],
    scenarios: [],
    totals: {
      completedTurns: 59,
      judgedReplies: 59,
      agentCostNanoUsd: 1,
      evaluatorCostNanoUsd: 1,
    },
    terminalAcknowledged: true,
    cleanupCompleted: true,
  };
}
