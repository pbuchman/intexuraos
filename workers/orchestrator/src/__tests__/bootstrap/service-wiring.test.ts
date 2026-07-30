import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import {
  buildTaskDispatcherWorkerSecrets,
  CREDENTIAL_REFRESH_BUFFER_MS,
  runCredentialRefreshTick,
  resolveSettingsLocalTemplatePath,
} from '../../bootstrap/service-wiring.js';
import { loadEnvConfig, type BootstrapEnvConfig } from '../../bootstrap/env-config.js';
import type { WorkerAuthRegistry } from '../../services/worker-auth/index.js';

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
    INTEXURAOS_GEMINI_APP_API_KEY: 'gemini-key',
  });
}

describe('runCredentialRefreshTick', () => {
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
      MINIMAX_API_KEY: 'minimax-key',
      MIMO_API_KEY: 'mimo-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
      KIMI_API_KEY: 'kimi-key',
      OPENROUTER_API_KEY: 'openrouter-key',
    });
  });
});
