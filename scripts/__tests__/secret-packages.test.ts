import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crc32c,
  crc32cBase64,
  createGcloudSecretManagerAdapter,
  dualCompareSecretPackages,
  fetchSecretPackage,
  loadSecretPackageManifest,
  publishSecretPackage,
  reconcileSecretPackagePublish,
  renderSecretPackage,
  resumeSecretPackagePublish,
  unlockSecretPackagePublish,
  validateSecretPackageManifest,
  validateSecretPackagePayload,
} from '../lib/secret-package.mjs';
import { runSecretPackageCli } from '../secret-package.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const manifestPath = resolve(repoRoot, 'config', 'environments', 'secret-packages.json');
const cliPath = resolve(repoRoot, 'scripts', 'secret-package.mjs');
const temporaryDirectories: string[] = [];
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fakePrivateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const EXPECTED_NATIVE_SECRET_NAMES = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
] as const;

const EXPECTED_DEV_FILES = ['githubAppPrivateKeyPemBase64'] as const;

const EXPECTED_PROD_FILES = [
  'cloudflareDnsApiTokenBase64',
  'runtimeGcpServiceAccountJsonBase64',
  'tlsPrivateKeyPemBase64',
] as const;

interface TestSecretPackagePayload {
  schemaVersion: number;
  environment: 'dev' | 'prod';
  env: Record<string, string>;
  files: Record<string, string>;
}

function makePublishReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    operation: 'secret-package-publish',
    operationId: '11111111-1111-4111-8111-111111111111',
    state: 'pending-verification',
    startedAt: '2026-08-13T17:00:00.000Z',
    prePublishMaxVersion: '42',
    environment: 'dev',
    projectId: 'test-project',
    secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
    version: '43',
    ...overrides,
  };
}

function versionMetadata(
  version: string,
  createTime = '2026-08-13T17:00:01.000Z'
): { createTime: string; state: string; version: string } {
  return { createTime, state: 'ENABLED', version };
}

function publishLockPath(receiptPath: string, environment = 'dev'): string {
  const secretId =
    environment === 'dev' ? 'INTEXURAOS_SECRET_PACKAGE_DEV' : 'INTEXURAOS_SECRET_PACKAGE_PROD';
  return join(dirname(receiptPath), `.test-project.${secretId}.publish.lock`);
}

function makePublishLock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    operation: 'secret-package-publish-lock',
    environment: 'dev',
    projectId: 'test-project',
    secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
    hostname: 'test-host',
    pid: 2147483647,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('secret package manifest', () => {
  it('declares exactly the dev/prod packages and native Secret Manager exceptions', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });

    expect(Object.keys(manifest).sort()).toEqual([
      'nativeSecretNames',
      'packages',
      'schemaVersion',
    ]);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.nativeSecretNames).toEqual([...EXPECTED_NATIVE_SECRET_NAMES]);
    expect(Object.keys(manifest.packages).sort()).toEqual(['dev', 'prod']);
    expect(manifest.packages.dev.secretId).toBe('INTEXURAOS_SECRET_PACKAGE_DEV');
    expect(manifest.packages.prod.secretId).toBe('INTEXURAOS_SECRET_PACKAGE_PROD');
    expect(manifest.packages.dev.files).toEqual([...EXPECTED_DEV_FILES]);
    expect(manifest.packages.prod.files).toEqual([...EXPECTED_PROD_FILES]);

    for (const environment of ['dev', 'prod'] as const) {
      const definition = manifest.packages[environment];
      expect(Object.keys(definition).sort()).toEqual([
        'envNames',
        'files',
        'secretId',
        'stableVersion',
      ]);
      expect(definition.stableVersion).toBe(environment === 'dev' ? 3 : 4);
      expect(definition.envNames).toEqual([...definition.envNames].sort());
      expect(new Set(definition.envNames).size).toBe(definition.envNames.length);
      expect(definition.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
      expect(
        definition.envNames.filter((name) => EXPECTED_NATIVE_SECRET_NAMES.includes(name as never))
      ).toEqual(
        environment === 'dev'
          ? [...EXPECTED_NATIVE_SECRET_NAMES]
          : ['INTEXURAOS_INTERNAL_AUTH_TOKEN']
      );
      expect(Object.hasOwn(definition, 'env')).toBe(false);
      expect(Object.hasOwn(definition, 'values')).toBe(false);
    }
  });

  it.each([
    [
      'unknown top-level key',
      (manifest: Record<string, unknown>): void => {
        manifest.extra = true;
      },
    ],
    [
      'unsupported schema',
      (manifest: Record<string, unknown>): void => {
        manifest.schemaVersion = 2;
      },
    ],
    [
      'missing environment',
      (manifest: Record<string, unknown>): void => {
        delete (manifest.packages as Record<string, unknown>).prod;
      },
    ],
    [
      'latest version',
      (manifest: Record<string, unknown>): void => {
        (
          (manifest.packages as Record<string, unknown>).dev as Record<string, unknown>
        ).stableVersion = 'latest';
      },
    ],
    [
      'zero version',
      (manifest: Record<string, unknown>): void => {
        (
          (manifest.packages as Record<string, unknown>).dev as Record<string, unknown>
        ).stableVersion = 0;
      },
    ],
    [
      'duplicate env name',
      (manifest: Record<string, unknown>): void => {
        const dev = (manifest.packages as Record<string, unknown>).dev as Record<string, unknown>;
        dev.envNames = [...(dev.envNames as string[]), (dev.envNames as string[])[0]];
      },
    ],
    [
      'wrong package id',
      (manifest: Record<string, unknown>): void => {
        ((manifest.packages as Record<string, unknown>).prod as Record<string, unknown>).secretId =
          'INTEXURAOS_SECRET_PACKAGE_DEV';
      },
    ],
    [
      'missing Firebase key',
      (manifest: Record<string, unknown>): void => {
        const prod = (manifest.packages as Record<string, unknown>).prod as Record<string, unknown>;
        prod.envNames = (prod.envNames as string[]).filter(
          (name) => name !== 'INTEXURAOS_FIREBASE_API_KEY'
        );
      },
    ],
  ])('rejects a manifest with %s', (_label, mutate) => {
    const manifest = readManifestObject();
    mutate(manifest);

    expect(() => validateSecretPackageManifest(manifest)).toThrow(/Secret package manifest/u);
  });
});

describe('secret package payload validation', () => {
  it.each(['dev', 'prod'] as const)(
    'accepts the exact %s env/files set and returns only safe metadata',
    (environment) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const payload = makePayload(environment, manifest);
      const result = validateSecretPackagePayload({ environment, payload, manifest });

      expect(result.environment).toBe(environment);
      expect(result.byteLength).toBeGreaterThan(0);
      expect(result.byteLength).toBeLessThanOrEqual(65_536);
      expect(result.crc32c).toMatch(/^[A-Za-z0-9+/]{6}==$/u);
      expect(result.serviceAccount).toEqual(
        environment === 'prod'
          ? {
              clientEmail: `runtime-${environment}@intexuraos-dev-pbuchman.iam.gserviceaccount.com`,
              privateKeyId: '0123456789abcdef0123456789abcdef01234567',
              projectId: 'intexuraos-dev-pbuchman',
            }
          : undefined
      );
      expect(JSON.stringify(result)).not.toContain('fake-secret-for');
      expect(JSON.stringify(result)).not.toContain('BEGIN PRIVATE KEY');
    }
  );

  it.each([
    [
      'unsupported schema',
      (payload: Record<string, unknown>): void => {
        payload.schemaVersion = 2;
      },
    ],
    [
      'wrong environment',
      (payload: Record<string, unknown>): void => {
        payload.environment = 'prod';
      },
    ],
    [
      'unknown top-level key',
      (payload: Record<string, unknown>): void => {
        payload.extra = true;
      },
    ],
    [
      'missing env name',
      (payload: Record<string, unknown>): void => {
        delete (payload.env as Record<string, unknown>).INTEXURAOS_FIREBASE_API_KEY;
      },
    ],
    [
      'unknown env name',
      (payload: Record<string, unknown>): void => {
        (payload.env as Record<string, unknown>).INTEXURAOS_UNKNOWN_SECRET = 'do-not-print-this';
      },
    ],
    [
      'empty env value',
      (payload: Record<string, unknown>): void => {
        (payload.env as Record<string, unknown>).INTEXURAOS_FIREBASE_API_KEY = '';
      },
    ],
    [
      'missing file',
      (payload: Record<string, unknown>): void => {
        delete (payload.files as Record<string, unknown>).githubAppPrivateKeyPemBase64;
      },
    ],
    [
      'unknown file',
      (payload: Record<string, unknown>): void => {
        (payload.files as Record<string, unknown>).unknownFileBase64 =
          Buffer.from('do-not-print-this').toString('base64');
      },
    ],
    [
      'invalid base64',
      (payload: Record<string, unknown>): void => {
        (payload.files as Record<string, unknown>).githubAppPrivateKeyPemBase64 = '***';
      },
    ],
    [
      'invalid GitHub PEM',
      (payload: Record<string, unknown>): void => {
        (payload.files as Record<string, unknown>).githubAppPrivateKeyPemBase64 =
          Buffer.from('do-not-print-this').toString('base64');
      },
    ],
  ])('rejects %s without exposing values', (_label, mutate) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest) as Record<string, unknown>;
    if (_label === 'wrong environment') payload.environment = 'dev';
    mutate(payload);

    expect(() =>
      validateSecretPackagePayload({ environment: 'dev', payload, manifest })
    ).toThrowError(expect.not.stringContaining('do-not-print-this'));
  });

  it.each([
    ['wrong service-account type', { type: 'authorized_user' }],
    ['wrong service-account project', { project_id: 'do-not-print-this' }],
    ['invalid service-account email', { client_email: 'do-not-print-this' }],
    ['invalid service-account private key id', { private_key_id: 'do-not-print-this' }],
    ['invalid service-account private key', { private_key: 'do-not-print-this' }],
  ])('rejects %s without exposing values', (_label, replacement) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('prod', manifest) as Record<string, unknown>;
    replaceServiceAccount(payload, replacement);

    expect(() =>
      validateSecretPackagePayload({ environment: 'prod', payload, manifest })
    ).toThrowError(expect.not.stringContaining('do-not-print-this'));
  });

  it('rejects a serialized payload larger than the Secret Manager 64 KiB limit', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    payload.env.INTEXURAOS_FIREBASE_API_KEY = 'x'.repeat(65_536);

    expect(() => validateSecretPackagePayload({ environment: 'dev', payload, manifest })).toThrow(
      /64 KiB/u
    );
  });
});

describe('CRC32C integrity', () => {
  it('matches the canonical Castagnoli check vector and GCP base64 encoding', () => {
    const value = Buffer.from('123456789', 'utf8');

    expect(crc32c(value)).toBe(0xe3069283);
    expect(crc32cBase64(value)).toBe('4waSgw==');
  });
});

describe('Secret Manager adapter boundary', () => {
  it('lists target version metadata without accessing payloads', async () => {
    const execFile = vi.fn(() =>
      JSON.stringify([
        {
          name: 'projects/test-project/secrets/INTEXURAOS_SECRET_PACKAGE_DEV/versions/7',
          createTime: '2026-08-13T17:00:00.123456Z',
          state: 'ENABLED',
        },
      ])
    );
    const adapter = createGcloudSecretManagerAdapter({ execFile });

    await expect(
      adapter.listVersions({
        projectId: 'test-project',
        secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
      })
    ).resolves.toEqual([
      {
        createTime: '2026-08-13T17:00:00.123456Z',
        state: 'ENABLED',
        version: '7',
      },
    ]);
    expect(execFile).toHaveBeenCalledWith(
      'gcloud',
      [
        'secrets',
        'versions',
        'list',
        'INTEXURAOS_SECRET_PACKAGE_DEV',
        '--project',
        'test-project',
        '--format=json(name,createTime,state)',
      ],
      expect.objectContaining({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    );
  });

  it('preserves a server CRC32C above the signed 32-bit boundary', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    let data = Buffer.alloc(0);
    for (let nonce = 0; nonce < 100; nonce += 1) {
      payload.env.INTEXURAOS_OPENROUTER_APP_API_KEY = `fake-secret-boundary-${nonce}`;
      data = Buffer.from(JSON.stringify(payload), 'utf8');
      if (crc32c(data) > 0x7fffffff) break;
    }
    const responseCrc32c = String(crc32c(data));
    expect(crc32c(data)).toBeGreaterThan(0x7fffffff);
    const execFile = vi.fn(() =>
      JSON.stringify({
        name: 'projects/test-project/secrets/INTEXURAOS_SECRET_PACKAGE_DEV/versions/7',
        payload: { data: data.toString('base64url'), dataCrc32c: responseCrc32c },
      })
    );
    const adapter = createGcloudSecretManagerAdapter({ execFile });

    const result = await fetchSecretPackage({
      adapter,
      environment: 'dev',
      manifest,
      projectId: 'test-project',
      version: '7',
    });

    expect(result.payload).toEqual(payload);
    expect(result.crc32c).toBe(crc32cBase64(data));
    expect(execFile).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining(['7', '--secret', 'INTEXURAOS_SECRET_PACKAGE_DEV', '--format=json']),
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('fetches only an exact numeric version and validates CRC32C before parsing', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const accessVersion = vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) }));

    const result = await fetchSecretPackage({
      adapter: { accessVersion },
      environment: 'dev',
      manifest,
      projectId: 'test-project',
      version: '7',
    });

    expect(accessVersion).toHaveBeenCalledWith({
      projectId: 'test-project',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
      version: '7',
    });
    expect(result.payload).toEqual(payload);
    expect(result.version).toBe('7');
    expect(result.crc32c).toBe(crc32cBase64(data));
  });

  it('rejects latest and checksum mismatch without returning payload material', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const accessVersion = vi.fn(async () => ({ data, dataCrc32c: 'AAAAAA==' }));

    await expect(
      fetchSecretPackage({
        adapter: { accessVersion },
        environment: 'dev',
        manifest,
        projectId: 'test-project',
        version: 'latest',
      })
    ).rejects.toThrow(/numeric/u);
    expect(accessVersion).not.toHaveBeenCalled();

    await expect(
      fetchSecretPackage({
        adapter: { accessVersion },
        environment: 'dev',
        manifest,
        projectId: 'test-project',
        version: 7,
      })
    ).rejects.toThrow(/CRC32C/u);
  });

  it('publishes validated bytes and verifies the exact new version without logging payloads', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('prod', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const expectedData = Buffer.from(JSON.stringify(payload), 'utf8');
    const addVersion = vi.fn(async () => ({ version: '41' }));
    const listVersions = vi.fn(async () => [versionMetadata('40', '2026-08-13T16:59:59.000Z')]);
    const accessVersion = vi.fn(async () => ({
      data: expectedData,
      dataCrc32c: BigInt(crc32c(expectedData)),
    }));
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await publishSecretPackage({
      adapter: { accessVersion, addVersion, listVersions },
      environment: 'prod',
      manifest,
      payload,
      projectId: 'test-project',
      receiptPath,
    });

    expect(addVersion).toHaveBeenCalledOnce();
    expect(addVersion.mock.calls[0]?.[0]).toMatchObject({
      dataCrc32c: result.crc32c,
      projectId: 'test-project',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_PROD',
    });
    expect(accessVersion).toHaveBeenCalledWith({
      projectId: 'test-project',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_PROD',
      version: '41',
    });
    expect(result.version).toBe('41');
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toEqual({
      schemaVersion: 2,
      operation: 'secret-package-publish',
      operationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      ),
      state: 'verified',
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
      prePublishMaxVersion: '40',
      environment: 'prod',
      projectId: 'test-project',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_PROD',
      version: '41',
    });
    expect(fileMode(receiptPath)).toBe('600');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('fake-secret-for');
  });

  it('durably reserves the receipt before addVersion and blocks a concurrent publisher', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const enteredAdd = deferred<boolean>();
    const releaseAdd = deferred<{ version: string }>();
    const addVersion = vi.fn(async () => {
      expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
        state: 'publishing',
        version: null,
      });
      enteredAdd.resolve(true);
      return releaseAdd.promise;
    });
    const first = publishSecretPackage({
      adapter: {
        addVersion,
        accessVersion: vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) })),
        listVersions: vi.fn(async () => [versionMetadata('44')]),
      },
      environment: 'dev',
      manifest,
      payload,
      projectId: 'test-project',
      receiptPath,
    });
    await enteredAdd.promise;

    await expect(
      publishSecretPackage({
        adapter: { addVersion, accessVersion: vi.fn(), listVersions: vi.fn() },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/lock|already exists/u);
    expect(addVersion).toHaveBeenCalledOnce();

    releaseAdd.resolve({ version: '45' });
    await expect(first).resolves.toMatchObject({ version: '45' });
  });

  it('uses one package-scoped lock for different receipt paths in the same private journal', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const root = makeTempDirectory();
    const firstReceiptPath = join(root, 'first-receipt.json');
    const secondReceiptPath = join(root, 'second-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const enteredAdd = deferred<boolean>();
    const releaseAdd = deferred<{ version: string }>();
    const firstAddVersion = vi.fn(async () => {
      enteredAdd.resolve(true);
      return releaseAdd.promise;
    });
    const secondAddVersion = vi.fn(async () => ({ version: '46' }));
    const first = publishSecretPackage({
      adapter: {
        addVersion: firstAddVersion,
        accessVersion: vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) })),
        listVersions: vi.fn(async () => [versionMetadata('44')]),
      },
      environment: 'dev',
      manifest,
      payload,
      projectId: 'test-project',
      receiptPath: firstReceiptPath,
    });
    await enteredAdd.promise;

    await expect(
      publishSecretPackage({
        adapter: {
          addVersion: secondAddVersion,
          accessVersion: vi.fn(),
          listVersions: vi.fn(),
        },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath: secondReceiptPath,
      })
    ).rejects.toThrow(/lock/u);
    expect(secondAddVersion).not.toHaveBeenCalled();

    releaseAdd.resolve({ version: '45' });
    await expect(first).resolves.toMatchObject({ version: '45' });
  });

  it('keeps an ambiguous pre-response receipt and reconciles only the sole post-watermark version', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T17:00:00.000Z'));
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('prod', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const addVersion = vi.fn(async () => {
      throw new Error('response lost after commit');
    });
    const accessVersion = vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) }));
    const listVersions = vi
      .fn()
      .mockResolvedValueOnce([versionMetadata('45', '2026-08-13T16:59:59.000Z')])
      .mockResolvedValueOnce([
        versionMetadata('46', '2026-08-13T17:00:01.000Z'),
        versionMetadata('45', '2026-08-13T16:59:59.000Z'),
      ]);

    await expect(
      publishSecretPackage({
        adapter: { accessVersion, addVersion, listVersions },
        environment: 'prod',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/publish failed/u);
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
      state: 'publishing',
      version: null,
      prePublishMaxVersion: '45',
    });

    await expect(
      resumeSecretPackagePublish({
        adapter: { accessVersion },
        environment: 'prod',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/publish-reconcile/u);
    expect(accessVersion).not.toHaveBeenCalled();

    await expect(
      reconcileSecretPackagePublish({
        adapter: { accessVersion, listVersions },
        environment: 'prod',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
        version: '46',
      })
    ).resolves.toMatchObject({ version: '46' });
    expect(addVersion).toHaveBeenCalledOnce();
    expect(accessVersion).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
      state: 'verified',
      version: '46',
    });
  });

  it('rejects an old byte-identical recovery version and multiple post-watermark versions', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        makePublishReceipt({
          state: 'publishing',
          version: null,
          prePublishMaxVersion: '45',
        })
      )}\n`,
      { mode: 0o600 }
    );
    const accessVersion = vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) }));
    const listVersions = vi.fn(async () => [
      versionMetadata('47'),
      versionMetadata('46'),
      versionMetadata('45', '2026-08-13T16:59:59.000Z'),
    ]);

    await expect(
      reconcileSecretPackagePublish({
        adapter: { accessVersion, listVersions },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
        version: '45',
      })
    ).rejects.toThrow(/post-watermark|recovery version/u);
    await expect(
      reconcileSecretPackagePublish({
        adapter: { accessVersion, listVersions },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
        version: '47',
      })
    ).rejects.toThrow(/ambiguous/u);
    expect(accessVersion).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
      state: 'publishing',
      version: null,
    });
  });

  it('keeps the receipt blocked when metadata proves no post-watermark version', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        makePublishReceipt({ state: 'publishing', version: null, prePublishMaxVersion: '45' })
      )}\n`,
      { mode: 0o600 }
    );
    const accessVersion = vi.fn();

    await expect(
      reconcileSecretPackagePublish({
        adapter: {
          accessVersion,
          listVersions: vi.fn(async () => [versionMetadata('45', '2026-08-13T16:59:59.000Z')]),
        },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
        version: '46',
      })
    ).rejects.toThrow(/ambiguous/u);
    expect(accessVersion).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
      state: 'publishing',
      version: null,
    });
  });

  it.each([
    ['after-publish-lock-link', 'unreserved'],
    ['after-publish-receipt-link', 'publishing'],
  ])('leaves only a complete crash-recoverable journal at %s', async (failpoint, state) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const addVersion = vi.fn();

    await expect(
      publishSecretPackage({
        adapter: {
          accessVersion: vi.fn(),
          addVersion,
          listVersions: vi.fn(async () => [versionMetadata('44')]),
        },
        environment: 'dev',
        failpoint: (name: string) => {
          if (name === failpoint) throw new Error(`crash:${name}`);
        },
        manifest,
        payload: makePayload('dev', manifest),
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/lock is unavailable|reservation failed/u);
    expect(addVersion).not.toHaveBeenCalled();

    if (state === 'publishing') {
      expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
        schemaVersion: 2,
        state: 'publishing',
        version: null,
      });
    } else {
      expect(JSON.parse(readFileSync(publishLockPath(receiptPath), 'utf8'))).toMatchObject({
        schemaVersion: 1,
        operation: 'secret-package-publish-lock',
        environment: 'dev',
        projectId: 'test-project',
        secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
        pid: process.pid,
      });
    }
  });

  it.each([
    ['after-add-version-response', 'publishing', null],
    ['after-pending-receipt', 'pending-verification', '45'],
  ])('retains a recoverable receipt at %s', async (failpoint, state, version) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const addVersion = vi.fn(async () => ({ version: '45' }));

    await expect(
      publishSecretPackage({
        adapter: {
          accessVersion: vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) })),
          addVersion,
          listVersions: vi.fn(async () => [versionMetadata('44')]),
        },
        environment: 'dev',
        failpoint: (name: string) => {
          if (name === failpoint) throw new Error(`crash:${name}`);
        },
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/crash:/u);
    expect(addVersion).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({ state, version });
    expect(() => lstatSync(publishLockPath(receiptPath))).toThrow();
  });

  it('removes only a same-host dead-process publish lock before crash recovery', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const receiptPath = join(root, 'publish-receipt.json');
    writeFileSync(
      receiptPath,
      `${JSON.stringify(makePublishReceipt({ state: 'publishing', version: null }))}\n`,
      { mode: 0o600 }
    );
    writeFileSync(publishLockPath(receiptPath), `${JSON.stringify(makePublishLock())}\n`, {
      mode: 0o600,
    });

    expect(
      unlockSecretPackagePublish({
        environment: 'dev',
        hostname: 'test-host',
        manifest,
        projectId: 'test-project',
        receiptPath,
      })
    ).toMatchObject({ state: 'publishing', unlocked: true });
    expect(() => lstatSync(publishLockPath(receiptPath))).toThrow();
  });

  it('reports an unreserved crashed lock as safe for a fresh publication', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    writeFileSync(publishLockPath(receiptPath), `${JSON.stringify(makePublishLock())}\n`, {
      mode: 0o600,
    });

    expect(
      unlockSecretPackagePublish({
        environment: 'dev',
        hostname: 'test-host',
        manifest,
        projectId: 'test-project',
        receiptPath,
      })
    ).toMatchObject({ state: 'unreserved', unlocked: true });
  });

  it.each([
    ['a live owner', 'test-host', process.pid, /still running/u],
    ['a different host', 'different-host', 2147483647, /different host/u],
  ])('refuses to unlock a publish journal owned by %s', (_name, lockHostname, pid, error) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    writeFileSync(
      publishLockPath(receiptPath),
      `${JSON.stringify(makePublishLock({ hostname: lockHostname, pid }))}\n`,
      { mode: 0o600 }
    );

    expect(() =>
      unlockSecretPackagePublish({
        environment: 'dev',
        hostname: 'test-host',
        manifest,
        projectId: 'test-project',
        receiptPath,
      })
    ).toThrow(error);
    expect(lstatSync(publishLockPath(receiptPath)).isFile()).toBe(true);
  });

  it.each([
    {
      name: 'server CRC32C does not match the fetched bytes',
      observe: (data: Buffer): { data: Buffer; dataCrc32c: bigint } => ({
        data,
        dataCrc32c: 0n,
      }),
      error: /CRC32C/u,
    },
    {
      name: 'fetched bytes differ even though their server CRC32C is valid',
      observe: (data: Buffer): { data: Buffer; dataCrc32c: bigint } => {
        const changed = Buffer.from(data);
        changed[changed.length - 2] ^= 1;
        return { data: changed, dataCrc32c: BigInt(crc32c(changed)) };
      },
      error: /bytes/u,
    },
  ])('rejects a published version when $name', async ({ observe, error }) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const expectedData = Buffer.from(JSON.stringify(payload), 'utf8');
    const addVersion = vi.fn(async () => ({
      version: '42',
      dataCrc32c: crc32cBase64(expectedData),
    }));
    const accessVersion = vi.fn(async () => observe(expectedData));
    const listVersions = vi.fn(async () => [versionMetadata('41')]);

    await expect(
      publishSecretPackage({
        adapter: { accessVersion, addVersion, listVersions },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(error);
    expect(accessVersion).toHaveBeenCalledWith({
      projectId: 'test-project',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
      version: '42',
    });
  });

  it('persists the numeric version before readback failure and resumes without adding a version', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    const expectedData = Buffer.from(JSON.stringify(payload), 'utf8');
    const receiptPath = join(makeTempDirectory(), 'publish-receipt.json');
    const addVersion = vi.fn(async () => ({ version: '43' }));
    const listVersions = vi.fn(async () => [versionMetadata('42')]);
    const accessVersion = vi
      .fn()
      .mockImplementationOnce(async () => {
        expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toEqual({
          schemaVersion: 2,
          operation: 'secret-package-publish',
          operationId: expect.any(String),
          state: 'pending-verification',
          startedAt: expect.any(String),
          prePublishMaxVersion: '42',
          environment: 'dev',
          projectId: 'test-project',
          secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
          version: '43',
        });
        throw new Error('transient readback failure');
      })
      .mockResolvedValueOnce({
        data: expectedData,
        dataCrc32c: crc32cBase64(expectedData),
      })
      .mockResolvedValueOnce({
        data: expectedData,
        dataCrc32c: crc32cBase64(expectedData),
      });

    await expect(
      publishSecretPackage({
        adapter: { accessVersion, addVersion, listVersions },
        environment: 'dev',
        manifest,
        payload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/verification failed/u);

    const pendingReceipt = readFileSync(receiptPath, 'utf8');
    expect(fileMode(receiptPath)).toBe('600');
    expect(pendingReceipt).not.toContain('fake-secret-for');
    expect(pendingReceipt).not.toMatch(/crc|digest|payload/iu);

    const differentPayload = makePayload('dev', manifest);
    differentPayload.env.INTEXURAOS_FIREBASE_API_KEY = `AIza${'z'.repeat(35)}`;
    await expect(
      resumeSecretPackagePublish({
        adapter: { accessVersion },
        environment: 'dev',
        manifest,
        payload: differentPayload,
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/bytes/u);
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
      state: 'pending-verification',
      version: '43',
    });

    const result = await resumeSecretPackagePublish({
      adapter: { accessVersion },
      environment: 'dev',
      manifest,
      payload,
      projectId: 'test-project',
      receiptPath,
    });

    expect(result).toMatchObject({
      environment: 'dev',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
      version: '43',
    });
    expect(addVersion).toHaveBeenCalledOnce();
    expect(accessVersion).toHaveBeenCalledTimes(3);
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toMatchObject({
      state: 'verified',
      version: '43',
    });
  });

  it('requires a new private receipt destination before adding a version', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const addVersion = vi.fn(async () => ({ version: '44' }));
    const accessVersion = vi.fn();

    await expect(
      publishSecretPackage({
        adapter: { accessVersion, addVersion, listVersions: vi.fn() },
        environment: 'dev',
        manifest,
        payload: makePayload('dev', manifest),
        projectId: 'test-project',
      })
    ).rejects.toThrow(/receipt path/u);
    expect(addVersion).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'an existing regular file', mode: 0o600, symlink: false, error: /already exists/u },
    { name: 'a symbolic link', mode: 0o600, symlink: true, error: /regular non-symlink/u },
    { name: 'group-readable permissions', mode: 0o640, symlink: false, error: /permissions/u },
  ])(
    'rejects a publish receipt destination containing $name before adding a version',
    async ({ mode, symlink, error }) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const root = makeTempDirectory();
      const targetPath = join(root, 'receipt-target.json');
      const receiptPath = join(root, 'publish-receipt.json');
      writeFileSync(targetPath, '{}\n', { mode: 0o600 });
      if (symlink) {
        symlinkSync(targetPath, receiptPath);
      } else {
        writeFileSync(receiptPath, '{}\n', { mode: 0o600 });
        chmodSync(receiptPath, mode);
      }
      const addVersion = vi.fn(async () => ({ version: '44' }));

      await expect(
        publishSecretPackage({
          adapter: { accessVersion: vi.fn(), addVersion, listVersions: vi.fn() },
          environment: 'dev',
          manifest,
          payload: makePayload('dev', manifest),
          projectId: 'test-project',
          receiptPath,
        })
      ).rejects.toThrow(error);
      expect(addVersion).not.toHaveBeenCalled();
    }
  );

  it('rejects a non-private publish receipt parent before adding a version', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    chmodSync(root, 0o750);
    const addVersion = vi.fn(async () => ({ version: '44' }));

    await expect(
      publishSecretPackage({
        adapter: { accessVersion: vi.fn(), addVersion, listVersions: vi.fn() },
        environment: 'dev',
        manifest,
        payload: makePayload('dev', manifest),
        projectId: 'test-project',
        receiptPath: join(root, 'publish-receipt.json'),
      })
    ).rejects.toThrow(/parent directory must be private/u);
    expect(addVersion).not.toHaveBeenCalled();
  });

  it('rejects a non-private resume receipt parent before version access', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const receiptPath = join(root, 'publish-receipt.json');
    writeFileSync(receiptPath, `${JSON.stringify(makePublishReceipt())}\n`, { mode: 0o600 });
    chmodSync(root, 0o750);
    const accessVersion = vi.fn();

    await expect(
      resumeSecretPackagePublish({
        adapter: { accessVersion },
        environment: 'dev',
        manifest,
        payload: makePayload('dev', manifest),
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/parent directory must be private/u);
    expect(accessVersion).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a symbolic link', mode: 0o600, symlink: true, error: /regular non-symlink/u },
    { name: 'group-readable permissions', mode: 0o640, symlink: false, error: /permissions/u },
  ])('rejects a resume receipt that has $name', async ({ mode, symlink, error }) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const targetPath = join(root, 'receipt-target.json');
    const receiptPath = join(root, 'publish-receipt.json');
    writeFileSync(targetPath, `${JSON.stringify(makePublishReceipt())}\n`, { mode: 0o600 });
    if (symlink) {
      symlinkSync(targetPath, receiptPath);
    } else {
      writeFileSync(receiptPath, readFileSync(targetPath), { mode: 0o600 });
      chmodSync(receiptPath, mode);
    }
    const accessVersion = vi.fn();

    await expect(
      resumeSecretPackagePublish({
        adapter: { accessVersion },
        environment: 'dev',
        manifest,
        payload: makePayload('dev', manifest),
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(error);
    expect(accessVersion).not.toHaveBeenCalled();
  });

  it('rejects receipt metadata for a different project before version access', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const receiptPath = join(root, 'publish-receipt.json');
    writeFileSync(
      receiptPath,
      `${JSON.stringify(makePublishReceipt({ projectId: 'other-project' }))}\n`,
      { mode: 0o600 }
    );
    const accessVersion = vi.fn();

    await expect(
      resumeSecretPackagePublish({
        adapter: { accessVersion },
        environment: 'dev',
        manifest,
        payload: makePayload('dev', manifest),
        projectId: 'test-project',
        receiptPath,
      })
    ).rejects.toThrow(/does not match/u);
    expect(accessVersion).not.toHaveBeenCalled();
  });
});

describe('atomic rendering', () => {
  it('binds the DEV writer lock to the running executable instead of a caller argv entrypoint', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const outputDir = makeTempDirectory();
    const originalArgv = process.argv;

    try {
      process.argv = [process.execPath, '/tmp/not-the-running-process-entrypoint.mjs'];
      renderSecretPackage({
        environment: 'dev',
        manifest,
        outputDir,
        payload: makePayload('dev', manifest),
        version: 7,
      });
    } finally {
      process.argv = originalArgv;
    }

    expect(lstatSync(join(outputDir, 'current')).isSymbolicLink()).toBe(true);
  });

  it.each(['dev', 'prod'] as const)(
    'renders %s into an immutable release and atomically switches current',
    (environment) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const outputDir = makeTempDirectory();
      const firstPayload = makePayload(environment, manifest);
      firstPayload.env.INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY = `{"kid":"matrix-key","private":"line\\nwith 'single' and \\"double\\" quotes"}`;
      const first = renderSecretPackage({
        environment,
        manifest,
        outputDir,
        payload: firstPayload,
        version: 7,
      });
      const firstCurrent = resolveCurrent(outputDir);
      const expectedFiles =
        environment === 'dev'
          ? ['environment.env', 'github-app-private-key.pem']
          : [
              'cloudflare-dns-api-token',
              'environment.env',
              'runtime-gcp-service-account.json',
              'tls-private-key.pem',
            ];

      expect(lstatSync(join(outputDir, 'current')).isSymbolicLink()).toBe(true);
      expect(basename(firstCurrent)).toBe(first.releaseName);
      expect(readdirSync(firstCurrent).sort()).toEqual([...expectedFiles, 'metadata.json'].sort());
      expect(parseDotenv(readFileSync(join(firstCurrent, 'environment.env'), 'utf8'))).toEqual(
        firstPayload.env
      );
      expect(fileMode(join(firstCurrent, 'environment.env'))).toBe('600');
      if (environment === 'prod') {
        expect(fileMode(join(firstCurrent, 'runtime-gcp-service-account.json'))).toBe('600');
      }
      expect(JSON.parse(readFileSync(join(firstCurrent, 'metadata.json'), 'utf8'))).toEqual(
        first.metadata
      );
      expect(readFileSync(join(firstCurrent, 'metadata.json'), 'utf8')).not.toContain(
        'fake-secret-for'
      );

      const secondPayload = makePayload(environment, manifest);
      secondPayload.env.INTEXURAOS_FIREBASE_API_KEY = `AIza${'b'.repeat(35)}`;
      const second = renderSecretPackage({
        environment,
        manifest,
        outputDir,
        payload: secondPayload,
        version: 8,
      });
      const secondCurrent = resolveCurrent(outputDir);

      expect(secondCurrent).not.toBe(firstCurrent);
      expect(basename(secondCurrent)).toBe(second.releaseName);
      expect(statSync(firstCurrent).isDirectory()).toBe(true);
      expect(parseDotenv(readFileSync(join(secondCurrent, 'environment.env'), 'utf8'))).toEqual(
        secondPayload.env
      );
      expect(readdirSync(outputDir).filter((name) => name.startsWith('.staging-'))).toEqual([]);
    }
  );

  it('does not switch current when the replacement payload is invalid', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const outputDir = makeTempDirectory();
    renderSecretPackage({
      environment: 'dev',
      manifest,
      outputDir,
      payload: makePayload('dev', manifest),
      version: 7,
    });
    const originalTarget = readlinkSync(join(outputDir, 'current'));
    const invalid = makePayload('dev', manifest);
    delete invalid.env.INTEXURAOS_FIREBASE_API_KEY;

    expect(() =>
      renderSecretPackage({
        environment: 'dev',
        manifest,
        outputDir,
        payload: invalid,
        version: 8,
      })
    ).toThrow(/missing/u);
    expect(readlinkSync(join(outputDir, 'current'))).toBe(originalTarget);
  });

  it('rejects a tampered immutable release instead of reusing it', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const outputDir = makeTempDirectory();
    const payload = makePayload('dev', manifest);
    renderSecretPackage({ environment: 'dev', manifest, outputDir, payload, version: 7 });
    const originalTarget = readlinkSync(join(outputDir, 'current'));
    const releaseDir = resolve(outputDir, originalTarget);
    writeFileSync(join(releaseDir, 'environment.env'), 'TAMPERED="true"\n', { mode: 0o600 });

    expect(() =>
      renderSecretPackage({ environment: 'dev', manifest, outputDir, payload, version: 7 })
    ).toThrow(/existing immutable release contents do not match/u);
    expect(readlinkSync(join(outputDir, 'current'))).toBe(originalTarget);
  });

  it('rejects line breaks in env members because multiline material belongs in files', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const payload = makePayload('dev', manifest);
    payload.env.INTEXURAOS_INTERNAL_AUTH_TOKEN = 'first-line\nsecond-line';

    expect(() => validateSecretPackagePayload({ environment: 'dev', manifest, payload })).toThrow(
      /line break/u
    );
  });
});

describe('dual comparison', () => {
  it('returns only HMAC-based MATCH or MISMATCH', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const left = makePayload('dev', manifest);
    const right = structuredClone(left);
    const key = Buffer.from('ephemeral-test-key-with-at-least-32-bytes');

    expect(
      dualCompareSecretPackages({ environment: 'dev', hmacKey: key, left, manifest, right })
    ).toBe('MATCH');
    right.env.INTEXURAOS_FIREBASE_API_KEY = `AIza${'c'.repeat(35)}`;
    expect(
      dualCompareSecretPackages({ environment: 'dev', hmacKey: key, left, manifest, right })
    ).toBe('MISMATCH');
  });
});

describe('secret package CLI', () => {
  it('supports the stable offline render contract without invoking GCP', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const payloadPath = join(root, 'payload.json');
    const outputDir = join(root, 'rendered');
    writeFileSync(payloadPath, `${JSON.stringify(makePayload('dev', manifest))}\n`, {
      mode: 0o600,
    });

    const stdout = execFileSync(
      process.execPath,
      [
        cliPath,
        'render',
        '--environment',
        'dev',
        '--version',
        '7',
        '--project-id',
        'test-project',
        '--output-dir',
        outputDir,
        '--payload-file',
        payloadPath,
      ],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    expect(resolveCurrent(outputDir)).toContain('dev-v7-');
    expect(stdout).not.toContain('fake-secret-for');
    expect(JSON.parse(stdout)).toMatchObject({ environment: 'dev', version: '7' });
  });

  it('routes publish/fetch through an injected adapter and prints metadata only', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const payload = makePayload('prod', manifest);
    const payloadPath = join(root, 'payload.json');
    const receiptPath = join(root, 'publish-receipt.json');
    const fetchedPath = join(root, 'fetched.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    writeFileSync(payloadPath, data, { mode: 0o600 });
    const addVersion = vi.fn(async () => ({ version: '12' }));
    const listVersions = vi.fn(async () => [versionMetadata('11')]);
    const accessVersion = vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) }));
    const output: string[] = [];

    expect(
      await runSecretPackageCli(
        [
          'publish',
          '--environment',
          'prod',
          '--project-id',
          'test-project',
          '--payload-file',
          payloadPath,
          '--receipt-file',
          receiptPath,
        ],
        {
          adapter: { accessVersion, addVersion, listVersions },
          manifest,
          stdout: (line) => output.push(line),
        }
      )
    ).toBe(0);
    expect(
      await runSecretPackageCli(
        [
          'fetch',
          '--environment',
          'prod',
          '--version',
          '12',
          '--project-id',
          'test-project',
          '--output',
          fetchedPath,
        ],
        { adapter: { accessVersion }, manifest, stdout: (line) => output.push(line) }
      )
    ).toBe(0);

    expect(addVersion).toHaveBeenCalledOnce();
    expect(accessVersion).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(fetchedPath, 'utf8'))).toEqual(payload);
    expect(fileMode(fetchedPath)).toBe('600');
    expect(output.join('\n')).not.toContain('fake-secret-for');
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ environment: 'prod', version: '12' }),
      expect.objectContaining({ environment: 'prod', version: '12' }),
    ]);
  });

  it('resumes CLI publication from the receipt without invoking addVersion again', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const payload = makePayload('dev', manifest);
    const payloadPath = join(root, 'payload.json');
    const receiptPath = join(root, 'publish-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    writeFileSync(payloadPath, data, { mode: 0o600 });
    const addVersion = vi.fn(async () => ({ version: '13' }));
    const listVersions = vi.fn(async () => [versionMetadata('12')]);
    const accessVersion = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient readback failure'))
      .mockResolvedValueOnce({ data, dataCrc32c: crc32cBase64(data) });
    const output: string[] = [];

    await expect(
      runSecretPackageCli(
        [
          'publish',
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--payload-file',
          payloadPath,
          '--receipt-file',
          receiptPath,
        ],
        {
          adapter: { accessVersion, addVersion, listVersions },
          manifest,
          stdout: (line) => output.push(line),
        }
      )
    ).rejects.toThrow(/verification failed/u);

    await expect(
      runSecretPackageCli(
        [
          'publish-resume',
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--payload-file',
          payloadPath,
          '--receipt-file',
          receiptPath,
        ],
        { adapter: { accessVersion }, manifest, stdout: (line) => output.push(line) }
      )
    ).resolves.toBe(0);

    expect(addVersion).toHaveBeenCalledOnce();
    expect(accessVersion).toHaveBeenCalledTimes(2);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      command: 'publish-resume',
      environment: 'dev',
      version: '13',
    });
    expect(output[0]).not.toContain('fake-secret-for');
  });

  it('routes ambiguous CLI recovery only through publish-reconcile', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const payload = makePayload('dev', manifest);
    const payloadPath = join(root, 'payload.json');
    const receiptPath = join(root, 'publish-receipt.json');
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    writeFileSync(payloadPath, data, { mode: 0o600 });
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        makePublishReceipt({ state: 'publishing', version: null, prePublishMaxVersion: '12' })
      )}\n`,
      { mode: 0o600 }
    );
    const accessVersion = vi.fn(async () => ({ data, dataCrc32c: crc32cBase64(data) }));
    const listVersions = vi.fn(async () => [versionMetadata('13')]);
    const output: string[] = [];

    await expect(
      runSecretPackageCli(
        [
          'publish-reconcile',
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--payload-file',
          payloadPath,
          '--receipt-file',
          receiptPath,
          '--version',
          '13',
        ],
        {
          adapter: { accessVersion, listVersions },
          manifest,
          stdout: (line) => output.push(line),
        }
      )
    ).resolves.toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      command: 'publish-reconcile',
      environment: 'dev',
      version: '13',
    });
  });

  it('accepts private payload inputs with mode 0600 or more restrictive', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const output: string[] = [];

    for (const mode of [0o600, 0o400]) {
      const payloadPath = join(root, `payload-${mode.toString(8)}.json`);
      writeFileSync(payloadPath, JSON.stringify(makePayload('dev', manifest)), { mode: 0o600 });
      chmodSync(payloadPath, mode);

      await expect(
        runSecretPackageCli(['validate', '--environment', 'dev', '--payload-file', payloadPath], {
          manifest,
          stdout: (line) => output.push(line),
        })
      ).resolves.toBe(0);
    }

    expect(output).toHaveLength(2);
  });

  it.each([
    { name: 'a symbolic link', mode: 0o600, symlink: true },
    { name: 'owner-executable permissions', mode: 0o700, symlink: false },
    { name: 'group-readable permissions', mode: 0o640, symlink: false },
    { name: 'other-writable permissions', mode: 0o602, symlink: false },
  ])('rejects a payload input that has $name', async ({ mode, symlink }) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const targetPath = join(root, 'payload-target.json');
    const payloadPath = join(root, 'payload.json');
    writeFileSync(targetPath, JSON.stringify(makePayload('dev', manifest)), { mode: 0o600 });
    if (symlink) {
      symlinkSync(targetPath, payloadPath);
    } else {
      writeFileSync(payloadPath, readFileSync(targetPath), { mode: 0o600 });
      chmodSync(payloadPath, mode);
    }

    await expect(
      runSecretPackageCli(['validate', '--environment', 'dev', '--payload-file', payloadPath], {
        manifest,
        stdout: () => undefined,
      })
    ).rejects.toThrow(symlink ? /regular non-symlink/u : /permissions/u);
  });

  it.each([
    { name: 'a symbolic link', mode: 0o600, symlink: true },
    { name: 'group-readable permissions', mode: 0o640, symlink: false },
  ])('rejects an HMAC input that has $name', async ({ mode, symlink }) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const root = makeTempDirectory();
    const payloadPath = join(root, 'payload.json');
    const keyTargetPath = join(root, 'hmac-target.key');
    const keyPath = join(root, 'hmac.key');
    writeFileSync(payloadPath, JSON.stringify(makePayload('dev', manifest)), { mode: 0o600 });
    writeFileSync(keyTargetPath, Buffer.alloc(32, 0x41), { mode: 0o600 });
    if (symlink) {
      symlinkSync(keyTargetPath, keyPath);
    } else {
      writeFileSync(keyPath, readFileSync(keyTargetPath), { mode: 0o600 });
      chmodSync(keyPath, mode);
    }

    await expect(
      runSecretPackageCli(
        [
          'dual-compare',
          '--environment',
          'dev',
          '--left-payload-file',
          payloadPath,
          '--right-payload-file',
          payloadPath,
          '--hmac-key-file',
          keyPath,
        ],
        { manifest, stdout: () => undefined }
      )
    ).rejects.toThrow(symlink ? /regular non-symlink/u : /permissions/u);
  });
});

function readManifestObject(): Record<string, unknown> {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
}

function makePayload(
  environment: 'dev' | 'prod',
  manifest: ReturnType<typeof loadSecretPackageManifest>
): TestSecretPackagePayload {
  const definition = manifest.packages[environment];
  const env = Object.fromEntries(
    definition.envNames.map((name) => [
      name,
      name === 'INTEXURAOS_FIREBASE_API_KEY' ? `AIza${'a'.repeat(35)}` : `fake-secret-for-${name}`,
    ])
  ) as Record<string, string>;
  const serviceAccount = {
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    client_email: `runtime-${environment}@intexuraos-dev-pbuchman.iam.gserviceaccount.com`,
    client_id: '123456789012345678901',
    client_x509_cert_url:
      `https://www.googleapis.com/robot/v1/metadata/x509/runtime-${environment}` +
      '%40intexuraos-dev-pbuchman.iam.gserviceaccount.com',
    private_key: fakePrivateKeyPem,
    private_key_id: '0123456789abcdef0123456789abcdef01234567',
    project_id: 'intexuraos-dev-pbuchman',
    token_uri: 'https://oauth2.googleapis.com/token',
    type: 'service_account',
    universe_domain: 'googleapis.com',
  };
  const fileValues: Record<string, string> = {
    cloudflareDnsApiTokenBase64: Buffer.from('fake-cloudflare-dns-token').toString('base64'),
    githubAppPrivateKeyPemBase64: Buffer.from(fakePrivateKeyPem).toString('base64'),
    runtimeGcpServiceAccountJsonBase64: Buffer.from(JSON.stringify(serviceAccount)).toString(
      'base64'
    ),
    tlsPrivateKeyPemBase64: Buffer.from(fakePrivateKeyPem).toString('base64'),
  };
  const files = Object.fromEntries(
    definition.files.map((name) => [name, fileValues[name]])
  ) as Record<string, string>;

  return { schemaVersion: 1, environment, env, files };
}

function replaceServiceAccount(
  payload: Record<string, unknown>,
  replacement: Record<string, unknown>
): void {
  const files = payload.files as Record<string, string>;
  const current = JSON.parse(
    Buffer.from(files.runtimeGcpServiceAccountJsonBase64 ?? '', 'base64').toString('utf8')
  ) as Record<string, unknown>;
  files.runtimeGcpServiceAccountJsonBase64 = Buffer.from(
    JSON.stringify({ ...current, ...replacement })
  ).toString('base64');
}

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'intexuraos-secret-package-'));
  temporaryDirectories.push(directory);
  return directory;
}

function resolveCurrent(outputDir: string): string {
  return resolve(outputDir, readlinkSync(join(outputDir, 'current')));
}

function fileMode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}
