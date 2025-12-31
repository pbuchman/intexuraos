# Firestore Collection Ownership

## Overview

This document specifies the **single-owner rule** for Firestore collections in IntexuraOS: each collection MUST be owned by exactly one service.

**Key Principle:** Bounded contexts with clear ownership prevent tight coupling, enable independent scaling, and maintain data integrity.

## Rationale

### Why Single-Owner Collections?

**Problem:** Shared collections create tight coupling between services.

When multiple services access the same Firestore collection directly:

- **Coupling:** Services become dependent on each other's data models
- **Versioning:** Schema changes require coordinated deployments across services
- **Ownership Ambiguity:** Unclear who owns data integrity and migration logic
- **Testing Complexity:** Integration tests require multiple services running
- **Scaling Constraints:** Cannot independently scale services with shared data

**Solution:** Each collection owned by exactly one service.

Benefits:

- **Clear Ownership:** Single source of truth for data and business logic
- **Independent Scaling:** Scale services based on their own load patterns
- **Isolated Testing:** Test each service with fake/in-memory dependencies
- **Flexible Schema Evolution:** Change schemas without cross-service coordination
- **Bounded Contexts:** Aligns with Domain-Driven Design principles

### Comparison with Alternatives

| Approach                   | Pros                        | Cons                              | IntexuraOS Choice |
| -------------------------- | --------------------------- | --------------------------------- | ----------------- |
| **Single-owner**           | Clear boundaries, testable  | Requires HTTP for cross-service   | ✅ **CHOSEN**     |
| **Shared collections**     | Direct access, faster reads | Tight coupling, hard to version   | ❌ Rejected       |
| **ACL-based sharing**      | Fine-grained permissions    | Complex rules, hard to reason     | ❌ Rejected       |
| **Collection-per-service** | Complete isolation          | Data duplication, sync complexity | ❌ Overkill       |

**Decision:** Single-owner with HTTP-based cross-service access strikes the right balance.

## Registry Specification

### File Location

`firestore-collections.json` at repository root.

### Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "description": "Firestore Collection Ownership Registry",
  "collections": {
    "<collection_name>": {
      "owner": "<service_name>",
      "description": "<what this collection stores>"
    }
  }
}
```

**Fields:**

| Field         | Type   | Required | Description                              |
| ------------- | ------ | -------- | ---------------------------------------- |
| `owner`       | string | ✅       | Service that owns this collection        |
| `description` | string | ✅       | Human-readable purpose of the collection |

**Constraints:**

- Collection names: `^[a-zA-Z0-9_]+$` (alphanumeric + underscore)
- Owner must match an existing service directory: `apps/<owner>/`
- Each collection appears exactly once in the registry

### Example

```json
{
  "collections": {
    "user_settings": {
      "owner": "user-service",
      "description": "User preferences and encrypted API keys"
    },
    "whatsapp_messages": {
      "owner": "whatsapp-service",
      "description": "WhatsApp messages with transcription metadata"
    }
  }
}
```

## Validation Algorithm

### Script: `scripts/verify-firestore-ownership.mjs`

**Purpose:** Detect cross-service collection access violations at CI time.

**Algorithm:**

1. **Load Registry:**
   - Read `firestore-collections.json`
   - Validate JSON schema
   - Build `Map<collectionName, owner>`

2. **Scan Codebase:**
   - For each service in `apps/*/`:
     - Scan `src/infra/firestore/**/*.ts` (excluding tests)
     - Extract collection references using regex patterns

3. **Extract Collection References:**
   - Pattern 1: `const COLLECTION_NAME = 'collection_name'`
   - Pattern 2: `.collection('collection_name')`
   - Pattern 3: `constructor(collectionName = 'collection_name')`
   - Pattern 4: `this.collectionName = 'collection_name'`

4. **Validate Ownership:**
   - For each extracted collection:
     - **If NOT in registry:** Report as `UNDECLARED`
     - **If owner ≠ current service:** Report as `CROSS_SERVICE` violation

5. **Report Violations:**
   - Exit code 0: No violations
   - Exit code 1: Violations detected (blocks CI)
   - Output: File path, line number, collection name, fix instructions

### Example Output

**Cross-Service Violation:**

```
❌ FIRESTORE OWNERSHIP VIOLATIONS DETECTED

═══ Cross-Service Collection Access ═══

Collection: whatsapp_messages
Owner: whatsapp-service
Violator: user-service
File: apps/user-service/src/infra/firestore/messageRepo.ts:12

Fix: Remove direct Firestore access. Use service-to-service HTTP API:
  GET http://whatsapp-service/internal/whatsapp/<resource>
```

**Undeclared Collection:**

```
═══ Undeclared Collections ═══

Collection: new_collection
Found in: notion-service
File: apps/notion-service/src/infra/firestore/repo.ts:8

Fix: Add to firestore-collections.json:
  {
    "new_collection": {
      "owner": "notion-service",
      "description": "..."
    }
  }
```

### CI Integration

**Command:** `npm run verify:firestore`

**Location in CI:** Runs after `verify:common`, before `format` in `npm run ci`.

**Effect:** CI fails if violations detected, preventing bad merges.

## Service-to-Service Data Access

### Pattern: HTTP-Based Communication

When Service A needs data from Service B's collection:

1. **Service B** (owner) exposes an internal HTTP endpoint:

   ```
   GET /internal/{service-prefix}/{resource-path}
   ```

2. **Service A** (consumer) calls the endpoint with authentication:
   ```typescript
   const response = await fetch(`${SERVICE_B_URL}/internal/{service-prefix}/resource`, {
     headers: { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN },
   });
   ```

### Example: Notion Token Access

**Before (VIOLATION):**

```typescript
// promptvault-service accessing notion_connections directly
import { getFirestore } from '@intexuraos/infra-firestore';

const db = getFirestore();
const doc = await db.collection('notion_connections').doc(userId).get();
const token = doc.data()?.notionToken;
```

**After (CORRECT):**

```typescript
// notion-service owns notion_connections and exposes HTTP endpoint
// apps/notion-service/src/routes/internalRoutes.ts
app.get('/internal/notion/users/:userId/context', async (req, reply) => {
  validateInternalAuth(req); // Throws 401 if invalid
  const { userId } = req.params;
  const token = await getNotionToken(userId);
  return { connected: !!token, token };
});

// promptvault-service calls notion-service via HTTP
// apps/promptvault-service/src/infra/notion/notionServiceClient.ts
export async function getNotionToken(userId: string): Promise<Result<string | null, Error>> {
  const url = `${NOTION_SERVICE_URL}/internal/notion/users/${userId}/context`;
  const response = await fetch(url, {
    headers: { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN },
  });
  const data = await response.json();
  return ok(data.token);
}
```

### Internal Endpoint Conventions

See [service-to-service-communication.md](./service-to-service-communication.md) for full specification.

**Summary:**

- **Pattern:** `/internal/{service-prefix}/{resource-path}`
- **Auth:** `X-Internal-Auth` header with `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- **Response:** JSON with `{ success, data/error, diagnostics }`
- **Error Handling:** 401 for auth failures, 404 for not found, 502 for downstream errors

## Adding New Collections

### Process

1. **Decide Ownership:**
   - Which service's domain does this data belong to?
   - Which service will maintain business logic for this data?

2. **Add to Registry:**

   ```bash
   # Edit firestore-collections.json
   {
     "collections": {
       "my_new_collection": {
         "owner": "my-service",
         "description": "Stores user-specific configuration for feature X"
       }
     }
   }
   ```

3. **Create Repository:**

   ```typescript
   // apps/my-service/src/infra/firestore/myRepository.ts
   import { getFirestore } from '@intexuraos/infra-firestore';

   const COLLECTION_NAME = 'my_new_collection';

   export async function saveData(userId: string, data: MyData): Promise<Result<void, Error>> {
     const db = getFirestore();
     await db.collection(COLLECTION_NAME).doc(userId).set(data);
     return ok(undefined);
   }
   ```

4. **Verify:**

   ```bash
   npm run verify:firestore
   # Should pass with no violations
   ```

5. **Expose HTTP Endpoint (if needed for cross-service access):**
   ```typescript
   // apps/my-service/src/routes/internalRoutes.ts
   app.get('/internal/my-service/users/:userId/data', async (req, reply) => {
     validateInternalAuth(req);
     const data = await getData(req.params.userId);
     return { success: true, data };
   });
   ```

### Naming Conventions

| Pattern                | Example                   | Use Case                   |
| ---------------------- | ------------------------- | -------------------------- |
| `{service}_{resource}` | `whatsapp_messages`       | Service-specific resources |
| `{feature}_settings`   | `promptvault_settings`    | Feature configuration      |
| `{resource}_mappings`  | `whatsapp_user_mappings`  | ID mappings/lookups        |
| `{resource}_events`    | `whatsapp_webhook_events` | Event sourcing/audit logs  |

## Migration Guide

### Scenario: Moving Collection to Different Service

**Use Case:** Collection `foo_data` currently in `service-a`, needs to move to `service-b`.

**Steps:**

1. **Create HTTP endpoint in service-b:**

   ```typescript
   // apps/service-b/src/routes/internalRoutes.ts
   app.get('/internal/service-b/foo/:id', async (req, reply) => {
     validateInternalAuth(req);
     const data = await getFooData(req.params.id);
     return { success: true, data };
   });
   ```

2. **Update service-a to use HTTP client:**

   ```typescript
   // apps/service-a/src/infra/serviceBClient.ts
   export async function getFooData(id: string): Promise<Result<FooData, Error>> {
     const url = `${SERVICE_B_URL}/internal/service-b/foo/${id}`;
     const response = await fetch(url, {
       headers: { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN },
     });
     // ... parse response
   }
   ```

3. **Update registry ownership:**

   ```json
   {
     "foo_data": {
       "owner": "service-b", // Changed from service-a
       "description": "..."
     }
   }
   ```

4. **Remove direct Firestore access from service-a:**

   ```bash
   # Delete apps/service-a/src/infra/firestore/fooRepository.ts
   git rm apps/service-a/src/infra/firestore/fooRepository.ts
   ```

5. **Verify:**

   ```bash
   npm run verify:firestore
   npm run ci
   ```

6. **Deploy both services:**
   - Deploy service-b first (with HTTP endpoint)
   - Then deploy service-a (using HTTP client)

### Scenario: Splitting Collection Across Services

**Use Case:** Collection `combined_data` has two concerns: `user_prefs` and `feature_config`.

**Steps:**

1. **Create two new collections:**

   ```json
   {
     "user_preferences": {
       "owner": "user-service",
       "description": "User-specific preferences"
     },
     "feature_configuration": {
       "owner": "feature-service",
       "description": "Feature-specific configuration"
     }
   }
   ```

2. **Create repositories in each service:**

   ```typescript
   // apps/user-service/src/infra/firestore/userPrefsRepository.ts
   const COLLECTION_NAME = 'user_preferences';

   // apps/feature-service/src/infra/firestore/featureConfigRepository.ts
   const COLLECTION_NAME = 'feature_configuration';
   ```

3. **Migrate data:**

   ```typescript
   // scripts/migrate-combined-data.ts
   const oldDocs = await db.collection('combined_data').get();
   for (const doc of oldDocs) {
     const { userPrefs, featureConfig } = doc.data();
     await db.collection('user_preferences').doc(doc.id).set(userPrefs);
     await db.collection('feature_configuration').doc(doc.id).set(featureConfig);
   }
   ```

4. **Remove old collection from registry:**

   ```json
   // Remove "combined_data" entry from firestore-collections.json
   ```

5. **Delete old collection access code:**

   ```bash
   git rm apps/*/src/infra/firestore/combinedDataRepository.ts
   ```

6. **Verify and deploy:**
   ```bash
   npm run verify:firestore
   npm run ci
   ```

## Troubleshooting

### "Collection not in registry" Error

**Symptom:**

```
═══ Undeclared Collections ═══
Collection: my_collection
Found in: my-service
```

**Fix:**
Add collection to `firestore-collections.json`:

```json
{
  "my_collection": {
    "owner": "my-service",
    "description": "..."
  }
}
```

### "Cross-service access" Error

**Symptom:**

```
Collection: whatsapp_messages
Owner: whatsapp-service
Violator: user-service
```

**Fix:**
Replace direct Firestore access with HTTP call:

```typescript
// ❌ Before
const db = getFirestore();
const doc = await db.collection('whatsapp_messages').doc(id).get();

// ✅ After
const response = await fetch(`${WHATSAPP_SERVICE_URL}/internal/whatsapp/messages/${id}`, {
  headers: { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN },
});
```

### Validation Script Misses Collection Reference

**Symptom:** Using collection but validation doesn't detect it.

**Possible Causes:**

1. **Dynamic collection name:**

   ```typescript
   // ❌ Validation can't detect this
   const collectionName = getCollectionName();
   db.collection(collectionName);

   // ✅ Use constant
   const COLLECTION_NAME = 'my_collection';
   db.collection(COLLECTION_NAME);
   ```

2. **Collection reference outside `src/infra/firestore/`:**
   - Move repository code to `apps/<service>/src/infra/firestore/`

3. **Unsupported pattern:**
   - Check if your pattern matches one of the 4 regex patterns
   - Add new pattern to `scripts/verify-firestore-ownership.mjs` if needed

## References

- [service-to-service-communication.md](./service-to-service-communication.md) - HTTP endpoint patterns
- [firestore-collections.json](../../firestore-collections.json) - Collection registry
- [scripts/verify-firestore-ownership.mjs](../../scripts/verify-firestore-ownership.mjs) - Validation script
- [.claude/CLAUDE.md](../../.claude/CLAUDE.md) - Quick reference guide
