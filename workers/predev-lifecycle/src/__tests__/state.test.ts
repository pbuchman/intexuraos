import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to preserve the actual Timestamp class for instanceof checks
vi.mock('@google-cloud/firestore', async () => {
  const actual = await vi.importActual('@google-cloud/firestore');
  const mockDocMethods = vi.fn();
  return {
    ...actual,
    Firestore: vi.fn(function () {
      return {
        collection: vi.fn(() => ({
          doc: vi.fn(() => mockDocMethods()),
        })),
        runTransaction: vi.fn(),
      };
    }),
    __mockDocMethods: mockDocMethods,
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

import { StateManager } from '../lib/state.js';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import * as firestoreMock from '@google-cloud/firestore';

// Helper to create mock document snapshot
function createMockDoc(exists: boolean, data: Record<string, unknown> | null): DocumentSnapshot {
  return {
    exists,
    data: () => data,
    id: 'current',
    ref: null as unknown,
    createReadStream: vi.fn(),
    read: vi.fn(),
  } as unknown as DocumentSnapshot;
}

describe('StateManager', () => {
  let stateManager: StateManager;
  let mockDocMethods: ReturnType<typeof vi.fn> & { mockReturnValue: (value: unknown) => void };

  beforeEach(() => {
    vi.clearAllMocks();
    // Get the mock reference BEFORE creating StateManager
    mockDocMethods = (firestoreMock as unknown as { __mockDocMethods: ReturnType<typeof vi.fn> })
      .__mockDocMethods as ReturnType<typeof vi.fn> & { mockReturnValue: (value: unknown) => void };
    stateManager = new StateManager();
  });

  describe('getState', () => {
    it('should return state when document exists with all fields', async () => {
      // Use strings for dates - toDate() handles strings
      const mockData = {
        status: 'running',
        vmIp: '10.0.0.1',
        branch: 'development',
        lastActivity: '2024-01-01T00:00:00.000Z',
        startedAt: '2024-01-01T00:00:00.000Z',
      };
      const mockDoc = createMockDoc(true, mockData);
      const mockGetFn = vi.fn().mockResolvedValue(mockDoc);
      mockDocMethods.mockReturnValue({ get: mockGetFn });

      const result = await stateManager.getState();

      // Check the result
      expect(result).not.toBeNull();
      expect(result?.status).toBe('running');
      expect(result?.vmIp).toBe('10.0.0.1');
      expect(result?.branch).toBe('development');
      expect(result?.lastActivity).toBeInstanceOf(Date);
      expect(result?.startedAt).toBeInstanceOf(Date);
    });

    it('should return null when document does not exist', async () => {
      mockDocMethods.mockReturnValue({
        get: vi.fn().mockResolvedValue(createMockDoc(false, null)),
      });

      const result = await stateManager.getState();

      expect(result).toBeNull();
    });

    it('should return null when data is undefined', async () => {
      mockDocMethods.mockReturnValue({
        get: vi.fn().mockResolvedValue(createMockDoc(true, null)),
      });

      const result = await stateManager.getState();

      expect(result).toBeNull();
    });

    it('should return default values when fields are missing', async () => {
      mockDocMethods.mockReturnValue({
        get: vi.fn().mockResolvedValue(createMockDoc(true, {})),
      });

      const result = await stateManager.getState();

      expect(result).not.toBeNull();
      expect(result?.status).toBe('stopped');
      expect(result?.branch).toBe('development');
      expect(result?.vmIp).toBeNull();
      expect(result?.startedAt).toBeNull();
    });

    it('should return null on error and log error', async () => {
      mockDocMethods.mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('Firestore error')),
      });

      const result = await stateManager.getState();

      expect(result).toBeNull();
    });
  });

  describe('setState', () => {
    it('should call set with merge option', async () => {
      const mockSetFn = vi.fn().mockResolvedValue(undefined);
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      await stateManager.setState({ status: 'running' });

      expect(mockSetFn).toHaveBeenCalledWith({ status: 'running' }, { merge: true });
    });

    it('should handle set errors gracefully', async () => {
      const mockSetFn = vi.fn().mockRejectedValue(new Error('Set error'));
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      // Should not throw
      await expect(stateManager.setState({ status: 'running' })).resolves.toBeUndefined();
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivity to current time', async () => {
      const mockSetFn = vi.fn().mockResolvedValue(undefined);
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      await stateManager.updateActivity();

      expect(mockSetFn).toHaveBeenCalledWith({ lastActivity: expect.any(Date) }, { merge: true });
    });
  });

  describe('setRunning', () => {
    it('should set running state with ip and branch', async () => {
      const mockSetFn = vi.fn().mockResolvedValue(undefined);
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      await stateManager.setRunning('10.0.0.1', 'feature-branch');

      expect(mockSetFn).toHaveBeenCalledWith(
        {
          status: 'running',
          vmIp: '10.0.0.1',
          branch: 'feature-branch',
          lastActivity: expect.any(Date),
          startedAt: expect.any(Date),
        },
        { merge: true }
      );
    });
  });

  describe('setStarting', () => {
    it('should set starting status', async () => {
      const mockSetFn = vi.fn().mockResolvedValue(undefined);
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      await stateManager.setStarting();

      expect(mockSetFn).toHaveBeenCalledWith({ status: 'starting' }, { merge: true });
    });
  });

  describe('setStopped', () => {
    it('should set stopped status with null values', async () => {
      const mockSetFn = vi.fn().mockResolvedValue(undefined);
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      await stateManager.setStopped();

      expect(mockSetFn).toHaveBeenCalledWith(
        {
          status: 'stopped',
          vmIp: null,
          startedAt: null,
        },
        { merge: true }
      );
    });
  });

  describe('setStopping', () => {
    it('should set stopping status', async () => {
      const mockSetFn = vi.fn().mockResolvedValue(undefined);
      mockDocMethods.mockReturnValue({ set: mockSetFn });

      await stateManager.setStopping();

      expect(mockSetFn).toHaveBeenCalledWith({ status: 'stopping' }, { merge: true });
    });
  });
});
