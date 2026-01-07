import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '../index.js';
import { createEncryptor } from '../encryption.js';
import { randomBytes } from 'crypto';

describe('encryption', () => {
  const testKey = randomBytes(32).toString('base64');

  it('encrypts and decrypts string', () => {
    const encryptor = createEncryptor(testKey);
    const plaintext = 'sk-test-api-key-12345';

    const encryptResult = encryptor.encrypt(plaintext);
    expect(isOk(encryptResult)).toBe(true);

    if (isOk(encryptResult)) {
      const decryptResult = encryptor.decrypt(encryptResult.value);
      expect(isOk(decryptResult)).toBe(true);

      if (isOk(decryptResult)) {
        expect(decryptResult.value).toBe(plaintext);
      }
    }
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const encryptor = createEncryptor(testKey);
    const plaintext = 'test';

    const result1 = encryptor.encrypt(plaintext);
    const result2 = encryptor.encrypt(plaintext);

    if (isOk(result1) && isOk(result2)) {
      expect(result1.value.ciphertext).not.toBe(result2.value.ciphertext);
    }
  });

  it('fails to decrypt with wrong key', () => {
    const encryptor1 = createEncryptor(testKey);
    const encryptor2 = createEncryptor(randomBytes(32).toString('base64'));

    const encrypted = encryptor1.encrypt('secret');
    if (isOk(encrypted)) {
      const decrypted = encryptor2.decrypt(encrypted.value);
      expect(isErr(decrypted)).toBe(true);
    }
  });

  it('throws on invalid key length', () => {
    expect(() => createEncryptor('short')).toThrow('32 bytes');
  });

  it('handles empty string', () => {
    const encryptor = createEncryptor(testKey);
    const plaintext = '';

    const encryptResult = encryptor.encrypt(plaintext);
    expect(isOk(encryptResult)).toBe(true);

    if (isOk(encryptResult)) {
      const decryptResult = encryptor.decrypt(encryptResult.value);
      expect(isOk(decryptResult)).toBe(true);

      if (isOk(decryptResult)) {
        expect(decryptResult.value).toBe(plaintext);
      }
    }
  });

  it('handles unicode strings', () => {
    const encryptor = createEncryptor(testKey);
    const plaintext = 'API key: 日本語テスト 🔐';

    const encryptResult = encryptor.encrypt(plaintext);
    expect(isOk(encryptResult)).toBe(true);

    if (isOk(encryptResult)) {
      const decryptResult = encryptor.decrypt(encryptResult.value);
      expect(isOk(decryptResult)).toBe(true);

      if (isOk(decryptResult)) {
        expect(decryptResult.value).toBe(plaintext);
      }
    }
  });
});
