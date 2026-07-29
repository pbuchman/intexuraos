import { describe, it, expect } from 'vitest';
import { IntexuraOSError } from '@intexuraos/common-core';
import {
  getRequiredEnv,
  getOptionalEnv,
  loadEnvConfig,
  type EnvReader,
} from '../../bootstrap/env-config.js';
import {
  DEFAULT_CAPACITY,
  DEFAULT_COMPLETION_MAX_ATTEMPTS,
  DEFAULT_PORT,
  DEFAULT_VALIDATION_MODELS,
  DEFAULT_WORKER_IMAGE,
} from '../../types/constants.js';

/** Minimum env dict sufficient to make `loadEnvConfig` succeed. */
function makeValidEnv(overrides: Partial<Record<string, string>> = {}): EnvReader {
  return {
    INTEXURAOS_REPOSITORY_URL: 'https://github.com/example/repo.git',
    INTEXURAOS_CODE_AGENT_URL: 'https://code-agent.test',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'internal-token',
    INTEXURAOS_ORCHESTRATOR_SECRET: 'secret',
    INTEXURAOS_USAGE_WEBHOOK_URL: 'https://usage.test',
    INTEXURAOS_GITHUB_APP_ID: '12345',
    INTEXURAOS_GITHUB_INSTALLATION_ID: '67890',
    INTEXURAOS_PROJECT_ID: 'proj-id',
    GOOGLE_APPLICATION_CREDENTIALS: '/path/to/sa.json',
    INTEXURAOS_LINEAR_API_KEY: 'lin-key',
    INTEXURAOS_SENTRY_AUTH_TOKEN: 'sentry-token',
    INTEXURAOS_MINIMAX_APP_API_KEY: 'minimax-key',
    INTEXURAOS_MIMO_APP_API_KEY: 'mimo-key',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: 'dashscope-key',
    INTEXURAOS_KIMI_APP_API_KEY: 'ABCDEFG',
    INTEXURAOS_GEMINI_APP_API_KEY: 'gemini-key',
    ...overrides,
  };
}

describe('getRequiredEnv', () => {
  it('returns the value when set', () => {
    expect(getRequiredEnv('FOO', { FOO: 'bar' })).toBe('bar');
  });

  it('throws with the variable name when missing', () => {
    expect(() => getRequiredEnv('MISSING', {})).toThrow(
      /Required environment variable 'MISSING' is not set/
    );
  });

  it('throws when value is empty string', () => {
    expect(() => getRequiredEnv('EMPTY', { EMPTY: '' })).toThrow(/EMPTY/);
  });

  // INT-1565 acceptance: env-config failures must be typed `IntexuraOSError`s
  // (no plain `throw new Error(`) so start.ts can branch on `error.code`.
  it('throws an IntexuraOSError with code MISCONFIGURED', () => {
    try {
      getRequiredEnv('MISSING', {});
      throw new Error('expected getRequiredEnv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IntexuraOSError);
      expect((err as IntexuraOSError).code).toBe('MISCONFIGURED');
    }
  });
});

describe('getOptionalEnv', () => {
  it('returns the value when set', () => {
    expect(getOptionalEnv('FOO', 'default', { FOO: 'bar' })).toBe('bar');
  });

  it('returns the default when missing', () => {
    expect(getOptionalEnv('FOO', 'default', {})).toBe('default');
  });

  it('returns the default when empty string', () => {
    expect(getOptionalEnv('FOO', 'default', { FOO: '' })).toBe('default');
  });
});

describe('loadEnvConfig', () => {
  it('throws naming the missing variable when a required var is absent', () => {
    const env = makeValidEnv();
    delete env['INTEXURAOS_REPOSITORY_URL'];
    expect(() => loadEnvConfig(env)).toThrow(/INTEXURAOS_REPOSITORY_URL/);
  });

  it('returns a typed config object when all required vars are set', () => {
    const config = loadEnvConfig(makeValidEnv());
    expect(config.repoUrl).toBe('https://github.com/example/repo.git');
    expect(config.codeAgentUrl).toBe('https://code-agent.test');
    expect(config.gcpSaKeyPath).toBe('/path/to/sa.json');
    expect(config.projectId).toBe('proj-id');
    expect(config.linearApiKey).toBe('lin-key');
    expect(config.kimiApiKey).toBe('ABCDEFG');
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.capacity).toBe(DEFAULT_CAPACITY);
    expect(config.completionMaxAttempts).toBe(DEFAULT_COMPLETION_MAX_ATTEMPTS);
    expect(config.validationModels).toBe(DEFAULT_VALIDATION_MODELS);
    expect(config.workerImage).toBe(DEFAULT_WORKER_IMAGE);
    expect(config.logLevel).toBe('info');
    expect(config.openRouterApiKey).toBe('');
    expect(config.errorHubHost).toBeUndefined();
    expect(config.keepContainersAlive).toBe(false);
    expect(config.workerForensicsMode).toBe(false);
    expect(config.preserveWorkerContainers).toBe(true);
  });

  it('parses PORT and INTEXURAOS_WORKER_CAPACITY overrides', () => {
    const config = loadEnvConfig(
      makeValidEnv({
        PORT: '9000',
        INTEXURAOS_WORKER_CAPACITY: '4',
        INTEXURAOS_COMPLETION_MAX_ATTEMPTS: '5',
        LOG_LEVEL: 'debug',
      })
    );
    expect(config.port).toBe(9000);
    expect(config.capacity).toBe(4);
    expect(config.completionMaxAttempts).toBe(5);
    expect(config.logLevel).toBe('debug');
  });

  it('rejects non-numeric PORT', () => {
    expect(() => loadEnvConfig(makeValidEnv({ PORT: 'not-a-number' }))).toThrow(/Invalid PORT/);
  });

  it('rejects out-of-range PORT', () => {
    expect(() => loadEnvConfig(makeValidEnv({ PORT: '70000' }))).toThrow(/Invalid PORT/);
  });

  it('rejects zero or negative capacity', () => {
    expect(() => loadEnvConfig(makeValidEnv({ INTEXURAOS_WORKER_CAPACITY: '0' }))).toThrow(
      /INTEXURAOS_WORKER_CAPACITY/
    );
  });

  // INT-1565 acceptance: invalid env values must be typed `IntexuraOSError`s.
  it('throws an IntexuraOSError with code MISCONFIGURED on invalid PORT', () => {
    try {
      loadEnvConfig(makeValidEnv({ PORT: 'not-a-number' }));
      throw new Error('expected loadEnvConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IntexuraOSError);
      expect((err as IntexuraOSError).code).toBe('MISCONFIGURED');
    }
  });

  it('reads boolean feature flags', () => {
    const config = loadEnvConfig(
      makeValidEnv({
        KEEP_CONTAINERS_ALIVE: '1',
        INTEXURAOS_CODE_WORKER_FORENSICS: '1',
        INTEXURAOS_PRESERVE_WORKER_CONTAINERS: '0',
      })
    );
    expect(config.keepContainersAlive).toBe(true);
    expect(config.workerForensicsMode).toBe(true);
    expect(config.preserveWorkerContainers).toBe(false);
  });

  it('normalizes digest-pinned worker image overrides back to latest', () => {
    const config = loadEnvConfig(
      makeValidEnv({
        INTEXURAOS_CODE_WORKER_IMAGE:
          'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker@sha256:323593e1f8d4687612b42a8f7e94c3ba1d761407886d4cad9ae5f90ef1326f18',
      })
    );

    expect(config.workerImage).toBe(
      'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest'
    );
  });

  it('surfaces optional string overrides', () => {
    const config = loadEnvConfig(
      makeValidEnv({
        INTEXURAOS_REPOSITORY_PATH: '/custom/repo',
        INTEXURAOS_CODE_WORKER_FORENSICS_PATH: '/custom/forensics',
        INTEXURAOS_GITHUB_APP_PRIVATE_KEY: 'PEM-KEY',
        INTEXURAOS_GIT_USER_NAME: 'Alice',
        INTEXURAOS_GIT_USER_EMAIL: 'alice@example.com',
        INTEXURAOS_OPENROUTER_APP_API_KEY: 'or-key',
      })
    );
    expect(config.repoPath).toBe('/custom/repo');
    expect(config.workerForensicsBasePath).toBe('/custom/forensics');
    expect(config.githubPrivateKeyOverride).toBe('PEM-KEY');
    expect(config.gitUserNameOverride).toBe('Alice');
    expect(config.gitUserEmailOverride).toBe('alice@example.com');
    expect(config.openRouterApiKey).toBe('or-key');
  });

  it('omits optional string overrides when env vars are empty', () => {
    const config = loadEnvConfig(
      makeValidEnv({
        INTEXURAOS_REPOSITORY_PATH: '',
        INTEXURAOS_GIT_USER_NAME: '',
      })
    );
    expect(config.repoPath).toBeUndefined();
    expect(config.gitUserNameOverride).toBeUndefined();
  });

  it.each(['home-dev.example.ts.net', 'home-dev.example.ts.net:8443'])(
    'accepts Error Hub DNS host %s without changing it',
    (host) => {
      const config = loadEnvConfig(makeValidEnv({ INTEXURAOS_ERROR_HUB_HOST: host }));

      expect(config.errorHubHost).toBe(host);
    }
  );

  it.each([
    'https://home-dev.example.ts.net:8443',
    'home-dev.example.ts.net/issues/1',
    'user@home-dev.example.ts.net',
    'home dev.example.ts.net',
    'home-dev.example.ts.net:0',
    'home-dev.example.ts.net:65536',
  ])('rejects invalid INTEXURAOS_ERROR_HUB_HOST value %s', (value) => {
    expect(() => loadEnvConfig(makeValidEnv({ INTEXURAOS_ERROR_HUB_HOST: value }))).toThrow(
      /Invalid INTEXURAOS_ERROR_HUB_HOST/
    );
  });

  it.each([
    ['host with trailing LF', 'home-dev.example.ts.net\n'],
    ['host and port with trailing LF', 'home-dev.example.ts.net:8443\n'],
    ['host and port with trailing CRLF', 'home-dev.example.ts.net:8443\r\n'],
    ['host and port with trailing tab', 'home-dev.example.ts.net:8443\t'],
  ])('rejects INTEXURAOS_ERROR_HUB_HOST containing whitespace: %s', (_name, value) => {
    expect(() => loadEnvConfig(makeValidEnv({ INTEXURAOS_ERROR_HUB_HOST: value }))).toThrow(
      /Invalid INTEXURAOS_ERROR_HUB_HOST/
    );
  });

  it('does not repeat rejected Error Hub credentials in the startup error', () => {
    const credentialValue = 'user:password@home-dev.example.ts.net';
    let thrown: unknown;

    try {
      loadEnvConfig(makeValidEnv({ INTEXURAOS_ERROR_HUB_HOST: credentialValue }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IntexuraOSError);
    expect((thrown as IntexuraOSError).message).not.toContain(credentialValue);
  });

  it('forwards INTEXURAOS_ENVIRONMENT and falls back to NODE_ENV when unset', () => {
    const explicit = loadEnvConfig(makeValidEnv({ INTEXURAOS_ENVIRONMENT: 'production' }));
    expect(explicit.environment).toBe('production');

    const fallback = loadEnvConfig(makeValidEnv({ NODE_ENV: 'staging' }));
    expect(fallback.environment).toBe('staging');

    const def = loadEnvConfig(makeValidEnv());
    expect(def.environment).toBe('development');
  });

  it('surfaces INTEXURAOS_SENTRY_DSN, K_REVISION, and INTEXURAOS_RELEASE overrides', () => {
    // K_REVISION wins over INTEXURAOS_RELEASE when both are present (Cloud Run
    // injects K_REVISION on every deploy; the explicit override is for hosts
    // that don't run on Cloud Run).
    const cloudRun = loadEnvConfig(
      makeValidEnv({
        INTEXURAOS_SENTRY_DSN: 'https://example@sentry.io/1',
        K_REVISION: 'orchestrator-00007-rev',
        INTEXURAOS_RELEASE: 'should-not-win',
      })
    );
    expect(cloudRun.sentryDsn).toBe('https://example@sentry.io/1');
    expect(cloudRun.release).toBe('orchestrator-00007-rev');

    const explicit = loadEnvConfig(makeValidEnv({ INTEXURAOS_RELEASE: 'manual-tag' }));
    expect(explicit.release).toBe('manual-tag');

    const none = loadEnvConfig(makeValidEnv());
    expect(none.sentryDsn).toBeUndefined();
    expect(none.release).toBeUndefined();
  });
});
