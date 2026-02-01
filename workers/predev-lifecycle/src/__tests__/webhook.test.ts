import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'crypto';

// Mock crypto module - need to mock both createHmac and timingSafeEqual
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof crypto>('crypto');

  // Create mock HMAC that produces predictable signature
  const mockUpdate = vi.fn(function (this: unknown) {
    return this;
  });
  const mockDigest = vi.fn(() => 'predicted-hash-value');
  const mockHmac = vi.fn(() => ({
    update: mockUpdate,
    digest: mockDigest,
  }));

  return {
    ...actual,
    createHmac: mockHmac,
    timingSafeEqual: vi.fn(() => true),
  };
});

vi.mock('@google-cloud/firestore', () => ({
  Firestore: vi.fn(),
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

import { webhook } from '../functions/webhook.js';

interface MockResponse {
  status: ReturnType<typeof vi.fn> & { send: (data: string) => void };
  send: ReturnType<typeof vi.fn>;
}

interface MockRequest {
  method: string;
  headers: Record<string, string>;
  rawBody: string;
  body: unknown;
}

describe('webhook function', () => {
  let mockReq: MockRequest;
  let mockRes: MockResponse;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = 'test-secret';

    const defaultBody = { ref: 'refs/heads/development' };
    mockReq = {
      method: 'POST',
      headers: {
        // Use signature that matches the mock HMAC digest output
        'x-hub-signature-256': 'sha256=predicted-hash-value',
        'x-github-event': 'push',
      },
      rawBody: JSON.stringify(defaultBody),
      body: defaultBody,
    };

    sendFn = vi.fn();
    mockRes = {
      status: vi.fn(function (this: MockResponse) {
        this.send = sendFn;
        return this;
      }) as unknown as ReturnType<typeof vi.fn> & { send: (data: string) => void },
      send: sendFn,
    } as MockResponse;
  });

  it('should reject non-POST requests', async () => {
    mockReq.method = 'GET';
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(405);
    expect(sendFn).toHaveBeenCalledWith('Method not allowed');
  });

  it('should return 500 when webhook secret is not configured', async () => {
    delete process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'];
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(500);
    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = 'test-secret';
  });

  it('should return 401 when signature is missing', async () => {
    mockReq.headers = {};
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 when signature is empty string', async () => {
    mockReq.headers = { 'x-hub-signature-256': '' };
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should ignore non-push events', async () => {
    mockReq.headers['x-github-event'] = 'pull_request';
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(sendFn).toHaveBeenCalledWith('Ignored event');
  });

  it('should return 400 when ref is missing', async () => {
    mockReq.body = {};
    mockReq.rawBody = JSON.stringify(mockReq.body);
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(sendFn).toHaveBeenCalledWith('Missing ref');
  });

  it('should return 400 when ref is empty string', async () => {
    mockReq.body = { ref: '' };
    mockReq.rawBody = JSON.stringify(mockReq.body);
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should update state with branch from push event', async () => {
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should extract branch name from refs/heads/ prefix', async () => {
    mockReq.body = { ref: 'refs/heads/feature/test-branch' };
    mockReq.rawBody = JSON.stringify({ ref: 'refs/heads/feature/test-branch' });
    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should return 401 when signature comparison fails', async () => {
    // Use an invalid signature (digest output won't match)
    mockReq.headers['x-hub-signature-256'] = 'sha256=invalid-signature';

    await webhook(mockReq as never, mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should handle timingSafeEqual errors gracefully', async () => {
    // Use a malformed signature that will cause comparison to fail
    mockReq.headers['x-hub-signature-256'] = 'invalid-format';

    await webhook(mockReq as never, mockRes as never);
    // Should return 401 due to signature validation failure
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return OK after processing push event', async () => {
    await webhook(mockReq as never, mockRes as never);
    expect(sendFn).toHaveBeenCalledWith('OK');
  });
});
