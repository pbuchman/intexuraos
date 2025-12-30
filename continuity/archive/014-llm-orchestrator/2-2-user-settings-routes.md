# Task 2-2: Add LLM API Keys Routes to user-service

**Tier:** 2 (Depends on 2-0 and 2-1)

---

## Context Snapshot

- UserSettings model extended with `llmApiKeys` (task 2-1)
- Encryption utility available in common-core (task 2-0)
- Need HTTP endpoints for managing API keys
- Keys should be returned masked for display (e.g., `sk-...4f2a`)

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Need REST endpoints for users to:

1. View which LLM providers have configured API keys (masked)
2. Set/update an API key for a specific provider
3. Delete an API key for a specific provider

---

## Scope

**In scope:**

- `GET /users/:uid/settings/llm-keys` — list configured providers with masked keys
- `PATCH /users/:uid/settings/llm-keys` — set/update a key for a provider
- `DELETE /users/:uid/settings/llm-keys/:provider` — remove a key
- Encryption/decryption using common-core encryptor
- JSON schemas for request/response validation

**Non-scope:**

- Key validation (testing the key works) — done client-side
- Key rotation
- Audit logging

---

## Required Approach

### Step 1: Add encryption key to service config

Update `apps/user-service/src/services.ts` to include encryptor:

```typescript
import { createEncryptor, type Encryptor } from '@intexuraos/common-core';

interface Services {
  // ... existing
  encryptor: Encryptor;
}

// In initialization:
const encryptionKey = process.env.INTEXURAOS_ENCRYPTION_KEY;
if (!encryptionKey) {
  throw new Error('INTEXURAOS_ENCRYPTION_KEY is required');
}

const encryptor = createEncryptor(encryptionKey);
```

### Step 2: Create JSON schemas

Add to `apps/user-service/src/routes/schemas/llmKeysSchemas.ts`:

```typescript
export const getLlmKeysResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        google: { type: 'string', nullable: true }, // masked or null
        openai: { type: 'string', nullable: true },
        anthropic: { type: 'string', nullable: true },
      },
    },
  },
} as const;

export const patchLlmKeyBodySchema = {
  type: 'object',
  required: ['provider', 'apiKey'],
  properties: {
    provider: { type: 'string', enum: ['google', 'openai', 'anthropic'] },
    apiKey: { type: 'string', minLength: 10 },
  },
} as const;

export const patchLlmKeyResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        masked: { type: 'string' },
      },
    },
  },
} as const;
```

### Step 3: Create route handlers

Add to `apps/user-service/src/routes/settingsRoutes.ts` or create new file `llmKeysRoutes.ts`:

```typescript
// GET /users/:uid/settings/llm-keys
fastify.get<{
  Params: { uid: string };
}>(
  '/users/:uid/settings/llm-keys',
  {
    schema: {
      params: uidParamsSchema,
      response: { 200: getLlmKeysResponseSchema },
    },
    preHandler: authMiddleware,
  },
  async (request, reply) => {
    const { uid } = request.params;
    const { settingsRepo } = getServices();

    const settingsResult = await settingsRepo.findByUserId(uid);
    if (isErr(settingsResult)) {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', settingsResult.error.message));
    }

    const settings = settingsResult.value;
    const llmApiKeys = settings?.llmApiKeys;

    return reply.send({
      success: true,
      data: {
        google: llmApiKeys?.google ? maskKey(llmApiKeys.google) : null,
        openai: llmApiKeys?.openai ? maskKey(llmApiKeys.openai) : null,
        anthropic: llmApiKeys?.anthropic ? maskKey(llmApiKeys.anthropic) : null,
      },
    });
  }
);

// PATCH /users/:uid/settings/llm-keys
fastify.patch<{
  Params: { uid: string };
  Body: { provider: LlmProvider; apiKey: string };
}>(
  '/users/:uid/settings/llm-keys',
  {
    schema: {
      params: uidParamsSchema,
      body: patchLlmKeyBodySchema,
      response: { 200: patchLlmKeyResponseSchema },
    },
    preHandler: authMiddleware,
  },
  async (request, reply) => {
    const { uid } = request.params;
    const { provider, apiKey } = request.body;
    const { settingsRepo, encryptor } = getServices();

    const encryptResult = encryptor.encrypt(apiKey);
    if (isErr(encryptResult)) {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Encryption failed'));
    }

    const updateResult = await settingsRepo.updateLlmApiKey(uid, provider, encryptResult.value);
    if (isErr(updateResult)) {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', updateResult.error.message));
    }

    return reply.send({
      success: true,
      data: {
        provider,
        masked: maskApiKey(apiKey),
      },
    });
  }
);

// DELETE /users/:uid/settings/llm-keys/:provider
fastify.delete<{
  Params: { uid: string; provider: LlmProvider };
}>(
  '/users/:uid/settings/llm-keys/:provider',
  {
    schema: {
      params: {
        type: 'object',
        properties: {
          uid: { type: 'string' },
          provider: { type: 'string', enum: ['google', 'openai', 'anthropic'] },
        },
      },
    },
    preHandler: authMiddleware,
  },
  async (request, reply) => {
    const { uid, provider } = request.params;
    const { settingsRepo } = getServices();

    const deleteResult = await settingsRepo.deleteLlmApiKey(uid, provider);
    if (isErr(deleteResult)) {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', deleteResult.error.message));
    }

    return reply.send({ success: true });
  }
);

// Helper function
function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function maskKey(encrypted: EncryptedValue): string {
  // Decrypt to get first/last 4 chars, then mask
  // Or just return a placeholder indicating key exists
  return '••••...configured';
}
```

### Step 4: Update settings repository

Add methods to `apps/user-service/src/infra/settings/FirestoreSettingsRepository.ts`:

```typescript
async updateLlmApiKey(
  userId: string,
  provider: LlmProvider,
  encryptedKey: EncryptedValue
): Promise<Result<void, RepositoryError>> {
  try {
    const docRef = this.collection.doc(userId);
    await docRef.update({
      [`llmApiKeys.${provider}`]: encryptedKey,
      updatedAt: new Date().toISOString(),
    });
    return ok(undefined);
  } catch (error) {
    return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
  }
}

async deleteLlmApiKey(
  userId: string,
  provider: LlmProvider
): Promise<Result<void, RepositoryError>> {
  try {
    const docRef = this.collection.doc(userId);
    await docRef.update({
      [`llmApiKeys.${provider}`]: FieldValue.delete(),
      updatedAt: new Date().toISOString(),
    });
    return ok(undefined);
  } catch (error) {
    return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
  }
}
```

### Step 5: Add to OpenAPI spec

Ensure new endpoints appear in `/openapi.json`.

---

## Step Checklist

- [ ] Add `INTEXURAOS_ENCRYPTION_KEY` to service config
- [ ] Add encryptor to services container
- [ ] Create JSON schemas for LLM keys endpoints
- [ ] Implement GET /users/:uid/settings/llm-keys
- [ ] Implement PATCH /users/:uid/settings/llm-keys
- [ ] Implement DELETE /users/:uid/settings/llm-keys/:provider
- [ ] Add `updateLlmApiKey` and `deleteLlmApiKey` to repository
- [ ] Add tests for new endpoints
- [ ] Verify OpenAPI spec includes new routes
- [ ] Run verification commands

---

## Definition of Done

1. Three new endpoints working:
   - GET returns masked keys for configured providers
   - PATCH encrypts and stores new key
   - DELETE removes key for provider
2. Encryption key loaded from environment
3. Tests pass for all new endpoints
4. OpenAPI spec updated
5. `npm run ci` passes

---

## Verification Commands

```bash
npm run typecheck
npm run test -- apps/user-service
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Revert changes to routes
2. Revert changes to repository
3. Revert changes to services.ts
4. Remove JSON schema files
