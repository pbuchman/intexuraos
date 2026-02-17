import { describe, it, expect, vi, afterEach } from 'vitest';

describe('register (no-op path)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not throw when endpoint is not configured', async () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');

    // Dynamic import to test the module's top-level execution
    await expect(import('../register.js')).resolves.not.toThrow();
  });
});
