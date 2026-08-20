import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const executableTemporaryDirectory = process.platform === 'linux' ? '/var/tmp' : tmpdir();
const loaderPath = resolve(repoRoot, 'scripts/hetzner/load-secrets.sh');
const runbookPath = resolve(repoRoot, 'docs/operations/hetzner-prod-runbook.md');
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
  lockPath: string;
  lockTracePath: string;
  fakeBin: string;
}

function mode(path: string): number {
  return statSync(path).mode & 0o7777;
}

function runtimeServiceAccount(): Record<string, string> {
  return {
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
  const serviceAccount = runtimeServiceAccount();
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
  const root = mkdtempSync(join(executableTemporaryDirectory, 'intexuraos-prod-package-'));
  const fakeBin = join(root, 'bin');
  const payloadPath = join(root, 'payload.json');
  const outputPath = join(root, 'stable', '.env.prod');
  const runtimePath = join(root, 'stable', 'runtime-sa-key.json');
  const internalPath = join(root, 'stable', 'internal-auth-token');
  const cloudflarePath = join(root, 'stable', 'cloudflare.ini');
  const tlsPath = join(root, 'stable', 'tls-private-key.pem');
  const lockPath = join(root, 'lock', 'prod-secret-package.lock');
  const lockTracePath = join(root, 'lock-trace');
  mkdirSync(fakeBin, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'stable'), { recursive: true, mode: 0o700 });
  chmodSync(join(root, 'stable'), 0o700);
  writeFileSync(payloadPath, JSON.stringify(packagePayload(marker)), { mode: 0o600 });
  writeFileSync(
    outputPath,
    [
      'INTEXURAOS_ENVIRONMENT=prod',
      'PROJECT_ID=intexuraos-dev-pbuchman',
      'GOOGLE_CLOUD_PROJECT=intexuraos-dev-pbuchman',
      `GOOGLE_APPLICATION_CREDENTIALS=${runtimePath}`,
      'INTEXURAOS_INTERNAL_AUTH_TOKEN=previous-internal-token',
      'PREVIOUS_ENV=complete',
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  writeFileSync(runtimePath, `${JSON.stringify(runtimeServiceAccount())}\n`, { mode: 0o600 });
  writeFileSync(internalPath, 'previous-internal-token', { mode: 0o640 });
  writeFileSync(cloudflarePath, 'dns_cloudflare_api_token = previous-cloudflare-token\n', {
    mode: 0o600,
  });
  writeFileSync(tlsPath, privateKeyPem, { mode: 0o600 });
  writeFileSync(
    join(fakeBin, 'flock'),
    [
      '#!/usr/bin/env python3',
      'import fcntl, os, sys, time',
      'arguments = sys.argv[1:]',
      'timeout = float(arguments[arguments.index("--wait") + 1])',
      'descriptor = int(arguments[-1])',
      'deadline = time.monotonic() + timeout',
      'while True:',
      '  try:',
      '    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)',
      '    break',
      '  except BlockingIOError:',
      '    if time.monotonic() >= deadline: sys.exit(1)',
      '    time.sleep(0.02)',
      'trace = os.environ.get("TEST_FLOCK_TRACE")',
      'if trace:',
      '  with open(trace, "a", encoding="utf8") as output: output.write("acquired\\n")',
      'marker = os.environ.get("TEST_FLOCK_ACQUIRED_MARKER")',
      'if marker:',
      '  with open(marker, "w", encoding="utf8") as output: output.write("acquired\\n")',
      'time.sleep(float(os.environ.get("TEST_FLOCK_HOLD_SECONDS", "0")))',
      '',
    ].join('\n'),
    { mode: 0o700 }
  );
  writeFileSync(
    join(fakeBin, 'timeout'),
    [
      '#!/usr/bin/env python3',
      'import subprocess, sys',
      'arguments = sys.argv[1:]',
      'while arguments and arguments[0].startswith("--"): arguments.pop(0)',
      'duration = float(arguments.pop(0))',
      'try:',
      '  result = subprocess.run(arguments, timeout=duration)',
      '  sys.exit(result.returncode)',
      'except subprocess.TimeoutExpired:',
      '  sys.exit(124)',
      '',
    ].join('\n'),
    { mode: 0o700 }
  );
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
    lockPath,
    lockTracePath,
    fakeBin,
  };
}

function runLoaderWithArgs(
  input: Fixture,
  args: string[],
  environment: Record<string, string> = {},
  options: { includePayload?: boolean } = {}
): ReturnType<typeof spawnSync> {
  const payloadArguments =
    options.includePayload === false ? [] : ['--payload-file', input.payloadPath];
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
      ...payloadArguments,
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
        PATH: `${input.fakeBin}:${process.env.PATH ?? ''}`,
        RUNTIME_SA_KEY_FILE: input.runtimePath,
        SECRET_PACKAGE_LOCK_FILE: input.lockPath,
        SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS: '2',
        SKIP_OWNERSHIP: '1',
        SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
        TLS_PRIVATE_KEY_FILE: input.tlsPath,
        TEST_FLOCK_TRACE: input.lockTracePath,
        TMPDIR: input.root,
        ...environment,
      },
    }
  );
}

function stagedRelease(input: Fixture, version = '8'): string {
  const staged = runLoader(input, version, ['--stage-only']);
  expect(staged.status, staged.stderr).toBe(0);
  const match = /^STAGED_PROJECTION_RELEASE_NAME=([A-Za-z0-9._-]+)$/mu.exec(staged.stdout);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

function runLoader(
  input: Fixture,
  version = '7',
  operationArgs: string[] = []
): ReturnType<typeof spawnSync> {
  return runLoaderWithArgs(input, ['--version', version, ...operationArgs]);
}

describe('transactional PROD secret-package loader', () => {
  it('documents the bounded host lock and network-independent rollback validation', () => {
    const runbook = readFileSync(runbookPath, 'utf8').replace(/\s+/gu, ' ');

    expect(runbook).toContain('/run/lock/intexuraos/prod-secret-package.lock');
    expect(runbook).toContain('30 seconds');
    expect(runbook).toContain('local, network-independent validation');
    expect(runbook).toContain('does not call an external API');
    expect(runbook).toContain('five-second connection timeout');
    expect(runbook).toContain('20-second total timeout');
    expect(runbook).toContain(
      'render root must be a non-symlink `root:root` directory with exact mode `0700`'
    );
    expect(runbook).toContain(
      'projection root must be a non-symlink `root:root` directory with exact mode `0711`'
    );
    expect(runbook).toContain('private mode-`0700` sibling staging directory');
    expect(runbook).toContain('--rollback legacy-pre-packages');
    expect(runbook).toContain('package manifest or tracked runtime config');
    expect(runbook).toContain('Online package fetch is bounded to 20 seconds by default');
    expect(runbook).toContain('token issuance is bounded to 15 seconds by default');
    expect(runbook).toContain(
      'attestation directory and version file must be non-symlink `root:root` objects'
    );
    expect(runbook).toContain('durable two-state transaction marker');
    expect(runbook).toContain('removes the marker last');
    expect(runbook).toContain('cannot leave an untracked secret backup');
    expect(runbook).toContain('fsyncs each of its six exact regular files');
    expect(runbook).toContain('cannot make `current` point at an unpersisted partial release');
  });

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
    expect(mode(join(input.root, 'stable'))).toBe(0o700);
    expect(mode(input.renderDir)).toBe(0o700);
    expect(mode(input.projectionDir)).toBe(0o711);
    expect(
      readFileSync(join(input.projectionDir, 'legacy-pre-packages', '.env.prod'), 'utf8')
    ).toContain('PREVIOUS_ENV=complete\n');
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

    const current = runLoaderWithArgs(input, ['--current-release'], {
      SECRET_PACKAGE_LOCK_FILE: 'ignored-for-read-only-operation',
      SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS: '0',
    });
    expect(current.status, current.stderr).toBe(0);
    expect(readFileSync(input.lockTracePath, 'utf8').trim().split('\n')).toHaveLength(5);
  }, 30_000);

  it('rolls the first package cutover back to a fully validated immutable legacy snapshot without network access', () => {
    const input = fixture('first-cutover');
    const legacyEnvironment = readFileSync(input.outputPath, 'utf8');
    const cutover = runLoader(input, '7');
    expect(cutover.status, cutover.stderr).toBe(0);
    const packageRelease = readlinkSync(join(input.projectionDir, 'current'));
    expect(packageRelease).toMatch(/^prod-v7-/u);

    const legacyMetadata = JSON.parse(
      readFileSync(join(input.projectionDir, 'legacy-pre-packages', 'metadata.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(legacyMetadata).toMatchObject({
      environment: 'prod',
      releaseName: 'legacy-pre-packages',
      schemaVersion: 1,
      snapshotType: 'pre-package-runtime',
    });

    const rollback = runLoaderWithArgs(input, ['--rollback', 'legacy-pre-packages'], {
      PROD_CANDIDATE_VALIDATOR: join(input.root, 'missing-candidate-validator'),
      RUNTIME_CONFIG_ROOT: join(input.root, 'missing-runtime-config'),
      SECRET_PACKAGE_MANIFEST: join(input.root, 'missing-secret-package-manifest'),
      SKIP_CLOUDFLARE_CREDENTIAL_SMOKE: '0',
      SKIP_RUNTIME_CREDENTIAL_SMOKE: '0',
    });
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe('legacy-pre-packages');
    expect(readFileSync(input.outputPath, 'utf8')).toBe(legacyEnvironment);
  }, 30_000);

  it('retries first-cutover legacy sealing after an interrupted private staging build', () => {
    const input = fixture('first-cutover');

    const interrupted = runLoaderWithArgs(input, ['--version', '7', '--stage-only'], {
      TEST_FAIL_LEGACY_SNAPSHOT_AFTER_COPY: '1',
    });
    expect(interrupted.status).not.toBe(0);
    expect(interrupted.stderr).toContain('Injected legacy production snapshot seal failure');
    expect(existsSync(join(input.projectionDir, 'legacy-pre-packages'))).toBe(false);
    expect(
      readdirSync(input.projectionDir).some((name) => name.startsWith('.legacy-staging.'))
    ).toBe(false);
    expect(existsSync(join(input.projectionDir, 'current'))).toBe(false);

    const retried = runLoader(input, '7', ['--stage-only']);
    expect(retried.status, retried.stderr).toBe(0);
    expect(statSync(join(input.projectionDir, 'legacy-pre-packages')).isDirectory()).toBe(true);
    expect(
      readdirSync(input.projectionDir).some((name) => name.startsWith('.legacy-staging.'))
    ).toBe(false);
  }, 30_000);

  it('reuses a complete durable candidate after interruption immediately after release publication', () => {
    const input = fixture('first-cutover');

    const interrupted = runLoaderWithArgs(input, ['--version', '7', '--stage-only'], {
      TEST_PROJECTION_PUBLISH_FAILPOINT: 'after-projection-release-durable',
    });

    expect(interrupted.status).not.toBe(0);
    expect(interrupted.stderr).toContain('Injected durable projection release publication failure');
    const releases = readdirSync(input.projectionDir).filter((name) => name.startsWith('prod-v7-'));
    expect(releases).toHaveLength(1);
    const releaseDir = join(input.projectionDir, releases[0] ?? 'missing');
    expect(readdirSync(releaseDir).sort()).toEqual(
      [
        '.env.prod',
        'cloudflare.ini',
        'internal-auth-token',
        'metadata.json',
        'runtime-sa-key.json',
        'tls-private-key.pem',
      ].sort()
    );
    expect(readdirSync(input.projectionDir).some((name) => name.startsWith('.staging.'))).toBe(
      false
    );
    expect(existsSync(join(input.projectionDir, 'current'))).toBe(false);

    const retried = runLoader(input, '7', ['--stage-only']);

    expect(retried.status, retried.stderr).toBe(0);
    expect(readdirSync(input.projectionDir).filter((name) => name.startsWith('prod-v7-'))).toEqual(
      releases
    );
  }, 30_000);

  it('rejects a modified legacy snapshot before offline rollback', () => {
    const input = fixture('first-cutover');
    const cutover = runLoader(input, '7');
    expect(cutover.status, cutover.stderr).toBe(0);
    const packageRelease = readlinkSync(join(input.projectionDir, 'current'));
    writeFileSync(
      join(input.projectionDir, 'legacy-pre-packages', 'internal-auth-token'),
      'tampered-legacy-token',
      { mode: 0o640 }
    );

    const rollback = runLoaderWithArgs(input, ['--rollback', 'legacy-pre-packages']);
    expect(rollback.status).not.toBe(0);
    expect(rollback.stderr).toContain('legacy snapshot validation failed');
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(packageRelease);
  }, 30_000);

  it.each([
    [
      'the same path',
      (input: Fixture): void => {
        input.renderDir = join(input.root, 'shared-storage');
        input.projectionDir = input.renderDir;
      },
    ],
    [
      'a projection descendant',
      (input: Fixture): void => {
        input.renderDir = join(input.root, 'shared-storage');
        input.projectionDir = join(input.renderDir, 'projection');
      },
    ],
    [
      'a render descendant',
      (input: Fixture): void => {
        input.projectionDir = join(input.root, 'shared-storage');
        input.renderDir = join(input.projectionDir, 'render');
      },
    ],
    [
      'a realpath alias through a symlinked ancestor',
      (input: Fixture): void => {
        const actualParent = join(input.root, 'actual-storage-parent');
        const aliasParent = join(input.root, 'storage-parent-alias');
        mkdirSync(actualParent, { mode: 0o700 });
        symlinkSync(actualParent, aliasParent);
        input.renderDir = join(actualParent, 'shared-storage');
        input.projectionDir = join(aliasParent, 'shared-storage');
      },
    ],
  ] as const)(
    'rejects storage roots with %s before rendering or pointer mutation',
    (_label, arrange) => {
      const input = fixture();
      arrange(input);
      const renderExisted = existsSync(input.renderDir);
      const projectionExisted = existsSync(input.projectionDir);

      const result = runLoader(input, '7', ['--stage-only']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('storage roots must be disjoint');
      expect(existsSync(input.renderDir)).toBe(renderExisted);
      expect(existsSync(input.projectionDir)).toBe(projectionExisted);
      expect(existsSync(join(input.renderDir, 'current'))).toBe(false);
      expect(existsSync(join(input.projectionDir, 'current'))).toBe(false);
    }
  );

  it.each([
    [
      'a permissive render root',
      (input: Fixture): string => {
        mkdirSync(input.renderDir, { mode: 0o755 });
        chmodSync(input.renderDir, 0o755);
        return input.renderDir;
      },
    ],
    [
      'a permissive projection root',
      (input: Fixture): string => {
        mkdirSync(input.projectionDir, { mode: 0o700 });
        chmodSync(input.projectionDir, 0o700);
        return input.projectionDir;
      },
    ],
    [
      'a render root with a special mode bit',
      (input: Fixture): string => {
        mkdirSync(input.renderDir, { mode: 0o700 });
        chmodSync(input.renderDir, 0o1700);
        return input.renderDir;
      },
    ],
    [
      'a projection root with a special mode bit',
      (input: Fixture): string => {
        mkdirSync(input.projectionDir, { mode: 0o711 });
        chmodSync(input.projectionDir, 0o1711);
        return input.projectionDir;
      },
    ],
    [
      'a symlinked render root',
      (input: Fixture): string => {
        const target = join(input.root, 'render-target');
        mkdirSync(target, { mode: 0o700 });
        symlinkSync(target, input.renderDir);
        return target;
      },
    ],
    [
      'a symlinked projection root',
      (input: Fixture): string => {
        const target = join(input.root, 'projection-target');
        mkdirSync(target, { mode: 0o711 });
        symlinkSync(target, input.projectionDir);
        return target;
      },
    ],
  ] as const)('rejects %s without repairing or mutating either storage tree', (_label, arrange) => {
    const input = fixture();
    const existingRoot = arrange(input);
    const sentinel = join(existingRoot, 'sentinel');
    writeFileSync(sentinel, 'must-remain-unchanged', { mode: 0o600 });
    const originalMode = mode(existingRoot);
    const originalEntries = readdirSync(existingRoot);

    const result = runLoader(input, '7', ['--stage-only']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('storage root is unsafe');
    expect(mode(existingRoot)).toBe(originalMode);
    expect(readdirSync(existingRoot)).toEqual(originalEntries);
    expect(readFileSync(sentinel, 'utf8')).toBe('must-remain-unchanged');
    expect(existsSync(join(input.renderDir, 'current'))).toBe(false);
    expect(existsSync(join(input.projectionDir, 'current'))).toBe(false);
  });

  it.each([
    [
      'a dangling render root',
      (input: Fixture): string => {
        const target = join(input.root, 'missing-render-target');
        symlinkSync(target, input.renderDir);
        return input.projectionDir;
      },
    ],
    [
      'a dangling projection root',
      (input: Fixture): string => {
        const target = join(input.root, 'missing-projection-target');
        symlinkSync(target, input.projectionDir);
        return input.renderDir;
      },
    ],
    [
      'a regular file as a render ancestor',
      (input: Fixture): string => {
        const ancestor = join(input.root, 'render-file-ancestor');
        writeFileSync(ancestor, 'not-a-directory', { mode: 0o600 });
        input.renderDir = join(ancestor, 'render');
        return input.projectionDir;
      },
    ],
  ] as const)('rejects %s without creating the other storage root', (_label, arrange) => {
    const input = fixture();
    const otherRoot = arrange(input);

    const result = runLoader(input, '7', ['--stage-only']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('storage root is unsafe');
    expect(existsSync(otherRoot)).toBe(false);
    expect(existsSync(join(input.projectionDir, 'current'))).toBe(false);
    expect(existsSync(join(input.renderDir, 'current'))).toBe(false);
  });

  it.each([
    [
      'release metadata version',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'metadata.json');
        const metadata = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(path, `${JSON.stringify({ ...metadata, version: '9' })}\n`, { mode: 0o600 });
      },
    ],
    [
      'dotenv package version',
      (releaseDir: string): void => {
        const path = join(releaseDir, '.env.prod');
        writeFileSync(
          path,
          readFileSync(path, 'utf8').replace(
            'INTEXURAOS_SECRET_PACKAGE_VERSION="8"',
            'INTEXURAOS_SECRET_PACKAGE_VERSION="9"'
          ),
          { mode: 0o600 }
        );
      },
    ],
    [
      'duplicate dotenv package version',
      (releaseDir: string): void => {
        const path = join(releaseDir, '.env.prod');
        writeFileSync(path, `${readFileSync(path, 'utf8')}INTEXURAOS_SECRET_PACKAGE_VERSION=8\n`, {
          mode: 0o600,
        });
      },
    ],
    [
      'runtime service-account project',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'runtime-sa-key.json');
        const credential = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(path, JSON.stringify({ ...credential, project_id: 'wrong-project' }), {
          mode: 0o600,
        });
      },
    ],
    [
      'runtime service-account type',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'runtime-sa-key.json');
        const credential = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(path, JSON.stringify({ ...credential, type: 'authorized_user' }), {
          mode: 0o600,
        });
      },
    ],
    [
      'runtime service-account email',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'runtime-sa-key.json');
        const credential = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(
          path,
          JSON.stringify({
            ...credential,
            client_email: 'wrong-runtime@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
          }),
          { mode: 0o600 }
        );
      },
    ],
    [
      'runtime service-account private key ID',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'runtime-sa-key.json');
        const credential = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(path, JSON.stringify({ ...credential, private_key_id: 'not-a-key-id' }), {
          mode: 0o600,
        });
      },
    ],
    [
      'runtime service-account private key',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'runtime-sa-key.json');
        const credential = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(path, JSON.stringify({ ...credential, private_key: 'not-a-private-key' }), {
          mode: 0o600,
        });
      },
    ],
    [
      'internal auth token format',
      (releaseDir: string): void => {
        writeFileSync(join(releaseDir, 'internal-auth-token'), 'contains whitespace', {
          mode: 0o640,
        });
      },
    ],
    [
      'Cloudflare credentials format',
      (releaseDir: string): void => {
        writeFileSync(join(releaseDir, 'cloudflare.ini'), 'token = wrong-setting\n', {
          mode: 0o600,
        });
      },
    ],
    [
      'TLS private key shape',
      (releaseDir: string): void => {
        writeFileSync(join(releaseDir, 'tls-private-key.pem'), 'not-a-private-key\n', {
          mode: 0o600,
        });
      },
    ],
    [
      'release file mode',
      (releaseDir: string): void => chmodSync(join(releaseDir, 'runtime-sa-key.json'), 0o640),
    ],
    [
      'release symlink',
      (releaseDir: string): void => {
        const path = join(releaseDir, 'runtime-sa-key.json');
        const replacement = join(releaseDir, 'runtime-sa-key-replacement.json');
        writeFileSync(replacement, readFileSync(path), { mode: 0o600 });
        rmSync(path);
        symlinkSync(replacement, path);
      },
    ],
  ] as const)(
    'rejects a locally corrupted %s before activation and keeps the previous release active',
    (_label, corrupt) => {
      const input = fixture('previous');
      const first = runLoader(input, '7');
      expect(first.status, first.stderr).toBe(0);
      const previousRelease = readlinkSync(join(input.projectionDir, 'current'));

      writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), {
        mode: 0o600,
      });
      const candidateRelease = stagedRelease(input);
      corrupt(join(input.projectionDir, candidateRelease));

      const activation = runLoaderWithArgs(input, ['--activate', candidateRelease]);
      expect(activation.status).not.toBe(0);
      expect(activation.stderr).toContain('local validation failed');
      expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(previousRelease);
    },
    30_000
  );

  it.each([
    ['activate', 'missing'],
    ['activate', 'extra'],
    ['activate', 'empty'],
    ['activate', 'duplicate export assignment'],
    ['rollback', 'missing'],
    ['rollback', 'extra'],
    ['rollback', 'empty'],
  ] as const)(
    'rejects %s when an arbitrary package member is %s and keeps the active pointer unchanged',
    (operation, corruption) => {
      const input = fixture('previous');
      const first = runLoader(input, '7');
      expect(first.status, first.stderr).toBe(0);
      const previousRelease = readlinkSync(join(input.projectionDir, 'current'));

      writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), {
        mode: 0o600,
      });
      const candidateRelease = stagedRelease(input);
      let targetRelease = candidateRelease;
      if (operation === 'rollback') {
        const activation = runLoaderWithArgs(input, ['--activate', candidateRelease]);
        expect(activation.status, activation.stderr).toBe(0);
        targetRelease = previousRelease;
      }
      const activeBefore = readlinkSync(join(input.projectionDir, 'current'));
      const environmentPath = join(input.projectionDir, targetRelease, '.env.prod');
      const environment = readFileSync(environmentPath, 'utf8');
      const memberName = 'INTEXURAOS_OPENAI_APP_API_KEY';
      const memberPattern = new RegExp(`^${memberName}=.*\\n`, 'mu');
      expect(environment).toMatch(memberPattern);
      const corrupted =
        corruption === 'missing'
          ? environment.replace(memberPattern, '')
          : corruption === 'empty'
            ? environment.replace(memberPattern, `${memberName}=\n`)
            : corruption === 'duplicate export assignment'
              ? `${environment}export ${memberName}='forbidden-override'\n`
              : `${environment}INTEXURAOS_UNEXPECTED_PACKAGE_MEMBER='forbidden'\n`;
      writeFileSync(environmentPath, corrupted, { mode: 0o600 });

      const result = runLoaderWithArgs(input, [`--${operation}`, targetRelease]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('local validation failed');
      expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(activeBefore);
    },
    30_000
  );

  it('requires package metadata envNames to exactly match the tracked PROD manifest', () => {
    const input = fixture('previous');
    const first = runLoader(input, '7');
    expect(first.status, first.stderr).toBe(0);
    const activeBefore = readlinkSync(join(input.projectionDir, 'current'));

    writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), { mode: 0o600 });
    const candidateRelease = stagedRelease(input);
    const metadataPath = join(input.projectionDir, candidateRelease, 'metadata.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      envNames: string[];
    };
    writeFileSync(
      metadataPath,
      `${JSON.stringify({
        ...metadata,
        envNames: metadata.envNames.filter((name) => name !== 'INTEXURAOS_OPENAI_APP_API_KEY'),
      })}\n`,
      { mode: 0o600 }
    );

    const activation = runLoaderWithArgs(input, ['--activate', candidateRelease]);
    expect(activation.status).not.toBe(0);
    expect(activation.stderr).toContain('local validation failed');
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(activeBefore);
  }, 30_000);

  it('performs the same complete local validation for offline rollback', () => {
    const input = fixture('previous');
    const first = runLoader(input, '7');
    expect(first.status, first.stderr).toBe(0);
    const previousRelease = readlinkSync(join(input.projectionDir, 'current'));

    writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), { mode: 0o600 });
    const second = runLoader(input, '8');
    expect(second.status, second.stderr).toBe(0);
    const candidateRelease = readlinkSync(join(input.projectionDir, 'current'));
    chmodSync(join(input.projectionDir, previousRelease, 'internal-auth-token'), 0o600);

    const rollback = runLoaderWithArgs(input, ['--rollback', previousRelease], {
      SKIP_CLOUDFLARE_CREDENTIAL_SMOKE: '0',
      SKIP_RUNTIME_CREDENTIAL_SMOKE: '0',
    });
    expect(rollback.status).not.toBe(0);
    expect(rollback.stderr).toContain('local validation failed');
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(candidateRelease);
    expect(existsSync(input.lockPath)).toBe(true);
    expect(mode(input.lockPath)).toBe(0o600);
    expect(mode(join(input.root, 'lock'))).toBe(0o700);
  }, 30_000);

  it('fails closed on a concurrent mutating loader instead of interleaving releases', async () => {
    const input = fixture();
    const acquiredMarker = join(input.root, 'first-lock-acquired');
    const child = spawn(
      'bash',
      [
        loaderPath,
        '--version',
        '7',
        '--stage-only',
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
        env: {
          ...process.env,
          CLOUDFLARE_CREDENTIALS_FILE: input.cloudflarePath,
          EXPECTED_RUNTIME_SA_EMAIL:
            'ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
          INTERNAL_AUTH_TOKEN_FILE: input.internalPath,
          INTEXURAOS_COMMIT_SHA: 'a'.repeat(40),
          INTEXURAOS_ENVIRONMENT: 'prod',
          PATH: `${input.fakeBin}:${process.env.PATH ?? ''}`,
          RUNTIME_SA_KEY_FILE: input.runtimePath,
          SECRET_PACKAGE_LOCK_FILE: input.lockPath,
          SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS: '2',
          SKIP_OWNERSHIP: '1',
          SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
          TEST_FLOCK_ACQUIRED_MARKER: acquiredMarker,
          TEST_FLOCK_HOLD_SECONDS: '3',
          TLS_PRIVATE_KEY_FILE: input.tlsPath,
          TMPDIR: input.root,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const firstOutput: Buffer[] = [];
    const firstError: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => firstOutput.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => firstError.push(chunk));
    await waitForFile(acquiredMarker);

    const concurrent = runLoader(input, '8', ['--stage-only']);
    expect(concurrent.status).not.toBe(0);
    expect(concurrent.stderr).toContain('host lock');

    const firstStatus = await new Promise<number | null>((resolvePromise) => {
      child.once('close', resolvePromise);
    });
    expect(firstStatus, Buffer.concat(firstError).toString('utf8')).toBe(0);
    expect(Buffer.concat(firstOutput).toString('utf8')).toContain(
      'STAGED_PROJECTION_RELEASE_NAME='
    );
    expect(
      readdirSync(input.projectionDir).filter((name) => name.startsWith('prod-v7-'))
    ).toHaveLength(1);
  }, 30_000);

  it('bounds a sleeping online gcloud fetch, releases the host lock, and preserves offline rollback', () => {
    const input = fixture('previous');
    const first = runLoader(input, '7');
    expect(first.status, first.stderr).toBe(0);
    writeFileSync(
      join(input.fakeBin, 'gcloud'),
      [
        '#!/usr/bin/env python3',
        'import os, time',
        'with open(os.environ["TEST_GCLOUD_MARKER"], "w", encoding="utf8") as output:',
        '  output.write("started\\n")',
        'time.sleep(10)',
        '',
      ].join('\n'),
      { mode: 0o700 }
    );
    const gcloudMarker = join(input.root, 'gcloud-started');

    const startedAt = Date.now();
    const timedOut = runLoaderWithArgs(
      input,
      ['--version', '8', '--stage-only'],
      {
        SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS: '1',
        TEST_GCLOUD_MARKER: gcloudMarker,
      },
      { includePayload: false }
    );
    const elapsedMilliseconds = Date.now() - startedAt;

    expect(timedOut.status).not.toBe(0);
    expect(timedOut.stderr).toContain('package fetch timed out');
    expect(existsSync(gcloudMarker)).toBe(true);
    expect(elapsedMilliseconds).toBeLessThan(4_000);

    const rollbackStartedAt = Date.now();
    const rollback = runLoaderWithArgs(input, ['--rollback', 'legacy-pre-packages'], {
      SKIP_CLOUDFLARE_CREDENTIAL_SMOKE: '0',
      SKIP_RUNTIME_CREDENTIAL_SMOKE: '0',
    });
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(Date.now() - rollbackStartedAt).toBeLessThan(3_000);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe('legacy-pre-packages');
  }, 30_000);

  it('rejects an unsafe host lock and an unbounded timeout before package mutation', () => {
    const linkedLock = fixture();
    mkdirSync(join(linkedLock.root, 'lock'), { mode: 0o700 });
    symlinkSync(linkedLock.payloadPath, linkedLock.lockPath);

    const unsafe = runLoader(linkedLock, '7', ['--stage-only']);
    expect(unsafe.status).not.toBe(0);
    expect(unsafe.stderr).toContain('host lock file is unsafe');
    expect(existsSync(linkedLock.projectionDir)).toBe(false);

    const invalidTimeout = fixture();
    const timed = runLoaderWithArgs(invalidTimeout, ['--version', '7', '--stage-only'], {
      SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS: '301',
    });
    expect(timed.status).not.toBe(0);
    expect(timed.stderr).toContain('between 1 and 300 seconds');
    expect(existsSync(invalidTimeout.projectionDir)).toBe(false);
  });

  it('keeps emergency rollback independent of external canaries and stale attestations', () => {
    const input = fixture('previous');
    chmodSync(join(input.root, 'stable'), 0o700);
    const first = runLoader(input, '7');
    expect(first.status, first.stderr).toBe(0);
    const previousRelease = readlinkSync(join(input.projectionDir, 'current'));

    writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), { mode: 0o600 });
    const candidate = runLoader(input, '8');
    expect(candidate.status, candidate.stderr).toBe(0);

    const rolledBack = runLoaderWithArgs(input, ['--rollback', previousRelease], {
      SKIP_CLOUDFLARE_CREDENTIAL_SMOKE: '0',
      SKIP_RUNTIME_CREDENTIAL_SMOKE: '0',
    });

    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(previousRelease);
  }, 30_000);

  it('observes a damaged active pointer so compensation can still restore the previous release', () => {
    const input = fixture('previous');
    const first = runLoader(input, '7');
    expect(first.status, first.stderr).toBe(0);
    const previousRelease = readlinkSync(join(input.projectionDir, 'current'));

    writeFileSync(input.payloadPath, JSON.stringify(packagePayload('candidate')), { mode: 0o600 });
    const candidate = runLoader(input, '8');
    expect(candidate.status, candidate.stderr).toBe(0);
    const candidateRelease = readlinkSync(join(input.projectionDir, 'current'));
    rmSync(join(input.projectionDir, candidateRelease, 'metadata.json'));

    const observed = runLoaderWithArgs(input, ['--current-release']);
    expect(observed.status, observed.stderr).toBe(0);
    expect(observed.stdout.trim()).toBe(candidateRelease);

    const rolledBack = runLoaderWithArgs(input, ['--rollback', previousRelease], {
      SKIP_CLOUDFLARE_CREDENTIAL_SMOKE: '0',
      SKIP_RUNTIME_CREDENTIAL_SMOKE: '0',
    });
    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe(previousRelease);
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
    expect(readFileSync(input.outputPath, 'utf8')).toContain('PREVIOUS_ENV=complete\n');
    expect(JSON.parse(readFileSync(input.runtimePath, 'utf8'))).toMatchObject({
      type: 'service_account',
      project_id: 'intexuraos-dev-pbuchman',
    });
    expect(readFileSync(input.internalPath, 'utf8')).toBe('previous-internal-token');
    expect(existsSync(join(input.projectionDir, '.stable-link-transaction.json'))).toBe(false);
  }, 30_000);

  it('recovers a committed stable-link transaction before removing durable secret backups', () => {
    const input = fixture('previous');
    const legacyEnvironment = readFileSync(input.outputPath, 'utf8');
    const markerPath = join(input.projectionDir, '.stable-link-transaction.json');
    const stableDirectory = join(input.root, 'stable');

    const interrupted = runLoaderWithArgs(input, ['--version', '7'], {
      TEST_STABLE_LINK_TRANSACTION_FAILPOINT: 'after-commit-before-backup-cleanup',
    });

    expect(interrupted.status).not.toBe(0);
    expect(interrupted.stderr).toContain('Stable production projection link transaction failed');
    const markerText = readFileSync(markerPath, 'utf8');
    expect(JSON.parse(markerText)).toMatchObject({ schemaVersion: 2, state: 'committed' });
    expect(markerText).not.toContain('previous-internal-token');
    expect(
      readdirSync(stableDirectory).filter((name) => name.includes('.package-backup-'))
    ).toHaveLength(5);
    for (const stablePath of [
      input.outputPath,
      input.runtimePath,
      input.internalPath,
      input.cloudflarePath,
      input.tlsPath,
    ]) {
      expect(lstatSync(stablePath).isSymbolicLink(), stablePath).toBe(true);
    }
    expect(readlinkSync(join(input.projectionDir, 'current'))).toBe('legacy-pre-packages');

    const recovered = runLoaderWithArgs(input, ['--rollback', 'legacy-pre-packages']);

    expect(recovered.status, recovered.stderr).toBe(0);
    expect(readFileSync(input.outputPath, 'utf8')).toBe(legacyEnvironment);
    expect(existsSync(markerPath)).toBe(false);
    expect(
      readdirSync(stableDirectory).filter((name) => name.includes('.package-backup-'))
    ).toHaveLength(0);
  }, 30_000);
});
