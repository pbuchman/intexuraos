/**
 * Tests for HMAC signing utilities.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { generateNonce, signDispatchRequest } from '../../../infra/services/hmacSigning.js';
import { generateWebhookSecret } from '../../../domain/utils/secrets.js';

describe('hmacSigning', () => {
  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const dispatchSigningSecret = 'test-dispatch-secret';

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
    it('generates a deterministic secret from sharedSecret and taskId', () => {
      const secret1 = generateWebhookSecret('shared-secret', 'task_123');
      const secret2 = generateWebhookSecret('shared-secret', 'task_123');

      expect(secret1).toBe(secret2);
      expect(secret1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('generates different secrets for different taskIds', () => {
      const secret1 = generateWebhookSecret('shared-secret', 'task_123');
      const secret2 = generateWebhookSecret('shared-secret', 'task_456');

      expect(secret1).not.toBe(secret2);
    });

    it('generates different secrets for different sharedSecrets', () => {
      const secret1 = generateWebhookSecret('secret-a', 'task_123');
      const secret2 = generateWebhookSecret('secret-b', 'task_123');

      expect(secret1).not.toBe(secret2);
    });
  });

  describe('signDispatchRequest', () => {
    it('generates signature with timestamp, nonce, and body', () => {
      const body = '{"taskId":"task-123","prompt":"Fix the bug"}';
      const timestamp = 1234567890;
      const nonce = 'test-nonce-123';

      const result = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp, nonce });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timestamp).toBe(timestamp);
        expect(result.value.signature).toBeDefined();
        expect(result.value.signature).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
      }
    });

    it('returns error when dispatchSigningSecret is empty', () => {
      const result = signDispatchRequest(
        { logger, dispatchSigningSecret: '' },
        { body: '{}', timestamp: Date.now(), nonce: 'test-nonce' }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('missing_secret');
        expect(result.error.message).toContain('dispatchSigningSecret is required');
      }
    });

    it('generates deterministic signature for same input', () => {
      const body = '{"test":"body"}';
      const timestamp = 1234567890;
      const nonce = 'same-nonce';

      const result1 = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp, nonce });
      const result2 = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp, nonce });

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
      const nonce = 'test-nonce';

      const result1 = signDispatchRequest({ logger, dispatchSigningSecret }, { body: '{"test":"body1"}', timestamp, nonce });
      const result2 = signDispatchRequest({ logger, dispatchSigningSecret }, { body: '{"test":"body2"}', timestamp, nonce });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });

    it('generates different signatures for different timestamps', () => {
      const body = '{"test":"body"}';
      const nonce = 'test-nonce';

      const result1 = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp: 1234567890, nonce });
      const result2 = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp: 1234567891, nonce });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });

    it('generates different signatures for different nonces', () => {
      const body = '{"test":"body"}';
      const timestamp = 1234567890;

      const result1 = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp, nonce: 'nonce-1' });
      const result2 = signDispatchRequest({ logger, dispatchSigningSecret }, { body, timestamp, nonce: 'nonce-2' });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });
  });
});
