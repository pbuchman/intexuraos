import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadRuntimeConfig,
  loadRuntimePolicy,
  renderRuntimeConfig,
  validateRuntimeConfig,
} from '../lib/runtime-config.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const configRoot = resolve(repoRoot, 'config', 'environments');
const renderCliPath = resolve(repoRoot, 'scripts', 'render-runtime-config.mjs');
const temporaryDirectories: string[] = [];

const COMMON_CONFIG_NAMES = [
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_SPA_CLIENT_ID',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
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
  'INTEXURAOS_REPOSITORY_URL',
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_SENTRY_DSN_WEB',
] as const;

const DEV_CONFIG_NAMES = [
  'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL',
  'INTEXURAOS_SENTRY_DSN_DEV',
] as const;
const PROD_CONFIG_NAMES = ['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] as const;
const DEAD_GEMINI_KEY_NAME = 'INTEXURAOS_GEMINI_APP_API_KEY';
const DEAD_REDIRECT_NAME = 'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI';
const DELETE_ONLY_NAMES = [DEAD_GEMINI_KEY_NAME, DEAD_REDIRECT_NAME] as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('versioned runtime configuration', () => {
  it('loads 22 common values plus environment-specific Matrix URLs and the dev Sentry DSN', () => {
    const prod = loadRuntimeConfig({ environment: 'prod', configRoot });
    const dev = loadRuntimeConfig({ environment: 'dev', configRoot });

    expect(Object.keys(prod).sort()).toEqual([...COMMON_CONFIG_NAMES, ...PROD_CONFIG_NAMES].sort());
    expect(Object.keys(dev).sort()).toEqual([...COMMON_CONFIG_NAMES, ...DEV_CONFIG_NAMES].sort());
    expect(Object.values(prod).every((value) => typeof value === 'string' && value !== '')).toBe(
      true
    );
    expect(Object.values(dev).every((value) => typeof value === 'string' && value !== '')).toBe(
      true
    );
    expect(Object.hasOwn(prod, 'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI')).toBe(false);
    expect(Object.hasOwn(dev, 'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI')).toBe(false);
    expect(dev['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL']).toBe('http://127.0.0.1:8099');
    expect(prod['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL']).toBe(
      'https://dev.intexuraos.cloud/api/matrix-outbound'
    );
  });

  it('keeps versioned configuration fully disjoint from Secret Manager', () => {
    const policy = loadRuntimePolicy({ configRoot });
    const validation = validateRuntimeConfig({ environment: 'dev', configRoot });
    const configNames = [
      ...new Set([...policy.scopes.common, ...policy.scopes.dev, ...policy.scopes.prod]),
    ];
    const overlap = configNames.filter((name) => policy.secretManagerNames.includes(name)).sort();

    expect(validation.valid).toBe(true);
    expect(policy.migrationRollbackSecretNames).toEqual([]);
    expect(policy.deleteOnlyNames).toEqual([...DELETE_ONLY_NAMES]);
    expect(overlap).toEqual([]);
    expect(policy.sensitiveConfigNameAllowlist).toEqual([]);
  });

  it('retains removed Google AI credentials and OAuth redirect as permanent tombstones', () => {
    const policy = loadRuntimePolicy({ configRoot });
    const activeNames = [
      ...policy.scopes.common,
      ...policy.scopes.dev,
      ...policy.scopes.prod,
      ...policy.secretManagerNames,
      ...policy.migrationRollbackSecretNames,
    ];

    expect(activeNames).not.toContain(DEAD_GEMINI_KEY_NAME);
    expect(activeNames).not.toContain(DEAD_REDIRECT_NAME);
    expect(policy.deleteOnlyNames).toEqual([...DELETE_ONLY_NAMES]);
  });

  it('requires explicit rollback when a delete-only tombstone still exists in Secret Manager', () => {
    const fixture = makeFixture();
    const policyPath = resolve(fixture, 'policy.json');
    const policy = loadRuntimePolicy({ configRoot: fixture });
    writeFileSync(
      policyPath,
      `${JSON.stringify(
        {
          ...policy,
          deleteOnlyNames: [DEAD_REDIRECT_NAME],
          secretManagerNames: [...policy.secretManagerNames, DEAD_REDIRECT_NAME].sort(),
        },
        null,
        2
      )}\n`
    );

    expect(() => loadRuntimePolicy({ configRoot: fixture })).toThrow(
      /delete-only name is in Secret Manager without migration rollback/u
    );
  });

  it('allows an explicitly declared rollback for a delete-only Secret Manager overlap', () => {
    const fixture = makeFixture();
    const policyPath = resolve(fixture, 'policy.json');
    const policy = loadRuntimePolicy({ configRoot: fixture });
    writeFileSync(
      policyPath,
      `${JSON.stringify(
        {
          ...policy,
          deleteOnlyNames: [DEAD_REDIRECT_NAME],
          migrationRollbackSecretNames: [DEAD_REDIRECT_NAME],
          secretManagerNames: [...policy.secretManagerNames, DEAD_REDIRECT_NAME].sort(),
        },
        null,
        2
      )}\n`
    );

    expect(loadRuntimePolicy({ configRoot: fixture }).migrationRollbackSecretNames).toEqual([
      DEAD_REDIRECT_NAME,
    ]);
  });

  it('renders deterministic shell and dotenv without printing diagnostics', () => {
    const dev = loadRuntimeConfig({ environment: 'dev', configRoot });
    const shell = renderRuntimeConfig({ environment: 'dev', configRoot, format: 'shell-export' });
    const dotenv = renderRuntimeConfig({ environment: 'dev', configRoot, format: 'dotenv' });

    expect(shell.endsWith('\n')).toBe(true);
    expect(dotenv.endsWith('\n')).toBe(true);
    expect(shell.split('\n').filter(Boolean)).toHaveLength(24);
    expect(dotenv.split('\n').filter(Boolean)).toHaveLength(24);
    expect(Object.keys(parseDotenv(dotenv)).sort()).toEqual(Object.keys(dev).sort());
    expect(digest(parseDotenv(dotenv)['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'] ?? '')).toBe(
      digest(dev['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'])
    );

    const cliOutput = execFileSync(
      process.execPath,
      [renderCliPath, '--environment', 'prod', '--format', 'dotenv'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    expect(digest(cliOutput)).toBe(
      digest(renderRuntimeConfig({ environment: 'prod', configRoot, format: 'dotenv' }))
    );
  });

  it('preserves a JSON value exactly when Bash sources the dotenv output', () => {
    const fixture = makeFixture();
    const dotenvPath = resolve(fixture, 'runtime.env');
    const name = 'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY';
    const config = loadRuntimeConfig({ environment: 'prod', configRoot: fixture });
    writeFileSync(
      dotenvPath,
      renderRuntimeConfig({ environment: 'prod', configRoot: fixture, format: 'dotenv' })
    );

    const sourcedDigest = execFileSync(
      '/bin/bash',
      [
        '-c',
        [
          'set -a',
          'source "$1"',
          `node -e 'const { createHash } = require("node:crypto"); const value = process.env[process.argv[1]]; if (value === undefined) process.exit(2); process.stdout.write(createHash("sha256").update(value).digest("hex"));' "$2"`,
        ].join('\n'),
        'runtime-config-test',
        dotenvPath,
        name,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    expect(sourcedDigest).toBe(digest(config[name]));
  });

  it.each([
    ['unknown key', { INTEXURAOS_UNCLASSIFIED_VALUE: 'value' }],
    ['empty value', { INTEXURAOS_AUTH0_DOMAIN: '' }],
    ['non-string value', { INTEXURAOS_AUTH0_DOMAIN: 123 }],
    ['CR value', { INTEXURAOS_AUTH0_DOMAIN: 'example.com\rvalue' }],
    ['LF value', { INTEXURAOS_AUTH0_DOMAIN: 'example.com\nvalue' }],
    ['NUL value', { INTEXURAOS_AUTH0_DOMAIN: 'example.com\0value' }],
  ])('rejects %s without including the value in the error', (_label, replacement) => {
    const fixture = makeFixture();
    const common = makeSyntheticCommonConfig();
    Object.assign(common, replacement);
    writeFileSync(resolve(fixture, 'common.json'), `${JSON.stringify(common, null, 2)}\n`);

    let message = '';
    try {
      loadRuntimeConfig({ environment: 'prod', configRoot: fixture });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe('');
    for (const value of Object.values(replacement)) {
      const sentinel = String(value);
      if (sentinel !== '') {
        expect(message.includes(sentinel)).toBe(false);
      }
    }
  });

  it('rejects duplicate JSON keys before JSON.parse can overwrite them', () => {
    const fixture = makeFixture();
    const commonPath = resolve(fixture, 'common.json');
    const common = makeSyntheticCommonConfig();
    const entries = Object.entries(common)
      .map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`)
      .join(',\n');
    writeFileSync(commonPath, `{\n${entries},\n"INTEXURAOS_AUTH0_DOMAIN": "second-value"\n}\n`);

    expect(() => loadRuntimeConfig({ environment: 'prod', configRoot: fixture })).toThrow(
      /duplicate key/u
    );
  });

  it('rejects sensitive config names unless policy explicitly permits them', () => {
    const fixture = makeFixture();
    const policyPath = resolve(fixture, 'policy.json');
    const policy = loadRuntimePolicy({ configRoot: fixture });
    const sensitiveName = 'INTEXURAOS_FIREBASE_API_KEY';
    writeFileSync(
      policyPath,
      `${JSON.stringify(
        {
          ...policy,
          scopes: {
            ...policy.scopes,
            common: [...policy.scopes.common, sensitiveName].sort(),
          },
          sensitiveConfigNameAllowlist: [],
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      resolve(fixture, 'common.json'),
      `${JSON.stringify(
        { ...makeSyntheticCommonConfig(), [sensitiveName]: `AIza${'a'.repeat(35)}` },
        null,
        2
      )}\n`
    );

    expect(() => loadRuntimeConfig({ environment: 'prod', configRoot: fixture })).toThrow(
      /sensitive config classification/u
    );
  });
});

function makeFixture(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'intexuraos-runtime-config-'));
  temporaryDirectories.push(directory);
  mkdirSync(directory, { recursive: true });

  const realPolicy = loadRuntimePolicy({ configRoot });
  writeFileSync(resolve(directory, 'policy.json'), `${JSON.stringify(realPolicy, null, 2)}\n`);
  writeFileSync(
    resolve(directory, 'common.json'),
    `${JSON.stringify(makeSyntheticCommonConfig(), null, 2)}\n`
  );
  writeFileSync(
    resolve(directory, 'dev.json'),
    `${JSON.stringify(
      {
        INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL: 'http://127.0.0.1:8099',
        INTEXURAOS_SENTRY_DSN_DEV: 'https://dev.example.invalid/1',
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    resolve(directory, 'prod.json'),
    `${JSON.stringify(
      { INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL: 'https://matrix.example.invalid' },
      null,
      2
    )}\n`
  );
  return directory;
}

function makeSyntheticCommonConfig(): Record<string, unknown> {
  const config = Object.fromEntries(COMMON_CONFIG_NAMES.map((name) => [name, `value-for-${name}`]));
  config['INTEXURAOS_AUTH0_DOMAIN'] = 'tenant.example.invalid';
  config['INTEXURAOS_AUTH_ISSUER'] = 'https://tenant.example.invalid/';
  config['INTEXURAOS_AUTH_JWKS_URL'] = 'https://tenant.example.invalid/.well-known/jwks.json';
  config['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.example.invalid';
  config['INTEXURAOS_FIREBASE_AUTH_DOMAIN'] = 'project.firebaseapp.com';
  config['INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL'] = 'https://grafana.example.invalid';
  config['INTEXURAOS_GRAFANA_CLOUD_LOKI_URL'] = 'https://loki.example.invalid/push';
  config['INTEXURAOS_REPOSITORY_URL'] = 'https://github.com/example/repository.git';
  config['INTEXURAOS_SENTRY_DSN'] = 'https://public@example.invalid/1';
  config['INTEXURAOS_SENTRY_DSN_WEB'] = 'https://public@example.invalid/2';
  config['INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION'] = 'test-v1';
  config['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'] = JSON.stringify({
    crv: 'Ed25519',
    kid: 'test-v1',
    kty: 'OKP',
    x: 'a'.repeat(43),
  });
  return config;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
