/**
 * Tests for token encryption utilities.
 * Tests AES-256-GCM encryption/decryption for auth tokens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, generateEncryptionKey } from '../infra/firestore/index.js';

describe('encryption', () => {
  const originalKeyEnv = process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalKeyEnv !== undefined) {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = originalKeyEnv;
    } else {
      delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
    }
    if (originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = originalNodeEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
  });

  describe('encryptToken', () => {
    it('returns base64 string in correct format (iv:authTag:ciphertext)', () => {
      const token = 'test-refresh-token-12345';
      const encrypted = encryptToken(token);

      // Should be 3 base64 parts separated by colons
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);

      // Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      }
    });

    it('produces different ciphertext for same input (random IV)', () => {
      const token = 'same-token';
      const encrypted1 = encryptToken(token);
      const encrypted2 = encryptToken(token);

      // Ciphertext should differ due to random IV
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('handles empty string', () => {
      const encrypted = encryptToken('');
      expect(encrypted).toContain(':');
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe('');
    });

    it('handles long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const encrypted = encryptToken(longToken);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(longToken);
    });

    it('handles special characters', () => {
      const token = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(token);
    });

    it('handles unicode characters', () => {
      const token = '🔐🔑🔒 Tökën with ünïcödé';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(token);
    });
  });

  describe('decryptToken', () => {
    it('decrypts what encryptToken produces', () => {
      const originalToken = 'my-secret-refresh-token-xyz';
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('throws on malformed input - missing parts', () => {
      expect(() => decryptToken('onlyonepart')).toThrow('Invalid encrypted data format');
      expect(() => decryptToken('two:parts')).toThrow('Invalid encrypted data format');
    });

    it('throws on malformed input - empty parts', () => {
      // Empty parts fail during decryption due to invalid IV/authTag
      expect(() => decryptToken('::validpart')).toThrow();
      expect(() => decryptToken('valid::part')).toThrow();
      expect(() => decryptToken('valid:part:')).toThrow();
    });

    it('throws on malformed input - too many parts', () => {
      expect(() => decryptToken('a:b:c:d')).toThrow('Invalid encrypted data format');
    });

    it('throws on tampered ciphertext', () => {
      const token = 'original-token';
      const encrypted = encryptToken(token);
      const parts = encrypted.split(':');

      // Tamper with ciphertext (third part)
      const ciphertext = Buffer.from(parts[2] as string, 'base64');
      ciphertext[0] = (ciphertext[0] as number) ^ 0xff; // Flip bits
      parts[2] = ciphertext.toString('base64');

      const tampered = parts.join(':');
      expect(() => decryptToken(tampered)).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const token = 'original-token';
      const encrypted = encryptToken(token);
      const parts = encrypted.split(':');

      // Tamper with auth tag (second part)
      const authTag = Buffer.from(parts[1] as string, 'base64');
      authTag[0] = (authTag[0] as number) ^ 0xff;
      parts[1] = authTag.toString('base64');

      const tampered = parts.join(':');
      expect(() => decryptToken(tampered)).toThrow();
    });

    it('throws on tampered IV', () => {
      const token = 'original-token';
      const encrypted = encryptToken(token);
      const parts = encrypted.split(':');

      // Tamper with IV (first part)
      const iv = Buffer.from(parts[0] as string, 'base64');
      iv[0] = (iv[0] as number) ^ 0xff;
      parts[0] = iv.toString('base64');

      const tampered = parts.join(':');
      expect(() => decryptToken(tampered)).toThrow();
    });
  });

  describe('generateEncryptionKey', () => {
    it('returns valid base64 key', () => {
      const key = generateEncryptionKey();
      expect(() => Buffer.from(key, 'base64')).not.toThrow();
    });

    it('returns key of correct length (32 bytes = 256 bits)', () => {
      const key = generateEncryptionKey();
      const keyBuffer = Buffer.from(key, 'base64');
      expect(keyBuffer.length).toBe(32);
    });

    it('generates unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('environment variable key', () => {
    it('uses env key when set', () => {
      // Generate and set a proper key
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = generateEncryptionKey();

      const token = 'test-token';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it('uses dev fallback when env var missing', () => {
      delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];

      const token = 'test-token';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it('uses dev fallback when env var is empty string', () => {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = '';

      const token = 'test-token';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it('uses dev fallback when env key has wrong length', () => {
      // Set a key that's too short
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = Buffer.from('short').toString('base64');

      const token = 'test-token';
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it('throws in production when key is missing', () => {
      delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
      process.env['NODE_ENV'] = 'production';

      expect(() => encryptToken('test')).toThrow(
        'INTEXURAOS_TOKEN_ENCRYPTION_KEY is required in production'
      );
    });

    it('throws in production when key has wrong length', () => {
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = Buffer.from('short').toString('base64');
      process.env['NODE_ENV'] = 'production';

      expect(() => encryptToken('test')).toThrow(
        /Invalid INTEXURAOS_TOKEN_ENCRYPTION_KEY: expected 32 bytes, got \d+/
      );
    });
  });
});
