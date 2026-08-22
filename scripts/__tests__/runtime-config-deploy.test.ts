import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, platform, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const syncSecretsPath = resolve(repoRoot, 'scripts/sync-secrets.sh');
const secretPackageCliPath = resolve(repoRoot, 'scripts/secret-package.mjs');
const devSecretProjectionPath = resolve(repoRoot, 'scripts/lib/dev-secret-projection.mjs');
const loadSecretsPath = resolve(repoRoot, 'scripts/hetzner/load-secrets.sh');
const deployWebPath = resolve(repoRoot, 'scripts/hetzner/deploy-web.sh');
const loadGrafanaEnvPath = resolve(repoRoot, 'scripts/observability/load-grafana-cloud-env.sh');
const generateOrchestratorEnvPath = resolve(repoRoot, 'scripts/generate-orchestrator-env.mjs');
const localEnvExamplePath = resolve(repoRoot, '.envrc.local.example');

function makeDevSecretPackagePayload(): {
  payload: Record<string, unknown>;
  privateKeyPem: string;
} {
  const manifest = JSON.parse(
    readFileSync(resolve(repoRoot, 'config/environments/secret-packages.json'), 'utf8')
  ) as { packages: { dev: { envNames: string[] } } };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const env = Object.fromEntries(
    manifest.packages.dev.envNames.map((name) => [
      name,
      name === 'INTEXURAOS_FIREBASE_API_KEY'
        ? `AIza${'d'.repeat(35)}`
        : `package-value-for-${name}`,
    ])
  );
  return {
    payload: {
      schemaVersion: 1,
      environment: 'dev',
      env,
      files: {
        githubAppPrivateKeyPemBase64: Buffer.from(privateKeyPem).toString('base64'),
      },
    },
    privateKeyPem,
  };
}

function makeProdSecretPackagePayload(overrides: Record<string, string> = {}): {
  cloudflareDnsToken: string;
  payload: Record<string, unknown>;
  runtimeServiceAccount: Record<string, string>;
  tlsPrivateKeyPem: string;
} {
  const manifest = JSON.parse(
    readFileSync(resolve(repoRoot, 'config/environments/secret-packages.json'), 'utf8')
  ) as { packages: { prod: { envNames: string[] } } };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tlsPrivateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const clientEmail = 'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
  const runtimeServiceAccount = {
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    client_email: clientEmail,
    client_id: '123456789012345678901',
    client_x509_cert_url:
      'https://www.googleapis.com/robot/v1/metadata/x509/' + encodeURIComponent(clientEmail),
    private_key: tlsPrivateKeyPem,
    private_key_id: '0123456789abcdef0123456789abcdef01234567',
    project_id: 'intexuraos-dev-pbuchman',
    token_uri: 'https://oauth2.googleapis.com/token',
    type: 'service_account',
    universe_domain: 'googleapis.com',
  };
  const env = Object.fromEntries(
    manifest.packages.prod.envNames.map((name) => [
      name,
      name === 'INTEXURAOS_FIREBASE_API_KEY'
        ? `AIza${'p'.repeat(35)}`
        : `package-value-for-${name}`,
    ])
  );
  Object.assign(env, overrides);
  const cloudflareDnsToken = 'cloudflare-dns-token-from-package';
  return {
    cloudflareDnsToken,
    payload: {
      schemaVersion: 1,
      environment: 'prod',
      env,
      files: {
        cloudflareDnsApiTokenBase64: Buffer.from(cloudflareDnsToken).toString('base64'),
        runtimeGcpServiceAccountJsonBase64: Buffer.from(
          JSON.stringify(runtimeServiceAccount)
        ).toString('base64'),
        tlsPrivateKeyPemBase64: Buffer.from(tlsPrivateKeyPem).toString('base64'),
      },
    },
    runtimeServiceAccount,
    tlsPrivateKeyPem,
  };
}

function validOrchestratorEnvironment(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    PROJECT_ID: 'test-project',
    INTEXURAOS_ENVIRONMENT: 'dev',
    INTEXURAOS_RUNTIME: 'prod',
    INTEXURAOS_REPOSITORY_URL: 'https://github.com/example/intexuraos.git',
    INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'internal-token',
    INTEXURAOS_ORCHESTRATOR_SECRET: 'orchestrator-token',
    INTEXURAOS_USAGE_WEBHOOK_URL: 'http://localhost:8128/internal/usage',
    INTEXURAOS_GITHUB_APP_ID: '123',
    INTEXURAOS_GITHUB_INSTALLATION_ID: '456',
    INTEXURAOS_LINEAR_API_KEY: 'linear-token',
    INTEXURAOS_ERROR_HUB_HOST: 'home-dev.example.ts.net:8443',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'openrouter-token',
    INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
    ...overrides,
  };
}

function syncDevPackage(options: {
  failpoint?: string;
  githubKeyOutput: string;
  lockFailpoint?: string;
  outputPath: string;
  packageOutputDir: string;
  payloadPath: string;
  tempRoot: string;
  version: string;
}): ReturnType<typeof spawnSync> {
  return spawnSync(
    'bash',
    [
      syncSecretsPath,
      '--version',
      options.version,
      '--project-id',
      'test-project',
      '--output',
      options.outputPath,
      '--package-output-dir',
      options.packageOutputDir,
      '--github-app-key-output',
      options.githubKeyOutput,
      '--payload-file',
      options.payloadPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: options.tempRoot,
        INTEXURAOS_SECRET_SYNC_LOCK_TEST_FAILPOINT: options.lockFailpoint ?? '',
        INTEXURAOS_SECRET_SYNC_TEST_FAILPOINT: options.failpoint ?? '',
        NODE_ENV: 'test',
        TMPDIR: options.tempRoot,
      },
    }
  );
}

function startDevPackageSync(options: {
  githubKeyOutput: string;
  holdLockMilliseconds?: number;
  outputPath: string;
  packageOutputDir: string;
  payloadPath: string;
  tempRoot: string;
  version: string;
}): {
  completed: Promise<{ status: number | null; stderr: string; stdout: string }>;
} {
  const child = spawn(
    'bash',
    [
      syncSecretsPath,
      '--version',
      options.version,
      '--project-id',
      'test-project',
      '--output',
      options.outputPath,
      '--package-output-dir',
      options.packageOutputDir,
      '--github-app-key-output',
      options.githubKeyOutput,
      '--payload-file',
      options.payloadPath,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: options.tempRoot,
        INTEXURAOS_SECRET_SYNC_TEST_LOCK_HOLD_MS: String(options.holdLockMilliseconds ?? 0),
        NODE_ENV: 'test',
        TMPDIR: options.tempRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  return {
    completed: new Promise((resolveCompleted) => {
      child.on('close', (status) => resolveCompleted({ status, stderr, stdout }));
    }),
  };
}

function startGenericDevRender(options: {
  holdLockMilliseconds?: number;
  lockPreparationReleaseFile?: string;
  outputDir: string;
  payloadPath: string;
  version: string;
}): {
  child: ReturnType<typeof spawn>;
  completed: Promise<{ status: number | null; stderr: string; stdout: string }>;
} {
  const child = spawn(
    process.execPath,
    [
      secretPackageCliPath,
      'render',
      '--environment',
      'dev',
      '--version',
      options.version,
      '--project-id',
      'test-project',
      '--output-dir',
      options.outputDir,
      '--payload-file',
      options.payloadPath,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        INTEXURAOS_SECRET_SYNC_LOCK_TEST_FAILPOINT:
          options.lockPreparationReleaseFile === undefined ? '' : 'hold-after-preparing-owner',
        INTEXURAOS_SECRET_SYNC_LOCK_TEST_RELEASE_FILE: options.lockPreparationReleaseFile ?? '',
        INTEXURAOS_SECRET_RENDER_TEST_LOCK_HOLD_MS: String(options.holdLockMilliseconds ?? 0),
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  return {
    child,
    completed: new Promise((resolveCompleted) => {
      child.on('close', (status) => resolveCompleted({ status, stderr, stdout }));
    }),
  };
}

async function waitForDevSyncClaim(packageOutputDir: string): Promise<void> {
  const lockRoot = join(packageOutputDir, '.sync-lock');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if (
        lstatSync(lockRoot).isDirectory() &&
        readdirSync(lockRoot).some((name) => name.startsWith('claim-'))
      ) {
        return;
      }
    } catch {
      // The first publisher has not installed its atomic claim yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('DEV sync claim was not observed');
}

async function waitForDevLockPreparationOwner(packageOutputDir: string): Promise<string> {
  const lockRoot = join(packageOutputDir, '.sync-lock');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const name = readdirSync(lockRoot).find((entry) =>
        /^\.preparing-owner-[0-9a-f-]+\.json$/u.test(entry)
      );
      if (name !== undefined) return name;
    } catch {
      // The writer has not installed its durable preparation owner yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('DEV lock preparation owner was not observed');
}

function processStartMarker(pid: number): string {
  if (platform() === 'linux') {
    const value = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
    const fieldsAfterCommand = value
      .slice(value.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/u);
    return fieldsAfterCommand[19] ?? '';
  }
  return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
}

function bootMarker(): string {
  if (platform() === 'linux') {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  }
  return execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' }).trim();
}

function makeStaleDevSyncClaim(options: {
  packageOutputDir: string;
  reason: 'non-sync-process' | 'reused-pid';
  token: string;
}): string {
  const lockRoot = join(options.packageOutputDir, '.sync-lock');
  const claimName = `claim-${options.token}`;
  const claimPath = join(lockRoot, claimName);
  const workDirectoryName = `.sync-work.${options.token}`;
  mkdirSync(claimPath, { mode: 0o700, recursive: true });
  mkdirSync(join(options.packageOutputDir, workDirectoryName), { mode: 0o700 });
  writeFileSync(
    join(claimPath, 'owner.json'),
    JSON.stringify({
      schemaVersion: 1,
      token: options.token,
      ownerPid: process.pid,
      hostname: hostname(),
      bootMarker: bootMarker(),
      processStartMarker:
        options.reason === 'reused-pid' ? 'stale-process-start' : processStartMarker(process.pid),
      syncScript: syncSecretsPath,
      workDirectoryName,
    }),
    { mode: 0o600 }
  );
  writeFileSync(join(claimPath, 'ticket'), '1\n', { mode: 0o600 });
  return workDirectoryName;
}

function makeLegacyDevProjection(options: {
  githubKeyOutput: string;
  outputPath: string;
  packageOutputDir: string;
  payloadPath: string;
  privateKeyPem: string;
  tempRoot: string;
  version: string;
}): void {
  const scratchOutput = join(options.tempRoot, 'scratch.envrc');
  const scratchKey = join(options.tempRoot, 'scratch-key.pem');
  const scratchPackages = join(options.tempRoot, 'scratch-packages');
  const syncResult = syncDevPackage({
    githubKeyOutput: scratchKey,
    outputPath: scratchOutput,
    packageOutputDir: scratchPackages,
    payloadPath: options.payloadPath,
    tempRoot: options.tempRoot,
    version: options.version,
  });
  expect(syncResult.status).toBe(0);

  execFileSync(
    'node',
    [
      resolve(repoRoot, 'scripts/secret-package.mjs'),
      'render',
      '--environment',
      'dev',
      '--version',
      options.version,
      '--project-id',
      'test-project',
      '--output-dir',
      options.packageOutputDir,
      '--payload-file',
      options.payloadPath,
    ],
    { cwd: repoRoot, env: { ...process.env, HOME: options.tempRoot }, stdio: 'pipe' }
  );
  copyFileSync(scratchOutput, options.outputPath);
  copyFileSync(scratchKey, options.githubKeyOutput);
  expect(readFileSync(options.githubKeyOutput, 'utf8')).toBe(options.privateKeyPem);
  rmSync(scratchPackages, { recursive: true, force: true });
  rmSync(scratchOutput, { force: true });
  rmSync(scratchKey, { force: true });
}

function expectCompleteDevProjection(options: {
  expectedPrivateKeyPem: string;
  expectedVersion: string;
  githubKeyOutput: string;
  outputPath: string;
  packageOutputDir: string;
}): void {
  const currentPath = join(options.packageOutputDir, 'current');
  const envrc = parse(readFileSync(options.outputPath, 'utf8'));
  const metadata = JSON.parse(readFileSync(join(currentPath, 'metadata.json'), 'utf8')) as {
    version: number;
  };
  expect(envrc.INTEXURAOS_SECRET_PACKAGE_VERSION).toBe(options.expectedVersion);
  expect(String(metadata.version)).toBe(options.expectedVersion);
  expect(readFileSync(options.githubKeyOutput, 'utf8')).toBe(options.expectedPrivateKeyPem);
  expect(readFileSync(join(currentPath, 'github-app-private-key.pem'), 'utf8')).toBe(
    options.expectedPrivateKeyPem
  );
}

describe('runtime configuration cutover', () => {
  it('uses one exact-version package render without legacy per-secret operations', () => {
    const script = readFileSync(syncSecretsPath, 'utf8');

    expect(script).toContain('scripts/secret-package.mjs');
    expect(script).toContain('SECRET_PACKAGE_VERSION');
    expect(script).toContain('--version');
    expect(script).toContain('--output-dir');
    expect(script).not.toContain('versions/latest');
    expect(script).not.toContain('secretmanager.googleapis.com');
    expect(script).not.toContain('gcloud secrets');
    expect(script).not.toContain('--add-new');
    expect(script).not.toContain('secret_manager');
  });

  it('atomically merges tracked config with a rendered DEV package and copies the GitHub PEM', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-sync-'));
    const outputPath = join(tempRoot, '.envrc');
    const packageOutputDir = join(tempRoot, 'packages');
    const githubKeyOutput = join(tempRoot, 'orchestrator', 'github-app.pem');
    const payloadPath = join(tempRoot, 'payload.json');
    const { payload, privateKeyPem } = makeDevSecretPackagePayload();
    writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

    execFileSync(
      'bash',
      [
        syncSecretsPath,
        'dev',
        '--version',
        '7',
        '--project-id',
        'test-project',
        '--output',
        outputPath,
        '--package-output-dir',
        packageOutputDir,
        '--github-app-key-output',
        githubKeyOutput,
        '--payload-file',
        payloadPath,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, HOME: tempRoot, TMPDIR: tempRoot },
        stdio: 'pipe',
      }
    );

    const envrc = readFileSync(outputPath, 'utf8');
    const merged = parse(envrc);
    const packageEnv = (payload.env ?? {}) as Record<string, string>;
    const trackedConfig = {
      ...(JSON.parse(
        readFileSync(resolve(repoRoot, 'config/environments/common.json'), 'utf8')
      ) as Record<string, string>),
      ...(JSON.parse(
        readFileSync(resolve(repoRoot, 'config/environments/dev.json'), 'utf8')
      ) as Record<string, string>),
    };
    expect(merged).toMatchObject({ ...trackedConfig, ...packageEnv });
    expect(merged.INTEXURAOS_FIREBASE_API_KEY).toBe(packageEnv.INTEXURAOS_FIREBASE_API_KEY);
    expect(readFileSync(githubKeyOutput, 'utf8')).toBe(privateKeyPem);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(statSync(githubKeyOutput).mode & 0o777).toBe(0o600);
    expect(statSync(packageOutputDir).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(packageOutputDir, 'current')).isSymbolicLink()).toBe(true);
    expect(readdirSync(packageOutputDir).some((name) => name.startsWith('.staging-'))).toBe(false);
    expect(envrc.trimEnd()).toMatch(
      /# Load \.envrc\.local if exists \(for local dev overrides\)\n\[\[ -f \.envrc\.local \]\] && source \.envrc\.local \|\| true$/u
    );
  }, 30_000);

  it('uses SECRET_PACKAGE_VERSION and the default private GitHub key destination', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-version-env-'));
    const outputPath = join(tempRoot, '.envrc');
    const payloadPath = join(tempRoot, 'payload.json');
    const { payload, privateKeyPem } = makeDevSecretPackagePayload();
    writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

    execFileSync(
      'bash',
      [
        syncSecretsPath,
        '--project-id',
        'test-project',
        '--output',
        outputPath,
        '--payload-file',
        payloadPath,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, HOME: tempRoot, SECRET_PACKAGE_VERSION: '11', TMPDIR: tempRoot },
        stdio: 'pipe',
      }
    );

    const defaultKeyPath = join(tempRoot, '.code-orchestrator', 'github-app.pem');
    const defaultRenderRoot = join(tempRoot, '.config', 'intexuraos', 'secret-packages', 'dev');
    const published = parse(readFileSync(outputPath, 'utf8'));
    expect(published['INTEXURAOS_SECRET_PACKAGE_VERSION']).toBe('11');
    expect(readFileSync(defaultKeyPath, 'utf8')).toBe(privateKeyPem);
    expect(statSync(defaultKeyPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(defaultRenderRoot, 'current')).isSymbolicLink()).toBe(true);
  }, 30_000);

  it.each([undefined, 'latest', '0', '01', '-1'])(
    'rejects a missing or non-numeric version %s without replacing local artifacts',
    (version) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-version-reject-'));
      const outputPath = join(tempRoot, '.envrc');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const { payload } = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });
      writeFileSync(outputPath, 'previous-complete-file\n', { mode: 0o600 });
      writeFileSync(githubKeyOutput, 'previous-private-key\n', { mode: 0o600 });
      const args = [
        syncSecretsPath,
        '--project-id',
        'test-project',
        '--output',
        outputPath,
        '--package-output-dir',
        join(tempRoot, 'packages'),
        '--github-app-key-output',
        githubKeyOutput,
        '--payload-file',
        payloadPath,
      ];
      if (version !== undefined) args.push('--version', version);

      const result = spawnSync('bash', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempRoot, SECRET_PACKAGE_VERSION: '', TMPDIR: tempRoot },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('positive numeric version');
      expect(readFileSync(outputPath, 'utf8')).toBe('previous-complete-file\n');
      expect(readFileSync(githubKeyOutput, 'utf8')).toBe('previous-private-key\n');
    }
  );

  it('keeps the previous .envrc and GitHub key intact when package validation fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-atomic-'));
    const outputPath = join(tempRoot, '.envrc');
    const githubKeyOutput = join(tempRoot, 'github-app.pem');
    const payloadPath = join(tempRoot, 'invalid-payload.json');
    const { payload } = makeDevSecretPackagePayload();
    delete ((payload.env ?? {}) as Record<string, unknown>).INTEXURAOS_FIREBASE_API_KEY;
    writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });
    writeFileSync(outputPath, 'previous-complete-file\n', { mode: 0o600 });
    writeFileSync(githubKeyOutput, 'previous-private-key\n', { mode: 0o600 });

    const result = spawnSync(
      'bash',
      [
        syncSecretsPath,
        'dev',
        '--version',
        '7',
        '--project-id',
        'test-project',
        '--output',
        outputPath,
        '--package-output-dir',
        join(tempRoot, 'packages'),
        '--github-app-key-output',
        githubKeyOutput,
        '--payload-file',
        payloadPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempRoot, TMPDIR: tempRoot },
      }
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(outputPath, 'utf8')).toBe('previous-complete-file\n');
    expect(readFileSync(githubKeyOutput, 'utf8')).toBe('previous-private-key\n');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  }, 30_000);

  it.each([
    'candidate-durable',
    'envrc-link-installed',
    'github-link-installed',
    'before-activation',
    'after-activation',
  ])(
    'fails closed or exposes the complete candidate on first-install SIGKILL at %s',
    (failpoint) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-crash-first-'));
      const outputPath = join(tempRoot, '.envrc');
      const packageOutputDir = join(tempRoot, 'packages');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload-v1.json');
      const candidate = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(candidate.payload), { mode: 0o600 });

      const interrupted = syncDevPackage({
        failpoint,
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '1',
      });

      expect(interrupted.status).not.toBe(0);
      if (failpoint === 'after-activation') {
        expectCompleteDevProjection({
          expectedPrivateKeyPem: candidate.privateKeyPem,
          expectedVersion: '1',
          githubKeyOutput,
          outputPath,
          packageOutputDir,
        });
      } else {
        expect(() => readFileSync(outputPath, 'utf8')).toThrow();
        expect(() => readFileSync(githubKeyOutput, 'utf8')).toThrow();
        expect(existsSync(join(packageOutputDir, 'current'))).toBe(false);
      }

      const resumed = syncDevPackage({
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '1',
      });
      expect(resumed.status).toBe(0);
      expectCompleteDevProjection({
        expectedPrivateKeyPem: candidate.privateKeyPem,
        expectedVersion: '1',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
    },
    30_000
  );

  it(
    'serializes two real concurrent DEV publishers and removes every ephemeral claim',
    { timeout: 30_000 },
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-concurrent-'));
      const outputPath = join(tempRoot, '.envrc');
      const packageOutputDir = join(tempRoot, 'packages');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const firstPayloadPath = join(tempRoot, 'payload-v7.json');
      const secondPayloadPath = join(tempRoot, 'payload-v8.json');
      const first = makeDevSecretPackagePayload();
      const second = makeDevSecretPackagePayload();
      writeFileSync(firstPayloadPath, JSON.stringify(first.payload), { mode: 0o600 });
      writeFileSync(secondPayloadPath, JSON.stringify(second.payload), { mode: 0o600 });

      const firstSync = startDevPackageSync({
        githubKeyOutput,
        holdLockMilliseconds: 500,
        outputPath,
        packageOutputDir,
        payloadPath: firstPayloadPath,
        tempRoot,
        version: '7',
      });
      await waitForDevSyncClaim(packageOutputDir);
      const secondSync = startDevPackageSync({
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath: secondPayloadPath,
        tempRoot,
        version: '8',
      });

      const [firstResult, secondResult] = await Promise.all([
        firstSync.completed,
        secondSync.completed,
      ]);
      expect(firstResult).toMatchObject({ status: 0, stderr: '' });
      expect(secondResult).toMatchObject({ status: 0, stderr: '' });
      expectCompleteDevProjection({
        expectedPrivateKeyPem: second.privateKeyPem,
        expectedVersion: '8',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
      expect(readdirSync(join(packageOutputDir, '.sync-lock'))).toEqual([]);
      expect(
        readdirSync(packageOutputDir).filter(
          (name) => name.startsWith('.sync-work.') || name.startsWith('.sync-lock.')
        )
      ).toEqual([]);
    }
  );

  it.each([
    ['reused-pid', '11111111-1111-4111-8111-111111111111'],
    ['non-sync-process', '22222222-2222-4222-8222-222222222222'],
  ] as const)(
    'reclaims a stale %s claim without deleting a concurrent owner path',
    (reason, token) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-stale-claim-'));
      const outputPath = join(tempRoot, '.envrc');
      const packageOutputDir = join(tempRoot, 'packages');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const candidate = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(candidate.payload), { mode: 0o600 });
      const workDirectoryName = makeStaleDevSyncClaim({
        packageOutputDir,
        reason,
        token,
      });

      const result = syncDevPackage({
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '9',
      });

      expect(result).toMatchObject({ status: 0, stderr: '' });
      expect(existsSync(join(packageOutputDir, '.sync-lock', `claim-${token}`))).toBe(false);
      expect(existsSync(join(packageOutputDir, workDirectoryName))).toBe(false);
      expect(readdirSync(join(packageOutputDir, '.sync-lock'))).toEqual([]);
      expectCompleteDevProjection({
        expectedPrivateKeyPem: candidate.privateKeyPem,
        expectedVersion: '9',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
    },
    30_000
  );

  it(
    'recovers after SIGKILL between creating a lock preparation and installing its owner',
    { timeout: 30_000 },
    () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-lock-preparation-crash-'));
      const outputPath = join(tempRoot, '.envrc');
      const packageOutputDir = join(tempRoot, 'packages');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const candidate = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(candidate.payload), { mode: 0o600 });

      const interrupted = syncDevPackage({
        githubKeyOutput,
        lockFailpoint: 'after-preparing-directory',
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '9',
      });

      expect(interrupted.status).not.toBe(0);
      expect(readdirSync(join(packageOutputDir, '.sync-lock'))).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^\.preparing-[0-9a-f-]+$/u),
          expect.stringMatching(/^\.preparing-owner-[0-9a-f-]+\.json$/u),
        ])
      );

      const resumed = syncDevPackage({
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '9',
      });

      expect(resumed).toMatchObject({ status: 0, stderr: '' });
      expect(readdirSync(join(packageOutputDir, '.sync-lock'))).toEqual([]);
      expectCompleteDevProjection({
        expectedPrivateKeyPem: candidate.privateKeyPem,
        expectedVersion: '9',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
    }
  );

  it(
    'recovers after SIGKILL while constructing an owner inode before companion publication',
    { timeout: 30_000 },
    () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-lock-owner-inode-crash-'));
      const outputPath = join(tempRoot, '.envrc');
      const packageOutputDir = join(tempRoot, 'packages');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const candidate = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(candidate.payload), { mode: 0o600 });

      const interrupted = syncDevPackage({
        githubKeyOutput,
        lockFailpoint: 'after-preparing-owner-open',
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '9',
      });
      expect(interrupted.status).not.toBe(0);

      const resumed = syncDevPackage({
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '9',
      });

      expect(resumed).toMatchObject({ status: 0, stderr: '' });
      expect(readdirSync(join(packageOutputDir, '.sync-lock'))).toEqual([]);
      expect(readdirSync(packageOutputDir).filter((name) => name.includes('owner-temp'))).toEqual(
        []
      );
      expectCompleteDevProjection({
        expectedPrivateKeyPem: candidate.privateKeyPem,
        expectedVersion: '9',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
    }
  );

  it(
    'blocks a second writer while a live companion-only preparation is unpublished',
    { timeout: 30_000 },
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-live-lock-preparation-'));
      const outputDir = join(tempRoot, 'packages');
      const firstPayloadPath = join(tempRoot, 'payload-v7.json');
      const secondPayloadPath = join(tempRoot, 'payload-v8.json');
      const releaseFile = join(tempRoot, 'release-lock-preparation');
      const firstCandidate = makeDevSecretPackagePayload();
      const secondCandidate = makeDevSecretPackagePayload();
      writeFileSync(firstPayloadPath, JSON.stringify(firstCandidate.payload), { mode: 0o600 });
      writeFileSync(secondPayloadPath, JSON.stringify(secondCandidate.payload), { mode: 0o600 });

      const first = startGenericDevRender({
        lockPreparationReleaseFile: releaseFile,
        outputDir,
        payloadPath: firstPayloadPath,
        version: '7',
      });
      const preparationOwnerName = await waitForDevLockPreparationOwner(outputDir);
      const second = spawnSync(
        process.execPath,
        [
          secretPackageCliPath,
          'render',
          '--environment',
          'dev',
          '--version',
          '8',
          '--project-id',
          'test-project',
          '--output-dir',
          outputDir,
          '--payload-file',
          secondPayloadPath,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            INTEXURAOS_SECRET_SYNC_LOCK_TEST_FAILPOINT: '',
            INTEXURAOS_SECRET_SYNC_LOCK_TEST_RELEASE_FILE: '',
            INTEXURAOS_SECRET_SYNC_LOCK_TIMEOUT_MS: '100',
            NODE_ENV: 'test',
          },
        }
      );
      const activePreparationWasPreserved = existsSync(
        join(outputDir, '.sync-lock', preparationOwnerName)
      );
      writeFileSync(releaseFile, 'release\n', { mode: 0o600 });
      const firstResult = await first.completed;

      expect(second.status).not.toBe(0);
      expect(activePreparationWasPreserved).toBe(true);
      expect(firstResult).toMatchObject({ status: 0, stderr: '' });
      expect(readlinkSync(join(outputDir, 'current'))).toMatch(/^dev-v7-/u);
      expect(readdirSync(join(outputDir, '.sync-lock'))).toEqual([]);
    }
  );

  it.each(['envrc', 'github-key'] as const)(
    'rejects a %s endpoint located inside the private projection root',
    (endpoint) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-overlap-direct-'));
      const packageOutputDir = join(tempRoot, 'packages');
      const safeOutputPath = join(tempRoot, '.envrc');
      const safeGithubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const { payload } = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

      const result = syncDevPackage({
        githubKeyOutput:
          endpoint === 'github-key'
            ? join(packageOutputDir, 'endpoints', 'github-app.pem')
            : safeGithubKeyOutput,
        outputPath:
          endpoint === 'envrc' ? join(packageOutputDir, 'endpoints', '.envrc') : safeOutputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '10',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unable to promote the complete DEV secret projection');
      expect(existsSync(join(packageOutputDir, 'current'))).toBe(false);
    },
    30_000
  );

  it.each(['envrc', 'github-key'] as const)(
    'rejects a %s endpoint parent that resolves through a symlink into the projection root',
    (endpoint) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-overlap-alias-'));
      const packageOutputDir = join(tempRoot, 'packages');
      const aliasPath = join(tempRoot, 'projection-alias');
      const safeOutputPath = join(tempRoot, '.envrc');
      const safeGithubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const { payload } = makeDevSecretPackagePayload();
      mkdirSync(packageOutputDir, { mode: 0o700 });
      symlinkSync(packageOutputDir, aliasPath, 'dir');
      writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

      const result = syncDevPackage({
        githubKeyOutput:
          endpoint === 'github-key' ? join(aliasPath, 'github-app.pem') : safeGithubKeyOutput,
        outputPath: endpoint === 'envrc' ? join(aliasPath, '.envrc') : safeOutputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '10',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unable to promote the complete DEV secret projection');
      expect(existsSync(join(packageOutputDir, 'current'))).toBe(false);
    },
    30_000
  );

  it('keeps generic package render roots distinct from the DEV projection root', () => {
    const script = readFileSync(syncSecretsPath, 'utf8');
    const scriptsReadme = readFileSync(resolve(repoRoot, 'scripts/README.md'), 'utf8');
    const runtimeOperations = readFileSync(
      resolve(repoRoot, 'docs/operations/runtime-configuration.md'),
      'utf8'
    );

    expect(script).toContain('PROJECTION_OUTPUT_DIR');
    expect(script).toContain('CANDIDATE_RENDER_DIR');
    expect(script).not.toContain('SECRET_PACKAGE_RENDER_DIR:-');
    expect(scriptsReadme).toMatch(/must never be passed to\s+generic `secret-package render`/u);
    expect(runtimeOperations).toMatch(
      /must never be reused as the `--output-dir` of\s+generic `secret-package render`/u
    );
  });

  it(
    'rejects a generic package render into a DEV projection-managed root',
    { timeout: 30_000 },
    () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-managed-root-'));
      const packageOutputDir = join(tempRoot, 'projection');
      const outputPath = join(tempRoot, '.envrc');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const { payload } = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

      const sync = syncDevPackage({
        githubKeyOutput,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '10',
      });
      expect(sync.status, sync.stderr).toBe(0);

      const genericRender = spawnSync(
        process.execPath,
        [
          secretPackageCliPath,
          'render',
          '--environment',
          'dev',
          '--version',
          '11',
          '--project-id',
          'test-project',
          '--output-dir',
          packageOutputDir,
          '--payload-file',
          payloadPath,
        ],
        { cwd: repoRoot, encoding: 'utf8' }
      );

      expect(genericRender.status).not.toBe(0);
      expect(genericRender.stderr).toContain('DEV projection-managed root');
      expect(readFileSync(outputPath, 'utf8')).toContain(
        'export INTEXURAOS_SECRET_PACKAGE_VERSION=10'
      );
    }
  );

  it(
    'holds a generic DEV writer behind an active sync and rejects it after projection classification',
    { timeout: 30_000 },
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-sync-before-render-'));
      const packageOutputDir = join(tempRoot, 'projection');
      const outputPath = join(tempRoot, '.envrc');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const payloadPath = join(tempRoot, 'payload.json');
      const candidate = makeDevSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(candidate.payload), { mode: 0o600 });

      const sync = startDevPackageSync({
        githubKeyOutput,
        holdLockMilliseconds: 500,
        outputPath,
        packageOutputDir,
        payloadPath,
        tempRoot,
        version: '10',
      });
      await waitForDevSyncClaim(packageOutputDir);
      const generic = startGenericDevRender({
        outputDir: packageOutputDir,
        payloadPath,
        version: '11',
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));

      expect(generic.child.exitCode).toBeNull();
      const [syncResult, genericResult] = await Promise.all([sync.completed, generic.completed]);
      expect(syncResult).toMatchObject({ status: 0, stderr: '' });
      expect(genericResult.status).not.toBe(0);
      expect(genericResult.stderr).toContain('DEV projection-managed root');
      expectCompleteDevProjection({
        expectedPrivateKeyPem: candidate.privateKeyPem,
        expectedVersion: '10',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
    }
  );

  it(
    'serializes two generic DEV scratch writers without classifying the scratch root as a projection',
    { timeout: 30_000 },
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-generic-writers-'));
      const outputDir = join(tempRoot, 'scratch-render');
      const firstPayloadPath = join(tempRoot, 'payload-v7.json');
      const secondPayloadPath = join(tempRoot, 'payload-v8.json');
      const firstCandidate = makeDevSecretPackagePayload();
      const secondCandidate = makeDevSecretPackagePayload();
      writeFileSync(firstPayloadPath, JSON.stringify(firstCandidate.payload), { mode: 0o600 });
      writeFileSync(secondPayloadPath, JSON.stringify(secondCandidate.payload), { mode: 0o600 });

      const first = startGenericDevRender({
        holdLockMilliseconds: 500,
        outputDir,
        payloadPath: firstPayloadPath,
        version: '7',
      });
      await waitForDevSyncClaim(outputDir);
      const second = startGenericDevRender({
        outputDir,
        payloadPath: secondPayloadPath,
        version: '8',
      });

      const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
      expect(firstResult).toMatchObject({ status: 0, stderr: '' });
      expect(secondResult).toMatchObject({ status: 0, stderr: '' });
      expect(readlinkSync(join(outputDir, 'current'))).toMatch(/^dev-v(?:7|8)-/u);
      expect(readdirSync(outputDir).filter((name) => /^dev-v(?:7|8)-/u.test(name))).toHaveLength(2);
      expect(existsSync(join(outputDir, '.intexuraos-dev-secret-projection'))).toBe(false);
      expect(readdirSync(join(outputDir, '.sync-lock'))).toEqual([]);
    }
  );

  it.each([
    [
      'missing projected version',
      (envrcPath: string): void => {
        writeFileSync(
          envrcPath,
          readFileSync(envrcPath, 'utf8').replace(
            /^export INTEXURAOS_SECRET_PACKAGE_VERSION=.*\n/mu,
            ''
          ),
          { mode: 0o600 }
        );
      },
    ],
    [
      'wrong projected version',
      (envrcPath: string): void => {
        writeFileSync(
          envrcPath,
          readFileSync(envrcPath, 'utf8').replace(
            /^export INTEXURAOS_SECRET_PACKAGE_VERSION=.*$/mu,
            'export INTEXURAOS_SECRET_PACKAGE_VERSION=999'
          ),
          { mode: 0o600 }
        );
      },
    ],
    [
      'missing package env member',
      (envrcPath: string): void => {
        writeFileSync(
          envrcPath,
          readFileSync(envrcPath, 'utf8').replace(
            /^export INTEXURAOS_OPENROUTER_APP_API_KEY=.*\n/mu,
            ''
          ),
          { mode: 0o600 }
        );
      },
    ],
    [
      'mismatched package env member',
      (envrcPath: string): void => {
        writeFileSync(
          envrcPath,
          readFileSync(envrcPath, 'utf8').replace(
            /^export INTEXURAOS_OPENROUTER_APP_API_KEY=.*$/mu,
            "export INTEXURAOS_OPENROUTER_APP_API_KEY='mismatched-value'"
          ),
          { mode: 0o600 }
        );
      },
    ],
    [
      'GitHub key inconsistent with metadata',
      (_envrcPath: string, candidatePackageDir: string): void => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        writeFileSync(
          join(candidatePackageDir, 'github-app-private-key.pem'),
          privateKey.export({ format: 'pem', type: 'pkcs8' }),
          { mode: 0o600 }
        );
      },
    ],
    [
      'metadata env membership inconsistent with the package',
      (_envrcPath: string, candidatePackageDir: string): void => {
        const metadataPath = join(candidatePackageDir, 'metadata.json');
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as { envNames: string[] };
        metadata.envNames = metadata.envNames.slice(1);
        writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
      },
    ],
  ] as const)(
    'rejects a staged DEV projection with %s before changing current',
    (_label, corruptCandidate) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-invalid-projection-'));
      const packageOutputDir = join(tempRoot, 'active-projection');
      const outputPath = join(tempRoot, '.envrc');
      const githubKeyOutput = join(tempRoot, 'github-app.pem');
      const activePayloadPath = join(tempRoot, 'payload-v7.json');
      const candidatePayloadPath = join(tempRoot, 'payload-v8.json');
      const candidateEnvrcSource = join(tempRoot, 'candidate-source.envrc');
      const candidateKeySource = join(tempRoot, 'candidate-source-key.pem');
      const candidateProjection = join(tempRoot, 'candidate-projection');
      const candidateEnvrc = join(tempRoot, 'candidate.envrc');
      const candidatePackageRoot = join(tempRoot, 'candidate-package');
      const activeCandidate = makeDevSecretPackagePayload();
      const replacementCandidate = makeDevSecretPackagePayload();
      writeFileSync(activePayloadPath, JSON.stringify(activeCandidate.payload), { mode: 0o600 });
      writeFileSync(candidatePayloadPath, JSON.stringify(replacementCandidate.payload), {
        mode: 0o600,
      });
      expect(
        syncDevPackage({
          githubKeyOutput,
          outputPath,
          packageOutputDir,
          payloadPath: activePayloadPath,
          tempRoot,
          version: '7',
        }).status
      ).toBe(0);
      expect(
        syncDevPackage({
          githubKeyOutput: candidateKeySource,
          outputPath: candidateEnvrcSource,
          packageOutputDir: candidateProjection,
          payloadPath: candidatePayloadPath,
          tempRoot,
          version: '8',
        }).status
      ).toBe(0);
      const candidateRender = spawnSync(
        process.execPath,
        [
          secretPackageCliPath,
          'render',
          '--environment',
          'dev',
          '--version',
          '8',
          '--project-id',
          'test-project',
          '--output-dir',
          candidatePackageRoot,
          '--payload-file',
          candidatePayloadPath,
        ],
        { cwd: repoRoot, encoding: 'utf8' }
      );
      expect(candidateRender).toMatchObject({ status: 0, stderr: '' });
      copyFileSync(candidateEnvrcSource, candidateEnvrc);
      const candidatePackageDir = resolve(
        candidatePackageRoot,
        readlinkSync(join(candidatePackageRoot, 'current'))
      );
      corruptCandidate(candidateEnvrc, candidatePackageDir);
      const activeTarget = readlinkSync(join(packageOutputDir, 'current'));

      const promotion = spawnSync(
        process.execPath,
        [
          devSecretProjectionPath,
          '--candidate-envrc',
          candidateEnvrc,
          '--candidate-package-dir',
          candidatePackageDir,
          '--envrc-output',
          outputPath,
          '--github-key-output',
          githubKeyOutput,
          '--package-output-dir',
          packageOutputDir,
          '--version',
          '8',
        ],
        { cwd: repoRoot, encoding: 'utf8' }
      );

      expect(promotion.status).not.toBe(0);
      expect(promotion.stderr).toContain('DEV secret projection promotion failed');
      expect(readlinkSync(join(packageOutputDir, 'current'))).toBe(activeTarget);
      expectCompleteDevProjection({
        expectedPrivateKeyPem: activeCandidate.privateKeyPem,
        expectedVersion: '7',
        githubKeyOutput,
        outputPath,
        packageOutputDir,
      });
    },
    30_000
  );

  it('uses one exact PROD package and renders every required runtime file', () => {
    const script = readFileSync(loadSecretsPath, 'utf8');
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, 'config/environments/secret-packages.json'), 'utf8')
    ) as {
      packages: { prod: { envNames: string[]; files: string[]; secretId: string } };
    };

    expect(manifest.packages.prod.secretId).toBe('INTEXURAOS_SECRET_PACKAGE_PROD');
    expect(manifest.packages.prod.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(manifest.packages.prod.files).toEqual([
      'cloudflareDnsApiTokenBase64',
      'runtimeGcpServiceAccountJsonBase64',
      'tlsPrivateKeyPemBase64',
    ]);
    expect(script).toContain('scripts/secret-package.mjs');
    expect(script).toContain('--environment prod');
    expect(script).toContain('--version "${SECRET_PACKAGE_VERSION}"');
    expect(script).toContain('--output-dir "${SECRET_PACKAGE_RENDER_DIR}"');
    expect(script).toContain('render-runtime-config.mjs');
    expect(script).toContain('runtime-gcp-service-account.json');
    expect(script).toContain('cloudflare-dns-api-token');
    expect(script).toContain('tls-private-key.pem');
    expect(script).not.toContain('HETZNER_RUNTIME_SECRETS');
    expect(script).not.toContain('--secret');
    expect(script).not.toContain('versions/latest');
    expect(script).not.toContain('gcloud secrets versions access');
  });

  it(
    'renders and atomically publishes a complete offline PROD package projection',
    { timeout: 30_000 },
    () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-package-'));
      const outputPath = join(tempRoot, '.env.prod');
      const renderDir = join(tempRoot, 'package-render');
      const projectionDir = join(tempRoot, 'projections');
      const payloadPath = join(tempRoot, 'payload.json');
      const runtimeKeyPath = join(tempRoot, 'runtime-sa-key.json');
      const internalAuthTokenPath = join(tempRoot, 'internal-auth-token');
      const cloudflareCredentialsPath = join(tempRoot, 'cloudflare.ini');
      const tlsPrivateKeyPath = join(tempRoot, 'tls-private-key.pem');
      const { cloudflareDnsToken, payload, runtimeServiceAccount, tlsPrivateKeyPem } =
        makeProdSecretPackagePayload();
      writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

      const result = spawnSync(
        'bash',
        [
          loadSecretsPath,
          '--version',
          '17',
          '--project-id',
          'intexuraos-dev-pbuchman',
          '--output',
          outputPath,
          '--render-dir',
          renderDir,
          '--payload-file',
          payloadPath,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            INTEXURAOS_ENVIRONMENT: 'prod',
            INTEXURAOS_COMMIT_SHA: 'a'.repeat(40),
            SKIP_OWNERSHIP: '1',
            SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
            PROVISIONER_SA_KEY_FILE: join(tempRoot, 'missing-provisioner-key.json'),
            RUNTIME_SA_KEY_FILE: runtimeKeyPath,
            INTERNAL_AUTH_TOKEN_FILE: internalAuthTokenPath,
            CLOUDFLARE_CREDENTIALS_FILE: cloudflareCredentialsPath,
            PACKAGE_METADATA_FILE: join(tempRoot, 'package-metadata.json'),
            SECRET_PACKAGE_LOCK_FILE: join(tempRoot, 'loader.lock'),
            SECRET_PROJECTION_ROOT: projectionDir,
            TLS_PRIVATE_KEY_FILE: tlsPrivateKeyPath,
            TMPDIR: tempRoot,
          },
        }
      );

      expect(result.status, result.stderr).toBe(0);
      const published = parse(readFileSync(outputPath, 'utf8'));
      const packageEnvironment = (payload.env ?? {}) as Record<string, string>;
      const trackedConfig = {
        ...(JSON.parse(
          readFileSync(resolve(repoRoot, 'config/environments/common.json'), 'utf8')
        ) as Record<string, string>),
        ...(JSON.parse(
          readFileSync(resolve(repoRoot, 'config/environments/prod.json'), 'utf8')
        ) as Record<string, string>),
      };

      for (const [name, value] of Object.entries(trackedConfig)) {
        expect(published[name], name).toBe(value);
      }
      for (const [name, value] of Object.entries(packageEnvironment)) {
        expect(published[name], name).toBe(value);
      }
      expect(published['INTEXURAOS_FIREBASE_API_KEY']).toBe(
        packageEnvironment['INTEXURAOS_FIREBASE_API_KEY']
      );
      expect(published['INTEXURAOS_SECRET_PACKAGE_VERSION']).toBe('17');
      expect(readFileSync(internalAuthTokenPath, 'utf8')).toBe(
        packageEnvironment['INTEXURAOS_INTERNAL_AUTH_TOKEN']
      );
      expect(JSON.parse(readFileSync(runtimeKeyPath, 'utf8'))).toEqual(runtimeServiceAccount);
      expect(readFileSync(cloudflareCredentialsPath, 'utf8')).toBe(
        `dns_cloudflare_api_token = ${cloudflareDnsToken}\n`
      );
      expect(readFileSync(tlsPrivateKeyPath, 'utf8')).toBe(tlsPrivateKeyPem);
      expect(lstatSync(join(renderDir, 'current')).isSymbolicLink()).toBe(true);
      expect(existsSync(projectionDir)).toBe(false);
      for (const [path, mode] of [
        [outputPath, 0o600],
        [runtimeKeyPath, 0o600],
        [internalAuthTokenPath, 0o640],
        [cloudflareCredentialsPath, 0o600],
        [tlsPrivateKeyPath, 0o600],
      ] as const) {
        expect(lstatSync(path).isSymbolicLink(), path).toBe(false);
        expect(statSync(path).mode & 0o777, path).toBe(mode);
      }
      expect(result.stdout).toContain('Activated PROD secret package version 17');
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        packageEnvironment['INTEXURAOS_INTERNAL_AUTH_TOKEN']
      );
    }
  );

  it('preserves every stable production artifact when package validation fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-package-failure-'));
    const outputPath = join(tempRoot, '.env.prod');
    const runtimeKeyPath = join(tempRoot, 'runtime-sa-key.json');
    const internalAuthTokenPath = join(tempRoot, 'internal-auth-token');
    const cloudflareCredentialsPath = join(tempRoot, 'cloudflare.ini');
    const tlsPrivateKeyPath = join(tempRoot, 'tls-private-key.pem');
    const payloadPath = join(tempRoot, 'invalid-payload.json');
    const { payload } = makeProdSecretPackagePayload();
    delete ((payload.files ?? {}) as Record<string, unknown>).tlsPrivateKeyPemBase64;
    writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });
    const previousArtifacts = new Map([
      [outputPath, 'PREVIOUS_ENV=complete\n'],
      [runtimeKeyPath, '{"previous":true}\n'],
      [internalAuthTokenPath, 'previous-internal-token'],
      [cloudflareCredentialsPath, 'previous-cloudflare-token\n'],
      [tlsPrivateKeyPath, 'previous-tls-key\n'],
    ]);
    for (const [path, contents] of previousArtifacts) {
      writeFileSync(path, contents, { mode: path === internalAuthTokenPath ? 0o640 : 0o600 });
    }

    const result = spawnSync(
      'bash',
      [
        loadSecretsPath,
        '--version',
        '18',
        '--output',
        outputPath,
        '--render-dir',
        join(tempRoot, 'package-render'),
        '--payload-file',
        payloadPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          INTEXURAOS_ENVIRONMENT: 'prod',
          INTEXURAOS_COMMIT_SHA: 'a'.repeat(40),
          SKIP_OWNERSHIP: '1',
          SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
          PROVISIONER_SA_KEY_FILE: join(tempRoot, 'missing-provisioner-key.json'),
          RUNTIME_SA_KEY_FILE: runtimeKeyPath,
          INTERNAL_AUTH_TOKEN_FILE: internalAuthTokenPath,
          CLOUDFLARE_CREDENTIALS_FILE: cloudflareCredentialsPath,
          PACKAGE_METADATA_FILE: join(tempRoot, 'package-metadata.json'),
          SECRET_PACKAGE_LOCK_FILE: join(tempRoot, 'loader.lock'),
          SECRET_PROJECTION_ROOT: join(tempRoot, 'projections'),
          TLS_PRIVATE_KEY_FILE: tlsPrivateKeyPath,
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to render PROD package');
    for (const [path, contents] of previousArtifacts) {
      expect(lstatSync(path).isSymbolicLink(), path).toBe(false);
      expect(readFileSync(path, 'utf8'), path).toBe(contents);
    }
  });

  it('loads only the Grafana token from the rendered DEV package', () => {
    const script = readFileSync(loadGrafanaEnvPath, 'utf8');
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-grafana-success-'));
    const renderDir = join(tempRoot, 'rendered');
    const currentDir = join(renderDir, 'current');
    const outputPath = join(tempRoot, 'grafana-cloud.env');
    const token = 'grafana-token-that-must-not-be-logged';
    const unrelated = 'unrelated-secret-that-must-not-be-copied';
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(
      join(currentDir, 'environment.env'),
      [
        `INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN=${JSON.stringify(token)}`,
        `INTEXURAOS_UNRELATED_SECRET=${JSON.stringify(unrelated)}`,
        '',
      ].join('\n'),
      { mode: 0o600 }
    );

    const result = spawnSync('bash', [loadGrafanaEnvPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        INTEXURAOS_ENVIRONMENT: 'dev',
        OUTPUT_FILE: outputPath,
        SECRET_PACKAGE_RENDER_DIR: renderDir,
        TMPDIR: tempRoot,
      },
    });

    expect(script).toContain('SECRET_PACKAGE_RENDER_DIR');
    expect(script).toContain('current/environment.env');
    expect(script).toContain('render-runtime-config.mjs');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_URL');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN');
    expect(script).not.toContain('gcloud');
    expect(script).not.toContain('Secret Manager');
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    expect(`${result.stdout}${result.stderr}`).not.toContain(unrelated);
    const output = parse(readFileSync(outputPath, 'utf8'));
    expect(Object.keys(output).sort()).toEqual([
      'INTEXURAOS_ENVIRONMENT',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
    ]);
    expect(output['INTEXURAOS_ENVIRONMENT']).toBe('dev');
    expect(output['INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN']).toBe(token);
    expect(output).not.toHaveProperty('INTEXURAOS_UNRELATED_SECRET');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('preserves the previous Grafana env when the rendered DEV token is missing', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-grafana-'));
    const renderDir = join(tempRoot, 'rendered');
    const currentDir = join(renderDir, 'current');
    const outputPath = join(tempRoot, 'grafana-cloud.env');
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(
      join(currentDir, 'environment.env'),
      'INTEXURAOS_UNRELATED_SECRET="do-not-use"\n',
      { mode: 0o600 }
    );
    writeFileSync(outputPath, 'PREVIOUS=complete\n', { mode: 0o600 });

    const result = spawnSync('bash', [loadGrafanaEnvPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        INTEXURAOS_ENVIRONMENT: 'dev',
        OUTPUT_FILE: outputPath,
        SECRET_PACKAGE_RENDER_DIR: renderDir,
        TMPDIR: tempRoot,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN');
    expect(`${result.stdout}${result.stderr}`).not.toContain('do-not-use');
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS=complete\n');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('takes the Firebase web build input from the PROD package environment', () => {
    const script = readFileSync(deployWebPath, 'utf8');
    const { payload } = makeProdSecretPackagePayload();
    const packageEnvironment = (payload.env ?? {}) as Record<string, string>;
    expect(script).toContain('WEB_BUILD_ENV_KEYS=(');
    expect(script).not.toContain('WEB_SAFE_SECRETS');
    expect(script).toContain('const { parse } = require("dotenv")');
    expect(script).not.toContain('function unquote');
    expect(script).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(script).toContain('INTEXURAOS_FIREBASE_PROJECT_ID');

    const rendered = execFileSync(
      process.execPath,
      [
        resolve(repoRoot, 'scripts/render-runtime-config.mjs'),
        '--environment',
        'prod',
        '--format',
        'dotenv',
        '--key',
        'INTEXURAOS_AUTH0_DOMAIN',
        '--key',
        'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const parsed = parse(rendered);
    const commonConfig = JSON.parse(
      readFileSync(resolve(repoRoot, 'config/environments/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(commonConfig).not.toHaveProperty('INTEXURAOS_FIREBASE_API_KEY');
    expect(parsed).not.toHaveProperty('INTEXURAOS_FIREBASE_API_KEY');
    expect(packageEnvironment['INTEXURAOS_FIREBASE_API_KEY']).toMatch(/^AIza[A-Za-z0-9_-]{35}$/u);
    expect(parsed['INTEXURAOS_AUTH0_DOMAIN']).toBe(commonConfig['INTEXURAOS_AUTH0_DOMAIN']);
    expect(parsed['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY']).toBe(
      commonConfig['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY']
    );
  });

  it('keeps ecosystem mappings source-agnostic after config and secrets are merged', () => {
    const dev = readFileSync(resolve(repoRoot, 'ecosystem.config.cjs'), 'utf8');
    const prod = readFileSync(resolve(repoRoot, 'ecosystem.config.prod.cjs'), 'utf8');

    expect(dev).toContain('Common auth runtime environment for all services');
    expect(prod).toContain('SERVICE_RUNTIME_ENV_KEYS');
    expect(prod).not.toContain('SERVICE_SECRET_KEYS');
    expect(prod).not.toContain('INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI');
    expect(dev).not.toContain('INTEXURAOS_GEMINI_APP_API_KEY');
    expect(prod).not.toContain('INTEXURAOS_GEMINI_APP_API_KEY');
    expect(readFileSync(localEnvExamplePath, 'utf8')).not.toContain(
      'INTEXURAOS_GEMINI_APP_API_KEY'
    );
    expect(dev).toContain('or:google/gemma-4-31b-it,or:deepseek/deepseek-v4-flash');
    for (const serviceName of [
      'calendar-agent',
      'hellscript-agent',
      'linear-agent',
      'research-agent',
      'web-agent',
    ]) {
      const serviceSection = dev.split(`'${serviceName}': {`)[1]?.split('\n  },')[0] ?? '';
      expect(serviceSection, serviceName).toContain('INTEXURAOS_OPENROUTER_APP_API_KEY');
    }
    expect(readFileSync(loadSecretsPath, 'utf8')).not.toContain(
      'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI'
    );
    expect(
      readFileSync(resolve(repoRoot, 'config/environments/common.json'), 'utf8')
    ).not.toContain('INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI');
    expect(readFileSync(resolve(repoRoot, 'config/environments/dev.json'), 'utf8')).not.toContain(
      'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI'
    );
    expect(readFileSync(resolve(repoRoot, 'config/environments/prod.json'), 'utf8')).not.toContain(
      'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI'
    );
  });
});

describe('orchestrator environment generator', () => {
  it('writes only the explicit orchestrator allowlist with mode 600', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-env-'));
    const outputPath = join(tempRoot, 'env');
    execFileSync(
      process.execPath,
      [generateOrchestratorEnvPath, '--output', outputPath, '--user-home', tempRoot],
      {
        cwd: repoRoot,
        env: {
          ...validOrchestratorEnvironment(),
          GOOGLE_APPLICATION_CREDENTIALS: join(tempRoot, '.config/gcloud/broad-admin-key.json'),
          INTEXURAOS_WHATSAPP_ACCESS_TOKEN: 'must-not-leak',
          INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: 'must-not-leak-either',
          INTEXURAOS_GEMINI_APP_API_KEY: 'retired-key-must-not-leak',
        },
        stdio: 'pipe',
      }
    );

    const generated = parse(readFileSync(outputPath, 'utf8'));
    expect(generated['INTEXURAOS_REPOSITORY_URL']).toBe(
      'https://github.com/example/intexuraos.git'
    );
    expect(generated['INTEXURAOS_INTERNAL_AUTH_TOKEN']).toBe('internal-token');
    expect(generated['INTEXURAOS_GITHUB_APP_ID']).toBe('123');
    expect(generated['INTEXURAOS_PROJECT_ID']).toBe('test-project');
    expect(generated['GOOGLE_APPLICATION_CREDENTIALS']).toBe(
      join(tempRoot, '.config/intexuraos/home-orchestrator-sa-key.json')
    );
    expect(generated['INTEXURAOS_REPOSITORY_PATH']).toBe(join(tempRoot, '.code-orchestrator/repo'));
    expect(generated['INTEXURAOS_RUNTIME']).toBe('dev');
    expect(generated['PORT']).toBe('8199');
    expect(generated['INTEXURAOS_WORKER_CAPACITY']).toBe('3');
    expect(generated['INTEXURAOS_WHATSAPP_ACCESS_TOKEN']).toBeUndefined();
    expect(generated['INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET']).toBeUndefined();
    expect(generated['INTEXURAOS_GEMINI_APP_API_KEY']).toBeUndefined();
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it.each([
    'home-dev.example.ts.net',
    'home-dev.example.ts.net:443',
    'errors.intexuraos.cloud:8443',
    'https://home-dev.example.ts.net:8443',
    'home-dev.example.ts.net:8443/path',
    'user@home-dev.example.ts.net:8443',
  ])('rejects a non-private Error Hub endpoint without exposing it: %s', (rejectedHost) => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-env-error-hub-'));
    const outputPath = join(tempRoot, 'env');
    writeFileSync(outputPath, 'PREVIOUS=complete\n', { mode: 0o600 });

    const result = spawnSync(
      process.execPath,
      [generateOrchestratorEnvPath, '--output', outputPath, '--user-home', tempRoot],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: validOrchestratorEnvironment({ INTEXURAOS_ERROR_HUB_HOST: rejectedHost }),
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('INTEXURAOS_ERROR_HUB_HOST');
    expect(`${result.stdout}${result.stderr}`).not.toContain(rejectedHost);
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS=complete\n');
  });

  it('fails closed without replacing the previous env file or printing values', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-env-fail-'));
    const outputPath = join(tempRoot, 'env');
    writeFileSync(outputPath, 'PREVIOUS=complete\n', { mode: 0o600 });
    const sensitiveSentinel = 'value-that-must-not-be-logged';

    const result = spawnSync(
      process.execPath,
      [generateOrchestratorEnvPath, '--output', outputPath, '--user-home', tempRoot],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          INTEXURAOS_INTERNAL_AUTH_TOKEN: sensitiveSentinel,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(sensitiveSentinel);
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS=complete\n');
    expect(basename(outputPath)).toBe('env');
  });

  it('requires the platform OpenRouter key before replacing the orchestrator env file', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-env-openrouter-'));
    const outputPath = join(tempRoot, 'env');
    writeFileSync(outputPath, 'PREVIOUS=complete\n', { mode: 0o600 });
    const environment = validOrchestratorEnvironment();
    delete environment['INTEXURAOS_OPENROUTER_APP_API_KEY'];

    const result = spawnSync(
      process.execPath,
      [generateOrchestratorEnvPath, '--output', outputPath, '--user-home', tempRoot],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: environment,
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('INTEXURAOS_OPENROUTER_APP_API_KEY');
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS=complete\n');
  });
});

describe('runtime configuration documentation', () => {
  it('defines the repo-versus-Secret-Manager rule and the generated orchestrator flow', () => {
    const policyRunbook = readFileSync(
      resolve(repoRoot, 'docs/operations/runtime-configuration.md'),
      'utf8'
    );
    const localSetup = readFileSync(
      resolve(repoRoot, 'docs/setup/05-local-dev-with-gcp-deps.md'),
      'utf8'
    );
    const orchestratorReadme = readFileSync(
      resolve(repoRoot, 'workers/orchestrator/README.md'),
      'utf8'
    );
    expect(policyRunbook).toContain('belong in exactly one environment package');
    expect(policyRunbook).toContain('INTEXURAOS_SECRET_PACKAGE_DEV');
    expect(policyRunbook).toContain('INTEXURAOS_SECRET_PACKAGE_PROD');
    expect(policyRunbook).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(policyRunbook).toContain('config/environments/policy.json');
    expect(policyRunbook).toContain('./secret-exposure-final-cutover-plan.md');
    expect(localSetup).toContain('../operations/runtime-configuration.md');
    expect(orchestratorReadme).toContain('scripts/generate-orchestrator-env.mjs');
    expect(orchestratorReadme).toContain('SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS=');
    expect(orchestratorReadme).not.toMatch(
      /^GOOGLE_APPLICATION_CREDENTIALS=\/home\/pbuchman\/\.config\/intexuraos\/secret-renderer-sa-key\.json/gmu
    );
    expect(policyRunbook).toContain('HOME=/home/pbuchman');
    expect(policyRunbook).toContain(
      'SECRET_PACKAGE_RENDER_DIR=/home/pbuchman/.config/intexuraos/secret-packages/dev'
    );
    expect(orchestratorReadme).not.toContain("grep -E '^export INTEXURAOS_' .envrc");
  });
});
