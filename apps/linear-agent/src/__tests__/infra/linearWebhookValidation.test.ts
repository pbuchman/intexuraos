/**
 * Tests for Linear webhook signature validation.
 */

import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { validateLinearWebhookSignature } from '../../infra/linearWebhookValidation.js';
import type { FastifyRequest } from 'fastify';

// Augment Fastify types to include rawBody for webhook signature validation
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

describe('validateLinearWebhookSignature', () => {
  function createMockRequest(body: unknown, signature: string): FastifyRequest {
    return {
      headers: {
        'linear-signature': signature,
      },
      rawBody: JSON.stringify(body),
    } as unknown as FastifyRequest;
  }

  const webhookSecret = 'test-webhook-secret';

  describe('signature validation', () => {
    it('accepts valid signature', () => {
      const body = { test: 'data' };
      const expectedSignature = computeSignature(body, webhookSecret);
      const request = createMockRequest(body, expectedSignature);

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(true);
    });

    it('handles array header by using first element', () => {
      const body = { test: 'data' };
      const expectedSignature = computeSignature(body, webhookSecret);
      const request = {
        headers: {
          'linear-signature': [expectedSignature, 'ignored-second'],
        },
        rawBody: JSON.stringify(body),
      } as unknown as FastifyRequest;

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(true);
    });

    it('rejects when array header has wrong first element', () => {
      const body = { test: 'data' };
      const request = {
        headers: {
          'linear-signature': ['wrong-signature', 'also-wrong'],
        },
        rawBody: JSON.stringify(body),
      } as unknown as FastifyRequest;

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SIGNATURE');
      }
    });

    it('rejects signature with wrong length (length mismatch)', () => {
      const body = { test: 'data' };
      // Use a short signature that won't match the 64-char hex expected signature
      const request = createMockRequest(body, 'short');

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SIGNATURE');
        expect(result.error.message).toBe('Signature length mismatch');
      }
    });

    it('rejects missing signature header', () => {
      const request = {
        headers: {},
        rawBody: '{}',
      } as unknown as FastifyRequest;

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_SIGNATURE');
      }
    });

    it('rejects empty signature header', () => {
      const request = createMockRequest({}, '');

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SIGNATURE_FORMAT');
      }
    });

    it('rejects incorrect signature', () => {
      const body = { test: 'data' };
      // 64-char hex digest (wrong but valid format)
      const request = createMockRequest(body, 'a'.repeat(64));

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SIGNATURE');
      }
    });

    it('rejects missing raw body', () => {
      const request = {
        headers: {
          'linear-signature': 'abc123',
        },
        rawBody: undefined,
      } as unknown as FastifyRequest;

      const result = validateLinearWebhookSignature(request, webhookSecret);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SIGNATURE');
        expect(result.error.message).toBe('Missing request body');
      }
    });
  });
});

function computeSignature(body: unknown, secret: string): string {
  const rawBody = JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}
