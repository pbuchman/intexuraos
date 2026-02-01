import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use hoisted variables for the mock functions
const { mockResize, mockGet } = vi.hoisted(() => ({
  mockResize: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('@google-cloud/compute', () => ({
  InstanceGroupManagersClient: class {
    resize = mockResize;
    get = mockGet;
  },
}));

// Mock Firestore with state control - use same pattern as state.test.ts
vi.mock('@google-cloud/firestore', async () => {
  const actual = await vi.importActual('@google-cloud/firestore');
  const mockGet = vi.fn();
  return {
    ...actual,
    Firestore: vi.fn(function () {
      return {
        collection: vi.fn(() => ({
          doc: mockGet,
        })),
      };
    }),
    __mockGet: mockGet,
  };
});

vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../lib/config.js', () => ({
  CONFIG: {
    PROJECT_ID: 'test-project',
    REGION: 'us-central1',
    ZONE: 'us-central1-a',
    MIG_NAME: 'test-mig',
    ENVIRONMENT: 'dev',
    IDLE_TIMEOUT_MINUTES: 30,
  },
}));

import { idleCheck } from '../functions/idle-check.js';
import * as firestoreMock from '@google-cloud/firestore';
import type { CloudEvent } from '@google-cloud/functions-framework';

// Mock CloudEvent for scheduler-triggered function
const mockCloudEvent: CloudEvent<unknown> = {
  id: 'test-event-id',
  source: 'test-source',
  specversion: '1.0',
  type: 'google.cloud.scheduler.job.v1.executed',
};

describe('idleCheck function', () => {
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;
  let mockDocGet: ReturnType<typeof vi.fn> & {
    mockReturnValue: (value: {
      get: ReturnType<typeof vi.fn>;
      set?: ReturnType<typeof vi.fn>;
    }) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    originalSetTimeout = global.setTimeout;
    originalClearTimeout = global.clearTimeout;
    vi.useFakeTimers();

    // Get the mock reference from the Firestore mock
    mockDocGet = (firestoreMock as unknown as { __mockGet: ReturnType<typeof vi.fn> })
      .__mockGet as ReturnType<typeof vi.fn> & {
      mockReturnValue: (value: {
        get: ReturnType<typeof vi.fn>;
        set?: ReturnType<typeof vi.fn>;
      }) => void;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  });

  it('should skip check when state is null', async () => {
    mockDocGet.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: false,
        data: () => null,
      }),
    });

    await idleCheck(mockCloudEvent);

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('should skip check when status is not running', async () => {
    mockDocGet.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ status: 'stopped', branch: 'development' }),
      }),
    });

    await idleCheck(mockCloudEvent);

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('should skip stopping when VM is still active (within timeout)', async () => {
    // Recent activity (within 30 min timeout)
    const recentActivity = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

    mockDocGet.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          status: 'running',
          branch: 'development',
          lastActivity: recentActivity.toISOString(),
        }),
      }),
    });

    await idleCheck(mockCloudEvent);

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('should stop VM when idle timeout is exceeded', async () => {
    mockResize.mockResolvedValue([{ name: 'operation-stop' }]);

    // Old activity (exceeds 30 min timeout)
    const oldActivity = new Date(Date.now() - 60 * 60 * 1000); // 60 minutes ago

    mockDocGet.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          status: 'running',
          branch: 'development',
          lastActivity: oldActivity.toISOString(),
        }),
      }),
      set: vi.fn().mockResolvedValue(undefined),
    });

    await idleCheck(mockCloudEvent);

    expect(mockResize).toHaveBeenCalledWith({
      project: 'test-project',
      zone: 'us-central1-a',
      instanceGroupManager: 'test-mig',
      size: 0,
    });
  });

  it('should handle stopVm failure gracefully', async () => {
    mockResize.mockRejectedValue(new Error('Stop failed'));

    // Old activity to trigger stop attempt
    const oldActivity = new Date(Date.now() - 60 * 60 * 1000);

    mockDocGet.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          status: 'running',
          branch: 'development',
          lastActivity: oldActivity.toISOString(),
        }),
      }),
      set: vi.fn().mockResolvedValue(undefined),
    });

    // Should not throw, should log error
    await expect(idleCheck(mockCloudEvent)).resolves.toBeUndefined();
    expect(mockResize).toHaveBeenCalled();
  });

  it('should not set stopped when stopVm fails', async () => {
    mockResize.mockRejectedValue(new Error('Stop failed'));

    // Old activity to trigger stop attempt
    const oldActivity = new Date(Date.now() - 60 * 60 * 1000);

    const mockSet = vi.fn().mockResolvedValue(undefined);
    mockDocGet.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          status: 'running',
          branch: 'development',
          lastActivity: oldActivity.toISOString(),
        }),
      }),
      set: mockSet,
    });

    // The function should complete without throwing
    await expect(idleCheck(mockCloudEvent)).resolves.toBeUndefined();
    expect(mockResize).toHaveBeenCalled();
  });
});
