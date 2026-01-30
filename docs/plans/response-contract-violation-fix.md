# Response Contract Violation Fix Plan

## Executive Summary

**Problem:** Routes across 17 services use raw `return { error: '...' }` and `return { success: true, ... }` patterns instead of the mandated `reply.ok()` and `reply.fail()` methods.

**Impact:**

- Responses lack diagnostics (`requestId`, `durationMs`)
- Inconsistent error structure (`{ error: string }` vs `{ error: { code, message } }`)
- CI verification script doesn't catch this pattern (checks `.send()`, not raw returns)

**Scope:** ~130 violations across 17 services

---

## Phase 1: Update Verification Script

**File:** `scripts/verify-reply-send.mjs`

**Current behavior:** Only detects `reply.send()` calls

**New behavior:** Also detect:

1. `return { error:` patterns in route handlers
2. `return { success: true` patterns in route handlers
3. `reply.status(XXX); return {` two-line patterns

**Implementation:**

```javascript
// Add new patterns to detect raw returns
const rawReturnPatterns = [
  /return\s*\{\s*error:/, // return { error: ... }
  /return\s*\{\s*success:\s*true/, // return { success: true, ... }
];

// Context check: only in route files (routes/*.ts) within async handlers
```

**Escape hatch:** `// @allow-raw-return: <reason>`

---

## Phase 2: Fix Violations by Service

### Violation Inventory

| Service                      | File                   | Error Returns | Success Returns | Total   |
| ---------------------------- | ---------------------- | ------------- | --------------- | ------- |
| actions-agent                | internalRoutes.ts      | 20            | 7               | 27      |
| whatsapp-service             | pubsubRoutes.ts        | 11            | 11              | 22      |
| bookmarks-agent              | internalRoutes.ts      | 4             | 0               | 4       |
| bookmarks-agent              | pubsubRoutes.ts        | 3             | 6               | 9       |
| commands-agent               | internalRoutes.ts      | 4             | 2               | 6       |
| code-agent                   | webhookRoutes.ts       | 10            | 0               | 10      |
| app-settings-service         | internalRoutes.ts      | 6             | 1               | 7       |
| mobile-notifications-service | internalRoutes.ts      | 2             | 1               | 3       |
| todos-agent                  | internalRoutes.ts      | 1             | 0               | 1       |
| todos-agent                  | pubsubRoutes.ts        | 1             | 3               | 4       |
| user-service                 | internalRoutes.ts      | 7             | 0               | 7       |
| research-agent               | internalRoutes.ts      | 4             | 5               | 9       |
| data-insights-agent          | internalRoutes.ts      | 2             | 1               | 3       |
| data-insights-agent          | dataSourceRoutes.ts    | 0             | 1               | 1       |
| data-insights-agent          | compositeFeedRoutes.ts | 0             | 1               | 1       |
| data-insights-agent          | dataInsightsRoutes.ts  | 0             | 3               | 3       |
| web-agent                    | internalRoutes.ts      | 2             | 0               | 2       |
| notes-agent                  | internalRoutes.ts      | 1             | 0               | 1       |
| notion-service               | internalRoutes.ts      | 7             | 1               | 8       |
| image-service                | internalRoutes.ts      | 3             | 0               | 3       |
| **TOTAL**                    |                        | **88**        | **43**          | **131** |

### Fix Priority (by violation count)

1. **Tier 1 (High):** actions-agent, whatsapp-service, code-agent
2. **Tier 2 (Medium):** bookmarks-agent, user-service, research-agent, notion-service
3. **Tier 3 (Low):** commands-agent, app-settings-service, data-insights-agent, todos-agent, mobile-notifications-service, web-agent, notes-agent, image-service

---

## Phase 3: Fix Patterns

### Error Returns

**Before:**

```typescript
reply.status(401);
return { error: 'Unauthorized' };
```

**After:**

```typescript
return reply.fail('UNAUTHORIZED', 'Internal auth failed');
```

### Success Returns (200)

**Before:**

```typescript
return { success: true, data: result };
```

**After:**

```typescript
return reply.ok(result);
```

### Success Returns (201)

**Before:**

```typescript
reply.status(201);
return { success: true, data: created };
```

**After:**

```typescript
void reply.status(201);
return reply.ok(created);
```

Note: Use `void` prefix to indicate we're intentionally ignoring the return value of `status()`.

### Error Code Mapping

| HTTP Status | ErrorCode             |
| ----------- | --------------------- |
| 400         | `INVALID_REQUEST`     |
| 401         | `UNAUTHORIZED`        |
| 403         | `FORBIDDEN`           |
| 404         | `NOT_FOUND`           |
| 409         | `CONFLICT`            |
| 500         | `INTERNAL_ERROR`      |
| 502         | `DOWNSTREAM_ERROR`    |
| 503         | `SERVICE_UNAVAILABLE` |

---

## Phase 4: Schema Updates

Many routes have OpenAPI schemas that expect raw `{ error: string }` responses:

```typescript
response: {
  401: {
    type: 'object',
    properties: {
      error: { type: 'string' },  // ← Must change
    },
  },
}
```

**Update to:**

```typescript
response: {
  401: {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      diagnostics: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          durationMs: { type: 'number' },
        },
      },
    },
  },
}
```

---

## Execution Plan

### Step 1: Update Verification Script

- Modify `scripts/verify-reply-send.mjs`
- Add raw return detection
- Add `@allow-raw-return` escape hatch
- Run locally to confirm all 131 violations detected

### Step 2: Fix Services (One PR per service or batch)

**Option A: One mega-PR**

- Pros: Single review, atomic change
- Cons: Large diff, harder to review

**Option B: One PR per tier**

- Tier 1 PR: actions-agent, whatsapp-service, code-agent (~59 fixes)
- Tier 2 PR: bookmarks-agent, user-service, research-agent, notion-service (~37 fixes)
- Tier 3 PR: remaining services (~35 fixes)

**Option C: One PR per service**

- Pros: Easy to review, isolated changes
- Cons: 17 PRs to manage

**Recommendation:** Option B (3 PRs by tier)

### Step 3: Update Tests

- Route tests may assert raw response shapes
- Update to match new `{ success, data/error, diagnostics }` structure

### Step 4: Run Full CI

- `pnpm run ci:tracked` must pass for each PR

---

## Risk Assessment

| Risk                     | Mitigation                                     |
| ------------------------ | ---------------------------------------------- |
| Breaking API consumers   | Internal routes only - no external API changes |
| Test failures            | Update test assertions alongside fixes         |
| Large diff               | Split into tier-based PRs                      |
| Schema validation errors | Update OpenAPI schemas in same PR              |

---

## Success Criteria

1. `pnpm run verify:reply-send` passes (including new raw return checks)
2. All 131 violations fixed
3. `pnpm run ci:tracked` passes
4. Response shapes consistent: `{ success: boolean, data?: T, error?: { code, message }, diagnostics: { requestId, durationMs } }`

---

## Files to Modify

### Verification Script

- `scripts/verify-reply-send.mjs`

### Route Files (17 services, 20 files)

- `apps/actions-agent/src/routes/internalRoutes.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/bookmarks-agent/src/routes/internalRoutes.ts`
- `apps/bookmarks-agent/src/routes/pubsubRoutes.ts`
- `apps/commands-agent/src/routes/internalRoutes.ts`
- `apps/code-agent/src/routes/webhookRoutes.ts`
- `apps/app-settings-service/src/routes/internalRoutes.ts`
- `apps/mobile-notifications-service/src/routes/internalRoutes.ts`
- `apps/todos-agent/src/routes/internalRoutes.ts`
- `apps/todos-agent/src/routes/pubsubRoutes.ts`
- `apps/user-service/src/routes/internalRoutes.ts`
- `apps/research-agent/src/routes/internalRoutes.ts`
- `apps/data-insights-agent/src/routes/internalRoutes.ts`
- `apps/data-insights-agent/src/routes/dataSourceRoutes.ts`
- `apps/data-insights-agent/src/routes/compositeFeedRoutes.ts`
- `apps/data-insights-agent/src/routes/dataInsightsRoutes.ts`
- `apps/web-agent/src/routes/internalRoutes.ts`
- `apps/notes-agent/src/routes/internalRoutes.ts`
- `apps/notion-service/src/routes/internalRoutes.ts`
- `apps/image-service/src/routes/internalRoutes.ts`

### Test Files (update assertions)

- Corresponding `__tests__/*.test.ts` files for each route

---

## Estimated Effort

| Phase                        | Effort        |
| ---------------------------- | ------------- |
| Verification script update   | 1 hour        |
| Tier 1 fixes (59 violations) | 3 hours       |
| Tier 2 fixes (37 violations) | 2 hours       |
| Tier 3 fixes (35 violations) | 2 hours       |
| Test updates                 | 2 hours       |
| Review & iteration           | 2 hours       |
| **Total**                    | **~12 hours** |
