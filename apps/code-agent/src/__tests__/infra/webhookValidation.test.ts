/**
 * Tests for webhook signature validation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { validateWebhookSignature } from '../../infra/webhookValidation.js';
import crypto from 'node:crypto';

describe('validateWebhookSignature', () => {
  const getWebhookSecret = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getWebhookSecret.mockResolvedValue('test-secret');
  });

  function generateSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return { timestamp, signature };
  }

  function createRequest(body: object, headers: Record<string, string>): FastifyRequest {
    return {
      body,
      headers: {
        'x-request-timestamp': headers['x-request-timestamp'],
        'x-request-signature': headers['x-request-signature'],
      },
    } as unknown as FastifyRequest;
  }

  describe('header validation', () => {
    it('rejects missing timestamp header', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const { signature } = generateSignature(payload, 'test-secret');

      const request = createRequest(payload, {
        'x-request-timestamp': '',
        'x-request-signature': signature,
      });
      delete request.headers['x-request-timestamp'];

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('missing_timestamp');
      }
    });

    it('rejects missing signature header', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const timestamp = String(Math.floor(Date.now() / 1000));

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': '',
      });
      delete request.headers['x-request-signature'];

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('missing_signature');
      }
    });

    it('rejects invalid timestamp format (NaN)', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const { signature } = generateSignature(payload, 'test-secret');

      const request = createRequest(payload, {
        'x-request-timestamp': 'invalid',
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_timestamp_format');
      }
    });

    it('rejects expired timestamp (> 15 minutes)', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const expiredTimestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000));
      const { signature } = generateSignature(payload, 'test-secret');

      const request = createRequest(payload, {
        'x-request-timestamp': expiredTimestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('expired_signature');
        expect(result.error.message).toContain('timestamp age');
      }
    });
  });

  describe('taskId validation', () => {
    it('rejects missing taskId in body', async () => {
      const payload = { status: 'completed' }; // No taskId
      const { timestamp, signature } = generateSignature(payload, 'test-secret');

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown_task');
        expect(result.error.message).toContain('Missing taskId');
      }
    });

    it('rejects empty taskId in body', async () => {
      const payload = { taskId: '', status: 'completed' };
      const { timestamp, signature } = generateSignature(payload, 'test-secret');

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown_task');
        expect(result.error.message).toContain('Missing taskId');
      }
    });

    it('rejects when task not found (null secret)', async () => {
      const payload = { taskId: 'unknown-task', status: 'completed' };
      const { timestamp, signature } = generateSignature(payload, 'test-secret');

      getWebhookSecret.mockResolvedValue(null);

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown_task');
        expect(result.error.message).toContain('not found or has no webhook secret');
      }
    });

    it('rejects when task exists but has no webhook secret', async () => {
      const payload = { taskId: 'task-without-secret', status: 'completed' };
      const { timestamp, signature } = generateSignature(payload, 'test-secret');

      // Task exists but webhookSecret is null
      getWebhookSecret.mockResolvedValue(null);

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown_task');
      }
    });
  });

  describe('signature validation', () => {
    it('rejects signature length mismatch', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const timestamp = String(Math.floor(Date.now() / 1000));

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': 'abc', // Too short
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_signature');
        expect(result.error.message).toContain('length mismatch');
      }
    });

    it('rejects HMAC mismatch', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const timestamp = String(Math.floor(Date.now() / 1000));

      // Generate a valid signature but with wrong secret
      const wrongSecret = 'wrong-secret';
      const rawBody = JSON.stringify(payload);
      const message = `${timestamp}.${rawBody}`;
      const signature = crypto.createHmac('sha256', wrongSecret).update(message).digest('hex');

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_signature');
        expect(result.error.message).toContain('HMAC signature verification failed');
      }
    });

    it('accepts valid signature', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const { timestamp, signature } = generateSignature(payload, 'test-secret');

      const request = createRequest(payload, {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(true);
    });
  });

  describe('timestamp validation edge cases', () => {
    it('accepts timestamp exactly 15 minutes old', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const fifteenMinutesAgo = String(Math.floor((Date.now() - 15 * 60 * 1000) / 1000));

      // Generate signature with the actual timestamp we'll use
      const rawBody = JSON.stringify(payload);
      const message = `${fifteenMinutesAgo}.${rawBody}`;
      const signature = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');

      const request = createRequest(payload, {
        'x-request-timestamp': fifteenMinutesAgo,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      // 15 minutes = 900 seconds, which should pass (timestampAge > fifteenMinutes fails)
      expect(result.ok).toBe(true);
    });

    it('accepts future timestamps within 15 minutes', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const futureTimestamp = String(Math.floor((Date.now() + 10 * 60 * 1000) / 1000));

      // Generate signature with the actual timestamp we'll use
      const rawBody = JSON.stringify(payload);
      const message = `${futureTimestamp}.${rawBody}`;
      const signature = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');

      const request = createRequest(payload, {
        'x-request-timestamp': futureTimestamp,
        'x-request-signature': signature,
      });

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(true);
    });
  });

  describe('array header handling', () => {
    it('accepts valid signature when timestamp is an array', async () => {
      const payload = { taskId: 'task-123', status: 'completed' };
      const timestamp = String(Math.floor(Date.now() / 1000));

      // Generate signature with the actual timestamp we'll use
      const rawBody = JSON.stringify(payload);
      const message = `${timestamp}.${rawBody}`;
      const signature = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');

      // Create request with timestamp as array (Fastify can pass headers as arrays)
      const request = {
        body: payload,
        headers: {
          'x-request-timestamp': [timestamp],
          'x-request-signature': signature,
        },
      } as unknown as FastifyRequest;

      const result = await validateWebhookSignature(request, { getWebhookSecret });

      expect(result.ok).toBe(true);
    });
  });
});
