/**
 * Tests for HMAC signing utilities.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { generateNonce, generateWebhookSecret, signDispatchRequest } from '../../../infra/services/hmacSigning.js';

describe('hmacSigning', () => {
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Store original env and set up test env
    originalEnv = { ...process.env };
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('generateNonce', () => {
    it('generates a unique nonce each time', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).toBeDefined();
      expect(nonce2).toBeDefined();
      expect(nonce1).not.toBe(nonce2);
    });

    it('generates nonce with correct format (UUID v4)', () => {
      const nonce = generateNonce();

      // UUID v4 format
      expect(nonce).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    });
  });

  describe('generateWebhookSecret', () => {
    it('generates a webhook secret with whsec prefix', () => {
      const secret = generateWebhookSecret();

      expect(secret).toMatch(/^whsec_[a-f0-9]+$/);
    });

    it('generates unique secrets each time', () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();

      expect(secret1).not.toBe(secret2);
    });

    it('generates 48 character hex after prefix (24 bytes)', () => {
      const secret = generateWebhookSecret();

      // Format: whsec_ + 48 hex chars
      const hexPart = secret.replace('whsec_', '');
      expect(hexPart).toHaveLength(48);
    });
  });

  describe('signDispatchRequest', () => {
    it('generates signature with timestamp and body', () => {
      const body = '{"taskId":"task-123","prompt":"Fix the bug"}';
      const timestamp = 1234567890;

      const result = signDispatchRequest({ logger }, { body, timestamp });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timestamp).toBe(timestamp);
        expect(result.value.signature).toBeDefined();
        expect(result.value.signature).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
      }
    });

    it('returns error when DISPATCH_SECRET not configured', () => {
      delete process.env['INTEXURAOS_DISPATCH_SECRET'];

      const result = signDispatchRequest({ logger }, { body: '{}', timestamp: Date.now() });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('missing_secret');
        expect(result.error.message).toContain('INTEXURAOS_DISPATCH_SECRET');
      }
    });

    it('generates deterministic signature for same input', () => {
      const body = '{"test":"body"}';
      const timestamp = 1234567890;

      const result1 = signDispatchRequest({ logger }, { body, timestamp });
      const result2 = signDispatchRequest({ logger }, { body, timestamp });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        // Same input should produce same signature
        expect(result1.value.signature).toBe(result2.value.signature);
        expect(result1.value.signature).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('generates different signatures for different inputs', () => {
      const timestamp = Date.now();

      const result1 = signDispatchRequest({ logger }, { body: '{"test":"body1"}', timestamp });
      const result2 = signDispatchRequest({ logger }, { body: '{"test":"body2"}', timestamp });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });

    it('generates different signatures for different timestamps', () => {
      const body = '{"test":"body"}';

      const result1 = signDispatchRequest({ logger }, { body, timestamp: 1234567890 });
      const result2 = signDispatchRequest({ logger }, { body, timestamp: 1234567891 });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });
  });
});
