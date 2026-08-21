import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const loaderPath = resolve(repoRoot, 'scripts/hetzner/load-secrets.sh');
const manifest = JSON.parse(
  readFileSync(resolve(repoRoot, 'config/environments/secret-packages.json'), 'utf8')
) as { packages: { prod: { envNames: string[] } } };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

interface Fixture {
  cloudflarePath: string;
  internalPath: string;
  metadataPath: string;
  outputPath: string;
  payloadPath: string;
  projectionRoot: string;
  renderRoot: string;
  root: string;
  runtimePath: string;
  tlsPath: string;
}

function mode(path: string): number {
  return statSync(path).mode & 0o7777;
}

function runtimeServiceAccount(
  email = 'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
) {
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

function packagePayload(marker: string, serviceAccount = runtimeServiceAccount()) {
  return {
    schemaVersion: 1,
    environment: 'prod',
    env: Object.fromEntries(
      manifest.packages.prod.envNames.map((name) => [
        name,
        name === 'INTEXURAOS_FIREBASE_API_KEY'
          ? `AIza${marker.padEnd(35, 'a').slice(0, 35)}`
          : `${marker}-${name}`,
      ])
    ),
    files: {
      cloudflareDnsApiTokenBase64: Buffer.from(`${marker}-cloudflare-token`).toString('base64'),
      runtimeGcpServiceAccountJsonBase64: Buffer.from(JSON.stringify(serviceAccount)).toString(
        'base64'
      ),
      tlsPrivateKeyPemBase64: Buffer.from(privateKeyPem).toString('base64'),
    },
  };
}

function fixture(marker = 'candidate'): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'intexuraos-prod-loader-'));
  const stable = join(root, 'stable');
  const projectionRoot = join(root, 'projections');
  const renderRoot = join(root, 'rendered');
  mkdirSync(stable, { recursive: true, mode: 0o700 });
  mkdirSync(join(projectionRoot, 'obsolete-release'), { recursive: true, mode: 0o700 });
  const result: Fixture = {
    cloudflarePath: join(stable, 'cloudflare.ini'),
    internalPath: join(stable, 'internal-auth-token'),
    metadataPath: join(stable, 'metadata.json'),
    outputPath: join(stable, '.env.prod'),
    payloadPath: join(root, 'payload.json'),
    projectionRoot,
    renderRoot,
    root,
    runtimePath: join(stable, 'runtime-sa-key.json'),
    tlsPath: join(stable, 'tls-private-key.pem'),
  };
  writeFileSync(result.payloadPath, JSON.stringify(packagePayload(marker)), { mode: 0o600 });
  writeFileSync(result.outputPath, 'PREVIOUS_ENV=complete\n', { mode: 0o600 });
  writeFileSync(result.runtimePath, '{"previous":true}\n', { mode: 0o600 });
  writeFileSync(result.internalPath, 'previous-token', { mode: 0o640 });
  writeFileSync(result.cloudflarePath, 'previous-cloudflare\n', { mode: 0o600 });
  writeFileSync(result.tlsPath, 'previous-tls\n', { mode: 0o600 });
  writeFileSync(result.metadataPath, '{"previous":true}\n', { mode: 0o600 });
  return result;
}

function runLoader(input: Fixture, args: string[]) {
  return spawnSync(
    'bash',
    [
      loaderPath,
      ...args,
      '--project-id',
      'intexuraos-dev-pbuchman',
      '--output',
      input.outputPath,
      '--render-dir',
      input.renderRoot,
      '--payload-file',
      input.payloadPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUDFLARE_CREDENTIALS_FILE: input.cloudflarePath,
        INTERNAL_AUTH_TOKEN_FILE: input.internalPath,
        INTEXURAOS_ENVIRONMENT: 'prod',
        PACKAGE_METADATA_FILE: input.metadataPath,
        RUNTIME_SA_KEY_FILE: input.runtimePath,
        SECRET_PACKAGE_LOCK_FILE: join(input.root, 'lock', 'loader.lock'),
        SECRET_PROJECTION_ROOT: input.projectionRoot,
        SKIP_CLOUDFLARE_CREDENTIAL_SMOKE: '1',
        SKIP_OWNERSHIP: '1',
        SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
        TLS_PRIVATE_KEY_FILE: input.tlsPath,
        TMPDIR: input.root,
      },
    }
  );
}

describe('irreversible PROD secret-package loader', () => {
  it('publishes exactly one complete package and destroys local rollback state', () => {
    const input = fixture();
    const result = runLoader(input, ['--version', '7']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Activated PROD secret package version 7');
    expect(existsSync(input.projectionRoot)).toBe(false);
    expect(readdirSync(input.renderRoot).sort()).toEqual([
      'current',
      expect.stringMatching(/^prod-v7-[0-9a-f]{8}$/u),
    ]);

    const env = parse(readFileSync(input.outputPath, 'utf8'));
    expect(env.INTEXURAOS_ENVIRONMENT).toBe('prod');
    expect(env.INTEXURAOS_SECRET_PACKAGE_VERSION).toBe('7');
    for (const name of manifest.packages.prod.envNames) {
      expect(env[name], name).toBe(
        name === 'INTEXURAOS_FIREBASE_API_KEY'
          ? `AIza${'candidate'.padEnd(35, 'a').slice(0, 35)}`
          : `candidate-${name}`
      );
    }
    expect(env.PREVIOUS_ENV).toBeUndefined();
    expect(readFileSync(input.internalPath, 'utf8')).toBe(
      'candidate-INTEXURAOS_INTERNAL_AUTH_TOKEN'
    );
    expect(readFileSync(input.cloudflarePath, 'utf8')).toBe(
      'dns_cloudflare_api_token = candidate-cloudflare-token\n'
    );
    expect(JSON.parse(readFileSync(input.runtimePath, 'utf8')).client_email).toBe(
      'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(JSON.parse(readFileSync(input.metadataPath, 'utf8')).version).toBe('7');
    expect(mode(input.outputPath)).toBe(0o600);
    expect(mode(input.runtimePath)).toBe(0o600);
    expect(mode(input.internalPath)).toBe(0o640);
    expect(mode(input.cloudflarePath)).toBe(0o600);
    expect(mode(input.tlsPath)).toBe(0o600);
  });

  it('requires one exact numeric version and rejects every legacy operation', () => {
    const input = fixture();
    for (const args of [
      [],
      ['--version', 'latest'],
      ['--version', '7', '--stage-only'],
      ['--version', '7', '--activate'],
      ['--version', '7', '--rollback'],
    ]) {
      const result = runLoader(input, args);
      expect(result.status, args.join(' ')).not.toBe(0);
      expect(readFileSync(input.outputPath, 'utf8')).toBe('PREVIOUS_ENV=complete\n');
    }
  });

  it('fails before publication when the package is invalid', () => {
    const input = fixture();
    writeFileSync(
      input.payloadPath,
      JSON.stringify(packagePayload('bad', runtimeServiceAccount('wrong@example.com'))),
      { mode: 0o600 }
    );

    const result = runLoader(input, ['--version', '9']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to render PROD package');
    expect(readFileSync(input.outputPath, 'utf8')).toBe('PREVIOUS_ENV=complete\n');
    expect(readFileSync(input.internalPath, 'utf8')).toBe('previous-token');
    expect(existsSync(input.projectionRoot)).toBe(true);
  });

  it('contains no rollback, compatibility, or partial publication mode', () => {
    const script = readFileSync(loaderPath, 'utf8');
    expect(script).not.toContain('--stage-only');
    expect(script).not.toContain('--activate');
    expect(script).not.toContain('--rollback');
    expect(script).not.toContain('--secret');
    expect(script).not.toContain('current-release');
  });
});
