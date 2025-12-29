# Task 2-0: Add Encryption Utility to common-core

**Tier:** 2 (User service extension — depends on Tier 1 complete)

---

## Context Snapshot

- LLM API keys will be stored in Firestore as part of UserSettings
- Keys must be encrypted at rest using AES-256-GCM
- Encryption key will be stored in Secret Manager: `INTEXURAOS_ENCRYPTION_KEY`
- This utility is a shared concern → belongs in common-core

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

User-provided LLM API keys (Google, OpenAI, Anthropic) must be encrypted before storage in Firestore and decrypted when read. Need a reusable encryption utility with a simple interface.

---

## Scope

**In scope:**

- Create `packages/common-core/src/encryption.ts`
- Implement AES-256-GCM authenticated encryption
- Create factory function `createEncryptor()`
- Add unit tests for encryption/decryption
- Export from `packages/common-core/src/index.ts`

**Non-scope:**

- Key rotation mechanism
- Key generation CLI
- Secret Manager integration (handled by apps)

---

## Required Approach

### Step 1: Create src/encryption.ts

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ok, err, type Result } from './result.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export interface Encryptor {
  encrypt(plaintext: string): Result<EncryptedValue, Error>;
  decrypt(encrypted: EncryptedValue): Result<string, Error>;
}

export function createEncryptor(keyBase64: string): Encryptor {
  const key = Buffer.from(keyBase64, 'base64');

  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
  }

  return {
    encrypt(plaintext: string): Result<EncryptedValue, Error> {
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

    decrypt(encrypted: EncryptedValue): Result<string, Error> {
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
```

### Step 2: Update src/index.ts

Add export:

```typescript
export { type EncryptedValue, type Encryptor, createEncryptor } from './encryption.js';
```

### Step 3: Create test file

`packages/common-core/src/__tests__/encryption.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createEncryptor, isOk, isErr } from '../index.js';
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
});
```

---

## Step Checklist

- [ ] Create `packages/common-core/src/encryption.ts`
- [ ] Implement `createEncryptor()` factory
- [ ] Use AES-256-GCM with random IV
- [ ] Add export to `packages/common-core/src/index.ts`
- [ ] Create unit tests
- [ ] Run verification commands

---

## Definition of Done

1. `encryption.ts` exists with `createEncryptor()` function
2. AES-256-GCM authenticated encryption implemented
3. Random IV for each encryption operation
4. Unit tests pass for encrypt/decrypt cycle
5. `npm run ci` passes

---

## Verification Commands

```bash
npm run typecheck
npm run test -- packages/common-core
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove `packages/common-core/src/encryption.ts`
2. Remove test file
3. Revert changes to `packages/common-core/src/index.ts`
