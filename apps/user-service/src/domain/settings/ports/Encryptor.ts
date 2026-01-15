/**
 * Port interface for encryption service.
 * Domain layer defines these types; infra layer implements them.
 */

import type { Result } from '@intexuraos/common-core';

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export interface Encryptor {
  encrypt(plaintext: string): Result<EncryptedValue>;
  decrypt(encrypted: EncryptedValue): Result<string>;
}
