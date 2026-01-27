import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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
});
