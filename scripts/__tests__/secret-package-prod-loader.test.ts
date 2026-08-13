import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
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
  outputPath: string;
  payloadPath: string;
  projectionDir: string;
  renderDir: string;
  root: string;
  runtimePath: string;
  tlsPath: string;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

function packagePayload(marker: string): Record<string, unknown> {
  const env = Object.fromEntries(
    manifest.packages.prod.envNames.map((name) => [
      name,
      name === 'INTEXURAOS_FIREBASE_API_KEY'
        ? `AIza${marker.padEnd(35, 'a').slice(0, 35)}`
        : `${marker}-${name}`,
    ])
  );
  env.INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY = `{"kid":"${marker}","private":"value with 'single' and \\"double\\" quotes"}`;
  const serviceAccount = {
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    client_email: 'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
    client_id: '123456789012345678901',
    client_x509_cert_url:
      'https://www.googleapis.com/robot/v1/metadata/x509/' +
      'ixos-hetzner-runtime-dev%40intexuraos-dev-pbuchman.iam.gserviceaccount.com',
    private_key: privateKeyPem,
    private_key_id: '0123456789abcdef0123456789abcdef01234567',
    project_id: 'intexuraos-dev-pbuchman',
    token_uri: 'https://oauth2.googleapis.com/token',
    type: 'service_account',
    universe_domain: 'googleapis.com',
  };
  return {
    schemaVersion: 1,
    environment: 'prod',
    env,
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
  const root = mkdtempSync(join(tmpdir(), 'intexuraos-prod-package-'));
  const payloadPath = join(root, 'payload.json');
  const outputPath = join(root, 'stable', '.env.prod');
  const runtimePath = join(root, 'stable', 'runtime-sa-key.json');
  const internalPath = join(root, 'stable', 'internal-auth-token');
  const cloudflarePath = join(root, 'stable', 'cloudflare.ini');
  const tlsPath = join(root, 'stable', 'tls-private-key.pem');
  mkdirSync(join(root, 'stable'), { recursive: true });
  writeFileSync(payloadPath, JSON.stringify(packagePayload(marker)), { mode: 0o600 });
  writeFileSync(outputPath, 'PREVIOUS_ENV=complete\n', { mode: 0o600 });
  writeFileSync(runtimePath, '{"previous":true}\n', { mode: 0o600 });
  writeFileSync(internalPath, 'previous-internal-token', { mode: 0o640 });
  return {
    cloudflarePath,
    internalPath,
    outputPath,
    payloadPath,
    projectionDir: join(root, 'projections'),
    renderDir: join(root, 'rendered'),
    root,
    runtimePath,
    tlsPath,
  };
}

function runLoaderWithArgs(input: Fixture, args: string[]): ReturnType<typeof spawnSync> {
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
      input.renderDir,
      '--projection-dir',
      input.projectionDir,
      '--payload-file',
      input.payloadPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUDFLARE_CREDENTIALS_FILE: input.cloudflarePath,
        EXPECTED_RUNTIME_SA_EMAIL:
          'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
        INTERNAL_AUTH_TOKEN_FILE: input.internalPath,
        INTEXURAOS_COMMIT_SHA: 'a'.repeat(40),
        INTEXURAOS_ENVIRONMENT: 'prod',
        RUNTIME_SA_KEY_FILE: input.runtimePath,
        SKIP_OWNERSHIP: '1',
        SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
        TLS_PRIVATE_KEY_FILE: input.tlsPath,
        TMPDIR: input.root,
      },
    }
  );
}

function runLoader(
  input: Fixture,
  version = '7',
  operationArgs: string[] = []
): ReturnType<typeof spawnSync> {
  return runLoaderWithArgs(input, ['--version', version, ...operationArgs]);
}

describe('transactional PROD secret-package loader', () => {
  it('renders one exact package and atomically projects every production artifact', () => {
    const input = fixture();
    const result = runLoader(input);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Activated PROD secret package version 7');
    expect(`${result.stdout}${result.stderr}`).not.toContain('candidate-INTEXURAOS');
    expect(lstatSync(join(input.projectionDir, 'current')).isSymbolicLink()).toBe(true);
    for (const stablePath of [
      input.outputPath,
      input.runtimePath,
      input.internalPath,
      input.cloudflarePath,
      input.tlsPath,
    ]) {
      expect(lstatSync(stablePath).isSymbolicLink(), stablePath).toBe(true);
    }

    const projected = parse(readFileSync(input.outputPath, 'utf8'));
    expect(projected.INTEXURAOS_SECRET_PACKAGE_VERSION).toBe('7');
    expect(projected.INTEXURAOS_INTERNAL_AUTH_TOKEN).toBe(
      'candidate-INTEXURAOS_INTERNAL_AUTH_TOKEN'
    );
    expect(projected.INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY).toBe(
      `{"kid":"candidate","private":"value with 'single' and \\"double\\" quotes"}`
    );
    expect(readFileSync(input.internalPath, 'utf8')).toBe(
      'candidate-INTEXURAOS_INTERNAL_AUTH_TOKEN'
    );
    expect(readFileSync(input.cloudflarePath, 'utf8')).toBe(
      'dns_cloudflare_api_token = candidate-cloudflare-token\n'
    );
    expect(mode(input.outputPath)).toBe(0o600);
    expect(mode(input.runtimePath)).toBe(0o600);
    expect(mode(input.internalPath)).toBe(0o640);
    expect(mode(input.cloudflarePath)).toBe(0o600);
    expect(mode(input.tlsPath)).toBe(0o600);
    expect(
      readFileSync(join(input.projectionDir, 'legacy-pre-packages', '.env.prod'), 'utf8')
    ).toBe('PREVIOUS_ENV=complete\n');
  }, 30_000);

  it('is idempotent for the same immutable version and commit', () => {
    const input = fixture();
    const first = runLoader(input);
    const firstTarget = readlinkSync(join(input.projectionDir, 'current'));
    const second = runLoader(input);

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(firstTarget);
  }, 30_000);

  it('stages and preflights a complete candidate without changing current, then activates and rolls back atomically', () => {
    const input = fixture('previous');
    const first = runLoader(input, '7');
    expect(first.status, first.stderr).toBe(0);
    const previousRelease = readlinkSync(join(input.projectionDir, 'current'));
    const previousEnvironment = readFileSync(input.outputPath, 'utf8');

    writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), { mode: 0o600 });
    const staged = runLoader(input, '8', ['--stage-only']);
    expect(staged.status, staged.stderr).toBe(0);
    const releaseMatch = /^STAGED_PROJECTION_RELEASE_NAME=([A-Za-z0-9._-]+)$/mu.exec(staged.stdout);
    expect(releaseMatch).not.toBeNull();
    const candidateRelease = releaseMatch?.[1] ?? '';
    expect(candidateRelease).not.toBe(previousRelease);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(previousRelease);
    expect(readFileSync(input.outputPath, 'utf8')).toBe(previousEnvironment);
    expect(statSync(join(input.projectionDir, candidateRelease)).isDirectory()).toBe(true);

    const preflight = runLoaderWithArgs(input, ['--preflight', candidateRelease]);
    expect(preflight.status, preflight.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(previousRelease);
    expect(readFileSync(input.outputPath, 'utf8')).toBe(previousEnvironment);

    const activated = runLoaderWithArgs(input, ['--activate', candidateRelease]);
    expect(activated.status, activated.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(candidateRelease);
    expect(parse(readFileSync(input.outputPath, 'utf8')).INTEXURAOS_SECRET_PACKAGE_VERSION).toBe(
      '8'
    );

    const rolledBack = runLoaderWithArgs(input, ['--rollback', previousRelease]);
    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(previousRelease);
    expect(readFileSync(input.outputPath, 'utf8')).toBe(previousEnvironment);
  }, 30_000);

  it('rejects invalid or mutable versions before changing the active projection', () => {
    const input = fixture();
    const first = runLoader(input);
    const activeBefore = readlinkSync(join(input.projectionDir, 'current'));

    expect(first.status, first.stderr).toBe(0);
    for (const version of ['', 'latest', '0', '01', '-1']) {
      const failed = runLoader(input, version);
      expect(failed.status, version).not.toBe(0);
      expect(failed.stderr).toContain('positive numeric version');
      expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(activeBefore);
    }
  }, 30_000);

  it('keeps the previous complete projection when candidate validation fails', () => {
    const input = fixture();
    const first = runLoader(input);
    expect(first.status, first.stderr).toBe(0);
    const activeBefore = readlinkSync(join(input.projectionDir, 'current'));
    const previousEnv = readFileSync(input.outputPath, 'utf8');

    const invalid = packagePayload('broken') as {
      env: Record<string, string>;
    };
    delete invalid.env.INTEXURAOS_INTERNAL_AUTH_TOKEN;
    writeFileSync(input.payloadPath, JSON.stringify(invalid), { mode: 0o600 });
    chmodSync(input.payloadPath, 0o600);
    const failed = runLoader(input, '8', ['--stage-only']);

    expect(failed.status).not.toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(activeBefore);
    expect(readFileSync(input.outputPath, 'utf8')).toBe(previousEnv);
  }, 30_000);

  it('rolls back every stable path when first-time link publication fails midway', () => {
    const input = fixture();
    const blockedParent = join(input.root, 'blocked-parent');
    writeFileSync(blockedParent, 'not-a-directory', { mode: 0o600 });
    input.cloudflarePath = join(blockedParent, 'cloudflare.ini');

    const failed = runLoader(input);

    expect(failed.status).not.toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe('legacy-pre-packages');
    expect(lstatSync(input.outputPath).isSymbolicLink()).toBe(false);
    expect(lstatSync(input.runtimePath).isSymbolicLink()).toBe(false);
    expect(lstatSync(input.internalPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(input.outputPath, 'utf8')).toBe('PREVIOUS_ENV=complete\n');
    expect(readFileSync(input.runtimePath, 'utf8')).toBe('{"previous":true}\n');
    expect(readFileSync(input.internalPath, 'utf8')).toBe('previous-internal-token');
    expect(existsSync(join(input.projectionDir, '.stable-link-transaction.json'))).toBe(false);
  }, 30_000);
});
