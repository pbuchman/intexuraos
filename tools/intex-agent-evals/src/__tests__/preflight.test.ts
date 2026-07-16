import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  FirebaseAuthError: class MockFirebaseAuthError extends Error {
    readonly code = 'auth/internal-error';
  },
  getAuth: vi.fn(),
}));

import {
  CONFIG_MAX_BYTES,
  INTEX_AGENT_HEALTH_URL,
  JUDGE_MODEL,
  MATRIX_ADAPTER_HEALTH_URL,
  MATRIX_TARGETS_MAX_BYTES,
  MATRIX_TOKEN_MAX_BYTES,
  WHATSAPP_HEALTH_URL,
  WHATSAPP_SERVICE_BASE_URL,
  EvaluatorConfigSchema,
  MatrixTargetsSchema,
  canonicalizeEvaluatorConfig,
  createFirebaseIdentityPort,
  createHealthHttpPort,
  createNodeProtectedFilePort,
  createNodeRuntimeIdentityPort,
  createProductionPreflightPorts,
  createProductionSetupPorts,
  createScenarioCatalogPort,
  createWhatsAppReadinessPort,
  parseEvaluatorConfigContents,
  parseMatrixTargetsContents,
  runPreflight,
  setupEvaluatorConfig,
  type EvaluatorConfig,
  type FirebaseAdminDependencies,
  type MiniMaxProbePort,
  type PreflightPorts,
  type ProtectedFilePort,
  type RuntimeIdentityPort,
  type ScenarioCatalogPort,
  type SetupPorts,
  type WhatsAppClientFactory,
} from '../preflight.js';

const UID = process.getuid?.() ?? 1000;
const TEST_NONCE = '00000000-0000-4000-8000-000000000001';

function stagingPath(path: string, nonce = TEST_NONCE): string {
  return join(dirname(path), `.intex-agent-evals-${nonce}.tmp`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALID_CONFIG: EvaluatorConfig = {
  schemaVersion: 1,
  accountAlias: 'operator-one',
  userId: 'auth0|synthetic-user',
  matrixUserId: '@operator:home-dev',
  matrixAccessTokenFile: '/home/operator/.config/matrix-token',
  matrixTargetsFile: '/home/operator/.config/matrix-targets.json',
};

function standardHealth(serviceName: string): Record<string, unknown> {
  return {
    status: 'ok',
    serviceName,
    version: '3.8.0',
    timestamp: '2026-07-16T12:00:00.000Z',
    checks: [],
  };
}

function runningMatrixHealth(matrixUserId = VALID_CONFIG.matrixUserId): Record<string, unknown> {
  return {
    ok: true,
    state: 'running',
    homeserverUrl: 'https://matrix.synthetic.test',
    matrixUserId,
    ingestUrl: 'http://127.0.0.1:8113/internal/whatsapp/private/matrix/events',
    sourceAccountId: 'synthetic-source',
    counters: { received: 0 },
  };
}

function createRuntimePort(
  overrides: Record<string, string | undefined> = {}
): RuntimeIdentityPort {
  const environment: Record<string, string | undefined> = {
    INTEXURAOS_ENVIRONMENT: 'dev',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'synthetic-internal-token',
    INTEXURAOS_GCP_PROJECT_ID: 'synthetic-project',
    GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/adc.json',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'synthetic-openrouter-key',
    ...overrides,
  };

  return {
    platform: vi.fn(() => 'linux' as const),
    hostname: vi.fn(() => 'home-dev'),
    uid: vi.fn(() => UID),
    env: vi.fn((name: string) => environment[name]),
  };
}

function createFakeProtectedFiles(config: EvaluatorConfig): ProtectedFilePort {
  let storedConfig: string | undefined;
  return {
    read: vi.fn(async (path: string) => {
      if (path === config.matrixAccessTokenFile) {
        return { ok: true as const, contents: 'synthetic-matrix-token\n' };
      }
      if (path === config.matrixTargetsFile) {
        return {
          ok: true as const,
          contents: JSON.stringify({
            'synthetic-source': { intex_agent: '!agent-room:home-dev' },
          }),
        };
      }
      if (storedConfig !== undefined) {
        return { ok: true as const, contents: storedConfig };
      }
      return { ok: false as const, reason: 'missing' as const };
    }),
    validatePrivateDirectory: vi.fn(async () => ({ ok: true as const })),
    ensurePrivateDirectory: vi.fn(async () => ({ ok: true as const })),
    createExclusive: vi.fn(async (_path: string, contents: string) => {
      if (storedConfig !== undefined) {
        return { state: 'exists' as const };
      }
      storedConfig = contents;
      return { state: 'created' as const };
    }),
  };
}

function createSetupPorts(
  config: EvaluatorConfig = VALID_CONFIG,
  protectedFiles: ProtectedFilePort = createFakeProtectedFiles(config)
): SetupPorts {
  return {
    configPath: '/home/operator/.config/intexuraos/intex-agent-evals.json',
    runtime: createRuntimePort(),
    protectedFiles,
    healthHttp: {
      get: vi.fn(async (url: string) => {
        if (url.includes(':8134/')) {
          return { ok: true as const, status: 200, body: standardHealth('intex-agent') };
        }
        if (url.includes(':8113/')) {
          return { ok: true as const, status: 200, body: standardHealth('whatsapp-service') };
        }
        return { ok: true as const, status: 200, body: runningMatrixHealth(config.matrixUserId) };
      }),
    },
    firebaseIdentity: {
      getUserState: vi.fn(async () => ({ ok: true as const, state: 'enabled' as const })),
    },
    matrix: {
      whoAmI: vi.fn(async () => ({ ok: true as const, userId: config.matrixUserId })),
    },
    whatsapp: {
      getDeliveryStatus: vi.fn(async () => ({
        ok: true as const,
        value: { status: 'ready', deliverable: true },
      })),
    },
  };
}

function createPreflightProtectedFiles(config: EvaluatorConfig): ProtectedFilePort {
  return {
    read: vi.fn(async (path: string) => {
      if (path === config.matrixAccessTokenFile) {
        return { ok: true as const, contents: 'synthetic-matrix-token\n' };
      }
      if (path === config.matrixTargetsFile) {
        return {
          ok: true as const,
          contents: JSON.stringify({
            'synthetic-source': { intex_agent: '!agent-room:home-dev' },
          }),
        };
      }
      return { ok: true as const, contents: canonicalizeEvaluatorConfig(config) };
    }),
    validatePrivateDirectory: vi.fn(async () => ({ ok: true as const })),
    ensurePrivateDirectory: vi.fn(async () => ({ ok: true as const })),
    createExclusive: vi.fn(async () => ({ state: 'exists' as const })),
  };
}

function createPreflightPorts(config: EvaluatorConfig = VALID_CONFIG): PreflightPorts {
  return {
    ...createSetupPorts(config, createPreflightProtectedFiles(config)),
    scenarioCatalog: {
      count: vi.fn(async () => ({ ok: true as const, count: 20 })),
    },
    miniMaxProbe: {
      probe: vi.fn(async () => ({ ok: true as const })),
    },
  };
}

function overrideHealthResult(
  ports: PreflightPorts,
  targetUrl: string,
  replacement: Awaited<ReturnType<PreflightPorts['healthHttp']['get']>>
): void {
  const originalGet = ports.healthHttp.get;
  ports.healthHttp.get = vi.fn(async (url: string) =>
    url === targetUrl ? replacement : await originalGet(url)
  );
}

describe('evaluator config schemas', () => {
  it('accepts the exact version-one config and canonicalizes it with a final newline', () => {
    expect(EvaluatorConfigSchema.parse(VALID_CONFIG)).toEqual(VALID_CONFIG);
    expect(canonicalizeEvaluatorConfig(VALID_CONFIG)).toBe(
      `${JSON.stringify(VALID_CONFIG, null, 2)}\n`
    );
  });

  it.each([
    ['unknown key', { ...VALID_CONFIG, unexpected: true }],
    ['missing key', { ...VALID_CONFIG, userId: undefined }],
    ['wrong version', { ...VALID_CONFIG, schemaVersion: 2 }],
    ['blank alias', { ...VALID_CONFIG, accountAlias: '' }],
    ['untrimmed alias', { ...VALID_CONFIG, accountAlias: ' operator ' }],
    ['long alias', { ...VALID_CONFIG, accountAlias: 'a'.repeat(65) }],
    ['e-mail alias', { ...VALID_CONFIG, accountAlias: 'operator@example.test' }],
    ['provider-subject alias', { ...VALID_CONFIG, accountAlias: 'auth0|operator' }],
    ['phone alias', { ...VALID_CONFIG, accountAlias: '48123456789' }],
    ['formatted phone alias', { ...VALID_CONFIG, accountAlias: '48 123-456-789' }],
    ['dotted phone alias', { ...VALID_CONFIG, accountAlias: '481.234.567' }],
    ['mixed separator phone alias', { ...VALID_CONFIG, accountAlias: '48-123.456' }],
    [
      'international mixed separator phone alias',
      { ...VALID_CONFIG, accountAlias: '0048 123.456' },
    ],
    ['Matrix alias', { ...VALID_CONFIG, accountAlias: '@operator:home-dev' }],
    ['path alias', { ...VALID_CONFIG, accountAlias: '/home/operator' }],
    ['newline alias', { ...VALID_CONFIG, accountAlias: 'operator\nsecret' }],
    ['blank user ID', { ...VALID_CONFIG, userId: '' }],
    ['untrimmed user ID', { ...VALID_CONFIG, userId: ' auth0|operator' }],
    ['long user ID', { ...VALID_CONFIG, userId: 'u'.repeat(513) }],
    ['invalid Matrix user ID', { ...VALID_CONFIG, matrixUserId: 'operator' }],
    ['relative token path', { ...VALID_CONFIG, matrixAccessTokenFile: 'token' }],
    ['relative targets path', { ...VALID_CONFIG, matrixTargetsFile: 'targets.json' }],
  ])('rejects %s', (_name, candidate) => {
    expect(EvaluatorConfigSchema.safeParse(candidate).success).toBe(false);
  });

  it('parses JSON without exposing parser issues', () => {
    expect(parseEvaluatorConfigContents(JSON.stringify(VALID_CONFIG))).toEqual({
      ok: true,
      value: VALID_CONFIG,
    });
    expect(parseEvaluatorConfigContents('{not-json')).toEqual({ ok: false });
    expect(
      parseEvaluatorConfigContents(JSON.stringify({ ...VALID_CONFIG, secret: 'sentinel' }))
    ).toEqual({ ok: false });
  });

  it('strictly parses Matrix targets and exact room IDs', () => {
    const targets = {
      'synthetic-source': { intex_agent: '!agent-room:home-dev' },
    };

    expect(MatrixTargetsSchema.parse(targets)).toEqual(targets);
    expect(parseMatrixTargetsContents(JSON.stringify(targets))).toEqual({
      ok: true,
      value: targets,
    });

    for (const invalid of [
      null,
      [],
      'targets',
      { 'synthetic-source': {} },
      { 'synthetic-source': { intex_agent: '' } },
      { 'synthetic-source': { intex_agent: 'room' } },
      { 'synthetic-source': { intex_agent: '!agent-room:home-dev', extra: true } },
    ]) {
      expect(MatrixTargetsSchema.safeParse(invalid).success).toBe(false);
    }
    expect(parseMatrixTargetsContents('{not-json')).toEqual({ ok: false });
  });
});

describe('createNodeProtectedFilePort', () => {
  let rootDirectory: string;
  let privateDirectory: string;
  let protectedFile: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'intex-agent-preflight-'));
    privateDirectory = join(rootDirectory, 'private');
    protectedFile = join(privateDirectory, 'protected.json');
    await mkdir(privateDirectory, { mode: 0o700 });
    await chmod(privateDirectory, 0o700);
    await writeFile(protectedFile, 'protected contents', { mode: 0o600 });
    await chmod(protectedFile, 0o600);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('reads only a regular file with the exact owner and mode through a bounded handle', async () => {
    const port = createNodeProtectedFilePort({ expectedUid: UID });

    await expect(port.read(protectedFile, { mode: 0o600, maxBytes: 64 })).resolves.toEqual({
      ok: true,
      contents: 'protected contents',
    });
  });

  it('maps missing, symlink, non-regular, wrong-owner, wrong-mode, and oversized files', async () => {
    const port = createNodeProtectedFilePort({ expectedUid: UID });
    const symlinkPath = join(privateDirectory, 'symlink');
    await symlink(protectedFile, symlinkPath);

    await expect(
      port.read(join(privateDirectory, 'missing'), { mode: 0o600, maxBytes: 64 })
    ).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(port.read(symlinkPath, { mode: 0o600, maxBytes: 64 })).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
    await expect(port.read(privateDirectory, { mode: 0o600, maxBytes: 64 })).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
    await expect(
      createNodeProtectedFilePort({ expectedUid: UID + 1 }).read(protectedFile, {
        mode: 0o600,
        maxBytes: 64,
      })
    ).resolves.toEqual({ ok: false, reason: 'unsafe' });

    await chmod(protectedFile, 0o644);
    await expect(port.read(protectedFile, { mode: 0o600, maxBytes: 64 })).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });

    await chmod(protectedFile, 0o1600);
    await expect(port.read(protectedFile, { mode: 0o600, maxBytes: 64 })).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });

    await chmod(protectedFile, 0o600);
    await expect(port.read(protectedFile, { mode: 0o600, maxBytes: 4 })).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('rejects a same-permission replacement between lstat and open', async () => {
    const originalFile = join(privateDirectory, 'original');
    let replaced = false;
    const port = createNodeProtectedFilePort({
      expectedUid: UID,
      fileSystem: {
        open: async (...args) => {
          if (!replaced) {
            replaced = true;
            await rename(protectedFile, originalFile);
            await writeFile(protectedFile, 'replacement sentinel', { mode: 0o600 });
            await chmod(protectedFile, 0o600);
          }
          return await open(...args);
        },
      },
    });

    await expect(port.read(protectedFile, { mode: 0o600, maxBytes: 64 })).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
  });

  it.each([
    ['EACCES', 'unreadable'],
    ['EPERM', 'unreadable'],
    ['ELOOP', 'unsafe'],
  ] as const)('maps open %s without returning the underlying error', async (code, reason) => {
    const port = createNodeProtectedFilePort({
      expectedUid: UID,
      fileSystem: {
        open: async () => {
          throw Object.assign(new Error('secret sentinel'), { code });
        },
      },
    });

    const result = await port.read(protectedFile, { mode: 0o600, maxBytes: 64 });

    expect(result).toEqual({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain('secret sentinel');
  });

  it('validates and creates only an exact private directory', async () => {
    const port = createNodeProtectedFilePort({ expectedUid: UID });
    const newDirectory = join(rootDirectory, 'created-private');

    await expect(port.validatePrivateDirectory(privateDirectory)).resolves.toEqual({ ok: true });
    await expect(port.validatePrivateDirectory(join(rootDirectory, 'missing'))).resolves.toEqual({
      ok: false,
      reason: 'missing',
    });
    await expect(port.validatePrivateDirectory(protectedFile)).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
    await expect(
      createNodeProtectedFilePort({ expectedUid: UID + 1 }).validatePrivateDirectory(
        privateDirectory
      )
    ).resolves.toEqual({ ok: false, reason: 'unsafe' });

    await chmod(privateDirectory, 0o755);
    await expect(port.validatePrivateDirectory(privateDirectory)).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
    await chmod(privateDirectory, 0o700);

    await expect(port.ensurePrivateDirectory(newDirectory)).resolves.toEqual({ ok: true });
    const stats = await lstat(newDirectory);
    expect(stats.isDirectory()).toBe(true);
    expect(stats.mode & 0o7777).toBe(0o700);
  });

  it('rejects a symlink directory without following it', async () => {
    const port = createNodeProtectedFilePort({ expectedUid: UID });
    const symlinkDirectory = join(rootDirectory, 'private-link');
    await symlink(privateDirectory, symlinkDirectory);

    await expect(port.validatePrivateDirectory(symlinkDirectory)).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
    await expect(port.ensurePrivateDirectory(symlinkDirectory)).resolves.toEqual({
      ok: false,
      reason: 'unsafe',
    });
  });

  it('does not expose protected contents through metadata operations', async () => {
    const port = createNodeProtectedFilePort({ expectedUid: UID });
    const result = await port.read(protectedFile, { mode: 0o600, maxBytes: 1 });

    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(await readFile(protectedFile, 'utf8')).toBe('protected contents');
  });

  it('removes only the staging file and leaves the canonical path absent when hardening fails', async () => {
    const partialPath = join(privateDirectory, 'partial.json');
    const temporaryPath = stagingPath(partialPath);
    const port = createNodeProtectedFilePort({
      expectedUid: UID,
      nonce: () => TEST_NONCE,
      fileSystem: {
        open: async (...args) => {
          const handle = await open(...args);
          return new Proxy(handle, {
            get(target, property): unknown {
              if (property === 'chmod') {
                return async (): Promise<never> => {
                  throw new Error('private chmod sentinel');
                };
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      },
    });

    const result = await port.createExclusive(partialPath, 'partial contents sentinel');

    expect(result).toEqual({ state: 'failed' });
    expect(JSON.stringify(result)).not.toContain('private chmod sentinel');
    await expect(lstat(partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['../escape', 'ABCDEF0123456789ABCDEF0123456789', 'abc/def', 'short'])(
    'rejects invalid staging nonce %s before filesystem I/O',
    async (nonce) => {
      const openSpy = vi.fn(async (): Promise<never> => {
        throw new Error('unexpected open');
      });
      const linkSpy = vi.fn(async () => undefined);
      const unlinkSpy = vi.fn(async () => undefined);
      const port = createNodeProtectedFilePort({
        expectedUid: UID,
        nonce: () => nonce,
        fileSystem: { open: openSpy, link: linkSpy, unlink: unlinkSpy },
      });

      await expect(
        port.createExclusive(join(privateDirectory, 'invalid-nonce.json'), 'contents')
      ).resolves.toEqual({ state: 'failed' });
      expect(openSpy).not.toHaveBeenCalled();
      expect(linkSpy).not.toHaveBeenCalled();
      expect(unlinkSpy).not.toHaveBeenCalled();
    }
  );

  it('uses an atomic hard link without replacing a concurrently created canonical file', async () => {
    const canonicalPath = join(privateDirectory, 'race.json');
    const temporaryPath = stagingPath(canonicalPath);
    const linkSpy = vi.fn(async (sourcePath: string, destinationPath: string) => {
      await writeFile(destinationPath, 'race winner contents', { mode: 0o600 });
      await chmod(destinationPath, 0o600);
      await link(sourcePath, destinationPath);
    });
    const port = createNodeProtectedFilePort({
      expectedUid: UID,
      nonce: () => TEST_NONCE,
      fileSystem: { link: linkSpy },
    });

    await expect(port.createExclusive(canonicalPath, 'candidate contents')).resolves.toEqual({
      state: 'exists',
    });
    expect(linkSpy).toHaveBeenCalledWith(temporaryPath, canonicalPath);
    expect(await readFile(canonicalPath, 'utf8')).toBe('race winner contents');
    await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['chmod', 'writeFile', 'sync', 'close'] as const)(
    'leaves the canonical path absent when staging %s fails before publish',
    async (failingMethod) => {
      const canonicalPath = join(privateDirectory, `${failingMethod}.json`);
      const temporaryPath = stagingPath(canonicalPath);
      const openedPaths: string[] = [];
      const linkSpy = vi.fn(async () => undefined);
      const port = createNodeProtectedFilePort({
        expectedUid: UID,
        nonce: () => TEST_NONCE,
        fileSystem: {
          open: async (...args) => {
            openedPaths.push(args[0]);
            const handle = await open(...args);
            return new Proxy(handle, {
              get(target, property): unknown {
                if (property === failingMethod) {
                  return async (): Promise<never> => {
                    if (failingMethod === 'close') {
                      await target.close();
                    }
                    throw new Error('private staging failure sentinel');
                  };
                }
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          },
          link: linkSpy,
        },
      });

      const result = await port.createExclusive(canonicalPath, 'candidate contents');

      expect(result).toEqual({ state: 'failed' });
      expect(JSON.stringify(result)).not.toContain('private staging failure sentinel');
      expect(openedPaths).toEqual([temporaryPath]);
      expect(linkSpy).not.toHaveBeenCalled();
      await expect(lstat(canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('leaves the canonical path absent when atomic publish fails', async () => {
    const canonicalPath = join(privateDirectory, 'link-failure.json');
    const temporaryPath = stagingPath(canonicalPath);
    const linkSpy = vi.fn(async () => {
      throw Object.assign(new Error('private link failure sentinel'), { code: 'EACCES' });
    });
    const port = createNodeProtectedFilePort({
      expectedUid: UID,
      nonce: () => TEST_NONCE,
      fileSystem: { link: linkSpy },
    });

    const result = await port.createExclusive(canonicalPath, 'candidate contents');

    expect(result).toEqual({ state: 'failed' });
    expect(JSON.stringify(result)).not.toContain('private link failure sentinel');
    expect(linkSpy).toHaveBeenCalledWith(temporaryPath, canonicalPath);
    await expect(lstat(canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a complete canonical file when best-effort staging cleanup fails', async () => {
    const canonicalPath = join(privateDirectory, 'cleanup-failure.json');
    const temporaryPath = stagingPath(canonicalPath);
    const unlinkSpy = vi.fn(async (path: string) => {
      if (path === temporaryPath) {
        throw Object.assign(new Error('private unlink failure sentinel'), { code: 'EACCES' });
      }
      await unlink(path);
    });
    const port = createNodeProtectedFilePort({
      expectedUid: UID,
      nonce: () => TEST_NONCE,
      fileSystem: { unlink: unlinkSpy },
    });

    const result = await port.createExclusive(canonicalPath, 'complete candidate contents');

    expect(result).toEqual({ state: 'created' });
    expect(JSON.stringify(result)).not.toContain('private unlink failure sentinel');
    expect(await readFile(canonicalPath, 'utf8')).toBe('complete candidate contents');
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).toHaveBeenCalledWith(temporaryPath);
    expect(unlinkSpy).not.toHaveBeenCalledWith(canonicalPath);
  });
});

describe('setupEvaluatorConfig', () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'intex-agent-setup-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('strictly validates the in-memory candidate before any file or adapter I/O', async () => {
    const ports = createSetupPorts();
    const result = await setupEvaluatorConfig(
      { ...VALID_CONFIG, secret: 'secret sentinel' },
      ports
    );

    expect(result).toEqual({
      ok: false,
      exitCode: 2,
      code: 'CONFIG_INVALID',
      checks: [
        { check: 'runtime', status: 'passed' },
        { check: 'environment', status: 'passed' },
        { check: 'config', status: 'failed', code: 'CONFIG_INVALID' },
      ],
    });
    expect(ports.protectedFiles.read).not.toHaveBeenCalled();
    expect(ports.healthHttp.get).not.toHaveBeenCalled();
    expect(ports.protectedFiles.ensurePrivateDirectory).not.toHaveBeenCalled();
    expect(ports.protectedFiles.createExclusive).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret sentinel');
  });

  it('performs every readiness check before creating the config parent or file', async () => {
    const ports = createSetupPorts();
    vi.mocked(ports.healthHttp.get).mockResolvedValueOnce({ ok: false, reason: 'network' });

    const result = await setupEvaluatorConfig(VALID_CONFIG, ports);

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      code: 'INTEX_AGENT_HEALTH_FAILED',
    });
    expect(ports.protectedFiles.ensurePrivateDirectory).not.toHaveBeenCalled();
    expect(ports.protectedFiles.createExclusive).not.toHaveBeenCalled();
  });

  it('creates an exact private parent and exclusive canonical config, then succeeds idempotently', async () => {
    const secretsDirectory = join(rootDirectory, 'secrets');
    const configDirectory = join(rootDirectory, 'config');
    const configPath = join(configDirectory, 'intex-agent-evals.json');
    await mkdir(secretsDirectory, { mode: 0o700 });
    await chmod(secretsDirectory, 0o700);
    const candidate: EvaluatorConfig = {
      ...VALID_CONFIG,
      matrixAccessTokenFile: join(secretsDirectory, 'matrix-token'),
      matrixTargetsFile: join(secretsDirectory, 'matrix-targets.json'),
    };
    await writeFile(candidate.matrixAccessTokenFile, 'synthetic-matrix-token\n', { mode: 0o600 });
    await writeFile(
      candidate.matrixTargetsFile,
      JSON.stringify({ 'synthetic-source': { intex_agent: '!agent-room:home-dev' } }),
      { mode: 0o600 }
    );
    await chmod(candidate.matrixAccessTokenFile, 0o600);
    await chmod(candidate.matrixTargetsFile, 0o600);
    const protectedFiles = createNodeProtectedFilePort({ expectedUid: UID });
    const ports = createSetupPorts(candidate, protectedFiles);
    ports.configPath = configPath;

    await expect(setupEvaluatorConfig(candidate, ports)).resolves.toMatchObject({
      ok: true,
      exitCode: 0,
      state: 'created',
      accountAlias: candidate.accountAlias,
    });
    expect((await lstat(configDirectory)).mode & 0o7777).toBe(0o700);
    expect((await lstat(configPath)).mode & 0o7777).toBe(0o600);
    expect(await readFile(configPath, 'utf8')).toBe(canonicalizeEvaluatorConfig(candidate));

    await expect(setupEvaluatorConfig(candidate, ports)).resolves.toMatchObject({
      ok: true,
      exitCode: 0,
      state: 'already_configured',
      accountAlias: candidate.accountAlias,
    });

    await expect(
      setupEvaluatorConfig({ ...candidate, accountAlias: 'different-operator' }, ports)
    ).resolves.toMatchObject({
      ok: false,
      exitCode: 2,
      code: 'CONFIG_CONFLICT',
    });
  });

  it('maps an EEXIST race to a conflict after a secure differing-file read', async () => {
    const protectedFiles = createFakeProtectedFiles(VALID_CONFIG);
    const ports = createSetupPorts(VALID_CONFIG, protectedFiles);
    const originalRead = protectedFiles.read;
    protectedFiles.createExclusive = vi.fn(async () => ({ state: 'exists' as const }));
    protectedFiles.read = vi.fn(async (path, policy) => {
      if (path === ports.configPath) {
        return {
          ok: true as const,
          contents: canonicalizeEvaluatorConfig({
            ...VALID_CONFIG,
            accountAlias: 'different-operator',
          }),
        };
      }
      return await originalRead(path, policy);
    });

    await expect(setupEvaluatorConfig(VALID_CONFIG, ports)).resolves.toMatchObject({
      ok: false,
      exitCode: 2,
      code: 'CONFIG_CONFLICT',
    });
  });

  it('never unlinks a replacement canonical path when the secure reread fails', async () => {
    const secretsDirectory = join(rootDirectory, 'race-secrets');
    const configDirectory = join(rootDirectory, 'race-config');
    const configPath = join(configDirectory, 'intex-agent-evals.json');
    const publishedOriginalPath = join(configDirectory, 'published-original.json');
    await mkdir(secretsDirectory, { mode: 0o700 });
    await chmod(secretsDirectory, 0o700);
    const candidate: EvaluatorConfig = {
      ...VALID_CONFIG,
      matrixAccessTokenFile: join(secretsDirectory, 'matrix-token'),
      matrixTargetsFile: join(secretsDirectory, 'matrix-targets.json'),
    };
    await writeFile(candidate.matrixAccessTokenFile, 'synthetic-matrix-token\n', { mode: 0o600 });
    await writeFile(
      candidate.matrixTargetsFile,
      JSON.stringify({ 'synthetic-source': { intex_agent: '!agent-room:home-dev' } }),
      { mode: 0o600 }
    );
    await chmod(candidate.matrixAccessTokenFile, 0o600);
    await chmod(candidate.matrixTargetsFile, 0o600);

    let staleCanonicalStats: Stats | undefined;
    const nodePort = createNodeProtectedFilePort({
      expectedUid: UID,
      nonce: () => TEST_NONCE,
      fileSystem: {
        lstat: async (path) =>
          path === configPath && staleCanonicalStats !== undefined
            ? staleCanonicalStats
            : await lstat(path),
      },
    });
    const protectedFiles: ProtectedFilePort = {
      ...nodePort,
      read: async (path, policy) => {
        if (path === configPath) {
          await rename(configPath, publishedOriginalPath);
          staleCanonicalStats = await lstat(publishedOriginalPath);
          await writeFile(configPath, 'replacement canonical contents', { mode: 0o600 });
          await chmod(configPath, 0o600);
          return { ok: false, reason: 'unreadable' };
        }
        return await nodePort.read(path, policy);
      },
    };
    const ports = createSetupPorts(candidate, protectedFiles);
    ports.configPath = configPath;

    const result = await setupEvaluatorConfig(candidate, ports);

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      code: 'CONFIG_WRITE_FAILED',
    });
    expect(await readFile(configPath, 'utf8')).toBe('replacement canonical contents');
    expect(await readFile(publishedOriginalPath, 'utf8')).toBe(
      canonicalizeEvaluatorConfig(candidate)
    );
  });

  it('never mutates a pre-existing file and never leaks a differing config', async () => {
    const protectedFiles = createFakeProtectedFiles(VALID_CONFIG);
    const ports = createSetupPorts(VALID_CONFIG, protectedFiles);
    const originalRead = protectedFiles.read;
    protectedFiles.createExclusive = vi.fn(async () => ({ state: 'exists' as const }));
    protectedFiles.read = vi.fn(async (path, policy) => {
      if (path === ports.configPath) {
        return {
          ok: true as const,
          contents: `${canonicalizeEvaluatorConfig({
            ...VALID_CONFIG,
            userId: 'auth0|private-existing-user',
          })}private secret sentinel`,
        };
      }
      return await originalRead(path, policy);
    });

    const result = await setupEvaluatorConfig(VALID_CONFIG, ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2 });
    expect(JSON.stringify(result)).not.toContain('private-existing-user');
    expect(JSON.stringify(result)).not.toContain('private secret sentinel');
  });

  it('uses only the candidate user ID for Firebase and WhatsApp checks', async () => {
    const ports = createSetupPorts();

    const result = await setupEvaluatorConfig(VALID_CONFIG, ports);

    expect(ports.firebaseIdentity.getUserState).toHaveBeenCalledWith(VALID_CONFIG.userId);
    expect(ports.whatsapp.getDeliveryStatus).toHaveBeenCalledWith(VALID_CONFIG.userId);
    expect(result).toMatchObject({ ok: true, accountAlias: VALID_CONFIG.accountAlias });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(VALID_CONFIG.userId);
    expect(serialized).not.toContain(VALID_CONFIG.matrixUserId);
    expect(serialized).not.toContain(VALID_CONFIG.matrixAccessTokenFile);
    expect(serialized).not.toContain('synthetic-matrix-token');
  });

  it('uses the configured config size bound on secure reread', async () => {
    const protectedFiles = createFakeProtectedFiles(VALID_CONFIG);
    const ports = createSetupPorts(VALID_CONFIG, protectedFiles);

    await setupEvaluatorConfig(VALID_CONFIG, ports);

    const configRead = vi
      .mocked(protectedFiles.read)
      .mock.calls.find(([path]) => path === ports.configPath);
    expect(configRead?.[1]).toEqual({ mode: 0o600, maxBytes: CONFIG_MAX_BYTES });
  });
});

describe('runPreflight', () => {
  it('runs the fixed checks in fail-fast order and returns only the safe summary', async () => {
    const ports = createPreflightPorts();

    const result = await runPreflight(ports);

    expect(result).toEqual({
      ok: true,
      exitCode: 0,
      summary: {
        hostname: 'home-dev',
        ports: { intexAgent: 8134, whatsappService: 8113, matrixAdapter: 8099 },
        judgeModel: JUDGE_MODEL,
        scenarioCount: 20,
        accountAlias: VALID_CONFIG.accountAlias,
      },
      checks: [
        { check: 'runtime', status: 'passed' },
        { check: 'environment', status: 'passed' },
        { check: 'config', status: 'passed' },
        { check: 'matrix_files', status: 'passed' },
        { check: 'intex_agent_health', status: 'passed' },
        { check: 'whatsapp_health', status: 'passed' },
        { check: 'matrix_health', status: 'passed' },
        { check: 'firebase_identity', status: 'passed' },
        { check: 'matrix_identity', status: 'passed' },
        { check: 'whatsapp_delivery', status: 'passed' },
        { check: 'scenario_catalog', status: 'passed' },
        { check: 'minimax_probe', status: 'passed' },
      ],
    });
    expect(ports.healthHttp.get).toHaveBeenNthCalledWith(1, INTEX_AGENT_HEALTH_URL);
    expect(ports.healthHttp.get).toHaveBeenNthCalledWith(2, WHATSAPP_HEALTH_URL);
    expect(ports.healthHttp.get).toHaveBeenNthCalledWith(3, MATRIX_ADAPTER_HEALTH_URL);
    expect(ports.miniMaxProbe.probe).toHaveBeenCalledTimes(1);

    const probeOrder = vi.mocked(ports.miniMaxProbe.probe).mock.invocationCallOrder[0];
    const catalogOrder = vi.mocked(ports.scenarioCatalog.count).mock.invocationCallOrder[0];
    expect(probeOrder).toBeGreaterThan(catalogOrder ?? Number.MAX_SAFE_INTEGER);

    const serialized = JSON.stringify(result);
    for (const secret of [
      VALID_CONFIG.userId,
      VALID_CONFIG.matrixUserId,
      VALID_CONFIG.matrixAccessTokenFile,
      VALID_CONFIG.matrixTargetsFile,
      'synthetic-matrix-token',
      'synthetic-source',
      '!agent-room:home-dev',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ['wrong platform', { platform: 'darwin' }, 'HOME_DEV_REQUIRED'],
    ['wrong hostname', { hostname: 'mac-dev' }, 'HOME_DEV_REQUIRED'],
    ['missing UID', { uid: undefined }, 'HOME_DEV_REQUIRED'],
    ['negative UID', { uid: -1 }, 'HOME_DEV_REQUIRED'],
  ] as const)('fails before I/O for %s', async (_name, runtimeOverride, code) => {
    const ports = createPreflightPorts();
    if ('platform' in runtimeOverride) {
      vi.mocked(ports.runtime.platform).mockReturnValue(runtimeOverride.platform);
    }
    if ('hostname' in runtimeOverride) {
      vi.mocked(ports.runtime.hostname).mockReturnValue(runtimeOverride.hostname);
    }
    if ('uid' in runtimeOverride) {
      vi.mocked(ports.runtime.uid).mockReturnValue(runtimeOverride.uid);
    }

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.protectedFiles.validatePrivateDirectory).not.toHaveBeenCalled();
    expect(ports.healthHttp.get).not.toHaveBeenCalled();
    expect(ports.miniMaxProbe.probe).not.toHaveBeenCalled();
  });

  it.each([
    ['INTEXURAOS_ENVIRONMENT', undefined, 'REQUIRED_ENV_MISSING'],
    ['INTEXURAOS_ENVIRONMENT', 'local', 'REQUIRED_ENV_MISSING'],
    ['INTEXURAOS_INTERNAL_AUTH_TOKEN', '', 'REQUIRED_ENV_MISSING'],
    ['INTEXURAOS_GCP_PROJECT_ID', '   ', 'REQUIRED_ENV_MISSING'],
    ['GOOGLE_APPLICATION_CREDENTIALS', undefined, 'REQUIRED_ENV_MISSING'],
    ['INTEXURAOS_OPENROUTER_APP_API_KEY', '', 'MINIMAX_KEY_MISSING'],
  ] as const)('rejects invalid environment value for %s', async (name, value, code) => {
    const ports = createPreflightPorts();
    ports.runtime = createRuntimePort({ [name]: value });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.protectedFiles.validatePrivateDirectory).not.toHaveBeenCalled();
    expect(ports.miniMaxProbe.probe).not.toHaveBeenCalled();
  });

  it.each([
    ['missing parent', { ok: false, reason: 'missing' }, 'CONFIG_NOT_FOUND'],
    ['unsafe parent', { ok: false, reason: 'unsafe' }, 'CONFIG_PARENT_UNSAFE'],
  ] as const)('maps a %s without reading the config', async (_name, directoryResult, code) => {
    const ports = createPreflightPorts();
    vi.mocked(ports.protectedFiles.validatePrivateDirectory).mockResolvedValue(directoryResult);

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.protectedFiles.read).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 'CONFIG_NOT_FOUND'],
    ['unsafe', 'CONFIG_FILE_UNSAFE'],
    ['unreadable', 'CONFIG_FILE_UNSAFE'],
    ['too_large', 'CONFIG_FILE_UNSAFE'],
  ] as const)('maps config read reason %s', async (reason, code) => {
    const ports = createPreflightPorts();
    vi.mocked(ports.protectedFiles.read).mockResolvedValueOnce({ ok: false, reason });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.healthHttp.get).not.toHaveBeenCalled();
  });

  it('rejects malformed or schema-invalid config without returning parser data', async () => {
    const ports = createPreflightPorts();
    vi.mocked(ports.protectedFiles.read).mockResolvedValueOnce({
      ok: true,
      contents: '{private secret sentinel',
    });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code: 'CONFIG_INVALID' });
    expect(JSON.stringify(result)).not.toContain('private secret sentinel');
  });

  it.each([
    [VALID_CONFIG.matrixAccessTokenFile, 'unsafe', 'MATRIX_TOKEN_FILE_UNSAFE'],
    [VALID_CONFIG.matrixTargetsFile, 'too_large', 'MATRIX_TARGETS_FILE_UNSAFE'],
  ] as const)('maps protected referenced-file failure for %s', async (path, reason, code) => {
    const ports = createPreflightPorts();
    const originalRead = ports.protectedFiles.read;
    ports.protectedFiles.read = vi.fn(async (readPath, policy) =>
      readPath === path ? { ok: false as const, reason } : await originalRead(readPath, policy)
    );

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.healthHttp.get).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only token and malformed targets before health checks', async () => {
    const tokenPorts = createPreflightPorts();
    const tokenRead = tokenPorts.protectedFiles.read;
    tokenPorts.protectedFiles.read = vi.fn(async (path, policy) =>
      path === VALID_CONFIG.matrixAccessTokenFile
        ? { ok: true as const, contents: ' \n ' }
        : await tokenRead(path, policy)
    );
    await expect(runPreflight(tokenPorts)).resolves.toMatchObject({
      ok: false,
      code: 'MATRIX_TOKEN_INVALID',
    });

    const targetPorts = createPreflightPorts();
    const targetRead = targetPorts.protectedFiles.read;
    targetPorts.protectedFiles.read = vi.fn(async (path, policy) =>
      path === VALID_CONFIG.matrixTargetsFile
        ? { ok: true as const, contents: '{private target sentinel' }
        : await targetRead(path, policy)
    );
    const targetResult = await runPreflight(targetPorts);
    expect(targetResult).toMatchObject({ ok: false, code: 'MATRIX_TARGETS_INVALID' });
    expect(JSON.stringify(targetResult)).not.toContain('private target sentinel');
  });

  it('uses the exact protected-read bounds for config, token, and targets', async () => {
    const ports = createPreflightPorts();

    await runPreflight(ports);

    expect(ports.protectedFiles.read).toHaveBeenCalledWith(ports.configPath, {
      mode: 0o600,
      maxBytes: CONFIG_MAX_BYTES,
    });
    expect(ports.protectedFiles.read).toHaveBeenCalledWith(VALID_CONFIG.matrixAccessTokenFile, {
      mode: 0o600,
      maxBytes: MATRIX_TOKEN_MAX_BYTES,
    });
    expect(ports.protectedFiles.read).toHaveBeenCalledWith(VALID_CONFIG.matrixTargetsFile, {
      mode: 0o600,
      maxBytes: MATRIX_TARGETS_MAX_BYTES,
    });
  });
});

describe('preflight readiness mappings', () => {
  it.each([
    ['intex-agent', INTEX_AGENT_HEALTH_URL, 'INTEX_AGENT_HEALTH_FAILED'],
    ['whatsapp-service', WHATSAPP_HEALTH_URL, 'WHATSAPP_HEALTH_FAILED'],
  ] as const)('strictly validates %s health', async (serviceName, url, code) => {
    for (const body of [
      { ...standardHealth(serviceName), status: 'degraded' },
      { ...standardHealth(serviceName), serviceName: 'wrong-service' },
      { ...standardHealth(serviceName), extra: 'private secret sentinel' },
      {
        ...standardHealth(serviceName),
        checks: [{ name: 'db', status: 'ok', latencyMs: -1, details: null }],
      },
      { ...standardHealth(serviceName), timestamp: 'not-a-date' },
    ]) {
      const ports = createPreflightPorts();
      overrideHealthResult(ports, url, { ok: true, status: 200, body });

      const result = await runPreflight(ports);

      expect(result).toMatchObject({ ok: false, exitCode: 2, code });
      expect(JSON.stringify(result)).not.toContain('private secret sentinel');
    }

    const statusPorts = createPreflightPorts();
    overrideHealthResult(statusPorts, url, {
      ok: true,
      status: 503,
      body: standardHealth(serviceName),
    });
    await expect(runPreflight(statusPorts)).resolves.toMatchObject({ ok: false, code });

    const transportPorts = createPreflightPorts();
    overrideHealthResult(transportPorts, url, { ok: false, reason: 'timeout' });
    await expect(runPreflight(transportPorts)).resolves.toMatchObject({ ok: false, code });
  });

  it.each([
    'starting',
    'initializing',
    'error',
    'waiting_for_matrix_access_token',
    'waiting_for_intexuraos_oidc_credentials',
  ] as const)('rejects Matrix adapter state %s even when ok is true', async (state) => {
    const ports = createPreflightPorts();
    overrideHealthResult(ports, MATRIX_ADAPTER_HEALTH_URL, {
      ok: true,
      status: 200,
      body: { ...runningMatrixHealth(), state },
    });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code: 'MATRIX_HEALTH_FAILED' });
    expect(ports.firebaseIdentity.getUserState).not.toHaveBeenCalled();
  });

  it.each([
    ['ok false', { ...runningMatrixHealth(), ok: false }, 'MATRIX_HEALTH_FAILED'],
    [
      'last error',
      { ...runningMatrixHealth(), lastError: 'private error sentinel' },
      'MATRIX_HEALTH_FAILED',
    ],
    [
      'unknown key',
      { ...runningMatrixHealth(), unknown: 'private body sentinel' },
      'MATRIX_HEALTH_FAILED',
    ],
    [
      'negative counter',
      { ...runningMatrixHealth(), counters: { received: -1 } },
      'MATRIX_HEALTH_FAILED',
    ],
    [
      'invalid homeserver',
      { ...runningMatrixHealth(), homeserverUrl: 'not-a-url' },
      'MATRIX_HEALTH_FAILED',
    ],
    ['identity mismatch', runningMatrixHealth('@different:home-dev'), 'MATRIX_IDENTITY_MISMATCH'],
    [
      'missing target source',
      { ...runningMatrixHealth(), sourceAccountId: 'unmapped-source' },
      'MATRIX_TARGETS_INVALID',
    ],
  ] as const)('rejects Matrix health %s', async (_name, body, code) => {
    const ports = createPreflightPorts();
    overrideHealthResult(ports, MATRIX_ADAPTER_HEALTH_URL, { ok: true, status: 200, body });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(JSON.stringify(result)).not.toContain('private error sentinel');
    expect(JSON.stringify(result)).not.toContain('private body sentinel');
  });

  it.each(['toString', 'constructor', '__proto__'] as const)(
    'rejects inherited Matrix target key %s instead of passing full preflight',
    async (sourceAccountId) => {
      const ports = createPreflightPorts();
      const originalRead = ports.protectedFiles.read;
      ports.protectedFiles.read = vi.fn(async (path, policy) =>
        path === VALID_CONFIG.matrixTargetsFile
          ? { ok: true as const, contents: '{}' }
          : await originalRead(path, policy)
      );
      overrideHealthResult(ports, MATRIX_ADAPTER_HEALTH_URL, {
        ok: true,
        status: 200,
        body: { ...runningMatrixHealth(), sourceAccountId },
      });

      const result = await runPreflight(ports);

      expect(result).toMatchObject({
        ok: false,
        exitCode: 2,
        code: 'MATRIX_TARGETS_INVALID',
      });
      expect(ports.firebaseIdentity.getUserState).not.toHaveBeenCalled();
      expect(ports.miniMaxProbe.probe).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ ok: true, state: 'missing' }, 'FIREBASE_IDENTITY_MISSING'],
    [{ ok: true, state: 'disabled' }, 'FIREBASE_IDENTITY_DISABLED'],
    [{ ok: false }, 'FIREBASE_CHECK_FAILED'],
  ] as const)('maps Firebase state to %s', async (firebaseResult, code) => {
    const ports = createPreflightPorts();
    vi.mocked(ports.firebaseIdentity.getUserState).mockResolvedValue(firebaseResult);

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.matrix.whoAmI).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 'MATRIX_WHOAMI_UNAUTHORIZED'],
    ['timeout', 'MATRIX_WHOAMI_FAILED'],
    ['unavailable', 'MATRIX_WHOAMI_FAILED'],
    ['invalid_response', 'MATRIX_WHOAMI_FAILED'],
  ] as const)('maps Matrix whoami %s safely', async (reason, code) => {
    const ports = createPreflightPorts();
    vi.mocked(ports.matrix.whoAmI).mockResolvedValue({ ok: false, reason });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.whatsapp.getDeliveryStatus).not.toHaveBeenCalled();
  });

  it('requires three-way Matrix identity equality', async () => {
    const ports = createPreflightPorts();
    vi.mocked(ports.matrix.whoAmI).mockResolvedValue({
      ok: true,
      userId: '@different:home-dev',
    });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      code: 'MATRIX_IDENTITY_MISMATCH',
    });
    expect(JSON.stringify(result)).not.toContain('@different:home-dev');
  });

  it.each([
    [{ ok: false, reason: 'unavailable' }, 'WHATSAPP_DELIVERY_FAILED'],
    [
      {
        ok: true,
        value: { status: 'setup_required', deliverable: false, reason: 'private reason' },
      },
      'WHATSAPP_DELIVERY_NOT_READY',
    ],
    [
      { ok: true, value: { status: 'error', deliverable: false, message: 'private message' } },
      'WHATSAPP_DELIVERY_NOT_READY',
    ],
    [{ ok: true, value: { status: 'ready', deliverable: false } }, 'WHATSAPP_DELIVERY_FAILED'],
    [
      { ok: true, value: { status: 'ready', deliverable: true, extra: 'private extra' } },
      'WHATSAPP_DELIVERY_FAILED',
    ],
  ] as const)('strictly maps WhatsApp delivery result to %s', async (deliveryResult, code) => {
    const ports = createPreflightPorts();
    vi.mocked(ports.whatsapp.getDeliveryStatus).mockResolvedValue(deliveryResult);

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private reason');
    expect(serialized).not.toContain('private message');
    expect(serialized).not.toContain('private extra');
    expect(ports.scenarioCatalog.count).not.toHaveBeenCalled();
  });

  it('fails fast and never calls later adapters after the first failed prerequisite', async () => {
    const ports = createPreflightPorts();
    overrideHealthResult(ports, INTEX_AGENT_HEALTH_URL, { ok: false, reason: 'network' });

    await runPreflight(ports);

    expect(ports.healthHttp.get).toHaveBeenCalledTimes(1);
    expect(ports.firebaseIdentity.getUserState).not.toHaveBeenCalled();
    expect(ports.matrix.whoAmI).not.toHaveBeenCalled();
    expect(ports.whatsapp.getDeliveryStatus).not.toHaveBeenCalled();
    expect(ports.scenarioCatalog.count).not.toHaveBeenCalled();
    expect(ports.miniMaxProbe.probe).not.toHaveBeenCalled();
  });

  it('prevents the MiniMax probe when catalog loading fails', async () => {
    const ports = createPreflightPorts();
    vi.mocked(ports.scenarioCatalog.count).mockResolvedValue({ ok: false });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      code: 'SCENARIO_CATALOG_FAILED',
    });
    expect(ports.miniMaxProbe.probe).not.toHaveBeenCalled();
  });

  it.each([
    ['missing_key', 'MINIMAX_KEY_MISSING'],
    ['timeout', 'MINIMAX_PROBE_TIMEOUT'],
    ['invalid_json', 'MINIMAX_PROBE_INVALID'],
    ['invalid_schema', 'MINIMAX_PROBE_INVALID'],
    ['provider', 'MINIMAX_PROBE_FAILED'],
  ] as const)('maps MiniMax probe reason %s to %s', async (reason, code) => {
    const ports = createPreflightPorts();
    vi.mocked(ports.miniMaxProbe.probe).mockResolvedValue({ ok: false, reason });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code });
    expect(ports.miniMaxProbe.probe).toHaveBeenCalledTimes(1);
  });

  it('redacts an unexpected exception and never returns behavioral exit one', async () => {
    const ports = createPreflightPorts();
    vi.mocked(ports.runtime.uid).mockImplementation(() => {
      throw new Error('private exception sentinel');
    });

    const result = await runPreflight(ports);

    expect(result).toMatchObject({ ok: false, exitCode: 2, code: 'UNEXPECTED_FAILURE' });
    expect(JSON.stringify(result)).not.toContain('private exception sentinel');
    expect(JSON.stringify(result)).not.toContain('exitCode":1');
  });
});

describe('production preflight adapters', () => {
  it('reads runtime identity without performing I/O', () => {
    process.env['INTEX_AGENT_EVAL_SYNTHETIC_ENV'] = 'synthetic-value';
    const runtime = createNodeRuntimeIdentityPort();

    expect(runtime.platform()).toBe(process.platform);
    expect(runtime.hostname()).toBe(hostname());
    expect(runtime.uid()).toBe(process.getuid?.());
    expect(runtime.env('INTEX_AGENT_EVAL_SYNTHETIC_ENV')).toBe('synthetic-value');

    delete process.env['INTEX_AGENT_EVAL_SYNTHETIC_ENV'];
  });

  it('performs bounded JSON health GETs with exact safe request options', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(standardHealth('intex-agent')), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
    );
    const port = createHealthHttpPort({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });

    await expect(port.get(INTEX_AGENT_HEALTH_URL)).resolves.toEqual({
      ok: true,
      status: 200,
      body: standardHealth('intex-agent'),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      INTEX_AGENT_HEALTH_URL,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it.each([
    [new Response('not-json', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [new Response('{}', { headers: { 'content-type': 'text/plain' } }), 'invalid_json'],
    [new Response('12345', { headers: { 'content-type': 'application/json' } }), 'too_large'],
  ] as const)('maps malformed or oversized health responses to %s', async (response, reason) => {
    const port = createHealthHttpPort({
      fetchImpl: vi.fn<typeof fetch>(async () => response),
      timeoutMs: 50,
      maxBytes: reason === 'too_large' ? 4 : 4096,
    });

    await expect(port.get(INTEX_AGENT_HEALTH_URL)).resolves.toEqual({ ok: false, reason });
  });

  it('maps health network and timeout failures without raw errors', async () => {
    const networkPort = createHealthHttpPort({
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error('private network sentinel');
      }),
      timeoutMs: 50,
      maxBytes: 4096,
    });
    const networkResult = await networkPort.get(INTEX_AGENT_HEALTH_URL);
    expect(networkResult).toEqual({ ok: false, reason: 'network' });
    expect(JSON.stringify(networkResult)).not.toContain('private network sentinel');

    const timeoutFetch = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('private timeout sentinel', 'AbortError'));
          });
        })
    );
    const timeoutPort = createHealthHttpPort({
      fetchImpl: timeoutFetch,
      timeoutMs: 1,
      maxBytes: 4096,
    });
    const timeoutResult = await timeoutPort.get(INTEX_AGENT_HEALTH_URL);
    expect(timeoutResult).toEqual({ ok: false, reason: 'timeout' });
    expect(JSON.stringify(timeoutResult)).not.toContain('private timeout sentinel');
  });

  it('initializes one named Firebase app, checks the exact UID, and reads only disabled', async () => {
    const app = { name: 'intex-agent-evals-preflight' };
    const userRecord = { disabled: false } as { disabled: boolean; email?: string };
    Object.defineProperty(userRecord, 'email', {
      get: () => {
        throw new Error('profile fields must not be read');
      },
    });
    const getUser = vi.fn(async () => userRecord);
    const dependencies: FirebaseAdminDependencies = {
      getApps: vi.fn(() => []),
      getApp: vi.fn(() => app),
      initializeApp: vi.fn(() => app),
      getAuth: vi.fn(() => ({ getUser })),
      isUserNotFound: vi.fn(() => false),
    };
    const port = createFirebaseIdentityPort('synthetic-project', dependencies);

    await expect(port.getUserState(VALID_CONFIG.userId)).resolves.toEqual({
      ok: true,
      state: 'enabled',
    });
    expect(dependencies.initializeApp).toHaveBeenCalledWith(
      { projectId: 'synthetic-project' },
      'intex-agent-evals-preflight'
    );
    expect(getUser).toHaveBeenCalledWith(VALID_CONFIG.userId);
  });

  it('reuses the named Firebase app and maps missing, disabled, and generic failures', async () => {
    const app = { name: 'intex-agent-evals-preflight' };
    const getUser = vi
      .fn()
      .mockRejectedValueOnce({ code: 'auth/user-not-found' })
      .mockResolvedValueOnce({ disabled: true })
      .mockRejectedValueOnce(new Error('private firebase sentinel'));
    const dependencies: FirebaseAdminDependencies = {
      getApps: vi.fn(() => [app]),
      getApp: vi.fn(() => app),
      initializeApp: vi.fn(() => app),
      getAuth: vi.fn(() => ({ getUser })),
      isUserNotFound: vi.fn(
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'auth/user-not-found'
      ),
    };
    const port = createFirebaseIdentityPort('synthetic-project', dependencies);

    await expect(port.getUserState(VALID_CONFIG.userId)).resolves.toEqual({
      ok: true,
      state: 'missing',
    });
    await expect(port.getUserState(VALID_CONFIG.userId)).resolves.toEqual({
      ok: true,
      state: 'disabled',
    });
    const failed = await port.getUserState(VALID_CONFIG.userId);
    expect(failed).toEqual({ ok: false });
    expect(JSON.stringify(failed)).not.toContain('private firebase sentinel');
    expect(dependencies.getApp).toHaveBeenCalledWith('intex-agent-evals-preflight');
    expect(dependencies.initializeApp).not.toHaveBeenCalled();
  });

  it('constructs the WhatsApp client with fixed settings and a no-op logger', async () => {
    let capturedConfig: Parameters<WhatsAppClientFactory>[0] | undefined;
    const getPrivateMatrixDeliveryStatus = vi.fn(async () => ({
      ok: true as const,
      value: { status: 'ready' as const, deliverable: true as const },
    }));
    const clientFactory: WhatsAppClientFactory = vi.fn((config) => {
      capturedConfig = config;
      return { getPrivateMatrixDeliveryStatus };
    });
    const port = createWhatsAppReadinessPort({
      internalAuthToken: 'synthetic-internal-token',
      clientFactory,
    });

    await expect(port.getDeliveryStatus(VALID_CONFIG.userId)).resolves.toEqual({
      ok: true,
      value: { status: 'ready', deliverable: true },
    });
    expect(capturedConfig).toMatchObject({
      baseUrl: WHATSAPP_SERVICE_BASE_URL,
      internalAuthToken: 'synthetic-internal-token',
      defaultTimeoutMs: 10_000,
    });
    capturedConfig?.logger.info({ private: 'sentinel' }, 'ignored');
    capturedConfig?.logger.warn({ private: 'sentinel' }, 'ignored');
    capturedConfig?.logger.error({ private: 'sentinel' }, 'ignored');
    capturedConfig?.logger.debug({ private: 'sentinel' }, 'ignored');
    expect(getPrivateMatrixDeliveryStatus).toHaveBeenCalledWith(VALID_CONFIG.userId);
  });

  it('maps WhatsApp client Result errors and throws to a closed unavailable result', async () => {
    const resultFactory: WhatsAppClientFactory = () => ({
      getPrivateMatrixDeliveryStatus: vi.fn(async () => ({
        ok: false as const,
        error: new Error('HTTP 401 private sentinel'),
      })),
    });
    const resultPort = createWhatsAppReadinessPort({
      internalAuthToken: 'synthetic-internal-token',
      clientFactory: resultFactory,
    });
    const failedResult = await resultPort.getDeliveryStatus(VALID_CONFIG.userId);
    expect(failedResult).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(failedResult)).not.toContain('private sentinel');

    const throwFactory: WhatsAppClientFactory = () => ({
      getPrivateMatrixDeliveryStatus: vi.fn(async () => {
        throw new Error('private throw sentinel');
      }),
    });
    const throwPort = createWhatsAppReadinessPort({
      internalAuthToken: 'synthetic-internal-token',
      clientFactory: throwFactory,
    });
    await expect(throwPort.getDeliveryStatus(VALID_CONFIG.userId)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reuses the real typed WhatsApp client with encoded user ID and fake fetch only', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ success: true, data: { status: 'ready', deliverable: true } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetchImpl);
    const port = createWhatsAppReadinessPort({
      internalAuthToken: 'synthetic-internal-token',
    });
    const syntheticUserId = 'auth0|synthetic/user with spaces';

    await expect(port.getDeliveryStatus(syntheticUserId)).resolves.toEqual({
      ok: true,
      value: { status: 'ready', deliverable: true },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `${WHATSAPP_SERVICE_BASE_URL}/internal/whatsapp/private/matrix-delivery-status/${encodeURIComponent(syntheticUserId)}`
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-internal-auth': 'synthetic-internal-token',
    });
  });

  it('counts the validated catalog and closes loader failures', async () => {
    const loader = vi.fn(async () => [{}, {}, {}]);
    const port: ScenarioCatalogPort = createScenarioCatalogPort({
      directoryPath: '/synthetic/scenarios',
      loadCatalog: loader,
    });

    await expect(port.count()).resolves.toEqual({ ok: true, count: 3 });
    expect(loader).toHaveBeenCalledWith('/synthetic/scenarios');

    const failedPort = createScenarioCatalogPort({
      directoryPath: '/synthetic/scenarios',
      loadCatalog: vi.fn(async () => {
        throw new Error('private catalog sentinel');
      }),
    });
    const failed = await failedPort.count();
    expect(failed).toEqual({ ok: false });
    expect(JSON.stringify(failed)).not.toContain('private catalog sentinel');
  });

  it('constructs fixed production ports without calling live dependencies', () => {
    const matrix = {
      whoAmI: vi.fn(async () => ({ ok: true as const, userId: VALID_CONFIG.matrixUserId })),
    };
    const miniMaxProbe: MiniMaxProbePort = {
      probe: vi.fn(async () => ({ ok: true as const })),
    };

    const setupPorts = createProductionSetupPorts({ matrix });
    const preflightPorts = createProductionPreflightPorts({ matrix, miniMaxProbe });

    expect(setupPorts.configPath).toBe(
      join(homedir(), '.config', 'intexuraos', 'intex-agent-evals.json')
    );
    expect(preflightPorts.configPath).toBe(setupPorts.configPath);
    expect(setupPorts.matrix).toBe(matrix);
    expect(preflightPorts.matrix).toBe(matrix);
    expect(preflightPorts.miniMaxProbe).toBe(miniMaxProbe);
    expect(matrix.whoAmI).not.toHaveBeenCalled();
    expect(miniMaxProbe.probe).not.toHaveBeenCalled();
  });
});
