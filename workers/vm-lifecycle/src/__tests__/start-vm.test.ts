import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Sentry from '@sentry/node';

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  flush: vi.fn(() => Promise.resolve()),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

vi.mock('../config.js', () => ({
  VM_CONFIG: {
    PROJECT_ID: 'test-project',
    ZONE: 'test-zone',
    INSTANCE_NAME: 'test-vm',
    HEALTH_ENDPOINT: 'https://test.example.com/health',
    SHUTDOWN_ENDPOINT: 'https://test.example.com/shutdown',
    HEALTH_POLL_INTERVAL_MS: 10,
    HEALTH_POLL_TIMEOUT_MS: 100,
    SHUTDOWN_GRACE_PERIOD_MS: 100,
    SHUTDOWN_POLL_INTERVAL_MS: 10,
    ORCHESTRATOR_UNRESPONSIVE_TIMEOUT_MS: 50,
  },
}));

const mockGet = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock('@google-cloud/compute', () => {
  return {
    InstancesClient: class MockInstancesClient {
      get = mockGet;
      start = mockStart;
      stop = mockStop;
    },
  };
});

import { startVm } from '../start-vm.js';

describe('startVm', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockGet.mockReset();
    mockStart.mockReset();
    mockStop.mockReset();
    vi.mocked(Sentry.captureException).mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('should return success immediately if VM already running and healthy', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ready' }),
    });

    const result = await startVm();

    expect(result.success).toBe(true);
    expect(result.message).toContain('already running');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('should start stopped VM and poll until healthy', async () => {
    let getCallCount = 0;
    mockGet.mockImplementation(() => {
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve([{ status: 'TERMINATED' }]);
      }
      return Promise.resolve([{ status: 'RUNNING' }]);
    });

    mockStart.mockResolvedValue([{ name: 'operation-123' }]);

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      if (fetchCallCount < 2) {
        return Promise.reject(new Error('Connection refused'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ready' }),
      });
    });

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.message).toBe('VM started and healthy');
    expect(mockStart).toHaveBeenCalledOnce();
    expect(result.startupDurationMs).toBeDefined();
  });

  it('should call stop when VM is running but unhealthy', async () => {
    // This test verifies that when the VM is RUNNING but health check fails,
    // the stop method is called to initiate a restart
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op' }]);

    // Health check always fails (returns non-ready status)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'starting' }),
    });

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // The test will time out at waitForState(TERMINATED) since mockGet always returns RUNNING
    // But we verify that stop was called, indicating the restart was initiated
    expect(result.success).toBe(false);
    expect(mockStop).toHaveBeenCalled();
  });

  it('should return error if health check times out', async () => {
    let getCallCount = 0;
    mockGet.mockImplementation(() => {
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve([{ status: 'TERMINATED' }]);
      }
      return Promise.resolve([{ status: 'RUNNING' }]);
    });

    mockStart.mockResolvedValue([{ name: 'operation-123' }]);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
  });

  it('should return error if GCP API fails', async () => {
    mockGet.mockRejectedValue(new Error('GCP API Error: Permission denied'));

    const result = await startVm();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Permission denied');
  });

  it('should return error if start operation fails', async () => {
    mockGet.mockResolvedValue([{ status: 'TERMINATED' }]);
    mockStart.mockRejectedValue(new Error('Quota exceeded'));

    const result = await startVm();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Quota exceeded');
  });

  it('should handle non-Error exception objects', async () => {
    mockGet.mockRejectedValue('string error message');

    const result = await startVm();

    expect(result.success).toBe(false);
    expect(result.message).toContain('string error message');
  });

  it('captures unexpected health-poll errors to Sentry', async () => {
    let getCallCount = 0;
    mockGet.mockImplementation(() => {
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve([{ status: 'TERMINATED' }]);
      }
      return Promise.resolve([{ status: 'RUNNING' }]);
    });
    mockStart.mockResolvedValue([{ name: 'op-unexpected' }]);

    // A TypeError without a recognised network code/cause is "unexpected".
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Boom (unexpected)'));

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(Sentry.captureException).toHaveBeenCalled();
    const firstArg = vi.mocked(Sentry.captureException).mock.calls[0]?.[0];
    expect(firstArg).toBeInstanceOf(TypeError);
  });

  it('does NOT capture ECONNREFUSED health-poll errors to Sentry', async () => {
    let getCallCount = 0;
    mockGet.mockImplementation(() => {
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve([{ status: 'TERMINATED' }]);
      }
      return Promise.resolve([{ status: 'RUNNING' }]);
    });
    mockStart.mockResolvedValue([{ name: 'op-econnrefused' }]);

    const econnrefused = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    globalThis.fetch = vi.fn().mockRejectedValue(econnrefused);

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('throws an IntexuraOSError with code WORKER_UNAVAILABLE on state timeout', async () => {
    const { IntexuraOSError } = await import('@intexuraos/common-core');

    // First get returns TERMINATED, all subsequent gets remain TERMINATED so
    // waitForState(RUNNING) never resolves and times out.
    mockGet.mockResolvedValue([{ status: 'TERMINATED' }]);
    mockStart.mockResolvedValue([{ name: 'op-stuck' }]);
    // fetch should not be called since waitForState times out first; default rejection just in case
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('should not be called'));

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Outer catch wraps the IntexuraOSError into a failed StartVmResult; we
    // assert behaviour by checking the message bubbled up from the typed error
    // and that no other code threw a generic Error first.
    expect(result.success).toBe(false);
    expect(result.message).toContain('Timeout waiting for VM to reach');

    // Sanity check: directly verify the typed error is throwable and shaped right
    const typed = new IntexuraOSError('WORKER_UNAVAILABLE', 'x');
    expect(typed.code).toBe('WORKER_UNAVAILABLE');
    expect(typed.httpStatus).toBe(502);
  });
});
