import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import {
  registerUsageSink,
  unregisterUsageSink,
  clearUsageSinkRegistry,
  usageSinkRegistrySize,
  flushAllUsageSinks,
  type FlushableUsageSink,
} from '../usageSinkRegistry.js';

const makeLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

class FakeSink implements FlushableUsageSink {
  flushSync: () => Promise<void>;

  constructor(behavior: () => Promise<void> = () => Promise.resolve()) {
    this.flushSync = vi.fn(behavior);
  }
}

describe('usageSinkRegistry', () => {
  beforeEach(() => {
    clearUsageSinkRegistry();
  });

  afterEach(() => {
    clearUsageSinkRegistry();
  });

  describe('register / unregister', () => {
    it('register/unregister update the registry size', () => {
      expect(usageSinkRegistrySize()).toBe(0);
      const sink = new FakeSink();
      registerUsageSink(sink);
      expect(usageSinkRegistrySize()).toBe(1);
      unregisterUsageSink(sink);
      expect(usageSinkRegistrySize()).toBe(0);
    });

    it('registering the same sink twice is idempotent (Set semantics)', () => {
      const sink = new FakeSink();
      registerUsageSink(sink);
      registerUsageSink(sink);
      expect(usageSinkRegistrySize()).toBe(1);
    });

    it('unregistering a sink that was never registered is a no-op', () => {
      const sink = new FakeSink();
      expect(() => unregisterUsageSink(sink)).not.toThrow();
      expect(usageSinkRegistrySize()).toBe(0);
    });

    it('clearUsageSinkRegistry empties the registry', () => {
      registerUsageSink(new FakeSink());
      registerUsageSink(new FakeSink());
      expect(usageSinkRegistrySize()).toBe(2);
      clearUsageSinkRegistry();
      expect(usageSinkRegistrySize()).toBe(0);
    });
  });

  describe('flushAllUsageSinks', () => {
    it('drains every registered sink in parallel', async () => {
      const a = new FakeSink();
      const b = new FakeSink();
      const c = new FakeSink();
      registerUsageSink(a);
      registerUsageSink(b);
      registerUsageSink(c);

      await flushAllUsageSinks();

      expect(a.flushSync).toHaveBeenCalledTimes(1);
      expect(b.flushSync).toHaveBeenCalledTimes(1);
      expect(c.flushSync).toHaveBeenCalledTimes(1);
    });

    it('returns immediately when the registry is empty', async () => {
      await expect(flushAllUsageSinks()).resolves.toBeUndefined();
    });

    it('logs a warning when a sink rejects but does not throw', async () => {
      const logger = makeLogger();
      const ok = new FakeSink();
      const bad = new FakeSink(() => Promise.reject(new Error('boom')));
      registerUsageSink(ok);
      registerUsageSink(bad);

      await expect(flushAllUsageSinks({ logger })).resolves.toBeUndefined();

      expect(ok.flushSync).toHaveBeenCalledTimes(1);
      expect(bad.flushSync).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('boom') }),
        expect.stringContaining('failed to drain on shutdown')
      );
    });

    it('writes to stderr when no logger is provided and a sink fails', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      registerUsageSink(new FakeSink(() => Promise.reject(new Error('nope'))));

      await flushAllUsageSinks();

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('flushAllUsageSinks: sink failed to drain')
      );
      stderrSpy.mockRestore();
    });

    it('enforces per-sink timeout so a hung sink does not block shutdown', async () => {
      vi.useRealTimers();
      const logger = makeLogger();
      const fast = new FakeSink();
      const hung = new FakeSink(
        () =>
          new Promise<void>(() => {
            // never resolves
          })
      );
      registerUsageSink(fast);
      registerUsageSink(hung);

      await flushAllUsageSinks({ timeoutMs: 30, logger });

      expect(fast.flushSync).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('30ms') }),
        expect.any(String)
      );
    });

    it('snapshots the registry so concurrent register/unregister does not perturb iteration', async () => {
      const a = new FakeSink(async () => {
        // Mutating the registry mid-flush must not affect the in-flight drain.
        registerUsageSink(new FakeSink());
        clearUsageSinkRegistry();
      });
      registerUsageSink(a);
      await expect(flushAllUsageSinks()).resolves.toBeUndefined();
      expect(a.flushSync).toHaveBeenCalledTimes(1);
    });
  });
});
