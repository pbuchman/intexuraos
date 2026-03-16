/**
 * Tests for GitHub webhook authentication
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import { parseGitHubSignature, verifyGitHubSignature } from '../../infra/github-webhook-auth.js';

describe('github-webhook-auth', () => {
  let testSecret: string;
  let testPayload: Buffer;

  beforeEach(() => {
    testSecret = randomBytes(32).toString('hex');
    testPayload = Buffer.from(JSON.stringify({ test: 'data' }), 'utf-8');
  });

  describe('parseGitHubSignature', () => {
    it('should extract digest from valid signature with sha256= prefix', () => {
      const digest = randomBytes(32).toString('hex');
      const signature = `sha256=${digest}`;
      const result = parseGitHubSignature(signature);

      expect(result).not.toBeNull();
      expect(result?.toString('hex')).toBe(digest);
    });

    it('should return null for signature without sha256= prefix', () => {
      const digest = randomBytes(32).toString('hex');
      const signature = digest;
      const result = parseGitHubSignature(signature);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseGitHubSignature('');
      expect(result).toBeNull();
    });

    it('should return null for malformed hex digest', () => {
      const signature = 'sha256=not-valid-hex!!';
      const result = parseGitHubSignature(signature);

      expect(result).toBeNull();
    });

    it('should return null for correct length but invalid hex characters', () => {
      const signature = `sha256=${'g'.repeat(64)}`;
      const result = parseGitHubSignature(signature);

      expect(result).toBeNull();
    });

    it('should return null for truncated hex digest', () => {
      const signature = 'sha256=abc123';
      const result = parseGitHubSignature(signature);

      expect(result).toBeNull();
    });
  });

  describe('verifyGitHubSignature', () => {
    it('should return true for matching signature', () => {
      const hmac = createHmac('sha256', testSecret);
      hmac.update(testPayload);
      const actualSignature = `sha256=${hmac.digest('hex')}`;

      const result = verifyGitHubSignature(testPayload, actualSignature, testSecret);
      expect(result).toBe(true);
    });

    it('should return false for non-matching signature', () => {
      const wrongDigest = randomBytes(32);
      const signature = `sha256=${wrongDigest.toString('hex')}`;

      const result = verifyGitHubSignature(testPayload, signature, testSecret);
      expect(result).toBe(false);
    });

    it('should return false for signature with wrong format', () => {
      const signature = 'invalid-format';

      const result = verifyGitHubSignature(testPayload, signature, testSecret);
      expect(result).toBe(false);
    });

    it('should return false for empty signature', () => {
      const result = verifyGitHubSignature(testPayload, '', testSecret);
      expect(result).toBe(false);
    });
  });
});
