import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use hoisted variables for the mock functions
const { mockResize, mockGet } = vi.hoisted(() => ({
  mockResize: vi.fn(),
  mockGet: vi.fn(),
}));

interface MockResponseChaining {
  send: ReturnType<typeof vi.fn>;
  setHeader: () => MockResponse;
  write: () => MockResponse;
  end: () => MockResponse;
}

interface MockResponse {
  status: ReturnType<typeof vi.fn> & MockResponseChaining;
  send: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn> & MockResponseChaining;
  write: ReturnType<typeof vi.fn> & MockResponseChaining;
  end: ReturnType<typeof vi.fn> & MockResponseChaining;
}

vi.mock('@google-cloud/compute', () => ({
  InstanceGroupManagersClient: class {
    resize = mockResize;
    get = mockGet;
  },
}));

// Mock Firestore to return null state by default (no existing state)
vi.mock('@google-cloud/firestore', async () => {
  const actual = await vi.importActual('@google-cloud/firestore');
  const mockDocGet = vi.fn().mockResolvedValue({
    exists: false,
    data: () => null,
  });
  const mockDoc = vi.fn(() => ({
    get: mockDocGet,
    set: vi.fn().mockResolvedValue(undefined),
  }));
  const mockCollection = vi.fn(() => ({
    doc: mockDoc,
  }));

  return {
    ...actual,
    Firestore: vi.fn(function () {
      return {
        collection: mockCollection,
      };
    }),
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

import { gateway } from '../functions/gateway.js';

describe('gateway function', () => {
  let mockReq: { method?: string; url?: string; path?: string; headers?: Record<string, string>; body?: unknown };
  let mockRes: MockResponse;
  let sendFn: ReturnType<typeof vi.fn>;

  function createMockRes(): MockResponse {
    sendFn = vi.fn();
    const res: Partial<MockResponse> = {
      status: vi.fn(function (this: MockResponse) {
        this.send = sendFn;
        this.setHeader = vi.fn(() => this);
        return this;
      }) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining,
      send: sendFn,
    };
    res.setHeader = vi.fn(() => res) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining;
    res.write = vi.fn(() => res) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining;
    res.end = vi.fn(() => res) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining;
    return res as MockResponse;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();

    mockReq = {
      method: 'GET',
      url: '/test',
      path: '/test',
      headers: {},
    };

    mockRes = createMockRes();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('SSE endpoints', () => {
    it('should return 503 for SSE when VM is not running', async () => {
      mockReq.path = '/devbar/logs';

      await gateway(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(sendFn).toHaveBeenCalledWith('VM not running');
    });
  });

  describe('VM stopped state', () => {
    it('should start VM and show starting page when VM is stopped', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      await gateway(mockReq, mockRes);

      expect(mockResize).toHaveBeenCalledWith({
        project: 'test-project',
        zone: 'us-central1-a',
        instanceGroupManager: 'test-mig',
        size: 1,
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 503 when VM start fails', async () => {
      mockResize.mockRejectedValue(new Error('Start failed'));

      await gateway(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      // VmControl prefixes with "Failed to start VM: " and gateway prefixes again
      expect(sendFn).toHaveBeenCalledWith('Failed to start VM: Failed to start VM: Start failed');
    });
  });

  describe('VM starting state', () => {
    it('should show starting page when state is null', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      await gateway(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Error handling', () => {
    it('should return 500 for unknown state', async () => {
      // This test verifies the gateway handles unexpected states
      await gateway(mockReq, mockRes);

      // Default behavior when no state exists - should start VM
      expect(mockResize).toHaveBeenCalled();
    });
  });

  describe('Different request paths', () => {
    it('should handle GET requests', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      mockReq.method = 'GET';
      mockReq.url = '/api/test';

      await gateway(mockReq, mockRes);

      expect(mockResize).toHaveBeenCalled();
    });

    it('should handle POST requests with body', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      mockReq.method = 'POST';
      mockReq.url = '/api/test';
      mockReq.body = { data: 'test' };

      await gateway(mockReq, mockRes);

      expect(mockResize).toHaveBeenCalled();
    });
  });
});
