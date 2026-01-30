import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { VmControl } from '../lib/vm-control.js';

describe('VmControl', () => {
  let vmControl: VmControl;

  beforeEach(() => {
    vi.clearAllMocks();
    vmControl = new VmControl();
  });

  describe('startVm', () => {
    it('should resize to 1 to start VM', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      const result = await vmControl.startVm();

      expect(result).toEqual({ success: true, message: 'VM start initiated' });
      expect(mockResize).toHaveBeenCalledWith({
        project: 'test-project',
        zone: 'us-central1-a',
        instanceGroupManager: 'test-mig',
        size: 1,
      });
    });

    it('should handle GCP errors during start', async () => {
      mockResize.mockRejectedValue(new Error('Quota exceeded'));

      const result = await vmControl.startVm();

      expect(result).toEqual({ success: false, message: 'Failed to start VM: Quota exceeded' });
    });

    it('should handle non-Error exceptions', async () => {
      mockResize.mockRejectedValue('string error');

      const result = await vmControl.startVm();

      expect(result).toEqual({ success: false, message: 'Failed to start VM: string error' });
    });

    it('should handle null error message', async () => {
      mockResize.mockRejectedValue(null);

      const result = await vmControl.startVm();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to start VM');
    });
  });

  describe('stopVm', () => {
    it('should resize to 0 to stop VM', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-stop' }]);

      const result = await vmControl.stopVm();

      expect(result).toEqual({ success: true, message: 'VM stop initiated' });
      expect(mockResize).toHaveBeenCalledWith({
        project: 'test-project',
        zone: 'us-central1-a',
        instanceGroupManager: 'test-mig',
        size: 0,
      });
    });

    it('should handle GCP errors during stop', async () => {
      mockResize.mockRejectedValue(new Error('Permission denied'));

      const result = await vmControl.stopVm();

      expect(result).toEqual({ success: false, message: 'Failed to stop VM: Permission denied' });
    });

    it('should handle non-Error exceptions', async () => {
      mockResize.mockRejectedValue({ code: 'UNKNOWN_ERROR' });

      const result = await vmControl.stopVm();

      expect(result).toEqual({ success: false, message: 'Failed to stop VM: [object Object]' });
    });
  });

  describe('getVmCount', () => {
    it('should return targetSize from MIG', async () => {
      mockGet.mockResolvedValue([{ targetSize: 1 }]);

      const count = await vmControl.getVmCount();

      expect(count).toBe(1);
      expect(mockGet).toHaveBeenCalledWith({
        project: 'test-project',
        zone: 'us-central1-a',
        instanceGroupManager: 'test-mig',
      });
    });

    it('should return 0 when targetSize is undefined', async () => {
      mockGet.mockResolvedValue([{}]);

      const count = await vmControl.getVmCount();

      expect(count).toBe(0);
    });

    it('should return 0 on error and log error', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const count = await vmControl.getVmCount();

      expect(count).toBe(0);
    });

    it('should handle non-Error exceptions', async () => {
      mockGet.mockRejectedValue('connection failed');

      const count = await vmControl.getVmCount();

      expect(count).toBe(0);
    });
  });
});
