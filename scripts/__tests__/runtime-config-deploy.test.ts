import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

const MIGRATED_CONFIG_NAMES = [
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_SPA_CLIENT_ID',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
  'INTEXURAOS_FIREBASE_API_KEY',
  'INTEXURAOS_FIREBASE_AUTH_DOMAIN',
  'INTEXURAOS_FIREBASE_PROJECT_ID',
  'INTEXURAOS_GITHUB_APP_ID',
  'INTEXURAOS_GITHUB_INSTALLATION_ID',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_ID',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
  'INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL',
  'INTEXURAOS_GRAFANA_CLOUD_LOKI_URL',
  'INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME',
  'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
  'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL',
  'INTEXURAOS_REPOSITORY_URL',
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_SENTRY_DSN_DEV',
  'INTEXURAOS_SENTRY_DSN_WEB',
] as const;

const DELETE_ONLY_NAMES = ['INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI'] as const;
const SECRET_MANAGER_BLOCKLIST = [...MIGRATED_CONFIG_NAMES, ...DELETE_ONLY_NAMES] as const;

function makeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function makeFakeSyncTools(root: string): { binDir: string; fetchLog: string } {
  const binDir = join(root, 'bin');
  const fetchLog = join(root, 'secret-fetches.txt');
  mkdirSync(binDir);
  makeExecutable(
    join(binDir, 'gcloud'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "config" ]]; then printf 'test-project\\n'; fi
`
  );
  makeExecutable(
    join(binDir, 'python3'),
    `#!/usr/bin/env bash
set -euo pipefail
[[ "\${FAIL_FETCH:-0}" != "1" ]] || exit 42
temp_dir="$3"
secrets_file="$4"
cp "\${secrets_file}" "\${FETCH_LOG:?}"
cp "\${secrets_file}" "\${temp_dir}/_existing.txt"
while IFS= read -r name; do
  [[ -n "\${name}" ]] || continue
  if [[ "\${name}" == "\${UNREADABLE_SECRET:-}" ]]; then
    printf 'unreadable' > "\${temp_dir}/\${name}.status"
  else
    printf 'present' > "\${temp_dir}/\${name}.status"
    printf 'secret-value-for-%s' "\${name}" > "\${temp_dir}/\${name}.value"
  fi
done < "\${secrets_file}"
printf '  fake fetch complete\\n'
`
  );
  return { binDir, fetchLog };
}

function basePath(binDir: string): string {
  return `${binDir}:${process.env.PATH ?? ''}`;
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
    INTEXURAOS_GEMINI_APP_API_KEY: 'gemini-token',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'openrouter-token',
    INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
    ...overrides,
  };
}

describe('runtime configuration cutover', () => {
  it('never disables TLS certificate or hostname verification during secret sync', () => {
    const script = readFileSync(syncSecretsPath, 'utf8');

    expect(script).not.toContain('CERT_NONE');
    expect(script).not.toMatch(/check_hostname\s*=\s*False/u);
    expect(script).toContain('ssl.create_default_context()');
  });

  it('syncs tracked dev config without reading migrated names from Secret Manager', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-sync-'));
    const outputPath = join(tempRoot, '.envrc');
    const { binDir, fetchLog } = makeFakeSyncTools(tempRoot);

    execFileSync(
      'bash',
      [syncSecretsPath, 'dev', '--project-id', 'test-project', '--output', outputPath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: basePath(binDir),
          FETCH_LOG: fetchLog,
          TMPDIR: tempRoot,
        },
        stdio: 'pipe',
      }
    );

    const envrc = readFileSync(outputPath, 'utf8');
    const fetchedNames = readFileSync(fetchLog, 'utf8').trim().split(/\r?\n/u);
    for (const name of SECRET_MANAGER_BLOCKLIST) {
      expect(fetchedNames, name).not.toContain(name);
    }
    expect(fetchedNames).toContain('INTEXURAOS_INTERNAL_AUTH_TOKEN');
    expect(envrc).not.toContain('export INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI=');
    expect(envrc).toContain('export INTEXURAOS_FIREBASE_API_KEY=');
    expect(
      envrc.split(/\r?\n/u).find((line) => line.startsWith('export INTEXURAOS_AUTH0_DOMAIN='))
    ).not.toContain('secret-value-for-');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(envrc.trimEnd()).toMatch(
      /# Load \.envrc\.local if exists \(for local dev overrides\)\n\[\[ -f \.envrc\.local \]\] && source \.envrc\.local \|\| true$/u
    );
  });

  it('keeps the previous .envrc intact when a secret fetch fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-atomic-'));
    const outputPath = join(tempRoot, '.envrc');
    const { binDir, fetchLog } = makeFakeSyncTools(tempRoot);
    writeFileSync(outputPath, 'previous-complete-file\n', { mode: 0o600 });

    const result = spawnSync(
      'bash',
      [syncSecretsPath, 'dev', '--project-id', 'test-project', '--output', outputPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: basePath(binDir),
          FETCH_LOG: fetchLog,
          FAIL_FETCH: '1',
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(outputPath, 'utf8')).toBe('previous-complete-file\n');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('keeps the previous .envrc intact when any secret is unreadable', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-unreadable-'));
    const outputPath = join(tempRoot, '.envrc');
    const { binDir, fetchLog } = makeFakeSyncTools(tempRoot);
    writeFileSync(outputPath, 'previous-complete-file\n', { mode: 0o600 });

    const result = spawnSync(
      'bash',
      [syncSecretsPath, 'dev', '--project-id', 'test-project', '--output', outputPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: basePath(binDir),
          FETCH_LOG: fetchLog,
          UNREADABLE_SECRET: 'INTEXURAOS_INTERNAL_AUTH_TOKEN',
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toContain('Left');
    expect(result.stdout).toContain('unchanged');
    expect(readFileSync(outputPath, 'utf8')).toBe('previous-complete-file\n');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('merges tracked prod config with only real Secret Manager values', () => {
    const script = readFileSync(loadSecretsPath, 'utf8');
    const runtimeSecrets = script
      .match(/HETZNER_RUNTIME_SECRETS=\(([\s\S]*?)\)/u)?.[1]
      ?.match(/INTEXURAOS_[A-Z0-9_]+/gu);
    expect(script).toContain('render-runtime-config.mjs');
    expect(script).toContain('--environment');
    expect(script).toContain('--format');
    expect(script).toContain('dotenv');
    expect(script).toContain('INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET');
    expect(script).not.toMatch(
      /HETZNER_RUNTIME_SECRETS=\([\s\S]*?INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI[\s\S]*?\)/u
    );
    expect(runtimeSecrets).toHaveLength(28);
    for (const name of SECRET_MANAGER_BLOCKLIST) {
      expect(runtimeSecrets, name).not.toContain(name);
    }
  });

  it('does not permit --secret to bypass the tracked-config policy', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-'));
    const binDir = join(tempRoot, 'bin');
    const gcloudLog = join(tempRoot, 'gcloud.log');
    mkdirSync(binDir);
    makeExecutable(
      join(binDir, 'gcloud'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${GCLOUD_LOG:?}"
printf 'must-not-be-read\\n'
`
    );

    const result = spawnSync(
      'bash',
      [
        loadSecretsPath,
        '--output',
        join(tempRoot, '.env.prod'),
        '--secret',
        'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: basePath(binDir),
          GCLOUD_LOG: gcloudLog,
          INTEXURAOS_ENVIRONMENT: 'prod',
          DEPLOY_USER: process.env.USER ?? 'p.buchman',
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('tracked runtime configuration');
    expect(() => readFileSync(gcloudLog, 'utf8')).toThrow();
  });

  it('preserves both production runtime files when a later secret fetch fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-rollback-'));
    const binDir = join(tempRoot, 'bin');
    const outputPath = join(tempRoot, '.env.prod');
    const internalAuthTokenPath = join(tempRoot, 'internal-auth-token');
    mkdirSync(binDir);
    writeFileSync(outputPath, 'PREVIOUS_ENV=complete\n', { mode: 0o600 });
    writeFileSync(internalAuthTokenPath, 'previous-internal-token', { mode: 0o640 });
    makeExecutable(
      join(binDir, 'gcloud'),
      `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *--secret=INTEXURAOS_INTERNAL_AUTH_TOKEN*) printf 'new-internal-token' ;;
  *--secret=INTEXURAOS_WHATSAPP_ACCESS_TOKEN*) exit 42 ;;
  *) exit 43 ;;
esac
`
    );
    makeExecutable(
      join(binDir, 'id'),
      '#!/usr/bin/env bash\nset -euo pipefail\n[[ "$1" == "-u" && "$2" == "test-deploy" ]]\n'
    );
    makeExecutable(
      join(binDir, 'getent'),
      '#!/usr/bin/env bash\nset -euo pipefail\n[[ "$1" == "group" && "$2" == "test-nginx" ]]\n'
    );
    makeExecutable(
      join(binDir, 'install'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-d" ]]; then
  mkdir -p "\${@: -1}"
else
  cp "\${@: -2:1}" "\${@: -1}"
fi
`
    );

    const result = spawnSync(
      'bash',
      [
        loadSecretsPath,
        '--output',
        outputPath,
        '--secret',
        'INTEXURAOS_INTERNAL_AUTH_TOKEN',
        '--secret',
        'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: basePath(binDir),
          INTEXURAOS_ENVIRONMENT: 'prod',
          DEPLOY_USER: 'test-deploy',
          NGINX_TOKEN_GROUP: 'test-nginx',
          PROVISIONER_SA_KEY_FILE: join(tempRoot, 'missing-provisioner-key.json'),
          RUNTIME_SA_KEY_FILE: join(tempRoot, 'runtime-key.json'),
          INTERNAL_AUTH_TOKEN_FILE: internalAuthTokenPath,
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to read Secret Manager value');
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS_ENV=complete\n');
    expect(readFileSync(internalAuthTokenPath, 'utf8')).toBe('previous-internal-token');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(statSync(internalAuthTokenPath).mode & 0o777).toBe(0o640);
  });

  it('does not publish the nginx token when publishing .env.prod fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-publish-'));
    const binDir = join(tempRoot, 'bin');
    const outputPath = join(tempRoot, '.env.prod');
    const internalAuthTokenPath = join(tempRoot, 'internal-auth-token');
    mkdirSync(binDir);
    writeFileSync(outputPath, 'PREVIOUS_ENV=complete\n', { mode: 0o600 });
    writeFileSync(internalAuthTokenPath, 'previous-internal-token', { mode: 0o640 });
    makeExecutable(
      join(binDir, 'gcloud'),
      "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'new-internal-token'\n"
    );
    makeExecutable(
      join(binDir, 'id'),
      '#!/usr/bin/env bash\nset -euo pipefail\n[[ "$1" == "-u" && "$2" == "test-deploy" ]]\n'
    );
    makeExecutable(
      join(binDir, 'getent'),
      '#!/usr/bin/env bash\nset -euo pipefail\n[[ "$1" == "group" && "$2" == "test-nginx" ]]\n'
    );
    makeExecutable(
      join(binDir, 'install'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-d" ]]; then
  mkdir -p "\${@: -1}"
elif [[ "\${@: -1}" == "\${FAIL_INSTALL_TARGET:?}" ]]; then
  exit 44
else
  cp "\${@: -2:1}" "\${@: -1}"
fi
`
    );

    const result = spawnSync(
      'bash',
      [loadSecretsPath, '--output', outputPath, '--secret', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: basePath(binDir),
          INTEXURAOS_ENVIRONMENT: 'prod',
          DEPLOY_USER: 'test-deploy',
          NGINX_TOKEN_GROUP: 'test-nginx',
          PROVISIONER_SA_KEY_FILE: join(tempRoot, 'missing-provisioner-key.json'),
          RUNTIME_SA_KEY_FILE: join(tempRoot, 'runtime-key.json'),
          INTERNAL_AUTH_TOKEN_FILE: internalAuthTokenPath,
          FAIL_INSTALL_TARGET: outputPath,
          TMPDIR: tempRoot,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS_ENV=complete\n');
    expect(readFileSync(internalAuthTokenPath, 'utf8')).toBe('previous-internal-token');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(statSync(internalAuthTokenPath).mode & 0o777).toBe(0o640);
  });

  it('loads only the Grafana token from Secret Manager', () => {
    const script = readFileSync(loadGrafanaEnvPath, 'utf8');
    const secretArray = script.match(/GRAFANA_CLOUD_COLLECTOR_SECRETS=\(([\s\S]*?)\)/u)?.[1];

    expect(secretArray?.match(/INTEXURAOS_[A-Z0-9_]+/gu)).toEqual([
      'INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN',
    ]);
    expect(script).toContain('render-runtime-config.mjs');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_URL');
    expect(script).toContain('INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME');
  });

  it('preserves the previous Grafana env when the token read fails', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-grafana-'));
    const binDir = join(tempRoot, 'bin');
    const outputPath = join(tempRoot, 'grafana-cloud.env');
    mkdirSync(binDir);
    writeFileSync(outputPath, 'PREVIOUS=complete\n', { mode: 0o600 });
    makeExecutable(join(binDir, 'gcloud'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 42\n');

    const result = spawnSync('bash', [loadGrafanaEnvPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: basePath(binDir),
        INTEXURAOS_ENVIRONMENT: 'dev',
        OUTPUT_FILE: outputPath,
        GOOGLE_APPLICATION_CREDENTIALS: join(tempRoot, 'missing-key.json'),
        TMPDIR: tempRoot,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unable to read Secret Manager value');
    expect(readFileSync(outputPath, 'utf8')).toBe('PREVIOUS=complete\n');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('names web inputs as build environment rather than Secret Manager values', () => {
    const script = readFileSync(deployWebPath, 'utf8');
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
        'INTEXURAOS_FIREBASE_API_KEY',
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
    expect(parsed['INTEXURAOS_FIREBASE_API_KEY']).toBe(commonConfig['INTEXURAOS_FIREBASE_API_KEY']);
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
          INTEXURAOS_WHATSAPP_ACCESS_TOKEN: 'must-not-leak',
          INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: 'must-not-leak-either',
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
      join(tempRoot, '.config/gcloud/sa-key.json')
    );
    expect(generated['INTEXURAOS_REPOSITORY_PATH']).toBe(join(tempRoot, '.code-orchestrator/repo'));
    expect(generated['INTEXURAOS_RUNTIME']).toBe('dev');
    expect(generated['PORT']).toBe('8199');
    expect(generated['INTEXURAOS_WORKER_CAPACITY']).toBe('3');
    expect(generated['INTEXURAOS_WHATSAPP_ACCESS_TOKEN']).toBeUndefined();
    expect(generated['INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET']).toBeUndefined();
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

    expect(policyRunbook).toContain(
      'Secret Manager contains only values that are not allowed in repository-backed'
    );
    expect(policyRunbook).toContain('config/environments/policy.json');
    expect(policyRunbook).toContain('26 old Secret Manager containers temporarily for rollback');
    expect(localSetup).toContain('../operations/runtime-configuration.md');
    expect(orchestratorReadme).toContain('scripts/generate-orchestrator-env.mjs');
    expect(orchestratorReadme).not.toContain("grep -E '^export INTEXURAOS_' .envrc");
  });
});
