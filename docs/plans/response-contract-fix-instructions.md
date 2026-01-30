# Response Contract Fix - Agent Instructions

## Task Overview

Fix 132 response contract violations across 17 services. Routes are using raw `return { error: ... }` and `return { success: true, ... }` instead of the standard `reply.ok()` and `reply.fail()` methods.

## Before Starting

```bash
# Run verification script to see all current violations
node scripts/verify-reply-send.mjs
```

This will output all violations with file paths, line numbers, and recommended fixes.

## The Fix Patterns

### Pattern 1: Error Returns → `reply.fail()`

**Before:**

```typescript
reply.status(401);
return { error: 'Unauthorized' };
```

**After:**

```typescript
return reply.fail('UNAUTHORIZED', 'Internal auth failed');
```

**Before:**

```typescript
reply.status(400);
return { error: 'Invalid message format' };
```

**After:**

```typescript
return reply.fail('INVALID_REQUEST', 'Invalid message format');
```

**Before:**

```typescript
reply.status(500);
return { error: result.error.message };
```

**After:**

```typescript
return reply.fail('INTERNAL_ERROR', result.error.message);
```

### Pattern 2: Success Returns → `reply.ok()`

**Before:**

```typescript
return { success: true };
```

**After:**

```typescript
return reply.ok({});
```

**Before:**

```typescript
return { success: true, actionId: result.value.actionId };
```

**After:**

```typescript
return reply.ok({ actionId: result.value.actionId });
```

**Before:**

```typescript
return { success: true, ...result };
```

**After:**

```typescript
return reply.ok(result);
```

### Pattern 3: Success with 201 Status

**Before:**

```typescript
reply.status(201);
return { success: true, data: action };
```

**After:**

```typescript
void reply.status(201);
return reply.ok(action);
```

### Error Code Mapping

| HTTP Status | ErrorCode             | Use For                   |
| ----------- | --------------------- | ------------------------- |
| 400         | `INVALID_REQUEST`     | Bad input, invalid format |
| 401         | `UNAUTHORIZED`        | Auth failed               |
| 403         | `FORBIDDEN`           | No permission             |
| 404         | `NOT_FOUND`           | Resource not found        |
| 500         | `INTERNAL_ERROR`      | Server errors             |
| 502         | `DOWNSTREAM_ERROR`    | External service failed   |
| 503         | `SERVICE_UNAVAILABLE` | Retryable errors          |

## Files to Fix (by priority)

### Tier 1 - High Impact (~69 violations)

1. `apps/actions-agent/src/routes/internalRoutes.ts` - 26 violations
2. `apps/whatsapp-service/src/routes/pubsubRoutes.ts` - 22 violations
3. `apps/research-agent/src/routes/internalRoutes.ts` - 21 violations

### Tier 2 - Medium Impact (~35 violations)

4. `apps/bookmarks-agent/src/routes/internalRoutes.ts` - 4 violations
5. `apps/bookmarks-agent/src/routes/pubsubRoutes.ts` - 9 violations
6. `apps/notion-service/src/routes/internalRoutes.ts` - 8 violations
7. `apps/user-service/src/routes/internalRoutes.ts` - 7 violations
8. `apps/app-settings-service/src/routes/internalRoutes.ts` - 7 violations

### Tier 3 - Lower Impact (~28 violations)

9. `apps/data-insights-agent/src/routes/internalRoutes.ts` - 3 violations
10. `apps/data-insights-agent/src/routes/dataSourceRoutes.ts` - 1 violation
11. `apps/data-insights-agent/src/routes/compositeFeedRoutes.ts` - 1 violation
12. `apps/data-insights-agent/src/routes/dataInsightsRoutes.ts` - 3 violations
13. `apps/commands-agent/src/routes/internalRoutes.ts` - 6 violations
14. `apps/todos-agent/src/routes/internalRoutes.ts` - 1 violation
15. `apps/todos-agent/src/routes/pubsubRoutes.ts` - 4 violations
16. `apps/image-service/src/routes/internalRoutes.ts` - 3 violations
17. `apps/mobile-notifications-service/src/routes/internalRoutes.ts` - 3 violations
18. `apps/web-agent/src/routes/internalRoutes.ts` - 2 violations
19. `apps/notes-agent/src/routes/internalRoutes.ts` - 1 violation

## Workflow for Each File

1. **Read the file** to understand context
2. **Find violations** by searching for:
   - `return { error:`
   - `return { success: true`
   - `return { success: false`
3. **Apply the fix pattern** based on context
4. **Remove the `reply.status()` line** when using `reply.fail()` (it auto-sets status)
5. **Keep `reply.status(201)`** when using `reply.ok()` for creates

## Important Rules

### DO:

- Use descriptive error messages in `reply.fail()`
- Keep the original error context (e.g., `result.error.message`)
- Run verification after each file: `node scripts/verify-reply-send.mjs`
- Run workspace tests after fixing a service: `pnpm run verify:workspace:tracked -- <service-name>`

### DON'T:

- Change the response schema definitions (those are separate task)
- Add extra fields to `reply.ok()` calls beyond what was returned
- Use `reply.fail()` without removing the preceding `reply.status()` line
- Modify test files in this task (tests may need separate updates)

## Verification Commands

```bash
# Check for remaining violations
node scripts/verify-reply-send.mjs

# Test specific service after fixing
pnpm run verify:workspace:tracked -- actions-agent
pnpm run verify:workspace:tracked -- whatsapp-service
# etc.

# Full CI check (run before committing)
pnpm run ci:tracked
```

## Example Fix Session

For `apps/actions-agent/src/routes/internalRoutes.ts`:

**Find:**

```typescript
const authResult = validateInternalAuth(request);
if (!authResult.valid) {
  request.log.warn({ reason: authResult.reason }, 'Internal auth failed for create action');
  reply.status(401);
  return { error: 'Unauthorized' };
}
```

**Replace with:**

```typescript
const authResult = validateInternalAuth(request);
if (!authResult.valid) {
  request.log.warn({ reason: authResult.reason }, 'Internal auth failed for create action');
  return reply.fail('UNAUTHORIZED', 'Internal auth failed for create action');
}
```

## Escape Hatch

If a raw return is legitimately required (external webhook contract, etc.), add:

```typescript
// @allow-raw-return: PubSub requires specific acknowledgment format
return { success: true };
```

## Test Considerations

Some tests may assert on the old response format:

```typescript
expect(response.json()).toEqual({ error: 'Unauthorized' });
```

These need updating to:

```typescript
expect(response.json()).toMatchObject({
  success: false,
  error: { code: 'UNAUTHORIZED', message: expect.any(String) },
});
```

**However:** Test updates are a separate task. Focus on route fixes first. If tests fail, note which tests need updating.

## Commit Strategy

Option A: One commit per tier

- `fix(response-contract): Tier 1 - actions-agent, whatsapp-service, research-agent`
- `fix(response-contract): Tier 2 - bookmarks, notion, user, app-settings`
- `fix(response-contract): Tier 3 - remaining services`

Option B: One commit per service (if Tier approach causes too many test failures)

## Reference

- Full plan: `docs/plans/response-contract-violation-fix.md`
- Response contract docs: `docs/patterns/response-contract.md`
- Plugin implementation: `packages/common-http/src/http/fastifyPlugin.ts`
