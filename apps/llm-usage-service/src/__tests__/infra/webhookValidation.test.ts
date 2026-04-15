import crypto from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateOrchestratorSignature } from '../../infra/webhookValidation.js';
import type { FastifyRequest } from 'fastify';

function createRequest(headers: Record<string, string | undefined>, body: unknown): FastifyRequest {
  return {
    headers,
    body,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  } as unknown as FastifyRequest;
}

function signBody(secret: string, timestamp: number, body: unknown): string {
  const message = `${String(timestamp)}.${JSON.stringify(body)}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

describe('validateOrchestratorSignature', () => {
  const secret = 'test-secret-key';
  const deps = { orchestratorSecret: secret };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok for a valid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = { schemaVersion: 2, events: [] };
    const signature = signBody(secret, timestamp, body);

    const request = createRequest(
      { 'x-request-timestamp': String(timestamp), 'x-request-signature': signature },
      body,
    );

    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(true);
  });

  it('returns error for missing timestamp', () => {
    const request = createRequest(
      { 'x-request-signature': 'abc' },
      {},
    );
    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('missing_timestamp');
    }
  });

  it('returns error for missing signature', () => {
    const request = createRequest(
      { 'x-request-timestamp': '12345' },
      {},
    );
    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('missing_signature');
    }
  });

  it('returns error for invalid timestamp format', () => {
    const request = createRequest(
      { 'x-request-timestamp': 'not-a-number', 'x-request-signature': 'abc' },
      {},
    );
    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_timestamp_format');
    }
  });

  it('returns error for expired signature', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 20 * 60; // 20 minutes ago
    const body = {};
    const signature = signBody(secret, oldTimestamp, body);

    const request = createRequest(
      { 'x-request-timestamp': String(oldTimestamp), 'x-request-signature': signature },
      body,
    );

    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('expired_signature');
    }
  });

  it('returns error for invalid signature (wrong secret)', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {};
    const signature = signBody('wrong-secret', timestamp, body);

    const request = createRequest(
      { 'x-request-timestamp': String(timestamp), 'x-request-signature': signature },
      body,
    );

    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_signature');
    }
  });

  it('returns error for signature length mismatch', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {};

    const request = createRequest(
      { 'x-request-timestamp': String(timestamp), 'x-request-signature': 'short' },
      body,
    );

    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_signature');
    }
  });

  it('handles array timestamp header', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = { test: true };
    const signature = signBody(secret, timestamp, body);

    const request = createRequest(
      {
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
      },
      body,
    );
    // Simulate array header
    (request.headers as Record<string, string | string[]>)['x-request-timestamp'] = [String(timestamp)];

    const result = validateOrchestratorSignature(request, deps);
    expect(result.ok).toBe(true);
  });
});
