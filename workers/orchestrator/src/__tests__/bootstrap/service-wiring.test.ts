import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import {
  buildWorkerAuthRegistry,
  buildTaskDispatcherWorkerSecrets,
  createWorkerAuthImageResolver,
  CREDENTIAL_REFRESH_BUFFER_MS,
  CREDENTIAL_REFRESH_TICK_MS,
  runCredentialRefreshTick,
  resolveSettingsLocalTemplatePath,
  startCredentialRefreshLoop,
} from '../../bootstrap/service-wiring.js';
import { loadEnvConfig, type BootstrapEnvConfig } from '../../bootstrap/env-config.js';
import type { WorkerAuthRegistry } from '../../services/worker-auth/index.js';
import type { IsolationProvider } from '../../services/isolation/types.js';
import { IMAGE_PULL_TIMEOUT_MS } from '../../services/task-dispatcher/retry-logic.js';
import { WorkerTypePolicy } from '../../services/worker-type-policy.js';
import { createDeferred } from '../deferred.js';

describe('createWorkerAuthImageResolver', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the provider registry pull and resolves the immutable worker image', async () => {
    const provider = {
      image: 'registry/code-worker@sha256:resolved',
      pullImage(_taskId: string): Promise<string> {
        return Promise.resolve(this.image);
      },
    };

    const resolveImage = createWorkerAuthImageResolver(provider as unknown as IsolationProvider);

    expect(await resolveImage()).toBe('registry/code-worker@sha256:resolved');
  });

  it('fails closed when the provider cannot pull worker images', async () => {
    const resolveImage = createWorkerAuthImageResolver({} as IsolationProvider);

    await expect(resolveImage()).rejects.toThrow(
      'Worker auth refresh requires worker image pulling'
    );
  });

  it('shares a pending registry pull between concurrent refresh callers', async () => {
    let finishPull: ((image: string) => void) | undefined;
    const pullImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishPull = resolve;
        })
    );
    const resolveImage = createWorkerAuthImageResolver({
      pullImage,
    } as unknown as IsolationProvider);

    const first = resolveImage();
    const second = resolveImage();
    expect(pullImage).toHaveBeenCalledOnce();
    finishPull?.('registry/code-worker@sha256:resolved');

    expect(await Promise.all([first, second])).toEqual([
      'registry/code-worker@sha256:resolved',
      'registry/code-worker@sha256:resolved',
    ]);
  });

  it('times out a caller without duplicating the underlying pull and retries after late completion', async () => {
    vi.useFakeTimers();
    let finishPull: ((image: string) => void) | undefined;
    const pendingPull = new Promise<string>((resolve) => {
      finishPull = resolve;
    });
    const pullImage = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(pendingPull)
      .mockResolvedValue('registry/code-worker@sha256:next');
    const resolveImage = createWorkerAuthImageResolver({
      pullImage,
    } as unknown as IsolationProvider);

    let callerRejected = false;
    const caller = resolveImage().catch((error: unknown) => {
      callerRejected = true;
      throw error;
    });
    const timedOut = expect(caller).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(IMAGE_PULL_TIMEOUT_MS);
    expect(callerRejected).toBe(true);
    await timedOut;

    const nextCaller = resolveImage();
    expect(pullImage).toHaveBeenCalledOnce();
    finishPull?.('registry/code-worker@sha256:resolved');
    expect(await nextCaller).toBe('registry/code-worker@sha256:resolved');

    expect(await resolveImage()).toBe('registry/code-worker@sha256:next');
    expect(pullImage).toHaveBeenCalledTimes(2);
  });

  it('releases a rejected registry pull so the next refresh can retry', async () => {
    const pullImage = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('registry unavailable'))
      .mockResolvedValue('registry/code-worker@sha256:resolved');
    const resolveImage = createWorkerAuthImageResolver({
      pullImage,
    } as unknown as IsolationProvider);

    await expect(resolveImage()).rejects.toThrow('registry unavailable');
    expect(await resolveImage()).toBe('registry/code-worker@sha256:resolved');
    expect(pullImage).toHaveBeenCalledTimes(2);
  });
});

type LogEntry = [level: 'info' | 'warn' | 'error' | 'debug', ...args: unknown[]];

function makeLogger(): Logger & { calls: LogEntry[] } {
  const calls: LogEntry[] = [];
  const logger = {
    info: (...args: unknown[]): number => calls.push(['info', ...args]),
    warn: (...args: unknown[]): number => calls.push(['warn', ...args]),
    error: (...args: unknown[]): number => calls.push(['error', ...args]),
    debug: (...args: unknown[]): number => calls.push(['debug', ...args]),
    calls,
  };
  return logger as unknown as Logger & { calls: LogEntry[] };
}

function makeRegistry(overrides: {
  isExpiringSoon?: (provider: string, bufferMs: number) => boolean;
  refresh?: (provider: string) => Promise<void>;
}): WorkerAuthRegistry {
  return {
    isExpiringSoon: overrides.isExpiringSoon ?? ((): boolean => false),
    refresh: overrides.refresh ?? ((): Promise<void> => Promise.resolve()),
  } as unknown as WorkerAuthRegistry;
}

function makeParsedEnv(errorHubHost = 'home-dev.example.ts.net:8443'): BootstrapEnvConfig {
  return loadEnvConfig({
    INTEXURAOS_REPOSITORY_URL: 'https://github.com/example/repo.git',
    INTEXURAOS_CODE_AGENT_URL: 'https://code-agent.test',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'internal-token',
    INTEXURAOS_ORCHESTRATOR_SECRET: 'orchestrator-secret',
    INTEXURAOS_USAGE_WEBHOOK_URL: 'https://usage.test',
    INTEXURAOS_GITHUB_APP_ID: '12345',
    INTEXURAOS_GITHUB_INSTALLATION_ID: '67890',
    INTEXURAOS_GITHUB_APP_PRIVATE_KEY_PATH:
      '/run/intexuraos/dev/current/github-app-private-key.pem',
    INTEXURAOS_PROJECT_ID: 'project-id',
    GOOGLE_APPLICATION_CREDENTIALS: '/path/to/sa.json',
    INTEXURAOS_LINEAR_API_KEY: 'linear-key',
    INTEXURAOS_SENTRY_AUTH_TOKEN: 'sentry-token',
    INTEXURAOS_ERROR_HUB_HOST: errorHubHost,
    INTEXURAOS_MINIMAX_APP_API_KEY: 'minimax-key',
    INTEXURAOS_MIMO_APP_API_KEY: 'mimo-key',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: 'dashscope-key',
    INTEXURAOS_KIMI_APP_API_KEY: 'kimi-key',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'openrouter-key',
  });
}

describe('runCredentialRefreshTick', () => {
  it('counts idle watchdog ticks independently of whether any credentials need refresh', async () => {
    vi.useFakeTimers();
    const snapshot = { idleTicks: 0 };
    const registry = makeRegistry({});
    let runningTasks: string[] = [];
    const interval = startCredentialRefreshLoop(
      registry,
      () => runningTasks,
      makeLogger(),
      snapshot
    );
    try {
      await vi.advanceTimersByTimeAsync(CREDENTIAL_REFRESH_TICK_MS * 2);
      expect(snapshot.idleTicks).toBe(2);
      runningTasks = ['running-task'];
      await vi.advanceTimersByTimeAsync(CREDENTIAL_REFRESH_TICK_MS);
      expect(snapshot.idleTicks).toBe(2);
    } finally {
      clearInterval(interval);
      vi.useRealTimers();
    }
  });

  it('is a no-op when no tasks running AND nothing is expiring', () => {
    const logger = makeLogger();
    const refresh = vi.fn(async () => undefined);
    const registry = makeRegistry({
      isExpiringSoon: () => false,
      refresh,
    });

    runCredentialRefreshTick(registry, () => [], logger);

    expect(refresh).not.toHaveBeenCalled();
    expect(logger.calls.filter(([level]) => level !== 'debug')).toHaveLength(0);
  });

  it('defers refresh but emits a debug log when workers are running and auth is expiring', () => {
    const logger = makeLogger();
    const refresh = vi.fn(async () => undefined);
    const registry = makeRegistry({
      isExpiringSoon: () => true,
      refresh,
    });

    runCredentialRefreshTick(registry, () => ['task-1'], logger);

    expect(refresh).not.toHaveBeenCalled();
    const debugCalls = logger.calls.filter(([level]) => level === 'debug');
    expect(debugCalls).toHaveLength(1);
  });

  it('stays silent when workers run but no provider is expiring', () => {
    const logger = makeLogger();
    const refresh = vi.fn(async () => undefined);
    const registry = makeRegistry({
      isExpiringSoon: () => false,
      refresh,
    });

    runCredentialRefreshTick(registry, () => ['task-1', 'task-2'], logger);

    expect(refresh).not.toHaveBeenCalled();
    expect(logger.calls).toHaveLength(0);
  });

  it('triggers refresh for each expiring provider when no tasks are running', () => {
    const logger = makeLogger();
    const refresh = vi.fn(async () => undefined);
    const registry = makeRegistry({
      isExpiringSoon: (provider: string) => provider === 'claude' || provider === 'codex',
      refresh,
    });

    runCredentialRefreshTick(registry, () => [], logger);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenNthCalledWith(1, 'claude');
    expect(refresh).toHaveBeenNthCalledWith(2, 'codex');
  });

  it('refreshes only providers that are expiring', () => {
    const logger = makeLogger();
    const refresh = vi.fn(async () => undefined);
    const registry = makeRegistry({
      isExpiringSoon: (provider: string) => provider === 'claude',
      refresh,
    });

    runCredentialRefreshTick(registry, () => [], logger);

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith('claude');
  });

  it('logs refresh failures at error level without throwing', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      isExpiringSoon: () => true,
      refresh: () => Promise.reject(new Error('refresh broke')),
    });

    runCredentialRefreshTick(registry, () => [], logger);
    // Flush the `void promise.catch(...)` handler registered by
    // runCredentialRefreshTick so the `logger.error` side-effect becomes
    // observable before we assert on it. Do not remove this line.
    await new Promise((resolve) => setImmediate(resolve));

    const errorCalls = logger.calls.filter(([level]) => level === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('uses the documented 5-minute buffer when checking expiry', () => {
    const logger = makeLogger();
    const bufferArgs: number[] = [];
    const isExpiringSoon = (_provider: string, bufferMs: number): boolean => {
      bufferArgs.push(bufferMs);
      return false;
    };
    const registry = makeRegistry({ isExpiringSoon });

    runCredentialRefreshTick(registry, () => [], logger);

    // Called once per provider (claude, codex)
    expect(bufferArgs[0]).toBe(CREDENTIAL_REFRESH_BUFFER_MS);
  });
});

describe('worker auth policy wiring', () => {
  async function writeExpiredClaudeAndActiveCodex(directory: string): Promise<{
    sharedCredsPath: string;
    sharedCodexAuthPath: string;
    credentialsPath: string;
  }> {
    const sharedCredsPath = join(directory, 'claude-creds');
    const sharedCodexAuthPath = join(directory, 'codex-auth');
    const credentialsPath = join(sharedCredsPath, '.credentials.json');
    await mkdir(sharedCredsPath);
    await mkdir(sharedCodexAuthPath);
    await writeFile(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'test-claude-token',
          expiresAt: Date.now() - 60_000,
          subscriptionType: 'max',
        },
      })
    );
    const encodedToken = Buffer.from(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    await writeFile(
      join(sharedCodexAuthPath, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: { access_token: `header.${encodedToken}.signature` },
      })
    );
    return { sharedCredsPath, sharedCodexAuthPath, credentialsPath };
  }

  it('keeps Codex active, aborts a pending Claude refresh, and reloads Claude on enable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'worker-auth-policy-'));
    const { sharedCredsPath, sharedCodexAuthPath, credentialsPath } =
      await writeExpiredClaudeAndActiveCodex(directory);
    const image = createDeferred<string>();
    const resolveRefreshImage = vi.fn(() => image.promise);
    const createContainer = vi.fn(() => Promise.reject(new Error('unexpected refresh container')));
    const policy = await WorkerTypePolicy.load(join(directory, 'worker-types.json'));
    const logger = makeLogger();
    const registry = buildWorkerAuthRegistry(
      policy,
      {
        sharedCredsPath,
        sharedCodexAuthPath,
        docker: { createContainer } as never,
        resolveRefreshImage,
      },
      logger
    );
    try {
      expect(registry.getState('claude').status).toBe('expired');
      const refresh = registry.refresh('claude');
      expect(resolveRefreshImage).toHaveBeenCalledOnce();
      await policy.apply(['codex', 'openrouter-free'], 0);
      expect(registry.getStates()).toMatchObject({
        claude: { status: 'disabled', refreshSupported: false },
        codex: { status: 'active' },
      });
      expect(registry.getCurrentAccessToken('claude')).toBeNull();

      await rm(credentialsPath);
      await policy.apply(['opus', 'codex', 'openrouter-free'], 1);
      expect(registry.getState('claude').status).toBe('not_configured');
      expect(registry.getCurrentAccessToken('claude')).toBeNull();
      image.resolve('registry/code-worker@sha256:resolved');
      await expect(refresh).resolves.toBe(false);
      expect(createContainer).not.toHaveBeenCalled();
    } finally {
      registry.stopMonitoring();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('survives restart with Claude disabled across idle ticks and resumes refresh after enabling Claude', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'worker-auth-watchdog-'));
    const { sharedCredsPath, sharedCodexAuthPath } =
      await writeExpiredClaudeAndActiveCodex(directory);
    const policyPath = join(directory, 'worker-types.json');
    await (await WorkerTypePolicy.load(policyPath)).apply(['codex'], 0);
    const policy = await WorkerTypePolicy.load(policyPath);
    const remove = vi.fn(async () => undefined);
    const createContainer = vi.fn(async () => ({
      id: 'fixture-refresh-container',
      start: async (): Promise<void> => undefined,
      wait: async (): Promise<{ StatusCode: number }> => ({ StatusCode: 0 }),
      remove,
    }));
    const logger = makeLogger();
    const watchdog = { idleTicks: 0 };
    vi.useFakeTimers();
    const registry = buildWorkerAuthRegistry(
      policy,
      {
        sharedCredsPath,
        sharedCodexAuthPath,
        docker: { createContainer } as never,
        resolveRefreshImage: async () => 'registry/code-worker@sha256:fixture',
      },
      logger
    );
    const interval = startCredentialRefreshLoop(registry, () => [], logger, watchdog);
    try {
      await vi.advanceTimersByTimeAsync(CREDENTIAL_REFRESH_TICK_MS * 2);
      expect(watchdog.idleTicks).toBe(2);
      expect(registry.getStates()).toMatchObject({
        claude: { status: 'disabled', refreshSupported: false },
        codex: { status: 'active' },
      });
      expect(createContainer).not.toHaveBeenCalled();

      await policy.apply(['opus', 'codex'], 1);
      expect(registry.getState('claude').status).toBe('expired');
      await vi.advanceTimersByTimeAsync(CREDENTIAL_REFRESH_TICK_MS);

      expect(watchdog.idleTicks).toBe(3);
      expect(createContainer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          name: expect.stringMatching(/^claude-cred-refresh-/),
        })
      );
      expect(remove).toHaveBeenCalledWith({ force: true });
    } finally {
      clearInterval(interval);
      registry.stopMonitoring();
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('resolveSettingsLocalTemplatePath', () => {
  it('points at the docker code-worker config-defaults directory', () => {
    expect(resolveSettingsLocalTemplatePath('/repo')).toBe(
      '/repo/docker/code-worker/config-defaults/settings.local.json'
    );
  });
});

describe('buildTaskDispatcherWorkerSecrets', () => {
  it('forwards the parsed Error Hub host to task dispatcher worker secrets', () => {
    const env = makeParsedEnv('home-dev.example.ts.net:8443');

    const secrets = buildTaskDispatcherWorkerSecrets(env, 'anthropic-token');

    expect(secrets).not.toHaveProperty('SENTRY_AUTH_TOKEN');
    expect(secrets).toEqual({
      ANTHROPIC_API_KEY: 'anthropic-token',
      LINEAR_API_KEY: 'linear-key',
      ERROR_HUB_HOST: 'home-dev.example.ts.net:8443',
      OPENROUTER_API_KEY: 'openrouter-key',
    });
  });
});
