/**
 * Token encryption utilities.
 * Uses AES-256-GCM for encrypting sensitive tokens at rest.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment.
 * Falls back to a deterministic key for local dev (NOT SECURE).
 * Throws in production if key is missing or invalid.
 */
function getEncryptionKey(): Buffer {
  const keyEnv = process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (keyEnv !== undefined && keyEnv !== '') {
    const key = Buffer.from(keyEnv, 'base64');
    if (key.length === KEY_LENGTH) {
      return key;
    }
    if (isProduction) {
      throw new Error(
        `Invalid INTEXURAOS_TOKEN_ENCRYPTION_KEY: expected ${String(KEY_LENGTH)} bytes, got ${String(key.length)}`
      );
    }
  } else if (isProduction) {
    throw new Error('INTEXURAOS_TOKEN_ENCRYPTION_KEY is required in production');
  }

  const devKey = Buffer.alloc(KEY_LENGTH);
  devKey.write('intexuraos-dev-key-not-for-production');
  return devKey;
}

/**
 * Encrypt a token string.
 * Returns base64-encoded encrypted data with IV and auth tag.
 * Format: iv:authTag:ciphertext (all base64)
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine iv, authTag, and encrypted data
  const combined = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  return combined;
}

/**
 * Decrypt an encrypted token string.
 * Expects format: iv:authTag:ciphertext (all base64)
 */
export function decryptToken(encryptedData: string): string {
  const key = getEncryptionKey();

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const ivPart = parts[0];
  const authTagPart = parts[1];
  const encryptedPart = parts[2];

  if (ivPart === undefined || authTagPart === undefined || encryptedPart === undefined) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivPart, 'base64');
  const authTag = Buffer.from(authTagPart, 'base64');
  const encrypted = Buffer.from(encryptedPart, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Generate a new encryption key.
 * Returns base64-encoded 32-byte key suitable for INTEXURAOS_TOKEN_ENCRYPTION_KEY.
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64');
}
