/**
 * Tests for domain/utils/secrets.ts
 *
 * Test Requirements from INT-614:
 * | # | Test Name | Function/Module | Scenario | Expected |
 * | -- | -- | -- | -- | -- |
 * | 1 | generateWebhookSecret returns deterministic HMAC | secrets.ts | Same (sharedSecret, taskId) input | Same hex output every time |
 * | 2 | generateWebhookSecret returns 64-char hex string | secrets.ts | Any valid input | 64-char lowercase hex (SHA-256) |
 * | 3 | generateWebhookSecret differs for different taskIds | secrets.ts | Two different taskIds, same secret | Different outputs |
 * | 4 | generateCancelNonce returns hex string | secrets.ts | Call with no args | Non-empty hex string |
 * | 5 | generateCancelNonce returns unique values | secrets.ts | Two consecutive calls | Different outputs |
 * | 6 | CANCEL_NONCE_TTL_MS equals 15 minutes | secrets.ts | Import constant | 900000 (15 × 60 × 1000) |
 * | 7 | processCodeAction uses shared generateWebhookSecret | processCodeAction.ts | Existing use-case tests still pass | No local function definition remains |
 * | 8 | retryTask uses shared generateWebhookSecret | retryTask.ts | Existing use-case tests still pass | No local function definition remains |
 * | 9 | submitTaskFeedback uses shared generateWebhookSecret | submitTaskFeedback.ts | Existing use-case tests still pass | No local function definition remains |
 * | 10 | submitToExecutionAgent uses shared utilities | submitToExecutionAgent.ts | Existing use-case tests still pass | No local function definitions remain |
 */

import { describe, it, expect } from 'vitest';
import {
  generateWebhookSecret,
  generateCancelNonce,
  CANCEL_NONCE_TTL_MS,
} from '../../../domain/utils/secrets.js';

describe('secrets', () => {
  describe('generateWebhookSecret', () => {
    it('returns deterministic HMAC (Test #1)', () => {
      const sharedSecret = 'test-secret';
      const taskId = 'task_123';

      const result1 = generateWebhookSecret(sharedSecret, taskId);
      const result2 = generateWebhookSecret(sharedSecret, taskId);
      const result3 = generateWebhookSecret(sharedSecret, taskId);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      // SHA256('task_123') with HMAC key 'test-secret'
      expect(result1).toBe('8430736420dc7595a053d44c1334c09b0c909914a4d9ad52330cd182a7891fe2');
    });

    it('returns 64-char lowercase hex string (Test #2)', () => {
      const result = generateWebhookSecret('secret', 'task123');

      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('differs for different taskIds (Test #3)', () => {
      const sharedSecret = 'my-shared-secret';

      const result1 = generateWebhookSecret(sharedSecret, 'task_001');
      const result2 = generateWebhookSecret(sharedSecret, 'task_002');

      expect(result1).not.toBe(result2);
    });

    it('differs for different sharedSecrets', () => {
      const taskId = 'task_123';

      const result1 = generateWebhookSecret('secret1', taskId);
      const result2 = generateWebhookSecret('secret2', taskId);

      expect(result1).not.toBe(result2);
    });
  });

  describe('generateCancelNonce', () => {
    it('returns non-empty hex string (Test #4)', () => {
      const result = generateCancelNonce();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it('returns unique values on consecutive calls (Test #5)', () => {
      const result1 = generateCancelNonce();
      const result2 = generateCancelNonce();
      const result3 = generateCancelNonce();

      // With 4 bytes (8 hex chars), collisions are extremely unlikely
      expect(result1).not.toBe(result2);
      expect(result2).not.toBe(result3);
      expect(result1).not.toBe(result3);
    });

    it('returns 8 hex characters (4 bytes)', () => {
      const result = generateCancelNonce();

      // 4 bytes = 8 hex characters
      expect(result).toHaveLength(8);
    });
  });

  describe('CANCEL_NONCE_TTL_MS', () => {
    it('equals 15 minutes (900000ms) (Test #6)', () => {
      expect(CANCEL_NONCE_TTL_MS).toBe(900000);
    });
  });
});
