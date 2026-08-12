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

const VERSIONED_CONFIG_NAMES = [
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

const RETIRED_RUNTIME_NAMES = ['INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI'] as const;
const SECRET_MANAGER_BLOCKLIST = [...VERSIONED_CONFIG_NAMES, ...RETIRED_RUNTIME_NAMES] as const;

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

function readHetznerRuntimeSecretNames(): string[] {
  const script = readFileSync(loadSecretsPath, 'utf8');
  return (
    script
      .match(/HETZNER_RUNTIME_SECRETS=\(([\s\S]*?)\)/u)?.[1]
      ?.match(/INTEXURAOS_[A-Z0-9_]+/gu) ?? []
  );
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

  it('syncs tracked dev config without reading versioned or retired names from Secret Manager', () => {
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
  }, 30_000);

  it('derives both loader blocklists from every config scope plus retired tombstones', () => {
    for (const scriptPath of [syncSecretsPath, loadSecretsPath]) {
      const script = readFileSync(scriptPath, 'utf8');

      expect(script, scriptPath).toContain('...policy.scopes.common');
      expect(script, scriptPath).toContain('...policy.scopes.dev');
      expect(script, scriptPath).toContain('...policy.scopes.prod');
      expect(script, scriptPath).toContain('...policy.deleteOnlyNames');
      expect(script, scriptPath).not.toContain('policy.migrationRollbackSecretNames.join');
    }
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
    const runtimeSecrets = readHetznerRuntimeSecretNames();
    const policy = JSON.parse(
      readFileSync(resolve(repoRoot, 'config/environments/policy.json'), 'utf8')
    ) as { secretManagerNames: string[] };
    expect(script).toContain('render-runtime-config.mjs');
    expect(script).toContain('--environment');
    expect(script).toContain('--format');
    expect(script).toContain('dotenv');
    expect(script).toContain('INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET');
    expect(script).not.toMatch(
      /HETZNER_RUNTIME_SECRETS=\([\s\S]*?INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI[\s\S]*?\)/u
    );
    expect(runtimeSecrets).toHaveLength(28);
    expect(runtimeSecrets.every((name) => policy.secretManagerNames.includes(name))).toBe(true);
    for (const name of SECRET_MANAGER_BLOCKLIST) {
      expect(runtimeSecrets, name).not.toContain(name);
    }
  });

  it.each(SECRET_MANAGER_BLOCKLIST)(
    'does not permit --secret to read the versioned or retired name %s',
    { timeout: 60_000 },
    (blockedName) => {
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
        [loadSecretsPath, '--output', join(tempRoot, '.env.prod'), '--secret', blockedName],
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
      expect(result.stderr).toContain('blocked by runtime configuration policy');
      expect(() => readFileSync(gcloudLog, 'utf8')).toThrow();
    }
  );

  it.each([
    ['INTEXURAOS_DASHSCOPE_APP_API_KEY', 'is not in the production runtime secret allowlist'],
    ['INTEXURAOS_UNCLASSIFIED_SECRET', 'is not classified as a Secret Manager secret'],
  ])('rejects the --secret assertion %s before any gcloud read', (requestedName, message) => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-assertion-'));
    const binDir = join(tempRoot, 'bin');
    const gcloudLog = join(tempRoot, 'gcloud.log');
    mkdirSync(binDir);
    makeExecutable(
      join(binDir, 'gcloud'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "\${GCLOUD_LOG:?}"
printf 'must-not-be-read\n'
`
    );

    const result = spawnSync(
      'bash',
      [loadSecretsPath, '--output', join(tempRoot, '.env.prod'), '--secret', requestedName],
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
    expect(result.stderr).toContain(message);
    expect(() => readFileSync(gcloudLog, 'utf8')).toThrow();
  });

  it(
    'treats --secret as an assertion and publishes the complete production environment',
    { timeout: 60_000 },
    () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'runtime-config-prod-complete-'));
      const binDir = join(tempRoot, 'bin');
      const outputPath = join(tempRoot, '.env.prod');
      const internalAuthTokenPath = join(tempRoot, 'internal-auth-token');
      const fetchLog = join(tempRoot, 'secret-fetches.txt');
      const runtimeSecrets = readHetznerRuntimeSecretNames();
      mkdirSync(binDir);
      makeExecutable(
        join(binDir, 'gcloud'),
        `#!/usr/bin/env bash
set -euo pipefail
secret_name=""
for argument in "$@"; do
  case "\${argument}" in
    --secret=*) secret_name="\${argument#*=}" ;;
  esac
done
[[ -n "\${secret_name}" ]]
printf '%s\n' "\${secret_name}" >> "\${FETCH_LOG:?}"
printf 'secret-value-for-%s' "\${secret_name}"
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
        [loadSecretsPath, '--output', outputPath, '--secret', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: basePath(binDir),
            FETCH_LOG: fetchLog,
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

      expect(result.status, result.stderr).toBe(0);
      const published = parse(readFileSync(outputPath, 'utf8'));
      const fetchedNames = readFileSync(fetchLog, 'utf8').trim().split(/\r?\n/u);
      const trackedConfig = {
        ...(JSON.parse(
          readFileSync(resolve(repoRoot, 'config/environments/common.json'), 'utf8')
        ) as Record<string, string>),
        ...(JSON.parse(
          readFileSync(resolve(repoRoot, 'config/environments/prod.json'), 'utf8')
        ) as Record<string, string>),
      };

      expect(fetchedNames).toEqual([...runtimeSecrets].sort());
      for (const [name, value] of Object.entries(trackedConfig)) {
        expect(published[name], name).toBe(value);
      }
      for (const name of runtimeSecrets) {
        expect(published[name], name).toBe(`secret-value-for-${name}`);
      }
      expect(readFileSync(internalAuthTokenPath, 'utf8')).toBe(
        'secret-value-for-INTEXURAOS_INTERNAL_AUTH_TOKEN'
      );
      expect(result.stdout).toContain('with 28 secrets');
    }
  );

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
  *) printf 'other-secret-value' ;;
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
    const cleanupRunbook = readFileSync(
      resolve(repoRoot, 'docs/operations/runtime-secret-manager-cleanup.md'),
      'utf8'
    );

    expect(policyRunbook).toContain(
      'Secret Manager contains only values that are not allowed in repository-backed'
    );
    expect(policyRunbook).toContain('config/environments/policy.json');
    expect(policyRunbook).toContain(
      '26 obsolete Secret Manager containers have been permanently removed'
    );
    expect(policyRunbook).toContain('permanent delete-only tombstone');
    expect(policyRunbook).toContain('./runtime-secret-manager-cleanup.md');
    expect(localSetup).toContain('../operations/runtime-configuration.md');
    expect(orchestratorReadme).toContain('scripts/generate-orchestrator-env.mjs');
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
