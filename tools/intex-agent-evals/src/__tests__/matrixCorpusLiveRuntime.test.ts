import { fileURLToPath } from 'node:url';
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntexAgentServiceClient, WhatsAppServiceClient } from '@intexuraos/internal-clients';
import type { OpenRouterCatalogClient } from '@intexuraos/infra-openrouter';

vi.mock('firebase-admin/app', () => ({
  applicationDefault: vi.fn(),
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
  createProductionMatrixCorpusLiveReadPort,
  inspectArtifactRoot,
  inspectHomeDevRuntime,
  listHomeDevFirestoreCompositeIndexes,
  MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS,
  resolveMatrixCorpusPuppetBinding,
  type FirestoreAdminIndexListDeps,
  type HomeDevRuntimeInspectionDeps,
  type MatrixCorpusPreparedContext,
} from '../matrixCorpus/liveRuntime.js';
import type { MatrixClient } from '../live/matrixClient.js';
import {
  canonicalizeEvaluatorConfig,
  MATRIX_ADAPTER_HEALTH_URL,
  type EvaluatorConfig,
  type SetupPorts,
} from '../preflight.js';
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

describe('production Hetzner runtime inspection from the Home Dev runner', () => {
  it('reads the production boundary without falling back to Home Dev product services', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'matrix-corpus-production-read-'));
    temporaryDirectories.push(repositoryRoot);
    const artifactRoot = join(repositoryRoot, '.artifacts', 'intex-agent-evals');
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(artifactRoot, 0o700);

    const evaluatorUserId = 'auth0|production-evaluator';
    const matrixUserId = '@operator:matrix.test';
    const puppetUserId = '@whatsapp_1:matrix.test';
    const config: EvaluatorConfig = {
      schemaVersion: 2,
      accountAlias: 'Production evaluator',
      userId: evaluatorUserId,
      matrixUserId,
      matrixAccessTokenFile: '/home/operator/.config/matrix-token',
      matrixOutboundAuthTokenFile: '/home/operator/.config/matrix-outbound-auth-token',
      matrixTargetsFile: '/home/operator/.config/matrix-targets.json',
    };
    const env: NodeJS.ProcessEnv = {
      GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/service-account.json',
      INTEXURAOS_ENVIRONMENT: 'prod',
      INTEXURAOS_INTERNAL_AUTH_TOKEN: 'synthetic-internal-token',
      INTEXURAOS_GCP_PROJECT_ID: 'intexuraos-dev-test',
      INTEXURAOS_OPENROUTER_APP_API_KEY: 'synthetic-openrouter-key',
      INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY: 'synthetic-hmac-key',
      INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
      INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'hetzner-prod',
      INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
      INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: evaluatorUserId,
      INTEXURAOS_MATRIX_CORPUS_MATRIX_PUPPET_USER_ID: puppetUserId,
      INTEXURAOS_EVAL_REQUESTED_REVISION: 'a'.repeat(40),
      INTEXURAOS_EVAL_WRAPPER_ATTESTED: 'true',
      INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN: 'true',
    };
    const matrix = {
      whoAmI: vi.fn(async () => ({ ok: true as const, userId: matrixUserId })),
      syncTargetRoom: vi.fn(async () => ({
        ok: true as const,
        nextBatch: 'next-batch',
        limited: false,
        events: [
          {
            type: 'm.room.message' as const,
            sender: puppetUserId,
            content: { msgtype: 'm.text' as const, body: 'historical reply' },
          },
        ],
      })),
    } as unknown as MatrixClient;
    const setup: SetupPorts = {
      configPath: '/home/operator/.config/intexuraos/intex-agent-evals.json',
      runtime: {
        platform: () => 'linux',
        hostname: () => 'home-dev',
        uid: () => process.getuid?.() ?? 1000,
        env: (name) => env[name],
      },
      protectedFiles: {
        read: vi.fn(async (path) => {
          if (path === config.matrixAccessTokenFile) {
            return { ok: true as const, contents: 'synthetic-matrix-token' };
          }
          if (path === config.matrixOutboundAuthTokenFile) {
            return { ok: true as const, contents: 'synthetic-outbound-token' };
          }
          if (path === config.matrixTargetsFile) {
            return {
              ok: true as const,
              contents: JSON.stringify({
                'source-account': { intex_agent: '!agent-room:matrix.test' },
              }),
            };
          }
          return { ok: true as const, contents: canonicalizeEvaluatorConfig(config) };
        }),
        validatePrivateDirectory: vi.fn(async () => ({ ok: true as const })),
        ensurePrivateDirectory: vi.fn(async () => ({ ok: true as const })),
        isAtomicReplaceIdle: vi.fn(async () => true),
        createExclusive: vi.fn(async () => ({ state: 'exists' as const })),
        replaceAtomic: vi.fn(async () => ({ state: 'conflict' as const })),
      },
      healthHttp: {
        get: vi.fn(async (url) => {
          if (url !== MATRIX_ADAPTER_HEALTH_URL) {
            throw new Error('Home Dev product health must not be called');
          }
          return {
            ok: true as const,
            status: 200,
            body: {
              ok: true,
              state: 'running',
              homeserverUrl: 'https://matrix.test',
              matrixUserId,
              ingestUrl: 'http://127.0.0.1:8113/internal/whatsapp/private/matrix/events',
              sourceAccountId: 'source-account',
              counters: { received: 1 },
            },
          };
        }),
      },
      firebaseIdentity: {
        getUserState: vi.fn(async () => ({ ok: true as const, state: 'enabled' as const })),
      },
      matrix,
      whatsapp: {
        getDeliveryStatus: vi.fn(async () => {
          throw new Error('Home Dev WhatsApp delivery must not be called');
        }),
      },
    };
    const intex = {
      getMatrixCorpusCurrentAcceptance: vi.fn(async () => ({
        ok: true as const,
        value: { kind: 'admission_ready' as const, current: 'absent' as const },
      })),
    } as unknown as IntexAgentServiceClient;
    const whatsapp = {
      getMatrixCorpusReadiness: vi.fn(async () => ({
        ok: true as const,
        value: { status: 'ready' as const },
      })),
    } as unknown as WhatsAppServiceClient;
    const modelCatalog = {
      getIntexAgentCatalogEvidence: vi.fn(async () => ({
        snapshotVersion: '2026-08-18' as const,
        fetchedAt: new Date().toISOString(),
        models: [{ id: catalog.agentModel }, { id: catalog.evaluatorModel }],
      })),
    } as unknown as OpenRouterCatalogClient;

    const read = createProductionMatrixCorpusLiveReadPort({
      matrix,
      repositoryRoot,
      env,
      intex,
      whatsapp,
      catalog: modelCatalog,
      inspectFirestoreIndexes: async () => true,
      inspectRuntime: async () => ({
        ready: true,
        deployedRevision: 'a'.repeat(40),
        criticalPathsClean: true,
      }),
      setup,
    });

    const result = await read.read(catalog);

    expect(result.snapshot).toMatchObject({
      environmentAlias: 'prod',
      runtimeAudience: 'hetzner-prod',
      servicesReady: true,
      userReady: true,
      accountTupleCount: 1,
      matrixReady: true,
      whatsappReady: true,
      modelBoundaryReady: true,
      runAdmission: 'absent',
    });
    expect(intex.getMatrixCorpusCurrentAcceptance).toHaveBeenCalledWith(evaluatorUserId);
    expect(whatsapp.getMatrixCorpusReadiness).toHaveBeenCalledOnce();
    expect(setup.healthHttp.get).toHaveBeenCalledOnce();
    expect(setup.healthHttp.get).toHaveBeenCalledWith(MATRIX_ADAPTER_HEALTH_URL, {
      bearerToken: 'synthetic-outbound-token',
    });
    expect(setup.whatsapp.getDeliveryStatus).not.toHaveBeenCalled();
  });

  it('lists paginated Firestore indexes through the bounded read-only Admin API', async () => {
    const firstIndex = requiredFirestoreIndexes()[0];
    const secondIndex = requiredFirestoreIndexes()[1];
    const request = vi
      .fn<FirestoreAdminIndexListDeps['fetch']>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ indexes: [firstIndex], nextPageToken: 'next page' }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ indexes: [secondIndex] })));

    const output = await listHomeDevFirestoreCompositeIndexes('intexuraos-dev-test', {
      getAccessToken: async () => 'private-access-token',
      fetch: request,
    });

    expect(JSON.parse(output)).toEqual([firstIndex, secondIndex]);
    expect(request).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(request.mock.calls[0]?.[0] ?? '');
    const secondUrl = new URL(request.mock.calls[1]?.[0] ?? '');
    expect(firstUrl.origin).toBe('https://firestore.googleapis.com');
    expect(firstUrl.pathname).toBe(
      '/v1/projects/intexuraos-dev-test/databases/(default)/collectionGroups/-/indexes'
    );
    expect(firstUrl.searchParams.get('pageSize')).toBe('0');
    expect(secondUrl.searchParams.get('pageToken')).toBe('next page');
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer private-access-token' },
    });
  });

  it('rejects failed Admin API reads and repeated pagination tokens', async () => {
    const getAccessToken = vi.fn(async () => 'private-access-token');
    await expect(
      listHomeDevFirestoreCompositeIndexes('../unsafe', {
        getAccessToken,
        fetch: async () => new Response('{}'),
      })
    ).rejects.toThrow('firestore_index_project_invalid');
    expect(getAccessToken).not.toHaveBeenCalled();

    await expect(
      listHomeDevFirestoreCompositeIndexes('intexuraos-dev-test', {
        getAccessToken: async () => 'private-access-token',
        fetch: async () => new Response('', { status: 403 }),
      })
    ).rejects.toThrow('firestore_index_list_failed');

    await expect(
      listHomeDevFirestoreCompositeIndexes('intexuraos-dev-test', {
        getAccessToken: async () => 'private-access-token',
        fetch: async () => new Response(JSON.stringify({ nextPageToken: 'repeat' })),
      })
    ).rejects.toThrow('firestore_index_page_token_invalid');
  });

  it('requires every Matrix corpus Firestore index to be READY', async () => {
    const runtimeModule = (await import('../matrixCorpus/liveRuntime.js')) as unknown as {
      inspectHomeDevFirestoreIndexes?: (
        projectId: string,
        dependencies: { listCompositeIndexes(projectId: string): Promise<string> }
      ) => Promise<boolean>;
    };
    const inspect = runtimeModule.inspectHomeDevFirestoreIndexes;
    expect(inspect).toBeTypeOf('function');
    if (inspect === undefined) return;

    const readyIndexes = requiredFirestoreIndexes();
    const listCompositeIndexes = vi.fn(async () => JSON.stringify(readyIndexes));

    await expect(inspect('intexuraos-dev-test', { listCompositeIndexes })).resolves.toBe(true);
    expect(listCompositeIndexes).toHaveBeenCalledWith('intexuraos-dev-test');

    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () =>
          JSON.stringify(
            readyIndexes.map((index, position) =>
              position === 0 ? { ...index, state: 'CREATING' } : index
            )
          ),
      })
    ).resolves.toBe(false);
    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () => JSON.stringify(readyIndexes.slice(1)),
      })
    ).resolves.toBe(false);
    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () =>
          JSON.stringify([
            { ...readyIndexes[0], apiScope: 'MONGODB_COMPATIBLE_API' },
            ...readyIndexes.slice(1),
          ]),
      })
    ).resolves.toBe(false);
    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () =>
          JSON.stringify(
            readyIndexes.map((index, position) =>
              position === 0
                ? {
                    ...index,
                    fields: (index['fields'] as Record<string, unknown>[]).map(
                      (field, fieldPosition, fields) =>
                        fieldPosition === fields.length - 1
                          ? { ...field, order: 'DESCENDING' }
                          : field
                    ),
                  }
                : index
            )
          ),
      })
    ).resolves.toBe(false);
    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () => 'not-json',
      })
    ).resolves.toBe(false);
  });

  it('fails closed for an unsafe project, unavailable control plane, or oversized response', async () => {
    const { inspectHomeDevFirestoreIndexes: inspect } =
      await import('../matrixCorpus/liveRuntime.js');
    const listCompositeIndexes = vi.fn(async () => JSON.stringify(requiredFirestoreIndexes()));

    await expect(inspect('../unsafe', { listCompositeIndexes })).resolves.toBe(false);
    expect(listCompositeIndexes).not.toHaveBeenCalled();
    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () => {
          throw new Error('control plane unavailable');
        },
      })
    ).resolves.toBe(false);
    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () => ' '.repeat(5 * 1024 * 1024 + 1),
      })
    ).resolves.toBe(false);
  });

  it('ignores unrelated composite indexes while checking the exact required set', async () => {
    const { inspectHomeDevFirestoreIndexes: inspect } =
      await import('../matrixCorpus/liveRuntime.js');
    const indexes = [
      ...requiredFirestoreIndexes(),
      firestoreIndex('unrelated_collection', [['value', 'ASCENDING']]),
      {
        ...firestoreIndex('vector_collection', [['value', 'ASCENDING']]),
        fields: [{ fieldPath: 'embedding', vectorConfig: { dimension: 768 } }],
      },
    ];

    await expect(
      inspect('intexuraos-dev-test', {
        listCompositeIndexes: async () => JSON.stringify(indexes),
      })
    ).resolves.toBe(true);
  });

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
              sender: '@whatsapp_999:example.test',
              content: { msgtype: 'm.text', body: 'historical reply' },
            },
            {
              type: 'm.room.message',
              sender: '@whatsapp_1:example.test',
              content: { msgtype: 'm.text', body: 'current reply' },
            },
          ],
        },
        true,
        '@whatsapp_1:example.test'
      )
    ).toEqual({
      expectedPuppetSender: '@whatsapp_1:example.test',
      accountTupleCount: 1,
    });
  });

  it.each([
    ['configured puppet is absent', true, '@whatsapp_2:example.test'],
    ['evaluator user does not match', false, '@whatsapp_1:example.test'],
    ['puppet binding is malformed', true, '1'],
  ] as const)('fails the account tuple when %s', (_name, userMatches, expectedPuppet) => {
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
              content: { msgtype: 'm.text', body: 'reply' },
            },
          ],
        },
        userMatches,
        expectedPuppet
      )
    ).toEqual({ expectedPuppetSender: undefined, accountTupleCount: 0 });
  });

  it('accepts an exact configured LID puppet binding', () => {
    expect(
      resolveMatrixCorpusPuppetBinding(
        {
          ok: true,
          nextBatch: 'current-cursor',
          limited: false,
          events: [
            {
              type: 'm.room.message',
              sender: '@whatsapp_lid-current:example.test',
              content: { msgtype: 'm.text', body: 'reply' },
            },
          ],
        },
        true,
        '@whatsapp_lid-current:example.test'
      )
    ).toEqual({
      expectedPuppetSender: '@whatsapp_lid-current:example.test',
      accountTupleCount: 1,
    });
  });

  it('accepts the exact five-field production deployment attestation for the Home Dev runner', async () => {
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
    expect(MATRIX_CORPUS_RUNTIME_CRITICAL_PATHS).toContain('scripts/hetzner/nginx/');
    expect(deps.fetchDeploymentDocument).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong host', { hostname: (): string => 'other-host' }],
    ['wrong platform', { platform: (): NodeJS.Platform => 'darwin' }],
    ['wrong repository', { realpath: async (path: string): Promise<string> => path }],
  ] as const)('rejects %s', async (_name, overrides) => {
    const result = await inspectHomeDevRuntime('/repo/current', runtimeInspectionDeps(overrides));
    expect(result.ready).toBe(false);
  });

  it('rejects a runner revision that does not match the production deployment', async () => {
    const result = await inspectHomeDevRuntime(
      '/repo/current',
      runtimeInspectionDeps({
        fetchDeploymentDocument: vi.fn(async () => ({
          commitSha: 'b'.repeat(40),
          commitMessage: 'feat: deploy the reviewed revision',
          workflowRunId: '654321',
          secretPackageVersion: '4',
          deployedAt: '2026-07-22T12:30:00.000Z',
        })),
      })
    );

    expect(result).toEqual({
      ready: false,
      deployedRevision: 'b'.repeat(40),
      criticalPathsClean: true,
    });
  });

  it.each([
    [
      'an unknown field',
      {
        commitSha: 'a'.repeat(40),
        commitMessage: 'feat: deploy the reviewed revision',
        workflowRunId: '123456',
        secretPackageVersion: '4',
        deployedAt: '2026-07-22T12:00:00.000Z',
        unexpected: true,
      },
    ],
    [
      'a missing commit message',
      {
        commitSha: 'a'.repeat(40),
        workflowRunId: '123456',
        secretPackageVersion: '4',
        deployedAt: '2026-07-22T12:00:00.000Z',
      },
    ],
    [
      'a non-string commit message',
      {
        commitSha: 'a'.repeat(40),
        commitMessage: 42,
        workflowRunId: '123456',
        secretPackageVersion: '4',
        deployedAt: '2026-07-22T12:00:00.000Z',
      },
    ],
    [
      'a non-exact secret package version',
      {
        commitSha: 'a'.repeat(40),
        commitMessage: 'feat: deploy the reviewed revision',
        workflowRunId: '123456',
        secretPackageVersion: 'latest',
        deployedAt: '2026-07-22T12:00:00.000Z',
      },
    ],
    [
      'a non-string secret package version',
      {
        commitSha: 'a'.repeat(40),
        commitMessage: 'feat: deploy the reviewed revision',
        workflowRunId: '123456',
        secretPackageVersion: 4,
        deployedAt: '2026-07-22T12:00:00.000Z',
      },
    ],
    [
      'a malformed workflow run ID',
      {
        commitSha: 'a'.repeat(40),
        commitMessage: 'feat: deploy the reviewed revision',
        workflowRunId: 123456,
        secretPackageVersion: '4',
        deployedAt: '2026-07-22T12:00:00.000Z',
      },
    ],
    [
      'an invalid deployment timestamp',
      {
        commitSha: 'a'.repeat(40),
        commitMessage: 'feat: deploy the reviewed revision',
        workflowRunId: '123456',
        secretPackageVersion: '4',
        deployedAt: 'not-a-timestamp',
      },
    ],
  ] as const)('rejects a deployment attestation with %s', async (_name, deploymentDocument) => {
    const result = await inspectHomeDevRuntime(
      '/repo/current',
      runtimeInspectionDeps({ fetchDeploymentDocument: vi.fn(async () => deploymentDocument) })
    );

    expect(result).toEqual({
      ready: false,
      deployedRevision: '',
      criticalPathsClean: true,
    });
  });

  it('reports dirty critical paths and rejects an invalid runner revision', async () => {
    const dirty = runtimeInspectionDeps({
      git: vi.fn(async (_cwd: string, args: readonly string[]) => ({
        stdout: args[0] === 'rev-parse' ? 'invalid\n' : ' M packages/common-core/src/index.ts\n',
      })),
    });

    await expect(inspectHomeDevRuntime('/repo/current', dirty)).resolves.toEqual({
      ready: false,
      deployedRevision: 'a'.repeat(40),
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
    fetchDeploymentDocument: vi.fn(async () => ({
      commitSha: 'a'.repeat(40),
      commitMessage: 'feat: deploy the reviewed revision',
      workflowRunId: '123456',
      secretPackageVersion: '4',
      deployedAt: '2026-07-22T12:00:00.000Z',
    })),
    ...overrides,
  };
}

function requiredFirestoreIndexes(): Record<string, unknown>[] {
  return [
    firestoreIndex('matrix_corpus_ingest_outbox', [
      ['status', 'ASCENDING'],
      ['createdAt', 'ASCENDING'],
    ]),
    firestoreIndex('matrix_corpus_ingest_outbox', [
      ['status', 'ASCENDING'],
      ['claim.expiresAt', 'ASCENDING'],
    ]),
    firestoreIndex('matrix_corpus_terminal_control_outbox', [
      ['status', 'ASCENDING'],
      ['createdAt', 'ASCENDING'],
    ]),
    firestoreIndex('matrix_corpus_terminal_control_outbox', [
      ['status', 'ASCENDING'],
      ['claim.expiresAt', 'ASCENDING'],
    ]),
    firestoreIndex('matrix_corpus_run_leases', [
      ['phase', 'ASCENDING'],
      ['expiresAt', 'ASCENDING'],
    ]),
    firestoreIndex('intex_agent_session_events', [
      ['sessionId', 'ASCENDING'],
      ['eventSequence', 'ASCENDING'],
    ]),
    firestoreIndex('intex_agent_test_runs', [
      ['userId', 'ASCENDING'],
      ['runtimeAudience', 'ASCENDING'],
      ['startedAt', 'DESCENDING'],
    ]),
    firestoreIndex('intex_agent_test_runs', [
      ['artifactDelivery.status', 'ASCENDING'],
      ['finishedAt', 'ASCENDING'],
    ]),
  ];
}

function firestoreIndex(
  collectionGroup: string,
  fields: readonly (readonly [string, 'ASCENDING' | 'DESCENDING'])[]
): Record<string, unknown> {
  return {
    name: `projects/test/databases/(default)/collectionGroups/${collectionGroup}/indexes/index`,
    queryScope: 'COLLECTION',
    state: 'READY',
    fields: [
      ...fields.map(([fieldPath, order]) => ({ fieldPath, order })),
      { fieldPath: '__name__', order: fields.at(-1)?.[1] ?? 'ASCENDING' },
    ],
  };
}

function snapshot(catalogDigest: string): MatrixCorpusPreflightSnapshot {
  return {
    requestedRevision: 'a'.repeat(40),
    deployedRevision: 'a'.repeat(40),
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
    catalogDigest,
    scenarioCount: 20,
    turnCount: 60,
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
      completedTurns: 60,
      judgedReplies: 60,
      agentCostNanoUsd: 1,
      evaluatorCostNanoUsd: 1,
    },
    terminalAcknowledged: true,
    cleanupCompleted: true,
  };
}
