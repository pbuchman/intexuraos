import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { logger } from '../logger.js';

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
    vi.mocked(logger.error).mockReset();
    vi.mocked(logger.warn).mockReset();
    vi.mocked(logger.info).mockReset();
    vi.mocked(logger.debug).mockReset();
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

  it('should restart VM when running but unhealthy: stop -> start -> health fails', async () => {
    // Walk through the full restart path:
    //   1) initial get -> RUNNING (triggers initial pollHealth)
    //   2) initial pollHealth fails (status: 'starting') -> code calls stop
    //   3) waitForState(TERMINATED) sees TERMINATED on next get
    //   4) start is called, waitForState(RUNNING) sees RUNNING
    //   5) final pollHealth never goes ready -> result.success === false
    let getCallCount = 0;
    mockGet.mockImplementation(() => {
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve([{ status: 'RUNNING' }]);
      }
      if (getCallCount === 2) {
        return Promise.resolve([{ status: 'TERMINATED' }]);
      }
      return Promise.resolve([{ status: 'RUNNING' }]);
    });
    mockStop.mockResolvedValue([{ name: 'stop-op' }]);
    mockStart.mockResolvedValue([{ name: 'start-op' }]);

    // Health endpoint never reports ready, so both the initial pollHealth
    // (forcing the restart) and the final pollHealth (after start) fail.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'starting' }),
    });

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
    expect(mockStop).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
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
    // First get returns TERMINATED, all subsequent gets remain TERMINATED so
    // waitForState(RUNNING) never resolves and times out.
    mockGet.mockResolvedValue([{ status: 'TERMINATED' }]);
    mockStart.mockResolvedValue([{ name: 'op-stuck' }]);
    // fetch should not be called since waitForState times out first; default rejection just in case
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('should not be called'));

    const resultPromise = startVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Outer catch unwraps the IntexuraOSError, surfacing its code and message
    // verbatim on the StartVmResult so the caller can branch on errorCode.
    expect(result.success).toBe(false);
    expect(result.message).toContain('Timeout waiting for VM to reach');
    expect(result.errorCode).toBe('WORKER_UNAVAILABLE');

    // The structured logger.error call MUST include the code field so dashboards
    // can filter by errorCode without parsing free-text messages.
    const errorCalls = vi.mocked(logger.error).mock.calls;
    const failedToStartCall = errorCalls.find(([, msg]) => msg === 'Failed to start VM');
    expect(failedToStartCall).toBeDefined();
    expect(failedToStartCall?.[0]).toMatchObject({ code: 'WORKER_UNAVAILABLE' });
  });
});
