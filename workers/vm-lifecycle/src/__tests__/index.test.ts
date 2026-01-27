import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from '@google-cloud/functions-framework';

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
}));

import { startVmFunction, stopVmFunction } from '../index.js';
import { startVm } from '../start-vm.js';
import { stopVm } from '../stop-vm.js';

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

function createMockResponse(): MockResponse {
  const res = {
    statusCode: 0,
    jsonData: null as unknown,
    status(code: number): typeof res {
      this.statusCode = code;
      return this;
    },
    json(data: unknown): typeof res {
      this.jsonData = data;
      return this;
    },
  };
  return res as unknown as MockResponse;
}

describe('startVmFunction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
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
    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer wrong-token' });
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

    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
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

    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.jsonData).toEqual({
      success: false,
      message: 'Failed to start VM: Quota exceeded',
    });
  });

  it('should reject when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
    const res = createMockResponse();

    await startVmFunction(req, res);

    expect(res.statusCode).toBe(401);
  });
});

describe('stopVmFunction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
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

  it('should return 200 on successful VM stop', async () => {
    vi.mocked(stopVm).mockResolvedValue({
      success: true,
      message: 'VM shutdown initiated',
      runningTasksAtShutdown: 0,
    });

    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
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

    const req = createMockRequest('POST', { 'x-internal-auth': 'Bearer test-token' });
    const res = createMockResponse();

    await stopVmFunction(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.jsonData).toEqual({
      success: false,
      message: 'Failed to stop VM: API Error',
    });
  });
});
