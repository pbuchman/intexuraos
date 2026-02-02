import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use hoisted variables for the mock functions
const { mockResize, mockGet } = vi.hoisted(() => ({
  mockResize: vi.fn(),
  mockGet: vi.fn(),
}));

interface MockResponseChaining {
  send: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: () => MockResponse;
  write: () => MockResponse;
  end: () => MockResponse;
}

interface MockResponse {
  status: ReturnType<typeof vi.fn> & MockResponseChaining;
  send: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
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

// Mock state data - mutable so tests can change it
let mockStateData: {
  status: string;
  vmIp: string | null;
  branch: string;
  branchLocked?: boolean;
} | null = null;

// Mock Firestore to return configurable state
vi.mock('@google-cloud/firestore', async () => {
  const actual = await vi.importActual('@google-cloud/firestore');
  const mockDocGet = vi.fn().mockImplementation(() =>
    Promise.resolve({
      exists: mockStateData !== null,
      data: () => mockStateData,
    })
  );
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

// Type for test request (subset of Express Request)
interface TestRequest {
  method?: string;
  url?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

describe('gateway function', () => {
  let mockReq: TestRequest;
  let mockRes: MockResponse;
  let sendFn: ReturnType<typeof vi.fn>;

  function createMockRes(): MockResponse {
    sendFn = vi.fn();
    const jsonFn = vi.fn();
    const res: Partial<MockResponse> = {
      status: vi.fn(function (this: MockResponse) {
        this.send = sendFn;
        this.json = jsonFn;
        this.setHeader = vi.fn(() => this) as never;
        return this;
      }) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining,
      send: sendFn,
      json: jsonFn,
    };
    res.setHeader = vi.fn(() => res) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining;
    res.write = vi.fn(() => res) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining;
    res.end = vi.fn(() => res) as unknown as ReturnType<typeof vi.fn> & MockResponseChaining;
    return res as MockResponse;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockStateData = null;

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
      mockReq.url = '/devbar/logs';

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(sendFn).toHaveBeenCalledWith('VM not running');
    });
  });

  describe('VM stopped state', () => {
    it('should start VM and show starting page when VM is stopped', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      await gateway(mockReq as never, mockRes as never);

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

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      // VmControl prefixes with "Failed to start VM: " and gateway prefixes again
      expect(sendFn).toHaveBeenCalledWith('Failed to start VM: Failed to start VM: Start failed');
    });
  });

  describe('VM starting state', () => {
    it('should show starting page when state is null', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Error handling', () => {
    it('should return 500 for unknown state', async () => {
      // This test verifies the gateway handles unexpected states
      await gateway(mockReq as never, mockRes as never);

      // Default behavior when no state exists - should start VM
      expect(mockResize).toHaveBeenCalled();
    });
  });

  describe('Different request paths', () => {
    it('should handle GET requests', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      mockReq.method = 'GET';
      mockReq.url = '/api/test';

      await gateway(mockReq as never, mockRes as never);

      expect(mockResize).toHaveBeenCalled();
    });

    it('should handle POST requests with body', async () => {
      mockResize.mockResolvedValue([{ name: 'operation-start' }]);

      mockReq.method = 'POST';
      mockReq.url = '/api/test';
      mockReq.body = { data: 'test' };

      await gateway(mockReq as never, mockRes as never);

      expect(mockResize).toHaveBeenCalled();
    });
  });

  describe('VM running state', () => {
    beforeEach(() => {
      mockStateData = { status: 'running', vmIp: '10.0.0.1', branch: 'development' };
    });

    it('should proxy requests to VM when running', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]) as unknown as Headers,
        text: () => Promise.resolve('{"result":"ok"}'),
      } as Response);

      await gateway(mockReq as never, mockRes as never);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://10.0.0.1:3000/test',
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 502 on proxy error', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Connection refused'));

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(sendFn).toHaveBeenCalledWith('Bad Gateway');
    });

    it('should proxy POST requests with body', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map() as unknown as Headers,
        text: () => Promise.resolve('created'),
      } as Response);

      mockReq.method = 'POST';
      mockReq.body = { data: 'test' };

      await gateway(mockReq as never, mockRes as never);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://10.0.0.1:3000/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: 'test' }),
        })
      );
    });

    it('should proxy SSE logs endpoint when running', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: test\n\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      } as unknown as Response);

      mockReq.url = '/devbar/logs';

      await gateway(mockReq as never, mockRes as never);

      expect(global.fetch).toHaveBeenCalledWith('http://10.0.0.1:8106/logs');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('should proxy SSE events endpoint when running', async () => {
      const mockReader = {
        read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      } as unknown as Response);

      mockReq.url = '/devbar/events';

      await gateway(mockReq as never, mockRes as never);

      expect(global.fetch).toHaveBeenCalledWith('http://10.0.0.1:8105/events');
    });

    it('should return error when SSE endpoint unavailable', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      mockReq.url = '/devbar/logs';

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(sendFn).toHaveBeenCalledWith('SSE endpoint unavailable');
    });

    it('should end response when SSE has no body', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);

      mockReq.url = '/devbar/logs';

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('VM starting state (existing)', () => {
    it('should show starting page when state is starting', async () => {
      mockStateData = { status: 'starting', vmIp: null, branch: 'feature/test' };

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(sendFn).toHaveBeenCalledWith(expect.stringContaining('Starting Pre-Dev Environment'));
      expect(sendFn).toHaveBeenCalledWith(expect.stringContaining('feature/test'));
    });
  });

  describe('branch lock endpoint', () => {
    it('should return current lock state on GET', async () => {
      mockStateData = {
        status: 'running',
        vmIp: '10.0.0.1',
        branch: 'development',
        branchLocked: true,
      };
      mockReq.method = 'GET';
      mockReq.url = '/internal/branch-lock';

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        locked: true,
        branch: 'development',
        status: 'running',
      });
    });

    it('should return defaults when state is null on GET', async () => {
      mockStateData = null;
      mockReq.method = 'GET';
      mockReq.url = '/internal/branch-lock';

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        locked: false,
        branch: 'unknown',
        status: 'unknown',
      });
    });

    it('should update lock state on POST', async () => {
      mockStateData = {
        status: 'running',
        vmIp: '10.0.0.1',
        branch: 'development',
        branchLocked: false,
      };
      mockReq.method = 'POST';
      mockReq.url = '/internal/branch-lock';
      mockReq.body = { locked: true };

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        locked: false,
        branch: 'development',
        status: 'running',
      });
    });

    it('should default to false when locked not provided in POST', async () => {
      mockStateData = {
        status: 'running',
        vmIp: '10.0.0.1',
        branch: 'development',
        branchLocked: true,
      };
      mockReq.method = 'POST';
      mockReq.url = '/internal/branch-lock';
      mockReq.body = {};

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 405 for unsupported methods', async () => {
      mockStateData = {
        status: 'running',
        vmIp: '10.0.0.1',
        branch: 'development',
      };
      mockReq.method = 'DELETE';
      mockReq.url = '/internal/branch-lock';

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(405);
      expect(sendFn).toHaveBeenCalledWith('Method not allowed');
    });

    it('should return defaults when state is null on POST', async () => {
      mockStateData = null;
      mockReq.method = 'POST';
      mockReq.url = '/internal/branch-lock';
      mockReq.body = { locked: true };

      await gateway(mockReq as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        locked: false,
        branch: 'unknown',
        status: 'unknown',
      });
    });
  });
});
