import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from '@google-cloud/functions-framework';

// Must be set BEFORE importing ../index.js — index captures the token once at module load.
// vi.hoisted runs before any import statement, including hoisted vi.mock factories.
vi.hoisted(() => {
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
});

vi.mock('../start-vm.js', () => ({
  startVm: vi.fn(),
}));

vi.mock('../stop-vm.js', () => ({
  stopVm: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  flush: vi.fn(() => Promise.resolve()),
}));

vi.mock('../__shims__/common-worker.js', async () => {
  const actual = await vi.importActual<typeof import('../__shims__/common-worker.js')>(
    '../__shims__/common-worker.js'
  );
  return {
    // Real verifyInternalAuth — pure function, MUST be exercised by these tests.
    verifyInternalAuth: actual.verifyInternalAuth,
  };
});

import { startVmFunction, stopVmFunction } from '../index.js';
import { startVm } from '../start-vm.js';
import { stopVm } from '../stop-vm.js';
import { flush } from '../logger.js';

function createMockRequest(method: string, headers: Record<string, string> = {}): Request {
  return {
    method,
    headers,
  } as unknown as Request;
}

interface MockResponse extends Response {
  statusCode: number;
  jsonData: unknown;
}

interface ChainableResponse {
  statusCode: number;
  jsonData: unknown;
  status(code: number): ChainableResponse;
  json(data: unknown): ChainableResponse;
}

function createMockResponse(): MockResponse {
  const res: ChainableResponse = {
    statusCode: 0,
    jsonData: null as unknown,
    status(code: number): ChainableResponse {
      res.statusCode = code;
      return res;
    },
    json(data: unknown): ChainableResponse {
      res.jsonData = data;
      return res;
    },
  };
  return res as unknown as MockResponse;
}

describe('startVmFunction', () => {
  beforeEach(() => {
    vi.mocked(startVm).mockReset();
    vi.mocked(flush).mockClear();
  });

  it('should reject non-POST requests', async () => {
    const req = createMockRequest('GET');
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.jsonData).toEqual({ error: 'Method not allowed' });
  });

  it('should reject requests without auth header', async () => {
    const req = createMockRequest('POST');
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData).toEqual({ error: 'Unauthorized' });
  });

  it('should reject requests with invalid auth token', async () => {
    const req = createMockRequest('POST', { 'x-internal-auth': 'wrong-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData).toEqual({ error: 'Unauthorized' });
  });

  it('should reject requests using legacy `Bearer <token>` format (regression)', async () => {
    // Regression: old contract prefixed the token with "Bearer "; new monorepo convention is the raw token.
    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData).toEqual({ error: 'Unauthorized' });
  });

  it('should return 200 on successful VM start', async () => {
    vi.mocked(startVm).mockResolvedValue({
      success: true,
      message: 'VM started and healthy',
      startupDurationMs: 5000,
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'test-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toEqual({
      success: true,
      message: 'VM started and healthy',
      startupDurationMs: 5000,
    });
  });

  it('should return 503 on VM start failure', async () => {
    vi.mocked(startVm).mockResolvedValue({
      success: false,
      message: 'Failed to start VM: Quota exceeded',
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'test-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.jsonData).toEqual({
      success: false,
      message: 'Failed to start VM: Quota exceeded',
    });
  });

  it('flushes the logger on 405 early return', async () => {
    const req = createMockRequest('GET');
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(flush).toHaveBeenCalled();
  });

  it('flushes the logger on 401 early return', async () => {
    const req = createMockRequest('POST', { 'x-internal-auth': 'wrong-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(flush).toHaveBeenCalled();
  });

  it('flushes the logger after a successful invocation', async () => {
    vi.mocked(startVm).mockResolvedValue({
      success: true,
      message: 'VM started and healthy',
      startupDurationMs: 1000,
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'test-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(flush).toHaveBeenCalled();
  });
});

describe('stopVmFunction', () => {
  beforeEach(() => {
    vi.mocked(stopVm).mockReset();
    vi.mocked(flush).mockClear();
  });

  it('should reject non-POST requests', async () => {
    const req = createMockRequest('GET');
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.jsonData).toEqual({ error: 'Method not allowed' });
  });

  it('should reject requests without auth header', async () => {
    const req = createMockRequest('POST');
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData).toEqual({ error: 'Unauthorized' });
  });

  it('should reject requests using legacy `Bearer <token>` format (regression)', async () => {
    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonData).toEqual({ error: 'Unauthorized' });
  });

  it('should return 200 on successful VM stop', async () => {
    vi.mocked(stopVm).mockResolvedValue({
      success: true,
      message: 'VM shutdown initiated',
      runningTasksAtShutdown: 0,
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'test-token' });
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toEqual({
      success: true,
      message: 'VM shutdown initiated',
      runningTasksAtShutdown: 0,
    });
  });

  it('should return 503 on VM stop failure', async () => {
    vi.mocked(stopVm).mockResolvedValue({
      success: false,
      message: 'Failed to stop VM: API Error',
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'test-token' });
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.jsonData).toEqual({
      success: false,
      message: 'Failed to stop VM: API Error',
    });
  });

  it('flushes the logger on 405 early return', async () => {
    const req = createMockRequest('GET');
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(flush).toHaveBeenCalled();
  });

  it('flushes the logger on 401 early return', async () => {
    const req = createMockRequest('POST', { 'x-internal-auth': 'wrong-token' });
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(flush).toHaveBeenCalled();
  });

  it('flushes the logger after a successful invocation', async () => {
    vi.mocked(stopVm).mockResolvedValue({
      success: true,
      message: 'VM shutdown initiated',
      runningTasksAtShutdown: 0,
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'test-token' });
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(flush).toHaveBeenCalled();
  });
});
