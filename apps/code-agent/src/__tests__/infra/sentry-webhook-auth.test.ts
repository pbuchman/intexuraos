/**
 * Tests for Sentry webhook authentication.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSentrySignature, verifySentrySignature } from '../../infra/sentry-webhook-auth.js';

describe('sentry-webhook-auth', () => {
  let secret: string;
  let payload: Buffer;

  beforeEach(() => {
    secret = randomBytes(32).toString('hex');
    payload = Buffer.from(JSON.stringify({ action: 'created', data: { issue: { id: '123' } } }), 'utf-8');
  });

  describe('parseSentrySignature', () => {
    it('accepts the raw 64-character hex digest from Sentry-Hook-Signature', () => {
      const digest = randomBytes(32).toString('hex');

      const result = parseSentrySignature(digest);

      expect(result?.toString('hex')).toBe(digest);
    });

    it('rejects sha256-prefixed signatures because Sentry sends a raw hex digest', () => {
      const digest = randomBytes(32).toString('hex');

      const result = parseSentrySignature(`sha256=${digest}`);

      expect(result).toBeNull();
    });

    it('rejects malformed or truncated digests', () => {
      expect(parseSentrySignature('')).toBeNull();
      expect(parseSentrySignature('not-valid-hex')).toBeNull();
      expect(parseSentrySignature('a'.repeat(62))).toBeNull();
      expect(parseSentrySignature('g'.repeat(64))).toBeNull();
    });
  });

  describe('verifySentrySignature', () => {
    it('authenticates exact Error Hub bytes on retries and rejects a one-byte change', () => {
      const exactPayload = readFileSync(
        new URL('../fixtures/error-hub-event-alert.json', import.meta.url),
      );
      const signature = createHmac('sha256', secret).update(exactPayload).digest('hex');

      expect(verifySentrySignature(exactPayload, signature, secret)).toBe(true);
      expect(verifySentrySignature(Buffer.from(exactPayload), signature, secret)).toBe(true);

      const changedPayload = Buffer.from(exactPayload);
      changedPayload[changedPayload.length - 2] = 0x20;
      expect(verifySentrySignature(changedPayload, signature, secret)).toBe(false);
    });

    it('returns true for a matching HMAC-SHA256 signature', () => {
      const signature = createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifySentrySignature(payload, signature, secret)).toBe(true);
    });

    it('returns false for a valid-looking signature with the wrong digest', () => {
      const signature = randomBytes(32).toString('hex');

      expect(verifySentrySignature(payload, signature, secret)).toBe(false);
    });

    it('returns false for an invalid signature format', () => {
      expect(verifySentrySignature(payload, 'sha256=abc', secret)).toBe(false);
    });
  });
});
