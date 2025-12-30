import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ok, err, type Result } from './result.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export interface Encryptor {
  encrypt(plaintext: string): Result<EncryptedValue>;
  decrypt(encrypted: EncryptedValue): Result<string>;
}

export function createEncryptor(keyBase64: string): Encryptor {
  const key = Buffer.from(keyBase64, 'base64');

  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
  }

  return {
    encrypt(plaintext: string): Result<EncryptedValue> {
      try {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, key, iv);

        let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
        ciphertext += cipher.final('base64');
        const tag = cipher.getAuthTag();

        return ok({
          ciphertext,
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
        });
      } catch (error) {
        return err(error instanceof Error ? error : new Error('Encryption failed'));
      }
    },

    decrypt(encrypted: EncryptedValue): Result<string> {
      try {
        const iv = Buffer.from(encrypted.iv, 'base64');
        const tag = Buffer.from(encrypted.tag, 'base64');
        const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let plaintext = decipher.update(ciphertext, undefined, 'utf8');
        plaintext += decipher.final('utf8');

        return ok(plaintext);
      } catch (error) {
        return err(error instanceof Error ? error : new Error('Decryption failed'));
      }
    },
  };
}
