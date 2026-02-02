# Linear Webhook Multi-Tenant Fix

**Status:** Ready for Review
**Created:** 2026-02-02
**Linear Issue:** TBD (create after plan approval)

## Problem Statement

The current Linear webhook implementation has two critical issues:

### Issue 1: Wrong Header Name (BUG)

| Expected (Linear Docs) | Actual (Our Code)   |
| ---------------------- | ------------------- |
| `Linear-Signature`     | `linear-hmacsha256` |

**Impact:** Webhooks from Linear will fail with "Missing signature" error because we're looking for the wrong header.

**Evidence:**

- Linear docs: "Linear-Signature: The HMAC signature for verification"
- Our code: `request.headers['linear-hmacsha256']` (line 41 of `linearWebhookValidation.ts`)

### Issue 2: Single App-Wide Secret (ARCHITECTURE)

Current design uses `INTEXURAOS_LINEAR_WEBHOOK_SECRET` env var for ALL organizations:

```
Alpha Corp (Linear) ──┐
                      ├──▶ Same webhook secret ──▶ linear-agent
Beta Inc (Linear)  ───┘
```

**Impact:**

- All organizations must share the same secret
- No isolation between organizations
- Secret compromise affects all users

## Proposed Solution

### Fix 1: Correct Header Name

Change `linear-hmacsha256` to `linear-signature` (Fastify normalizes to lowercase).

### Fix 2: Per-Connection Webhook Secrets

Move webhook secrets from env var to Firestore, stored per-connection:

```
Alpha Corp ──▶ secret: xyz789... ──┐
                                   ├──▶ linear-agent validates per-org
Beta Inc  ──▶ secret: qrs456... ───┘
```

---

## Endpoint Changes

| Service      | Method | Path              | Change                                         |
| ------------ | ------ | ----------------- | ---------------------------------------------- |
| linear-agent | POST   | `/linear/webhook` | Validate signature using per-connection secret |

**No new endpoints required.** The existing webhook endpoint's validation logic changes internally.

---

## Implementation Steps

### Phase 1: Fix Header Name (Bug Fix)

**Files to modify:**

| File                                                                    | Change                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/linear-agent/src/infra/linearWebhookValidation.ts`                | Change header from `linear-hmacsha256` to `linear-signature` |
| `apps/linear-agent/src/__tests__/infra/linearWebhookValidation.test.ts` | Update mock header name in tests                             |
| `apps/linear-agent/src/__tests__/routes/linearWebhookRoutes.test.ts`    | Update header name in integration tests                      |
| `apps/linear-agent/src/routes/linearWebhookRoutes.ts`                   | Update schema header documentation                           |

**Step 1.1:** Update `linearWebhookValidation.ts`

```typescript
// OLD (line 41)
const signatureHeader = request.headers['linear-hmacsha256'];

// NEW
const signatureHeader = request.headers['linear-signature'];
```

```typescript
// OLD (line 44)
return err({ code: 'MISSING_SIGNATURE', message: 'Missing Linear-Hmacsha256 header' });

// NEW
return err({ code: 'MISSING_SIGNATURE', message: 'Missing Linear-Signature header' });
```

Also update the JSDoc comment (lines 27-30) to reference `Linear-Signature`.

**Step 1.2:** Update `linearWebhookValidation.test.ts`

```typescript
// OLD (line 21)
'linear-hmacsha256': signature,

// NEW
'linear-signature': signature,
```

Update all test mock headers from `linear-hmacsha256` to `linear-signature`.

**Step 1.3:** Update `linearWebhookRoutes.test.ts`

```typescript
// OLD (line 119, 154, 171, 188)
'Linear-Hmacsha256': signature,

// NEW
'Linear-Signature': signature,
```

**Step 1.4:** Update `linearWebhookRoutes.ts` schema documentation

```typescript
// OLD (line 165)
'linear-hmacsha256': {

// NEW
'linear-signature': {
```

Update the description as well.

---

### Phase 2: Schema Changes

**Files to modify:**

| File                                                                  | Change                                              |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts` | Add `webhookSecret` field to schema                 |
| `apps/linear-agent/src/domain/models.ts` (or equivalent)              | Add `webhookSecret` to `LinearConnection` interface |
| `firestore-collections.json`                                          | Document new field (if applicable)                  |

**Step 2.1:** Update `LinearConnectionDoc` interface

```typescript
// NEW field
interface LinearConnectionDoc {
  userId: string;
  apiKey: string;
  teamId: string;
  teamName: string;
  webhookSecret: string | null; // NEW - null if not configured
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**Step 2.2:** Update domain model `LinearConnection`

```typescript
interface LinearConnection {
  userId: string;
  apiKey: string;
  teamId: string;
  teamName: string;
  webhookSecret: string | null; // NEW
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**Step 2.3:** Add new repository method `findWebhookSecretByTeamId`

```typescript
export async function findWebhookSecretByTeamId(
  teamId: string
): Promise<Result<{ userId: string; webhookSecret: string } | null, LinearError>> {
  const db = getFirestore();
  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('connected', '==', true)
    .where('teamId', '==', teamId)
    .limit(1)
    .get();

  if (snapshot.empty) return ok(null);

  const doc = snapshot.docs[0];
  if (!doc) return ok(null);

  const data = doc.data() as LinearConnectionDoc;
  if (!data.webhookSecret) return ok(null);

  return ok({ userId: doc.id, webhookSecret: data.webhookSecret });
}
```

---

### Phase 3: Update Webhook Validation Flow

**Files to modify:**

| File                                                     | Change                                                  |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `apps/linear-agent/src/routes/linearWebhookRoutes.ts`    | Lookup secret by team ID before validation              |
| `apps/linear-agent/src/infra/linearWebhookValidation.ts` | No changes needed (already accepts secret as parameter) |
| `apps/linear-agent/src/services.ts`                      | Update repository interface if needed                   |

**Step 3.1:** Update webhook handler flow

Current flow:

```typescript
const webhookSecret = process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'];
const signatureResult = validateLinearWebhookSignature(request, webhookSecret);
// ... then lookup user by team
```

New flow:

```typescript
// 1. Parse body to get team ID (untrusted at this point)
const { data } = request.body;
const teamId = data.team.id;

// 2. Lookup secret AND user by team ID
const secretResult = await services.connectionRepository.findWebhookSecretByTeamId(teamId);
if (!secretResult.ok) {
  return reply.fail('INTERNAL_ERROR', 'Failed to lookup connection');
}

if (secretResult.value === null) {
  // No connected user with webhook secret for this team
  return reply.ok({ message: 'Team not connected or webhook not configured' });
}

const { userId, webhookSecret } = secretResult.value;

// 3. Validate signature with per-connection secret
const signatureResult = validateLinearWebhookSignature(request, webhookSecret);
if (!signatureResult.ok) {
  return reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
}

// 4. Process webhook (now trusted)
// ... rest of handler using userId
```

---

### Phase 4: Add Webhook Configuration Endpoints

**Files to create/modify:**

| File                                                                  | Change                                          |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| `apps/linear-agent/src/routes/linearRoutes.ts`                        | Add POST/GET `/linear/webhook-config` endpoints |
| `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts` | Add `updateWebhookSecret` method                |

**Step 4.1:** Add `updateWebhookSecret` repository method

```typescript
export async function updateWebhookSecret(
  userId: string,
  webhookSecret: string | null
): Promise<Result<void, LinearError>> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION_NAME).doc(userId);
  const now = new Date().toISOString();

  await docRef.update({
    webhookSecret,
    updatedAt: now,
  });

  return ok(undefined);
}
```

**Step 4.2:** Add webhook configuration endpoints

```typescript
// GET /linear/webhook-config - Get webhook URL and current secret status
fastify.get('/linear/webhook-config', { ... }, async (request, reply) => {
  const connection = await services.connectionRepository.getFullConnection(userId);
  return reply.ok({
    webhookUrl: 'https://intexuraos-linear-agent-cj44trunra-lm.a.run.app/linear/webhook',
    hasWebhookSecret: connection?.webhookSecret !== null,
    teamId: connection?.teamId,
  });
});

// POST /linear/webhook-config - Generate or update webhook secret
fastify.post('/linear/webhook-config', { ... }, async (request, reply) => {
  const { secret } = request.body; // User provides the secret they configured in Linear
  await services.connectionRepository.updateWebhookSecret(userId, secret);
  return reply.ok({ configured: true });
});

// DELETE /linear/webhook-config - Remove webhook secret
fastify.delete('/linear/webhook-config', { ... }, async (request, reply) => {
  await services.connectionRepository.updateWebhookSecret(userId, null);
  return reply.ok({ configured: false });
});
```

---

### Phase 5: Cleanup

**Files to modify:**

| File                                                  | Change                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `apps/linear-agent/src/index.ts`                      | Remove `INTEXURAOS_LINEAR_WEBHOOK_SECRET` from REQUIRED_ENV |
| `apps/linear-agent/src/server.ts`                     | Remove from swagger env vars list if present                |
| `apps/linear-agent/src/routes/linearWebhookRoutes.ts` | Remove `process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET']`    |
| `terraform/environments/dev/main.tf`                  | Remove secret from linear_agent.secrets                     |
| `ecosystem.config.cjs`                                | Remove `INTEXURAOS_LINEAR_WEBHOOK_SECRET` entry             |

**Step 5.1:** Update `index.ts` REQUIRED_ENV

```typescript
// REMOVE from REQUIRED_ENV array (line 18):
// 'INTEXURAOS_LINEAR_WEBHOOK_SECRET',
```

**Step 5.2:** Update `server.ts`

```typescript
// REMOVE from hiddenEnvVars array (line 47):
// 'INTEXURAOS_LINEAR_WEBHOOK_SECRET',
```

**Step 5.3:** Update Terraform `main.tf`

```terraform
# REMOVE from linear_agent secrets block (lines 1459-1461):
# secrets = merge(local.common_service_secrets, {
#   INTEXURAOS_LINEAR_WEBHOOK_SECRET = module.secret_manager.secret_ids["INTEXURAOS_LINEAR_WEBHOOK_SECRET"]
# })

# CHANGE TO:
secrets = local.common_service_secrets
env_vars = local.common_service_env_vars
```

Also remove from secret_manager module if it's the only consumer.

**Step 5.4:** Update `ecosystem.config.cjs`

```javascript
// REMOVE (lines 21-22):
// INTEXURAOS_LINEAR_WEBHOOK_SECRET:
//   process.env.INTEXURAOS_LINEAR_WEBHOOK_SECRET ?? 'local-dev-webhook-secret',
```

---

## Test Scenarios (100% Coverage)

### Unit Tests: `linearWebhookValidation.test.ts`

| #   | Scenario                                       | Expected Result                                     |
| --- | ---------------------------------------------- | --------------------------------------------------- |
| 1   | Valid signature with `linear-signature` header | Returns `ok(undefined)`                             |
| 2   | Missing `linear-signature` header              | Returns `err({ code: 'MISSING_SIGNATURE' })`        |
| 3   | Invalid signature format (no `sha256=` prefix) | Returns `err({ code: 'INVALID_SIGNATURE_FORMAT' })` |
| 4   | Incorrect signature (wrong hash)               | Returns `err({ code: 'INVALID_SIGNATURE' })`        |
| 5   | Missing raw body                               | Returns `err({ code: 'INVALID_SIGNATURE' })`        |
| 6   | Empty signature header                         | Returns `err({ code: 'INVALID_SIGNATURE_FORMAT' })` |
| 7   | Array signature header (edge case)             | Uses first element, validates correctly             |

### Integration Tests: `linearWebhookRoutes.test.ts`

| #   | Scenario                                        | Expected Result                                 |
| --- | ----------------------------------------------- | ----------------------------------------------- |
| 1   | Valid webhook with per-connection secret        | 200 OK, issue synced                            |
| 2   | Missing signature header                        | 401 Unauthorized                                |
| 3   | Invalid signature                               | 401 Unauthorized                                |
| 4   | Non-Issue event type                            | 200 OK, `{ message: 'Ignored' }`                |
| 5   | Unconnected team (no connection exists)         | 200 OK, `{ message: 'Team not connected' }`     |
| 6   | Connected team but no webhook secret configured | 200 OK, `{ message: 'Webhook not configured' }` |
| 7   | Team connection lookup fails (Firestore error)  | 500 Internal Error                              |
| 8   | Issue sync fails after validation               | 500 Internal Error                              |
| 9   | Valid webhook for `update` action               | 200 OK, `{ action: 'updated' }`                 |
| 10  | Valid webhook for `remove` action               | 200 OK, `{ action: 'deleted' }`                 |

### Repository Tests: `linearConnectionRepository.test.ts`

| #   | Scenario                                              | Expected Result                     |
| --- | ----------------------------------------------------- | ----------------------------------- |
| 1   | `findWebhookSecretByTeamId` - team exists with secret | Returns `{ userId, webhookSecret }` |
| 2   | `findWebhookSecretByTeamId` - team exists, no secret  | Returns `null`                      |
| 3   | `findWebhookSecretByTeamId` - team not found          | Returns `null`                      |
| 4   | `findWebhookSecretByTeamId` - disconnected user       | Returns `null`                      |
| 5   | `findWebhookSecretByTeamId` - Firestore error         | Returns error result                |
| 6   | `updateWebhookSecret` - sets secret                   | Success, doc updated                |
| 7   | `updateWebhookSecret` - clears secret (null)          | Success, doc updated                |
| 8   | `saveLinearConnection` - preserves webhookSecret      | Existing secret not overwritten     |

### Route Tests: `linearRoutes.test.ts` (new webhook-config endpoints)

| #   | Scenario                                             | Expected Result                       |
| --- | ---------------------------------------------------- | ------------------------------------- |
| 1   | GET `/linear/webhook-config` - connected with secret | 200 OK, `{ hasWebhookSecret: true }`  |
| 2   | GET `/linear/webhook-config` - connected, no secret  | 200 OK, `{ hasWebhookSecret: false }` |
| 3   | GET `/linear/webhook-config` - not connected         | 403 Forbidden                         |
| 4   | POST `/linear/webhook-config` - valid secret         | 200 OK, `{ configured: true }`        |
| 5   | POST `/linear/webhook-config` - empty secret         | 400 Bad Request                       |
| 6   | DELETE `/linear/webhook-config`                      | 200 OK, `{ configured: false }`       |

---

## Migration Plan

### Backward Compatibility

The migration is **backward compatible** because:

1. **Existing connections** can continue working with the env var during transition
2. **New flow** checks per-connection secret first, falls back to env var (optional)
3. **Users configure** their own secrets at their own pace

### Migration Steps

1. Deploy Phase 1 (header fix) - **URGENT**, current webhooks are broken
2. Deploy Phase 2-4 (schema + new flow + endpoints)
3. Communicate to users: configure webhook secrets via new settings
4. After all users migrated: Deploy Phase 5 (cleanup env var)

### Rollback Plan

If issues arise:

1. Phase 5 cleanup is reversible - re-add env var
2. Phases 2-4 can coexist with env var as fallback
3. Phase 1 (header fix) cannot be rolled back without breaking webhooks

---

## Documentation Updates

| File                                      | Change                                     |
| ----------------------------------------- | ------------------------------------------ |
| `docs/setup/12-linear-integration.md`     | Update to reflect per-user webhook secrets |
| `docs/services/linear-agent/technical.md` | Add webhook-config endpoints documentation |
| `docs/services/linear-agent/tutorial.md`  | Add webhook setup section                  |

---

## Verification Checklist

- [ ] All tests pass with `pnpm run verify:workspace:tracked -- linear-agent`
- [ ] Header name changed to `linear-signature`
- [ ] Per-connection secret lookup working
- [ ] New webhook-config endpoints accessible
- [ ] Terraform updated (secret removed from linear-agent)
- [ ] ecosystem.config.cjs updated
- [ ] index.ts REQUIRED_ENV updated
- [ ] Documentation updated
- [ ] `pnpm run ci:tracked` passes

---

## Risks

| Risk                                 | Mitigation                                                |
| ------------------------------------ | --------------------------------------------------------- |
| Existing webhooks stop working       | Phase 1 (header fix) deployed first                       |
| Users don't configure new secrets    | Keep env var as fallback initially                        |
| Firestore index needed for new query | Composite index already exists for `connected` + `teamId` |

---

## Files Summary

### Modified Files

1. `apps/linear-agent/src/infra/linearWebhookValidation.ts`
2. `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts`
3. `apps/linear-agent/src/routes/linearWebhookRoutes.ts`
4. `apps/linear-agent/src/routes/linearRoutes.ts`
5. `apps/linear-agent/src/domain/models.ts` (or ports.ts)
6. `apps/linear-agent/src/services.ts`
7. `apps/linear-agent/src/index.ts`
8. `apps/linear-agent/src/server.ts`
9. `apps/linear-agent/src/__tests__/infra/linearWebhookValidation.test.ts`
10. `apps/linear-agent/src/__tests__/routes/linearWebhookRoutes.test.ts`
11. `apps/linear-agent/src/__tests__/routes/linearRoutes.test.ts`
12. `terraform/environments/dev/main.tf`
13. `ecosystem.config.cjs`
14. `docs/setup/12-linear-integration.md`
15. `docs/services/linear-agent/technical.md`

### No New Files Required

All changes fit within existing file structure.

---

**Ready for Review**
