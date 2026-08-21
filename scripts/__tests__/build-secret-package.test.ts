import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
const manifestPath = resolve(repoRoot, 'config/environments/secret-packages.json');
const sourcesPath = resolve(repoRoot, 'config/environments/secret-package-sources.json');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

function serviceAccount() {
  const email = 'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
  return {
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    client_email: email,
    client_id: '123456789012345678901',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(email)}`,
    private_key: privateKeyPem,
    private_key_id: '0123456789abcdef0123456789abcdef01234567',
    project_id: 'intexuraos-dev-pbuchman',
    token_uri: 'https://oauth2.googleapis.com/token',
    type: 'service_account',
    universe_domain: 'googleapis.com',
  };
}

function payload(environment: 'dev' | 'prod') {
  const manifest = loadSecretPackageManifest({ manifestPath });
  const definition = manifest.packages[environment];
  return {
    schemaVersion: 1,
    environment,
    env: Object.fromEntries(
      definition.envNames.map((name) => [
        name,
        name === 'INTEXURAOS_FIREBASE_API_KEY' ? `AIza${'f'.repeat(35)}` : `value-${name}`,
      ])
    ),
    files: Object.fromEntries(
      definition.files.map((name) => [
        name,
        Buffer.from(
          name === 'runtimeGcpServiceAccountJsonBase64'
            ? JSON.stringify(serviceAccount())
            : name === 'cloudflareDnsApiTokenBase64'
              ? 'cloudflare-token'
              : privateKeyPem
        ).toString('base64'),
      ])
    ),
  };
}

function adapterFor(environment: 'dev' | 'prod') {
  const data = Buffer.from(JSON.stringify(payload(environment)));
  return {
    accessVersion: vi.fn(async () => ({ data, dataCrc32c: BigInt(crc32c(data)) })),
  };
}

function explicitOverrides(environment: 'dev' | 'prod') {
  const source = payload(environment);
  return {
    env: Object.fromEntries(
      Object.entries(source.env).map(([name, value]) => [name, Buffer.from(value)])
    ),
    files: Object.fromEntries(
      Object.entries(source.files).map(([name, value]) => [name, Buffer.from(value, 'base64')])
    ),
  };
}

describe('final secret package builder', () => {
  it('uses only the current package containers as tracked rebuild sources', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    const sources = loadSecretPackageSources({ manifest, sourcesPath });

    expect(sources).toEqual({
      schemaVersion: 3,
      packages: {
        dev: { basePackageSecretId: 'INTEXURAOS_SECRET_PACKAGE_DEV' },
        prod: { basePackageSecretId: 'INTEXURAOS_SECRET_PACKAGE_PROD' },
      },
    });
    expect(JSON.stringify(sources)).not.toMatch(/legacy|recovery|latest/iu);
    expect(verifySecretPackages({ manifestPath, sourcesPath }).sourceManifest).toEqual(sources);
  });

  it('rejects every legacy source-manifest shape', () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    expect(() =>
      validateSecretPackageSources(
        {
          schemaVersion: 2,
          legacySecretVersions: {},
          packages: { dev: {}, prod: {} },
        },
        manifest
      )
    ).toThrow(/schemaVersion|top-level/u);
  });

  it.each(['dev', 'prod'] as const)(
    'builds %s from one exact package version and explicit overrides',
    async (environment) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const sources = loadSecretPackageSources({ manifest, sourcesPath });
      const adapter = adapterFor(environment);
      const firstName = manifest.packages[environment].envNames[0];

      const result = await buildSecretPackageCandidate({
        adapter,
        baseVersion: 2,
        environment,
        manifest,
        overrides: { env: { [firstName]: Buffer.from('rotated-value') }, files: {} },
        projectId: 'intexuraos-dev-pbuchman',
        sources,
      });

      expect(result.sourceMode).toBe('base-package');
      expect(result.baseVersion).toBe('2');
      expect(result.payload.env[firstName]).toBe('rotated-value');
      expect(adapter.accessVersion).toHaveBeenCalledWith({
        projectId: 'intexuraos-dev-pbuchman',
        secretId: manifest.packages[environment].secretId,
        version: '2',
      });
      expect(() =>
        validateSecretPackagePayload({ environment, manifest, payload: result.payload })
      ).not.toThrow();
    }
  );

  it.each(['dev', 'prod'] as const)(
    'builds %s only from a complete explicit member set when there is no base',
    async (environment) => {
      const manifest = loadSecretPackageManifest({ manifestPath });
      const result = await buildSecretPackageCandidate({
        environment,
        manifest,
        overrides: explicitOverrides(environment),
        projectId: 'intexuraos-dev-pbuchman',
      });
      expect(result.sourceMode).toBe('full-explicit');
      expect(Object.keys(result.payload.env)).toEqual(manifest.packages[environment].envNames);
      expect(Object.keys(result.payload.files)).toEqual(manifest.packages[environment].files);
    }
  );

  it('rejects incomplete explicit input, mutable versions, and removed CLI options', async () => {
    const manifest = loadSecretPackageManifest({ manifestPath });
    await expect(
      buildSecretPackageCandidate({
        environment: 'dev',
        manifest,
        overrides: { env: {}, files: {} },
        projectId: 'intexuraos-dev-pbuchman',
      })
    ).rejects.toThrow(/requires at least one explicit override/u);
    await expect(
      buildSecretPackageCandidate({
        adapter: adapterFor('dev'),
        baseVersion: 'latest',
        environment: 'dev',
        manifest,
        overrides: {
          env: { [manifest.packages.dev.envNames[0]]: Buffer.from('value') },
          files: {},
        },
        projectId: 'intexuraos-dev-pbuchman',
      })
    ).rejects.toThrow(/exact positive numeric version/u);
    await expect(
      runBuildSecretPackageCli([
        '--environment',
        'dev',
        '--project-id',
        'intexuraos-dev-pbuchman',
        '--output',
        '/tmp/unused',
        '--legacy-version',
        '1',
      ])
    ).rejects.toThrow(/unknown or duplicate option/u);
  });

  it('writes a private complete candidate without emitting payload values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intexuraos-package-builder-'));
    const output = join(root, 'candidate.json');
    const override = join(root, 'override');
    writeFileSync(override, 'rotated-openrouter-value', { mode: 0o600 });
    chmodSync(override, 0o600);
    const stdout: string[] = [];
    const manifest = loadSecretPackageManifest({ manifestPath });

    await runBuildSecretPackageCli(
      [
        '--environment',
        'dev',
        '--project-id',
        'intexuraos-dev-pbuchman',
        '--output',
        output,
        '--base-version',
        '2',
        '--override-env',
        `INTEXURAOS_OPENROUTER_APP_API_KEY=${override}`,
      ],
      { adapter: adapterFor('dev'), manifest, stdout: (line) => stdout.push(line) }
    );

    expect(statSync(output).mode & 0o7777).toBe(0o600);
    expect(JSON.parse(readFileSync(output, 'utf8')).env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBe(
      'rotated-openrouter-value'
    );
    expect(stdout.join('\n')).not.toContain('rotated-openrouter-value');
    expect(JSON.parse(stdout[0])).toMatchObject({
      valid: true,
      environment: 'dev',
      sourceMode: 'base-package',
      baseVersion: '2',
    });
  });
});
