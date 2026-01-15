import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { EncryptedValue, Encryptor } from '../domain/settings/ports/Encryptor.js';

export type { EncryptedValue, Encryptor };

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

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
        // Node's crypto module always throws Error instances
        return err(error as Error);
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
        // Node's crypto module always throws Error instances
        return err(error as Error);
      }
    },
  };
}

