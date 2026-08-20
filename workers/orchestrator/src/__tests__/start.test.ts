/**
 * Integration smoke test for `start()` — verifies the happy-path bootstrap
 * sequence invokes every module in the expected order.
 *
 * All bootstrap modules and the final `main()` call are mocked so that
 * importing the start module does not perform any real I/O. The test
 * drives the fully-wired `start()` function with a minimal env stub and
 * asserts the call sequence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Track invocation order across mocks.
const callOrder: string[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap module mocks (hoisted by vitest.vi.mock)
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../bootstrap/env-config.js', () => ({
  loadEnvConfig: vi.fn(() => {
    callOrder.push('loadEnvConfig');
    return {
      repoUrl: 'https://example.com/repo.git',
      codeAgentUrl: 'https://code-agent.test',
      internalAuthToken: 'internal',
      orchestratorSecret: 'secret',
      usageWebhookUrl: 'https://usage.test',
      githubAppId: '1',
      githubInstallationId: '2',
      githubPrivateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem',
      projectId: 'proj',
      gcpSaKeyPath: '/tmp/sa.json',
      port: 19199,
      capacity: 1,
      completionMaxAttempts: 3,
      validationModels: 'or:deepseek/deepseek-v4-flash',
      workerImage: 'image:latest',
      keepContainersAlive: false,
      workerForensicsMode: false,
      preserveWorkerContainers: true,
      linearApiKey: 'lin',
      errorHubHost: 'home-dev.example.ts.net:8443',
      minimaxApiKey: 'm',
      mimoApiKey: 'm',
      dashscopeApiKey: 'd',
      kimiApiKey: 'ABCDEFG',
      openRouterApiKey: '',
      logLevel: 'info',
      environment: 'test',
    };
  }),
}));

vi.mock('../bootstrap/gcp-validator.js', () => ({
  validateGcpCredentials: vi.fn(() => {
    callOrder.push('validateGcpCredentials');
  }),
}));

vi.mock('../bootstrap/port-checker.js', () => ({
  ensurePortAvailable: vi.fn(async () => {
    callOrder.push('ensurePortAvailable');
  }),
}));

vi.mock('../bootstrap/secret-manager.js', () => ({
  fetchGitHubKeys: vi.fn(() => {
    callOrder.push('fetchGitHubKeys');
    return 'PEM';
  }),
}));

// `validateWorkerApiKeys` is intentionally NOT pushed to `callOrder`.
// `start.ts` fires it with `void` (non-blocking), so in production it runs
// concurrently with `startCredentialRefreshLoop` and `main`. Pushing to
// `callOrder` inside this mock would only record the synchronous prelude of
// an async mock body and suggest a sequencing guarantee that does not exist.
// Invocation is verified separately via `toHaveBeenCalledOnce()`.
vi.mock('../bootstrap/api-key-validator.js', () => ({
  validateWorkerApiKeys: vi.fn(async () => undefined),
}));

vi.mock('../bootstrap/git-identity.js', () => ({
  readHostGitConfig: vi.fn(() => undefined),
}));

vi.mock('../bootstrap/service-wiring.js', () => ({
  buildOrchestratorServices: vi.fn(async () => {
    callOrder.push('buildOrchestratorServices');
    return {
      statePersistence: {},
      tokenService: {},
      webhookClient: {},
      dispatcher: { getRunningTaskIds: (): readonly string[] => [] },
      heartbeatManager: {},
      workerAuthRegistry: {},
      isolationProvider: {},
    };
  }),
  startCredentialRefreshLoop: vi.fn(() => {
    callOrder.push('startCredentialRefreshLoop');
    return null;
  }),
}));

vi.mock('../services/repo-manager.js', () => ({
  ensureRepository: vi.fn(async () => {
    callOrder.push('ensureRepository');
  }),
}));

vi.mock('../main.js', () => ({
  main: vi.fn(async () => {
    callOrder.push('main');
  }),
}));

// Mock file-system side effects in start.ts itself (mkdirSync, writeFileSync).
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(() => undefined),
    writeFileSync: vi.fn(() => undefined),
  };
});

// Mock pino so no transport worker threads spawn.
vi.mock('pino', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const pino = vi.fn(() => logger);
  return { default: pino };
});

// Mock initWorker so the bootstrap path doesn't touch Sentry / OTel during
// unit tests. The mock returns a fake logger + flush so we can assert that
// `flush` is forwarded into `main()` on the SIGTERM handoff.
const mockFlush = vi.fn(async () => undefined);
vi.mock('@intexuraos/infra-sentry', () => ({
  initWorker: vi.fn(() => {
    callOrder.push('initWorker');
    return {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      flush: mockFlush,
    };
  }),
}));

// Skip the git `rev-parse HEAD` probe.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(() => 'deadbeef'),
  };
});

// Imports below pick up the hoisted mocks above.
import { start } from '../start.js';
import { loadEnvConfig } from '../bootstrap/env-config.js';
import { validateGcpCredentials } from '../bootstrap/gcp-validator.js';
import { ensurePortAvailable } from '../bootstrap/port-checker.js';
import { fetchGitHubKeys } from '../bootstrap/secret-manager.js';
import { validateWorkerApiKeys } from '../bootstrap/api-key-validator.js';
import {
  buildOrchestratorServices,
  startCredentialRefreshLoop,
} from '../bootstrap/service-wiring.js';
import { ensureRepository } from '../services/repo-manager.js';
import { main } from '../main.js';
import { initWorker } from '@intexuraos/infra-sentry';

describe('start() — full bootstrap happy path', () => {
  beforeEach(() => {
    callOrder.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes every bootstrap module exactly once', async () => {
    await start();

    expect(loadEnvConfig).toHaveBeenCalledOnce();
    expect(validateGcpCredentials).toHaveBeenCalledOnce();
    expect(fetchGitHubKeys).toHaveBeenCalledOnce();
    expect(ensurePortAvailable).toHaveBeenCalledOnce();
    expect(ensureRepository).toHaveBeenCalledOnce();
    expect(buildOrchestratorServices).toHaveBeenCalledOnce();
    expect(validateWorkerApiKeys).toHaveBeenCalledOnce();
    expect(validateWorkerApiKeys).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kimiKey: 'ABCDEFG' }),
      expect.anything()
    );
    expect(startCredentialRefreshLoop).toHaveBeenCalledOnce();
    expect(initWorker).toHaveBeenCalledOnce();
    expect(main).toHaveBeenCalledOnce();
  });

  it('initializes the worker with serviceName=orchestrator and the env environment', async () => {
    await start();

    expect(initWorker).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'orchestrator', environment: 'test' })
    );
  });

  it('forwards the flush callback returned by initWorker into main()', async () => {
    await start();

    // Assert by argument identity (not positional index) so an extra optional
    // arg added to main()'s signature in the future does not silently move
    // the assertion onto the wrong slot.
    const mainArgs = vi.mocked(main).mock.calls[0];
    expect(mainArgs).toBeDefined();
    expect(mainArgs).toContain(mockFlush);
  });

  it('forwards sentryDsn and release into initWorker when env supplies them', async () => {
    // Drives the truthy arms of the conditional spreads in start.ts:
    //   ...(env.sentryDsn !== undefined ? { sentryDsn: env.sentryDsn } : {})
    //   ...(env.release !== undefined ? { release: env.release } : {})
    vi.mocked(loadEnvConfig).mockReturnValueOnce({
      repoUrl: 'https://example.com/repo.git',
      codeAgentUrl: 'https://code-agent.test',
      internalAuthToken: 'internal',
      orchestratorSecret: 'secret',
      usageWebhookUrl: 'https://usage.test',
      githubAppId: '1',
      githubInstallationId: '2',
      githubPrivateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem',
      projectId: 'proj',
      gcpSaKeyPath: '/tmp/sa.json',
      port: 19199,
      capacity: 1,
      completionMaxAttempts: 3,
      validationModels: 'or:deepseek/deepseek-v4-flash',
      workerImage: 'image:latest',
      keepContainersAlive: false,
      workerForensicsMode: false,
      preserveWorkerContainers: true,
      linearApiKey: 'lin',
      errorHubHost: 'home-dev.example.ts.net:8443',
      minimaxApiKey: 'm',
      mimoApiKey: 'm',
      dashscopeApiKey: 'd',
      kimiApiKey: 'ABCDEFG',
      openRouterApiKey: '',
      logLevel: 'info',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
      release: 'orchestrator-00099-rev',
    });

    await start();

    expect(initWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'orchestrator',
        environment: 'production',
        sentryDsn: 'https://x@sentry.io/1',
        release: 'orchestrator-00099-rev',
      })
    );
  });

  it('invokes bootstrap modules in the documented order', async () => {
    await start();

    // Env first, then dependent infra checks, then service wiring, then the
    // credential refresh loop, then the main loop. `validateWorkerApiKeys` is
    // intentionally omitted from this strict order: it is fired with `void`
    // in `start.ts`, so in production it runs concurrently with
    // `startCredentialRefreshLoop` and `main`. Including it here would only
    // assert the synchronous side-effect of the mock (which happens to push
    // to `callOrder` before its first await), giving false confidence about
    // sequencing that is not guaranteed in the real implementation. Its
    // invocation is separately verified via `toHaveBeenCalledOnce()` above.
    expect(callOrder).toEqual([
      'loadEnvConfig',
      'validateGcpCredentials',
      'fetchGitHubKeys',
      'ensurePortAvailable',
      'initWorker',
      'ensureRepository',
      'buildOrchestratorServices',
      'startCredentialRefreshLoop',
      'main',
    ]);
  });

  it('surfaces errors thrown by the env loader', async () => {
    vi.mocked(loadEnvConfig).mockImplementationOnce(() => {
      throw new Error('MISSING_VAR');
    });
    await expect(start()).rejects.toThrow('MISSING_VAR');
  });

  it('surfaces errors thrown by the port checker', async () => {
    vi.mocked(ensurePortAvailable).mockRejectedValueOnce(new Error('Port 19199 is already in use'));
    await expect(start()).rejects.toThrow(/Port 19199 is already in use/);
  });

  it('creates the inactivity-evidence directory alongside the orchestrator logs dir (INT-1787)', async () => {
    // Regression for INT-1787: ensureDirectoryExists must be called for
    // `<logsDir>/inactivity-evidence` so the directory is available before
    // copyOut runs during an inactivity restart.
    const { mkdirSync } = await import('node:fs');
    await start();

    expect(mkdirSync).toHaveBeenCalledWith(
      join(homedir(), '.code-orchestrator', 'logs', 'inactivity-evidence'),
      { recursive: true }
    );
  });

  it('forwards env overrides for repoPath and git identity', async () => {
    // Drive the truthy arms of `env.repoPath ?? defaultRepoPath`,
    // `env.gitUserNameOverride ?? readHostGitConfig(...)` /
    // `env.gitUserEmailOverride ?? readHostGitConfig(...)` inside start().
    // Without these, the default mock env leaves only the falsy arms covered.
    vi.mocked(loadEnvConfig).mockReturnValueOnce({
      repoUrl: 'https://example.com/repo.git',
      repoPath: '/custom/repo',
      codeAgentUrl: 'https://code-agent.test',
      internalAuthToken: 'internal',
      orchestratorSecret: 'secret',
      usageWebhookUrl: 'https://usage.test',
      githubAppId: '1',
      githubInstallationId: '2',
      githubPrivateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem',
      projectId: 'proj',
      gcpSaKeyPath: '/tmp/sa.json',
      port: 19199,
      capacity: 1,
      completionMaxAttempts: 3,
      validationModels: 'or:deepseek/deepseek-v4-flash',
      workerImage: 'image:latest',
      keepContainersAlive: false,
      workerForensicsMode: false,
      preserveWorkerContainers: true,
      linearApiKey: 'lin',
      errorHubHost: 'home-dev.example.ts.net:8443',
      minimaxApiKey: 'm',
      mimoApiKey: 'm',
      dashscopeApiKey: 'd',
      kimiApiKey: 'ABCDEFG',
      openRouterApiKey: '',
      gitUserNameOverride: 'Test User',
      gitUserEmailOverride: 'test@example.com',
      logLevel: 'info',
      environment: 'test',
    });

    await start();

    expect(fetchGitHubKeys).toHaveBeenCalledWith({
      privateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem',
    });

    // With both git-identity env vars set, readHostGitConfig is never called.
    const { readHostGitConfig } = await import('../bootstrap/git-identity.js');
    expect(vi.mocked(readHostGitConfig)).not.toHaveBeenCalled();

    // The custom repoPath overrides the default home-based path.
    expect(ensureRepository).toHaveBeenCalledWith(
      'https://example.com/repo.git',
      '/custom/repo',
      expect.anything()
    );
  });
});
