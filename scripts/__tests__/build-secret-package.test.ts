import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSecretPackageCandidate,
  loadSecretPackageSources,
  runBuildSecretPackageCli,
  validateSecretPackageSources,
} from '../build-secret-package.mjs';
import {
  crc32c,
  loadSecretPackageManifest,
  validateSecretPackagePayload,
} from '../lib/secret-package.mjs';
import { verifySecretPackages } from '../verify-secret-packages.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const manifestPath = resolve(repoRoot, 'config', 'environments', 'secret-packages.json');
const sourcesPath = resolve(repoRoot, 'config', 'environments', 'secret-package-sources.json');
const verifierPath = resolve(repoRoot, 'scripts', 'verify-secret-packages.mjs');
const temporaryDirectories: string[] = [];
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fakePrivateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const { privateKey: rotatedPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedPrivateKeyPem = rotatedPrivateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const firebaseApiKey = `AIza${'f'.repeat(35)}`;

const EXPECTED_LEGACY_VERSIONS: Record<string, number> = {
  INTEXURAOS_CLOUDFLARE_API_TOKEN: 2,
  INTEXURAOS_DASHSCOPE_APP_API_KEY: 1,
  INTEXURAOS_ENCRYPTION_KEY: 1,
  INTEXURAOS_GITHUB_APP_PRIVATE_KEY: 1,
  INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET: 1,
  INTEXURAOS_GITHUB_WEBHOOK_SECRET: 2,
  INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: 2,
  INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN: 1,
  INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN: 1,
  INTEXURAOS_INTERNAL_AUTH_TOKEN: 2,
  INTEXURAOS_KIMI_APP_API_KEY: 1,
  INTEXURAOS_LINEAR_API_KEY: 1,
  INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY: 1,
  INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY: 1,
  INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 1,
  INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING: 1,
  INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY: 1,
  INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING: 1,
  INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING: 1,
  INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN: 1,
  INTEXURAOS_MIMO_APP_API_KEY: 1,
  INTEXURAOS_MINIMAX_APP_API_KEY: 1,
  INTEXURAOS_OPENAI_APP_API_KEY: 1,
  INTEXURAOS_OPENROUTER_APP_API_KEY: 2,
  INTEXURAOS_ORCHESTRATOR_SECRET: 1,
  INTEXURAOS_SENTRY_AUTOMATION_USER_ID: 1,
  INTEXURAOS_SENTRY_WEBHOOK_SECRET: 2,
  INTEXURAOS_SPEECHMATICS_APP_API_KEY: 1,
  INTEXURAOS_SSL_PRIVATE_KEY: 1,
  INTEXURAOS_TOKEN_ENCRYPTION_KEY: 1,
  INTEXURAOS_WEBHOOK_VERIFY_SECRET: 1,
  INTEXURAOS_WHATSAPP_ACCESS_TOKEN: 2,
  INTEXURAOS_WHATSAPP_APP_SECRET: 2,
  INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: 1,
  INTEXURAOS_WHATSAPP_VERIFY_TOKEN: 1,
  INTEXURAOS_WHATSAPP_WABA_ID: 2,
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('secret package source manifest', () => {
  it('pins every legacy source to the reviewed exact numeric version', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });

    expect(Object.keys(sources).sort()).toEqual([
      'legacySecretVersions',
      'packages',
      'schemaVersion',
    ]);
    expect(sources.schemaVersion).toBe(2);
    expect(sources.legacySecretVersions).toEqual(EXPECTED_LEGACY_VERSIONS);
    expect(Object.values(sources.legacySecretVersions).every(Number.isSafeInteger)).toBe(true);
    expect(JSON.stringify(sources)).not.toContain('latest');
    expect(Object.keys(sources.packages).sort()).toEqual(['dev', 'prod']);
    expect(sources.packages.dev.basePackageSecretId).toBe('INTEXURAOS_SECRET_PACKAGE_DEV');
    expect(sources.packages.dev.externalEnvFiles).toEqual({
      INTEXURAOS_FIREBASE_API_KEY: 'firebase-api-key-file',
    });
    expect(sources.packages.dev.externalFiles).toEqual({});
    expect(sources.packages.dev.legacyFiles).toEqual({
      githubAppPrivateKeyPemBase64: 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY',
    });
    expect(sources.packages.prod.externalEnvFiles).toEqual({
      INTEXURAOS_FIREBASE_API_KEY: 'firebase-api-key-file',
    });
    expect(sources.packages.prod.externalFiles).toEqual({
      cloudflareDnsApiTokenBase64: 'cloudflare-dns-api-token-file',
      runtimeGcpServiceAccountJsonBase64: 'runtime-gcp-service-account-file',
    });
    expect(sources.packages.prod.legacyFiles).toEqual({
      tlsPrivateKeyPemBase64: 'INTEXURAOS_SSL_PRIVATE_KEY',
    });
    expect(sources.packages.prod.basePackageSecretId).toBe('INTEXURAOS_SECRET_PACKAGE_PROD');
  });

  it('is verified with the package manifest and emits source counts only', () => {
    const result = verifySecretPackages({ manifestPath, sourcesPath });

    expect(result.sourceManifest).toEqual({
      schemaVersion: 2,
      legacySecretVersionCount: 36,
      packages: {
        dev: {
          basePackageSecretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
          externalEnvFileCount: 1,
          externalFileCount: 0,
          legacyEnvCount: 34,
          legacyFileCount: 1,
        },
        prod: {
          basePackageSecretId: 'INTEXURAOS_SECRET_PACKAGE_PROD',
          externalEnvFileCount: 1,
          externalFileCount: 2,
          legacyEnvCount: 27,
          legacyFileCount: 1,
        },
      },
    });
    const output = JSON.stringify(result);
    expect(output).not.toContain('legacySecretVersions');
    expect(output).not.toContain('firebase-api-key-file');
    expect(output).not.toContain('runtime-gcp-service-account-file');
    expect(output).not.toContain('cloudflare-dns-api-token-file');
  });

  it('makes the CI verifier fail closed when the source manifest is invalid', () => {
    const root = makeTempDirectory();
    const invalidSourcesPath = join(root, 'invalid-sources.json');
    const sources = readSourcesObject();
    (sources.legacySecretVersions as Record<string, unknown>).INTEXURAOS_OPENAI_APP_API_KEY =
      'latest';
    writeFileSync(invalidSourcesPath, JSON.stringify(sources), { mode: 0o600 });

    expect(() => verifySecretPackages({ manifestPath, sourcesPath: invalidSourcesPath })).toThrow(
      /exact positive numeric versions/u
    );
  });

  it('prints metadata-only verification for explicit package and source manifests', () => {
    const result = spawnSync(
      process.execPath,
      [verifierPath, '--manifest', manifestPath, '--sources-manifest', sourcesPath],
      { encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      sourceManifest: { legacySecretVersionCount: 36, schemaVersion: 2 },
    });
    expect(result.stdout).not.toContain('legacySecretVersions');
    expect(result.stdout).not.toContain('firebase-api-key-file');
  });

  it.each([
    [
      'unknown top-level key',
      (sources: Record<string, unknown>): void => {
        sources.extra = true;
      },
    ],
    [
      'mutable legacy version',
      (sources: Record<string, unknown>): void => {
        (sources.legacySecretVersions as Record<string, unknown>).INTEXURAOS_OPENAI_APP_API_KEY =
          'latest';
      },
    ],
    [
      'zero legacy version',
      (sources: Record<string, unknown>): void => {
        (sources.legacySecretVersions as Record<string, unknown>).INTEXURAOS_OPENAI_APP_API_KEY = 0;
      },
    ],
    [
      'missing package member',
      (sources: Record<string, unknown>): void => {
        const packages = sources.packages as Record<string, Record<string, unknown>>;
        packages.dev.legacyEnvNames = (packages.dev.legacyEnvNames as string[]).filter(
          (name) => name !== 'INTEXURAOS_OPENAI_APP_API_KEY'
        );
      },
    ],
    [
      'overlapping external and legacy member',
      (sources: Record<string, unknown>): void => {
        const packages = sources.packages as Record<string, Record<string, unknown>>;
        packages.dev.legacyEnvNames = [
          ...(packages.dev.legacyEnvNames as string[]),
          'INTEXURAOS_FIREBASE_API_KEY',
        ].sort();
      },
    ],
    [
      'wrong GitHub PEM source',
      (sources: Record<string, unknown>): void => {
        const packages = sources.packages as Record<string, Record<string, unknown>>;
        (packages.dev.legacyFiles as Record<string, string>).githubAppPrivateKeyPemBase64 =
          'INTEXURAOS_SSL_PRIVATE_KEY';
      },
    ],
    [
      'wrong base package container',
      (sources: Record<string, unknown>): void => {
        const packages = sources.packages as Record<string, Record<string, unknown>>;
        packages.dev.basePackageSecretId = 'INTEXURAOS_SECRET_PACKAGE_PROD';
      },
    ],
    [
      'unknown external option',
      (sources: Record<string, unknown>): void => {
        const packages = sources.packages as Record<string, Record<string, unknown>>;
        (packages.prod.externalFiles as Record<string, string>).cloudflareDnsApiTokenBase64 =
          'unknown-file';
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = readSourcesObject();
    mutate(sources);

    expect(() => validateSecretPackageSources(sources, manifest)).toThrow(
      /Secret package source manifest/u
    );
  });
});

describe('secret package builder documentation', () => {
  it.each(['scripts/README.md', 'docs/operations/secret-packages.md'])(
    'documents the exact builder inputs in %s',
    (relativePath) => {
      const document = readFileSync(resolve(repoRoot, relativePath), 'utf8');

      expect(document).toContain('node scripts/build-secret-package.mjs');
      expect(document).toContain('--environment dev');
      expect(document).toContain('--environment prod');
      expect(document).toContain('--project-id <project-id>');
      expect(document).toContain('--output <mode-0600-candidate>');
      expect(document).toContain('--firebase-api-key-file <mode-0600-file>');
      expect(document).toContain('--runtime-gcp-service-account-file <mode-0600-file>');
      expect(document).toContain('--cloudflare-dns-api-token-file <mode-0600-file>');
      expect(document).toContain('--base-version <numeric-version>');
      expect(document).toContain('--override-env INTEXURAOS_OPENAI_APP_API_KEY=<mode-0600-file>');
      expect(document).toContain('--override-file githubAppPrivateKeyPemBase64=<mode-0600-file>');
      expect(document).toContain('INTEXURAOS_GITHUB_APP_PRIVATE_KEY');
      expect(document).toContain('INTEXURAOS_SSL_PRIVATE_KEY');
    }
  );
});

describe('secret package candidate builder', () => {
  it.each(['dev', 'prod'] as const)(
    'fetches only exact legacy versions and deterministically builds a valid %s payload',
    async (environment) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const sources = loadSecretPackageSources({ manifest, sourcesPath });
      const { adapter, accessVersion } = makeLegacyAdapter();
      const externalInputs = makeExternalInputs(environment);

      const first = await buildSecretPackageCandidate({
        adapter,
        environment,
        externalInputs,
        manifest,
        projectId: 'test-project',
        sources,
      });
      const second = await buildSecretPackageCandidate({
        adapter,
        environment,
        externalInputs,
        manifest,
        projectId: 'test-project',
        sources,
      });

      expect(first.payload).toEqual(second.payload);
      expect(Buffer.from(JSON.stringify(first.payload))).toEqual(
        Buffer.from(JSON.stringify(second.payload))
      );
      expect(() =>
        validateSecretPackagePayload({ environment, manifest, payload: first.payload })
      ).not.toThrow();
      expect(first.payload.env.INTEXURAOS_FIREBASE_API_KEY).toBe(firebaseApiKey);
      expect(Object.keys(first.payload.env)).toEqual(manifest.packages[environment].envNames);
      expect(Object.keys(first.payload.files)).toEqual(manifest.packages[environment].files);
      expect(
        accessVersion.mock.calls.every(
          ([request]) =>
            request.version === String(EXPECTED_LEGACY_VERSIONS[request.secretId]) &&
            request.version !== 'latest'
        )
      ).toBe(true);
      expect(
        accessVersion.mock.calls.every(([request]) => request.projectId === 'test-project')
      ).toBe(true);
      expect(first.metadata.environment).toBe(environment);
      expect(JSON.stringify(first.metadata)).not.toContain('legacy-value-for');
      expect(JSON.stringify(first.metadata)).not.toContain('BEGIN PRIVATE KEY');

      if (environment === 'dev') {
        expect(
          Buffer.from(first.payload.files.githubAppPrivateKeyPemBase64, 'base64').toString()
        ).toBe(fakePrivateKeyPem);
      } else {
        expect(Buffer.from(first.payload.files.tlsPrivateKeyPemBase64, 'base64').toString()).toBe(
          fakePrivateKeyPem
        );
        expect(
          Buffer.from(first.payload.files.cloudflareDnsApiTokenBase64, 'base64').toString()
        ).toBe('external-cloudflare-dns-token');
      }
    }
  );

  it('rejects a legacy CRC32C mismatch and adapter errors without exposing source values', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const secretValue = 'must-not-appear-in-error';
    const mismatchAdapter = {
      accessVersion: vi.fn(async () => ({
        data: Buffer.from(secretValue),
        dataCrc32c: BigInt(0),
      })),
    };

    await expect(
      buildSecretPackageCandidate({
        adapter: mismatchAdapter,
        environment: 'dev',
        externalInputs: makeExternalInputs('dev'),
        manifest,
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrowError(expect.not.stringContaining(secretValue));

    const throwingAdapter = {
      accessVersion: vi.fn(async () => {
        throw new Error(secretValue);
      }),
    };
    await expect(
      buildSecretPackageCandidate({
        adapter: throwingAdapter,
        environment: 'dev',
        externalInputs: makeExternalInputs('dev'),
        manifest,
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrowError(expect.not.stringContaining(secretValue));
  });

  it('does not require PROD-only external inputs for DEV', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const { adapter } = makeLegacyAdapter();

    await expect(
      buildSecretPackageCandidate({
        adapter,
        environment: 'dev',
        externalInputs: { 'firebase-api-key-file': Buffer.from(firebaseApiKey) },
        manifest,
        projectId: 'test-project',
        sources,
      })
    ).resolves.toMatchObject({ metadata: { environment: 'dev' } });
  });

  it('normalizes only trailing legacy env line endings preserved by Secret Manager', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const { adapter } = makeLegacyAdapter();
    adapter.accessVersion.mockImplementation(async ({ secretId }: { secretId: string }) => {
      const value =
        secretId === 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY'
          ? fakePrivateKeyPem
          : secretId === 'INTEXURAOS_KIMI_APP_API_KEY'
            ? 'legacy-value\r\n\n'
            : `legacy-value-for-${secretId}`;
      const data = Buffer.from(value, 'utf8');
      return { data, dataCrc32c: BigInt(crc32c(data)) };
    });

    const candidate = await buildSecretPackageCandidate({
      adapter,
      environment: 'dev',
      externalInputs: makeExternalInputs('dev'),
      manifest,
      projectId: 'test-project',
      sources,
    });

    expect(candidate.payload.env.INTEXURAOS_KIMI_APP_API_KEY).toBe('legacy-value');
  });

  it('still rejects line breaks inside an env value', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const { adapter } = makeLegacyAdapter();
    adapter.accessVersion.mockImplementation(async ({ secretId }: { secretId: string }) => {
      const value =
        secretId === 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY'
          ? fakePrivateKeyPem
          : secretId === 'INTEXURAOS_KIMI_APP_API_KEY'
            ? 'legacy\nvalue\n'
            : `legacy-value-for-${secretId}`;
      const data = Buffer.from(value, 'utf8');
      return { data, dataCrc32c: BigInt(crc32c(data)) };
    });

    await expect(
      buildSecretPackageCandidate({
        adapter,
        environment: 'dev',
        externalInputs: makeExternalInputs('dev'),
        manifest,
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrow(/line break/u);
  });

  it('fails before legacy reads when a required PROD external input is absent', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const { adapter, accessVersion } = makeLegacyAdapter();
    const externalInputs = makeExternalInputs('prod');
    delete externalInputs['runtime-gcp-service-account-file'];

    await expect(
      buildSecretPackageCandidate({
        adapter,
        environment: 'prod',
        externalInputs,
        manifest,
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrow(/required external input/u);
    expect(accessVersion).not.toHaveBeenCalled();
  });
});

describe('post-cleanup secret package candidate builder', () => {
  it('builds a complete candidate from one exact base package version plus explicit overrides', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const { adapter, accessVersion, payload: basePayload } = makeBasePackageAdapter('dev');

    const result = await buildSecretPackageCandidate({
      adapter,
      baseVersion: '7',
      environment: 'dev',
      manifest,
      overrides: {
        env: { INTEXURAOS_OPENAI_APP_API_KEY: Buffer.from('rotated-openai-value') },
        files: { githubAppPrivateKeyPemBase64: Buffer.from(rotatedPrivateKeyPem) },
      },
      projectId: 'test-project',
      sources,
    });

    expect(accessVersion).toHaveBeenCalledTimes(1);
    expect(accessVersion).toHaveBeenCalledWith({
      projectId: 'test-project',
      secretId: 'INTEXURAOS_SECRET_PACKAGE_DEV',
      version: '7',
    });
    expect(result.payload.env.INTEXURAOS_OPENAI_APP_API_KEY).toBe('rotated-openai-value');
    expect(result.payload.env.INTEXURAOS_KIMI_APP_API_KEY).toBe(
      basePayload.env.INTEXURAOS_KIMI_APP_API_KEY
    );
    expect(
      Buffer.from(result.payload.files.githubAppPrivateKeyPemBase64, 'base64').toString()
    ).toBe(rotatedPrivateKeyPem);
    expect(Object.keys(result.payload.env)).toEqual(manifest.packages.dev.envNames);
    expect(Object.keys(result.payload.files)).toEqual(manifest.packages.dev.files);
    expect(result).toMatchObject({
      sourceMode: 'base-package',
      baseVersion: '7',
      legacySourceCount: 0,
      externalSourceCount: 0,
      overrideEnvCount: 1,
      overrideFileCount: 1,
    });
    expect(() =>
      validateSecretPackagePayload({ environment: 'dev', manifest, payload: result.payload })
    ).not.toThrow();
  });

  it.each(['latest', '01', '0', '-1', '1.0'])(
    'rejects non-canonical base version %s before Secret Manager access',
    async (baseVersion) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const sources = loadSecretPackageSources({ manifest, sourcesPath });
      const { adapter, accessVersion } = makeBasePackageAdapter('dev');

      await expect(
        buildSecretPackageCandidate({
          adapter,
          baseVersion,
          environment: 'dev',
          manifest,
          overrides: {
            env: { INTEXURAOS_OPENAI_APP_API_KEY: Buffer.from('rotated-openai-value') },
          },
          projectId: 'test-project',
          sources,
        })
      ).rejects.toThrow(/exact positive numeric version/u);
      expect(accessVersion).not.toHaveBeenCalled();
    }
  );

  it('rejects empty or unknown overrides before Secret Manager access', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const { adapter, accessVersion } = makeBasePackageAdapter('dev');

    await expect(
      buildSecretPackageCandidate({
        adapter,
        baseVersion: '7',
        environment: 'dev',
        manifest,
        overrides: { env: {}, files: {} },
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrow(/at least one explicit override/u);
    await expect(
      buildSecretPackageCandidate({
        adapter,
        baseVersion: '7',
        environment: 'dev',
        manifest,
        overrides: { env: { INTEXURAOS_UNKNOWN_SECRET: Buffer.from('private-value') } },
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrow(/unknown env override/u);
    expect(accessVersion).not.toHaveBeenCalled();
  });

  it('rejects a base-package CRC mismatch without exposing package bytes', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });
    const secretValue = 'must-not-appear-in-error';
    const adapter = {
      accessVersion: vi.fn(async () => ({
        data: Buffer.from(secretValue),
        dataCrc32c: BigInt(0),
      })),
    };

    await expect(
      buildSecretPackageCandidate({
        adapter,
        baseVersion: '7',
        environment: 'dev',
        manifest,
        overrides: {
          env: { INTEXURAOS_OPENAI_APP_API_KEY: Buffer.from('rotated-openai-value') },
        },
        projectId: 'test-project',
        sources,
      })
    ).rejects.toThrowError(expect.not.stringContaining(secretValue));
  });
});

describe('secret package candidate CLI', () => {
  it.each(['dev', 'prod'] as const)(
    'writes a deterministic atomic mode-600 %s candidate and emits metadata only',
    async (environment) => {
      const root = makeTempDirectory();
      const output = join(root, `${environment}-candidate.json`);
      const externalPaths = writeExternalInputFiles(root, environment);
      const { adapter, accessVersion } = makeLegacyAdapter();
      const stdout: string[] = [];

      await expect(
        runBuildSecretPackageCli(
          [
            '--environment',
            environment,
            '--project-id',
            'test-project',
            '--output',
            output,
            ...Object.entries(externalPaths).flatMap(([name, path]) => [`--${name}`, path]),
          ],
          { adapter, stdout: (line: string) => stdout.push(line) }
        )
      ).resolves.toBe(0);

      const payload = JSON.parse(readFileSync(output, 'utf8')) as {
        environment: string;
        env: Record<string, string>;
      };
      expect(payload.environment).toBe(environment);
      expect(payload.env.INTEXURAOS_FIREBASE_API_KEY).toBe(firebaseApiKey);
      expect(statSync(output).mode & 0o777).toBe(0o600);
      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0] ?? '{}')).toMatchObject({
        environment,
        output,
        valid: true,
      });
      expect(stdout.join('\n')).not.toContain(firebaseApiKey);
      expect(stdout.join('\n')).not.toContain('legacy-value-for');
      expect(accessVersion).toHaveBeenCalled();
    }
  );

  it('rejects a symlink or non-private external input before fetching legacy secrets', async () => {
    const root = makeTempDirectory();
    const firebasePath = join(root, 'firebase-key');
    const symlinkPath = join(root, 'firebase-link');
    writeFileSync(firebasePath, firebaseApiKey, { mode: 0o644 });
    symlinkSync(firebasePath, symlinkPath);
    const { adapter, accessVersion } = makeLegacyAdapter();

    await expect(
      runBuildSecretPackageCli(
        [
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--output',
          join(root, 'candidate.json'),
          '--firebase-api-key-file',
          symlinkPath,
        ],
        { adapter, stdout: vi.fn() }
      )
    ).rejects.toThrow(/private regular file/u);
    expect(accessVersion).not.toHaveBeenCalled();
  });

  it('leaves an existing output unchanged when candidate validation fails', async () => {
    const root = makeTempDirectory();
    const output = join(root, 'candidate.json');
    const externalPaths = writeExternalInputFiles(root, 'dev');
    writeFileSync(output, 'previous-candidate\n', { mode: 0o600 });
    writeFileSync(externalPaths['firebase-api-key-file'], 'invalid-firebase-key', { mode: 0o600 });
    const { adapter } = makeLegacyAdapter();

    await expect(
      runBuildSecretPackageCli(
        [
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--output',
          output,
          '--firebase-api-key-file',
          externalPaths['firebase-api-key-file'],
        ],
        { adapter, stdout: vi.fn() }
      )
    ).rejects.toThrow(/Firebase API key/u);
    expect(readFileSync(output, 'utf8')).toBe('previous-candidate\n');
  });

  it('atomically builds from an exact base version and private env/file overrides', async () => {
    const root = makeTempDirectory();
    const output = join(root, 'dev-candidate.json');
    const envOverride = join(root, 'openai-key');
    const fileOverride = join(root, 'github-app.pem');
    writeFileSync(envOverride, 'rotated-openai-value', { mode: 0o600 });
    writeFileSync(fileOverride, rotatedPrivateKeyPem, { mode: 0o600 });
    const { adapter, accessVersion } = makeBasePackageAdapter('dev');
    const stdout: string[] = [];

    await expect(
      runBuildSecretPackageCli(
        [
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--output',
          output,
          '--base-version',
          '7',
          '--override-env',
          `INTEXURAOS_OPENAI_APP_API_KEY=${envOverride}`,
          '--override-file',
          `githubAppPrivateKeyPemBase64=${fileOverride}`,
        ],
        { adapter, stdout: (line: string) => stdout.push(line) }
      )
    ).resolves.toBe(0);

    const payload = JSON.parse(readFileSync(output, 'utf8')) as {
      env: Record<string, string>;
      files: Record<string, string>;
    };
    expect(payload.env.INTEXURAOS_OPENAI_APP_API_KEY).toBe('rotated-openai-value');
    expect(Buffer.from(payload.files.githubAppPrivateKeyPemBase64, 'base64').toString()).toBe(
      rotatedPrivateKeyPem
    );
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(accessVersion).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout[0] ?? '{}')).toMatchObject({
      valid: true,
      sourceMode: 'base-package',
      baseVersion: '7',
      overrideEnvCount: 1,
      overrideFileCount: 1,
    });
    expect(stdout.join('\n')).not.toContain('rotated-openai-value');
    expect(stdout.join('\n')).not.toContain('BEGIN PRIVATE KEY');
  });

  it('rejects duplicate, unknown, symlink, and non-private overrides before fetching the base', async () => {
    const root = makeTempDirectory();
    const privateInput = join(root, 'private-input');
    const publicInput = join(root, 'public-input');
    const symlinkInput = join(root, 'symlink-input');
    writeFileSync(privateInput, 'rotated-value', { mode: 0o600 });
    writeFileSync(publicInput, 'rotated-value', { mode: 0o644 });
    symlinkSync(privateInput, symlinkInput);
    const { adapter, accessVersion } = makeBasePackageAdapter('dev');
    const common = [
      '--environment',
      'dev',
      '--project-id',
      'test-project',
      '--output',
      join(root, 'candidate.json'),
      '--base-version',
      '7',
    ];

    await expect(
      runBuildSecretPackageCli(
        [
          ...common,
          '--override-env',
          `INTEXURAOS_OPENAI_APP_API_KEY=${privateInput}`,
          '--override-env',
          `INTEXURAOS_OPENAI_APP_API_KEY=${privateInput}`,
        ],
        { adapter, stdout: vi.fn() }
      )
    ).rejects.toThrow(/duplicate override/u);
    await expect(
      runBuildSecretPackageCli(
        [...common, '--override-env', `INTEXURAOS_UNKNOWN_SECRET=${privateInput}`],
        { adapter, stdout: vi.fn() }
      )
    ).rejects.toThrow(/unknown env override/u);
    for (const input of [publicInput, symlinkInput]) {
      await expect(
        runBuildSecretPackageCli(
          [...common, '--override-env', `INTEXURAOS_OPENAI_APP_API_KEY=${input}`],
          { adapter, stdout: vi.fn() }
        )
      ).rejects.toThrow(/private regular file/u);
    }
    expect(accessVersion).not.toHaveBeenCalled();
  });

  it('does not mix legacy external input flags with base-package mode', async () => {
    const root = makeTempDirectory();
    const privateInput = join(root, 'private-input');
    writeFileSync(privateInput, 'rotated-value', { mode: 0o600 });
    const { adapter, accessVersion } = makeBasePackageAdapter('dev');

    await expect(
      runBuildSecretPackageCli(
        [
          '--environment',
          'dev',
          '--project-id',
          'test-project',
          '--output',
          join(root, 'candidate.json'),
          '--base-version',
          '7',
          '--override-env',
          `INTEXURAOS_OPENAI_APP_API_KEY=${privateInput}`,
          '--firebase-api-key-file',
          privateInput,
        ],
        { adapter, stdout: vi.fn() }
      )
    ).rejects.toThrow(/cannot mix base-package and legacy inputs/u);
    expect(accessVersion).not.toHaveBeenCalled();
  });
});

function readSourcesObject(): Record<string, unknown> {
  return JSON.parse(readFileSync(sourcesPath, 'utf8')) as Record<string, unknown>;
}

function makeLegacyAdapter(): {
  adapter: { accessVersion: ReturnType<typeof vi.fn> };
  accessVersion: ReturnType<typeof vi.fn>;
} {
  const accessVersion = vi.fn(async ({ secretId }: { secretId: string }) => {
    const value =
      secretId === 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY' || secretId === 'INTEXURAOS_SSL_PRIVATE_KEY'
        ? fakePrivateKeyPem
        : `legacy-value-for-${secretId}`;
    const data = Buffer.from(value, 'utf8');
    return { data, dataCrc32c: BigInt(crc32c(data)) };
  });
  return { adapter: { accessVersion }, accessVersion };
}

function makeBasePackageAdapter(environment: 'dev' | 'prod'): {
  adapter: { accessVersion: ReturnType<typeof vi.fn> };
  accessVersion: ReturnType<typeof vi.fn>;
  payload: ReturnType<typeof makeBasePayload>;
} {
  const payload = makeBasePayload(environment);
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const accessVersion = vi.fn(async () => ({
    data,
    dataCrc32c: BigInt(crc32c(data)),
  }));
  return { adapter: { accessVersion }, accessVersion, payload };
}

function makeBasePayload(environment: 'dev' | 'prod'): {
  schemaVersion: number;
  environment: 'dev' | 'prod';
  env: Record<string, string>;
  files: Record<string, string>;
} {
  const manifest = loadSecretPackageManifest({ manifestPath });
  const definition = manifest.packages[environment];
  const env = Object.fromEntries(
    definition.envNames.map((name) => [
      name,
      name === 'INTEXURAOS_FIREBASE_API_KEY' ? firebaseApiKey : `base-value-for-${name}`,
    ])
  );
  const files = Object.fromEntries(
    definition.files.map((name) => {
      if (name === 'runtimeGcpServiceAccountJsonBase64') {
        return [name, Buffer.from(JSON.stringify(makeServiceAccount())).toString('base64')];
      }
      if (name === 'cloudflareDnsApiTokenBase64') {
        return [name, Buffer.from('base-cloudflare-token').toString('base64')];
      }
      return [name, Buffer.from(fakePrivateKeyPem).toString('base64')];
    })
  );
  return { schemaVersion: 1, environment, env, files };
}

function makeExternalInputs(environment: 'dev' | 'prod'): Record<string, Buffer> {
  const inputs: Record<string, Buffer> = {
    'firebase-api-key-file': Buffer.from(firebaseApiKey),
  };
  if (environment === 'prod') {
    inputs['cloudflare-dns-api-token-file'] = Buffer.from('external-cloudflare-dns-token');
    inputs['runtime-gcp-service-account-file'] = Buffer.from(JSON.stringify(makeServiceAccount()));
  }
  return inputs;
}

function writeExternalInputFiles(
  root: string,
  environment: 'dev' | 'prod'
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(makeExternalInputs(environment)).map(([name, value]) => {
      const path = join(root, name);
      writeFileSync(path, value, { mode: 0o600 });
      chmodSync(path, 0o600);
      return [name, path];
    })
  );
}

function makeServiceAccount(): Record<string, string> {
  const clientEmail = 'runtime-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
  return {
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    client_email: clientEmail,
    client_id: '123456789012345678901',
    client_x509_cert_url:
      'https://www.googleapis.com/robot/v1/metadata/x509/' + encodeURIComponent(clientEmail),
    private_key: fakePrivateKeyPem,
    private_key_id: '0123456789abcdef0123456789abcdef01234567',
    project_id: 'intexuraos-dev-pbuchman',
    token_uri: 'https://oauth2.googleapis.com/token',
    type: 'service_account',
    universe_domain: 'googleapis.com',
  };
}

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'intexuraos-build-secret-package-'));
  temporaryDirectories.push(directory);
  return directory;
}
