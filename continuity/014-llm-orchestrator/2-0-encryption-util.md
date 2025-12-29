# Task 2-0: Add Encryption Utility to common-core

## Objective

Add AES-256-GCM encryption utility for securing API keys before Firestore storage.

## Files to Create

### packages/common-core/src/encryption.ts

```typescript
import { Result, ok, err } from './result.js';

export interface EncryptionConfig {
  key: string;  // 32 bytes (256 bits), base64 encoded
}

export interface EncryptedValue {
  ciphertext: string;  // base64
  iv: string;          // base64
  tag: string;         // base64
}

export interface Encryptor {
  encrypt(plaintext: string): Result<EncryptedValue, Error>;
  decrypt(encrypted: EncryptedValue): Result<string, Error>;
}

export function createEncryptor(config: EncryptionConfig): Encryptor;
```

## Implementation Notes

- Use Node.js `crypto` module
- AES-256-GCM provides authenticated encryption
- Generate random IV for each encryption
- Store encryption key in Secret Manager: `INTEXURAOS_ENCRYPTION_KEY`

## Update packages/common-core/src/index.ts

Add export:
```typescript
export { type EncryptionConfig, type EncryptedValue, type Encryptor, createEncryptor } from './encryption.js';
```

## Verification

```bash
npm run typecheck
npm run test
```

## Acceptance Criteria

- [ ] encryption.ts created
- [ ] AES-256-GCM implementation
- [ ] Unit tests for encrypt/decrypt
- [ ] Exported from index.ts
- [ ] `npm run ci` passes
