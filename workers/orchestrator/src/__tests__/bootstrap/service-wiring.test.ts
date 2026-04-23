import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import {
  CREDENTIAL_REFRESH_BUFFER_MS,
  runCredentialRefreshTick,
} from '../../bootstrap/service-wiring.js';
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
