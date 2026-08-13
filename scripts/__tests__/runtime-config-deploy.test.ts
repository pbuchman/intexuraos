import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const syncSecretsPath = resolve(repoRoot, 'scripts/sync-secrets.sh');
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
    INTEXURAOS_MINIMAX_APP_API_KEY: 'minimax-token',
    INTEXURAOS_MIMO_APP_API_KEY: 'mimo-token',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: 'dashscope-token',
    INTEXURAOS_KIMI_APP_API_KEY: 'kimi-token',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'openrouter-token',
    INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
    ...overrides,
  };
}

function makePathThatFailsTheSecondMove(tempRoot: string): {
  counterPath: string;
  path: string;
} {
  const fakeBin = join(tempRoot, 'fake-bin');
  const counterPath = join(tempRoot, 'mv-count');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(
    join(fakeBin, 'mv'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'count=0',
      'if [[ -f "${SYNC_TEST_MV_COUNT_FILE}" ]]; then',
      '  count="$(<"${SYNC_TEST_MV_COUNT_FILE}")"',
      'fi',
      'count=$((count + 1))',
      'printf \'%s\\n\' "${count}" >"${SYNC_TEST_MV_COUNT_FILE}"',
      'if [[ "${count}" -eq 2 ]]; then',
      '  exit 71',
      'fi',
      'exec /bin/mv "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return { counterPath, path: `${fakeBin}:${process.env.PATH ?? ''}` };
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
  });

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
  });

  it('rolls back package current, .envrc, and GitHub PEM when publication fails after the first artifact', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-transaction-'));
    const outputPath = join(tempRoot, '.envrc');
    const packageOutputDir = join(tempRoot, 'packages');
    const githubKeyOutput = join(tempRoot, 'github-app.pem');
    const previousPayloadPath = join(tempRoot, 'payload-v7.json');
    const candidatePayloadPath = join(tempRoot, 'payload-v8.json');
    const previous = makeDevSecretPackagePayload();
    const candidate = makeDevSecretPackagePayload();
    writeFileSync(previousPayloadPath, JSON.stringify(previous.payload), { mode: 0o600 });
    writeFileSync(candidatePayloadPath, JSON.stringify(candidate.payload), { mode: 0o600 });

    const commonArgs = [
      syncSecretsPath,
      '--project-id',
      'test-project',
      '--output',
      outputPath,
      '--package-output-dir',
      packageOutputDir,
      '--github-app-key-output',
      githubKeyOutput,
    ];
    execFileSync('bash', [...commonArgs, '--version', '7', '--payload-file', previousPayloadPath], {
      cwd: repoRoot,
      env: { ...process.env, HOME: tempRoot, TMPDIR: tempRoot },
      stdio: 'pipe',
    });
    const previousCurrentTarget = readlinkSync(join(packageOutputDir, 'current'));
    const previousEnvrc = readFileSync(outputPath);
    const previousGithubKey = readFileSync(githubKeyOutput);
    const failingMove = makePathThatFailsTheSecondMove(tempRoot);

    const result = spawnSync(
      'bash',
      [...commonArgs, '--version', '8', '--payload-file', candidatePayloadPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: tempRoot,
          PATH: failingMove.path,
          SYNC_TEST_MV_COUNT_FILE: failingMove.counterPath,
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(failingMove.counterPath, 'utf8').trim()).toBe('2');
    expect(readlinkSync(join(packageOutputDir, 'current'))).toBe(previousCurrentTarget);
    expect(readFileSync(outputPath)).toEqual(previousEnvrc);
    expect(readFileSync(githubKeyOutput)).toEqual(previousGithubKey);
    expect(readFileSync(githubKeyOutput, 'utf8')).toBe(previous.privateKeyPem);
    expect(readFileSync(githubKeyOutput, 'utf8')).not.toBe(candidate.privateKeyPem);
  }, 30_000);

  it('removes newly published local artifacts when a first sync transaction fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-first-transaction-'));
    const outputPath = join(tempRoot, '.envrc');
    const packageOutputDir = join(tempRoot, 'packages');
    const githubKeyOutput = join(tempRoot, 'github-app.pem');
    const payloadPath = join(tempRoot, 'payload.json');
    const { payload } = makeDevSecretPackagePayload();
    const failingMove = makePathThatFailsTheSecondMove(tempRoot);
    writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });

    const result = spawnSync(
      'bash',
      [
        syncSecretsPath,
        '--version',
        '1',
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
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: tempRoot,
          PATH: failingMove.path,
          SYNC_TEST_MV_COUNT_FILE: failingMove.counterPath,
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(existsSync(join(packageOutputDir, 'current'))).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(githubKeyOutput)).toBe(false);
  }, 30_000);

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
          '--projection-dir',
          projectionDir,
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
      expect(lstatSync(join(projectionDir, 'current')).isSymbolicLink()).toBe(true);
      for (const [path, mode] of [
        [outputPath, 0o600],
        [runtimeKeyPath, 0o600],
        [internalAuthTokenPath, 0o640],
        [cloudflareCredentialsPath, 0o600],
        [tlsPrivateKeyPath, 0o600],
      ] as const) {
        expect(lstatSync(path).isSymbolicLink(), path).toBe(true);
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
        '--projection-dir',
        join(tempRoot, 'projections'),
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
          TLS_PRIVATE_KEY_FILE: tlsPrivateKeyPath,
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to fetch, verify, and render PROD package');
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
    const cleanupRunbook = readFileSync(
      resolve(repoRoot, 'docs/operations/runtime-secret-manager-cleanup.md'),
      'utf8'
    );

    expect(policyRunbook).toContain('belong in exactly one environment package');
    expect(policyRunbook).toContain('INTEXURAOS_SECRET_PACKAGE_DEV');
    expect(policyRunbook).toContain('INTEXURAOS_SECRET_PACKAGE_PROD');
    expect(policyRunbook).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(policyRunbook).toContain('config/environments/policy.json');
    expect(policyRunbook).toContain('./runtime-secret-manager-cleanup.md');
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

    expect(cleanupRunbook).toContain('0 add / 0 change / 396 destroy');
    expect(cleanupRunbook).toContain('| Secret Manager containers | 26 |');
    expect(cleanupRunbook).toContain('| Application secret-access IAM bindings | 324 |');
    expect(cleanupRunbook).toContain('| Hetzner secret-access IAM bindings | 42 |');
    expect(cleanupRunbook).toContain('| Firebase secret versions | 3 |');
    expect(cleanupRunbook).toContain('| Transcription Sentry rollback IAM binding | 1 |');
    expect(cleanupRunbook).toContain(
      '5c87082e4e1ae827fc067b77fd5a77425ace7e3d60c301fb2a9f03a3c737083c'
    );
    expect(cleanupRunbook).toContain('AccessSecretVersion');
    expect(cleanupRunbook).toContain('DATA_READ');
    expect(cleanupRunbook).toContain('T0');
    expect(cleanupRunbook).toContain('f9e4d21910a553405ea0b278fb59bc696c8ebe65');
    expect(cleanupRunbook).toContain('Older commits and old Terraform are prohibited');
    expect(cleanupRunbook).toContain('Recreating empty Secret Manager containers is not rollback');
    expect(cleanupRunbook).not.toContain('configScopes');
    expect(cleanupRunbook).toContain(
      '[.scopes.common[], .scopes.dev[], .scopes.prod[], .deleteOnlyNames[]] | unique[]'
    );
    expect(cleanupRunbook).toContain('Record `T0` immediately before Step 1 (merge)');
    expect(cleanupRunbook).toContain(
      'Every plan regeneration or deliberate read of a blocked secret invalidates and\nresets T0'
    );
    expect(cleanupRunbook).toContain('T0-pre-apply');
    expect(cleanupRunbook).toContain('protoPayload.resourceName=~');
    expect(cleanupRunbook).toContain('exhausts all result pages; do not add `--limit`');
    expect(cleanupRunbook).toContain('INTEXURAOS_INTERNAL_AUTH_TOKEN');
    expect(cleanupRunbook).toContain('INTEXURAOS_LINEAR_API_KEY');
    expect(cleanupRunbook).toContain(
      'ixos-hetzner-provisioner-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(cleanupRunbook).toContain(
      'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(cleanupRunbook).toContain(
      'ixos-transcription-fn-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
    );
    expect(cleanupRunbook).toContain('audit_blocked_secret_names()');
    expect(cleanupRunbook).toContain('audit_runtime_secret_set()');
    expect(cleanupRunbook).toContain('audit_unknown_secret_names()');
    expect(cleanupRunbook).toContain('prod-secret-names.txt');
    expect(cleanupRunbook).toContain('transcription-secret-names.txt');
    expect(cleanupRunbook).toContain("audit_runtime_secret_set \\\n  'prod-before-apply'");
    expect(cleanupRunbook).toContain("audit_runtime_secret_set \\\n  'home-dev-after-apply'");
    expect(cleanupRunbook).toContain("audit_runtime_secret_set \\\n  'prod-after-apply'");
    expect(cleanupRunbook).toContain("audit_runtime_secret_set \\\n  'transcription-after-apply'");
    expect(cleanupRunbook).toContain('Production reads exactly 28 allowlisted secrets');
    expect(cleanupRunbook).toContain('Home-dev sync reads\nall 37 policy-classified secrets');
    expect(cleanupRunbook).toContain('scripts/observability/load-grafana-cloud-env.sh');
    expect(cleanupRunbook).toContain('scripts/observability/install-grafana-alloy.sh');
    expect(cleanupRunbook).toContain('systemctl is-active --quiet alloy.service');
    expect(cleanupRunbook).toContain('target=transcription');
    expect(cleanupRunbook).toContain('gcloud functions describe');
    expect(cleanupRunbook).toContain('.state == "ACTIVE"');
    expect(cleanupRunbook).toContain('.serviceConfig.serviceAccountEmail == $principal');
    expect(cleanupRunbook).toContain('gcloud auth print-identity-token');
    expect(cleanupRunbook).toContain('__cold_start_probe__');
    expect(cleanupRunbook).toContain('test "${cleanup_transcription_status}" = \'404\'');
    expect(cleanupRunbook).toContain('resource.labels.revision_name');
    expect(cleanupRunbook).toContain('httpRequest.status=404');
    expect(cleanupRunbook).toContain('Manual `workflow_dispatch` has no SHA input');
    expect(cleanupRunbook).toContain('--ref development');
    expect(cleanupRunbook).toContain('headSha');
    expect(cleanupRunbook).toContain('gcloud secrets list');
    expect(cleanupRunbook).toContain('terraform -chdir=terraform/environments/dev state list');
    expect(cleanupRunbook).toContain('post-apply-targeted-noop.tfplan');
    expect(cleanupRunbook).toContain('approved=false');
    expect(cleanupRunbook).toContain('four unrelated updates');
    expect(cleanupRunbook).toContain('umask 077');
    expect(cleanupRunbook).toContain('test "$(stat -f \'%Lp\' "${cleanup_dir}")" = \'700\'');

    const gcloudCommands = cleanupRunbook
      .split('\n')
      .filter((line) => /^\s*(?:CLOUDSDK_[A-Z_]+=[^ ]+\s+)?gcloud\s/u.test(line));
    expect(gcloudCommands.length).toBeGreaterThanOrEqual(4);
    for (const command of gcloudCommands) {
      expect(command.trim()).toMatch(
        /^CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="\$\{cleanup_sa_key\}" gcloud\s/u
      );
    }

    const orderedSteps = [
      '1. Merge PR2',
      '2. Deploy PR2 To Production',
      '3. Apply The Saved Plan',
      '4. Cold-Sync And Restart home-dev',
      '5. Redeploy Production',
      '6. Verify Health And Audit',
    ];
    const positions = orderedSteps.map((step) => cleanupRunbook.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(cleanupRunbook.indexOf('Record `T0` immediately before Step 1 (merge)')).toBeLessThan(
      cleanupRunbook.indexOf('### 1. Merge PR2')
    );
  });
});
