import { describe, it, expect, beforeEach, vi } from 'vitest';

// Preserve actual exports while mocking Firestore
vi.mock('@google-cloud/firestore', async () => {
  const actual = await vi.importActual('@google-cloud/firestore');
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockGet = vi.fn().mockResolvedValue({ exists: false });
  return {
    ...actual,
    Firestore: vi.fn(function () {
      return {
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            set: mockSet,
            get: mockGet,
          })),
        })),
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

import { reportReady } from '../functions/report-ready.js';

interface MockResponse {
  status: ReturnType<typeof vi.fn> & { send: ReturnType<typeof vi.fn> };
  send: ReturnType<typeof vi.fn>;
}

describe('reportReady function', () => {
  let mockReq: { method?: string; body: { ip?: string | null; branch?: string | null } };
  let mockRes: MockResponse;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    sendFn = vi.fn();
    mockReq = {
      method: 'POST',
      body: {
        ip: '10.0.0.1',
        branch: 'development',
      },
    };

    mockRes = {
      status: vi.fn(function (this: MockResponse) {
        this.send = sendFn;
        return this;
      }) as unknown as ReturnType<typeof vi.fn> & { send: ReturnType<typeof vi.fn> },
      send: sendFn,
    } as MockResponse;
  });

  it('should reject non-POST requests', async () => {
    mockReq.method = 'GET';
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(405);
    expect(sendFn).toHaveBeenCalledWith('Method not allowed');
  });

  it('should return 400 when ip is missing', async () => {
    mockReq.body = { branch: 'development' };
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(sendFn).toHaveBeenCalledWith('Missing ip or branch');
  });

  it('should return 400 when branch is missing', async () => {
    mockReq.body = { ip: '10.0.0.1' };
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(sendFn).toHaveBeenCalledWith('Missing ip or branch');
  });

  it('should return 400 when both ip and branch are missing', async () => {
    mockReq.body = {};
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when ip is null', async () => {
    mockReq.body = { ip: null, branch: 'development' };
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when branch is null', async () => {
    mockReq.body = { ip: '10.0.0.1', branch: null };
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should return OK after processing', async () => {
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(sendFn).toHaveBeenCalledWith('OK');
  });

  it('should handle different branch names', async () => {
    mockReq.body = { ip: '10.0.0.2', branch: 'feature/test' };
    await reportReady(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});
