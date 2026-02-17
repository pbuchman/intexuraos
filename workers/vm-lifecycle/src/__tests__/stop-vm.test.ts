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
const mockStop = vi.fn();

vi.mock('@google-cloud/compute', () => {
  return {
    InstancesClient: class MockInstancesClient {
      get = mockGet;
      stop = mockStop;
    },
  };
});

import { stopVm } from '../stop-vm.js';

describe('stopVm', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockGet.mockReset();
    mockStop.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('should return success if VM already stopped', async () => {
    mockGet.mockResolvedValue([{ status: 'TERMINATED' }]);

    const result = await stopVm();

    expect(result.success).toBe(true);
    expect(result.message).toContain('already');
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('should gracefully shutdown when no tasks running', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op-123' }]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'acknowledged', runningTasks: 0 }),
    });

    const result = await stopVm();

    expect(result.success).toBe(true);
    expect(result.message).toBe('VM shutdown initiated');
    expect(result.runningTasksAtShutdown).toBe(0);
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('should wait for running tasks before stopping', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op-123' }]);

    let fetchCallCount = 0;
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async (url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
          fetchCallCount++;
          const urlStr = String(url);

          if (urlStr.includes('shutdown')) {
            return {
              ok: true,
              json: (): Promise<unknown> =>
                Promise.resolve({ status: 'acknowledged', runningTasks: 2 }),
            };
          }

          if (urlStr.includes('health')) {
            if (fetchCallCount <= 3) {
              return {
                ok: true,
                json: (): Promise<unknown> => Promise.resolve({ running: 2, status: 'running' }),
              };
            }
            return {
              ok: true,
              json: (): Promise<unknown> =>
                Promise.resolve({ running: 0, status: 'shutting_down' }),
            };
          }

          throw new Error(`Unexpected URL: ${urlStr}`);
        }
      );

    const resultPromise = stopVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.runningTasksAtShutdown).toBe(2);
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('should force shutdown if orchestrator unresponsive', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op-123' }]);

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      throw new Error('Timeout');
    });

    const resultPromise = stopVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('should return error if GCP API fails', async () => {
    mockGet.mockRejectedValue(new Error('GCP API Error: Permission denied'));

    const result = await stopVm();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Permission denied');
  });

  it('should handle VM in staging state', async () => {
    mockGet.mockResolvedValue([{ status: 'STAGING' }]);

    const result = await stopVm();

    expect(result.success).toBe(true);
    expect(result.message).toContain('already in STAGING');
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('should return error if stop operation fails after graceful shutdown', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockRejectedValue(new Error('Stop operation failed'));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'acknowledged', runningTasks: 0 }),
    });

    const result = await stopVm();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Stop operation failed');
  });

  it('should proceed with shutdown when orchestrator returns non-ok response', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op-456' }]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const result = await stopVm();

    expect(result.success).toBe(true);
    expect(result.runningTasksAtShutdown).toBe(0);
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('should handle non-Error exceptions', async () => {
    mockGet.mockRejectedValue('String error');

    const result = await stopVm();

    expect(result.success).toBe(false);
    expect(result.message).toContain('String error');
  });

  it('should handle health endpoint returning non-ok status during wait', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op-789' }]);

    let fetchCallCount = 0;
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async (
          url: string
        ): Promise<{ ok: boolean; json: () => Promise<unknown>; status?: number }> => {
          fetchCallCount++;
          const urlStr = String(url);

          if (urlStr.includes('shutdown')) {
            return {
              ok: true,
              json: (): Promise<unknown> =>
                Promise.resolve({ status: 'acknowledged', runningTasks: 1 }),
            };
          }

          if (urlStr.includes('health')) {
            if (fetchCallCount <= 2) {
              return {
                ok: false,
                status: 500,
                json: (): Promise<unknown> => Promise.reject(new Error('Not ok')),
              };
            }
            return {
              ok: true,
              json: (): Promise<unknown> => Promise.resolve({ running: 0, status: 'running' }),
            };
          }

          throw new Error(`Unexpected URL: ${urlStr}`);
        }
      );

    const resultPromise = stopVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('should handle graceful shutdown with running tasks that finish via running=0', async () => {
    mockGet.mockResolvedValue([{ status: 'RUNNING' }]);
    mockStop.mockResolvedValue([{ name: 'stop-op-111' }]);

    let fetchCallCount = 0;
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async (url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
          fetchCallCount++;
          const urlStr = String(url);

          if (urlStr.includes('shutdown')) {
            return {
              ok: true,
              json: (): Promise<unknown> =>
                Promise.resolve({ status: 'acknowledged', runningTasks: 1 }),
            };
          }

          if (urlStr.includes('health')) {
            if (fetchCallCount <= 2) {
              return {
                ok: true,
                json: (): Promise<unknown> => Promise.resolve({ running: 1, status: 'running' }),
              };
            }
            return {
              ok: true,
              json: (): Promise<unknown> => Promise.resolve({ running: 0, status: 'running' }),
            };
          }

          throw new Error(`Unexpected URL: ${urlStr}`);
        }
      );

    const resultPromise = stopVm();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.runningTasksAtShutdown).toBe(1);
    expect(mockStop).toHaveBeenCalledOnce();
  });
});
