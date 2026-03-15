/**
 * Tests for token encryption utilities.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptToken, decryptToken, generateEncryptionKey } from '../../../infra/firestore/encryption.js';

describe('encryption', () => {
  const originalEnv = process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = originalEnv;
    } else {
      delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
    }
    if (originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = originalNodeEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
  });

  describe('with valid encryption key', () => {
    beforeEach(() => {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = generateEncryptionKey();
    });

    it('encrypts and decrypts a token correctly', () => {
      const original = 'my-secret-token-12345';
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(original);
    });

    it('produces different ciphertext for same input due to random IV', () => {
      const original = 'my-secret-token';
      const encrypted1 = encryptToken(original);
      const encrypted2 = encryptToken(original);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('encrypted format contains three colon-separated parts', () => {
      const encrypted = encryptToken('test');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
    });
  });

  describe('with missing encryption key (dev fallback)', () => {
    beforeEach(() => {
      delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
    });

    it('uses dev key fallback when env var is not set', () => {
      const original = 'dev-mode-token';
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(original);
    });

    it('uses dev key fallback when env var is empty string', () => {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = '';

      const original = 'empty-env-token';
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(original);
    });

    it('uses dev key fallback when key has invalid length', () => {
      // 16 bytes instead of required 32 bytes
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = Buffer.alloc(16).toString('base64');

      const original = 'invalid-length-key-token';
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(original);
    });
  });

  describe('production error handling', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
    });

    it('throws when key has wrong length in production', () => {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = Buffer.alloc(16).toString('base64');

      expect(() => encryptToken('test')).toThrow('expected 32 bytes');
    });

    it('throws when key is missing in production', () => {
      delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];

      expect(() => encryptToken('test')).toThrow('required in production');
    });
  });

  describe('decryptToken error handling', () => {
    beforeEach(() => {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = generateEncryptionKey();
    });

    it('throws when encrypted data has wrong number of parts', () => {
      expect(() => decryptToken('invalid-no-colons')).toThrow('Invalid encrypted data format');
    });
  });

  describe('generateEncryptionKey', () => {
    it('generates a base64-encoded 32-byte key', () => {
      const key = generateEncryptionKey();
      const decoded = Buffer.from(key, 'base64');

      expect(decoded.length).toBe(32);
    });

    it('generates unique keys each time', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
    });
  });
});
