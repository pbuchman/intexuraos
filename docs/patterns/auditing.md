# Code Auditing & Consistency

**When to audit:** When implementing a fix or pattern in one service, ALWAYS audit other services for the same issue.

## Audit Process

1. **Identify the Pattern**
   - What issue did you just fix?
   - What pattern should be applied consistently?
   - Which services might have the same issue?

2. **Search Systematically**

   ```bash
   # Find all files with pattern
   grep -r "pattern" apps/*/src --include="*.ts"

   # Find specific route handlers
   grep -r "fastify.post('/internal" apps/*/src/routes

   # Find authentication checks
   grep -r "validateInternalAuth" apps/*/src
   ```

3. **Verify Consistency**
   - Compare implementations across services
   - Check for missing patterns where expected
   - Verify test coverage for the pattern

4. **Apply Fixes Systematically**
   - Fix all instances in a single commit
   - Update tests for all affected services
   - Document the pattern in CLAUDE.md

## Common Audit Scenarios

### Authentication Patterns

**Example:** Pub/Sub endpoints using wrong authentication detection

```bash
# Find all Pub/Sub push endpoints
grep -r "'/internal/.*/pubsub/" apps/*/src/routes --include="*.ts"

# Check authentication pattern
grep -B5 -A10 "isPubSubPush" apps/*/src/routes/*.ts
```

**What to verify:**

- All Pub/Sub endpoints check `from: noreply@google.com` header
- All have dual-mode auth (Pub/Sub OIDC OR x-internal-auth)
- All log authentication failures with context
- Tests cover both authentication modes

### Logging Patterns

**Example:** Internal endpoints missing request logging

```bash
# Find all internal endpoints
grep -r "'/internal/" apps/*/src/routes --include="*.ts" -A 20

# Check for logIncomingRequest usage
grep -r "logIncomingRequest" apps/*/src/routes --include="*.ts"
```

**What to verify:**

- All `/internal/*` endpoints use `logIncomingRequest()` at entry
- Logging happens BEFORE authentication check
- Sensitive headers are redacted automatically
- Log messages are descriptive and searchable

### Dependency Injection

**Example:** Use cases missing logger parameter

```bash
# Find all usecase factory functions
grep -r "createProcessCommandUseCase\|createHandleResearchActionUseCase" apps/*/src/domain/usecases --include="*.ts"

# Check logger parameter
grep -B3 "export function create.*UseCase" apps/*/src/domain/usecases/*.ts | grep "logger"
```

**What to verify:**

- All use cases accept logger in dependencies
- Logger is passed from services.ts
- Test fakes create logger with `level: 'silent'`
- Critical decision points are logged

## Cross-Service Pattern Application

When you fix a pattern in one service, apply it everywhere:

**Step 1: Document the pattern**

```typescript
// ✅ CORRECT PATTERN (apply everywhere)
const fromHeader = request.headers.from;
const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

if (isPubSubPush) {
  // Pub/Sub OIDC auth (validated by Cloud Run)
  request.log.info({ from: fromHeader }, 'Authenticated Pub/Sub push request');
} else {
  // Direct service call auth
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }
}
```

**Step 2: Find all instances**

```bash
# Find services with Pub/Sub endpoints
find apps -name "pubsubRoutes.ts" -o -name "internalRoutes.ts" | xargs grep -l "pubsub"
```

**Step 3: Verify and fix each**

- Read the current implementation
- Compare to the correct pattern
- Apply fix if different
- Update tests to match

**Step 4: Commit atomically**

- All fixes in a single commit
- Clear commit message explaining the pattern
- Reference the original issue/fix

## Debugging with Production Logs

**When issues occur in production:**

1. **Gather logs from Cloud Logging**

   ```bash
   gcloud logging read "resource.labels.service_name=intexuraos-commands-router" \
     --project=intexuraos-dev-pbuchman \
     --limit=50 \
     --format=json
   ```

2. **Identify the failure pattern**
   - What error message appears?
   - What request headers are present?
   - What's the failure rate?
   - Which endpoint is affected?

3. **Reproduce locally with tests**

   ```typescript
   it('handles Pub/Sub push without x-internal-auth', async () => {
     const response = await app.inject({
       method: 'POST',
       url: '/internal/endpoint',
       headers: {
         from: 'noreply@google.com', // Simulate Pub/Sub
       },
       payload: validPayload,
     });

     expect(response.statusCode).toBe(200);
   });
   ```

4. **Fix and verify**
   - Fix the code
   - Add/update tests
   - Run CI locally
   - Deploy and monitor logs

## Verification Checklist

After applying a pattern across services:

- [ ] Pattern applied to ALL affected services
- [ ] Tests updated for ALL affected services
- [ ] `pnpm run ci` passes
- [ ] Pattern documented in CLAUDE.md (if novel)
- [ ] Commit message references all affected services
- [ ] Deployment verified with production logs

## Example Audit Session

**Context:** Fixed Pub/Sub authentication in commands-router

**Audit steps:**

1. **Search for similar endpoints**

   ```bash
   grep -r "'/internal/.*/pubsub/" apps/*/src/routes --include="*.ts"
   # Found: whatsapp-service, actions-agent
   ```

2. **Check current implementation**

   ```bash
   grep -A30 "'/internal/whatsapp/pubsub/" apps/whatsapp-service/src/routes/pubsubRoutes.ts
   # Found: Using wrong header check
   ```

3. **Apply fix systematically**
   - Fixed whatsapp-service (2 endpoints)
   - Fixed actions-agent (1 endpoint)
   - Updated all tests with Pub/Sub auth coverage

4. **Verify deployment**
   ```bash
   ./scripts/verify-deployment.sh
   # All services healthy, logs show correct auth
   ```

**Result:** Pattern applied consistently across 3 services, 4 endpoints total.

## Red Flags Requiring Audit

Watch for these patterns that indicate inconsistency:

- **Same functionality, different implementations** → Standardize on one
- **Tests pass but production fails** → Missing test scenario
- **Pattern exists in 80% of services** → Apply to remaining 20%
- **Repeated manual redaction code** → Extract to utility
- **Similar endpoints with different auth** → Verify correct pattern
- **Logging only in some endpoints** → Add to all

## Audit Documentation

When you complete an audit and apply a pattern:

1. **Update CLAUDE.md** with the pattern (if not already documented)
2. **Note the audit in commit message**

   ```
   Fix Pub/Sub authentication across all internal endpoints

   Applied consistent authentication pattern to all Pub/Sub push endpoints:
   - whatsapp-service (2 endpoints)
   - actions-agent (1 endpoint)
   - commands-router (2 endpoints)

   All endpoints now check for `from: noreply@google.com` header to detect
   Pub/Sub push vs direct service calls.
   ```

3. **Add to Code Smells section** if it's a recurring anti-pattern
