# 2-0: Encryption Utility

**Tier:** 2 - Encryption Infrastructure + User Service Extension
**Status:** Pending

## Context

Add AES-256-GCM encryption utility to common-core for encrypting sensitive data like API keys.

## Problem Statement

User-service has no encryption. Need reusable encryption/decryption for storing LLM API keys securely.

## Scope

**In Scope:**
- Create `packages/common-core/src/encryption.ts`
- Implement AES-256-GCM encryption/decryption
- Use environment variable for encryption key
- Export from package index

**Out of Scope:**
- Key rotation
- Key management (handled by Secret Manager)

## Required Approach

1. Use Node.js crypto module
2. AES-256-GCM with random IV per encryption
3. Return base64-encoded ciphertext with IV prepended
4. Read key from `INTEXURAOS_ENCRYPTION_KEY` env var

## Step Checklist

- [ ] Create `packages/common-core/src/encryption.ts`
- [ ] Implement `encrypt(plaintext: string, key: string): string`
- [ ] Implement `decrypt(ciphertext: string, key: string): string`
- [ ] Handle missing key gracefully (throw descriptive error)
- [ ] Export from `packages/common-core/src/index.ts`
- [ ] Add unit tests
- [ ] Verify with roundtrip test

## Definition of Done

- [ ] Encryption/decryption roundtrip works
- [ ] Tests pass with good coverage
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/common-core
npm run typecheck
```

## Rollback Plan

Delete encryption.ts and revert index.ts exports.
