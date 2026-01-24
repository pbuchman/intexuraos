# Sentry Investigation Guide

How to effectively investigate and resolve Sentry issues.

## Reading Stack Traces

### Identifying the Root Frame

The most important frame is usually NOT the top of the stack. Look for:

1. **Your code** - Frames in `apps/` or `packages/`
2. **The actual error location** - Where the exception was thrown
3. **The data source** - Where the problematic data originated

```
❌ Red herring (framework code):
at Object.runMicrotasks (node:internal/process/task_queues:130:5)
at processTicksAndRejections (node:internal/process/task_queues:95:21)

✅ Relevant frame (your code):
at TodoService.findById (apps/todos-agent/src/domain/todos/service.ts:45:12)
```

### Tracing Data Flow

When you see `Cannot read property 'X' of undefined`:

1. Find where the variable is assigned
2. Trace back to where the data comes from
3. Check the data source (Firestore, API, user input)

## Using Tag Distribution

Tag distribution reveals the scope and nature of the issue.

### Impact Analysis

```
Call: mcp__sentry__get_issue_tag_values
Parameters:
  - issueUrl: <url>
  - tagKey: "url"
```

**Questions to answer:**

- Is this affecting one endpoint or many?
- Is this production-only or also staging?
- Is this browser-specific?

### Common Patterns

| Distribution               | Likely Cause                          |
| -------------------------- | ------------------------------------- |
| Single URL, single browser | Client-side race condition            |
| All URLs, all browsers     | Backend data issue                    |
| Production only            | Configuration or data migration issue |
| Specific release only      | Regression from recent deployment     |

## When to Use Seer vs Manual Investigation

### Use Seer For

- Clear TypeErrors and ReferenceErrors
- API response handling issues
- Validation failures
- Third-party integration errors
- "Quick triage" to get initial direction

### Use Manual Investigation For

- Data corruption or inconsistent state
- Intermittent/flaky failures
- Race conditions
- Complex business logic bugs
- Issues requiring Firestore inspection

## Firestore Investigation

When you need to check actual data:

```bash
# Authenticate
gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json

# Query Firestore (example)
gcloud firestore documents get projects/intexuraos-dev-pbuchman/databases/(default)/documents/users/abc123
```

**What to look for:**

- Missing fields that should exist
- Null values where objects expected
- Timestamp inconsistencies
- Orphaned references

## Expected Warnings (Ignore List)

Some Sentry issues represent **expected behavior** and should be marked as "Ignored".

### `[3.5.4] Partial failure detected, awaiting user confirmation`

- **Location:** `apps/research-agent/src/routes/internalRoutes.ts:813-818`
- **Reason:** External LLM provider failures (rate limits, network) trigger `awaiting_confirmation` state. This is intentional - user decides whether to proceed with partial results.
- **Action:** Ignore unless frequency spikes unexpectedly

### `[3.5.3] All LLMs failed, research marked as failed`

- **Location:** `apps/research-agent/src/routes/internalRoutes.ts:807-811`
- **Reason:** All configured LLM providers failed simultaneously. Expected when external services are unavailable.
- **Action:** Ignore unless indicating new failure mode

### Characteristics of Expected Warnings

1. Provide operational visibility into external dependencies
2. Allow monitoring of partial/complete failures
3. Enable user intervention when needed
4. Do NOT indicate code defects

**Action:** Mark Sentry issues matching these patterns as **"Ignored"** unless they indicate a sudden spike or new failure mode.

## Investigation Checklist

Before creating a fix:

- [ ] Read the full stack trace
- [ ] Check tag distribution for scope
- [ ] Run Seer analysis for initial direction
- [ ] If data issue, inspect Firestore documents
- [ ] Identify root cause (not just symptom)
- [ ] Check if this is an expected warning
- [ ] Document findings in Linear issue

## Anti-Patterns (FORBIDDEN)

### Band-Aid Fixes

```typescript
// ❌ FORBIDDEN - Hides the real problem
if (!user) return;

// ✅ CORRECT - Investigate WHY user is undefined
if (!user) {
  throw new Error(`User not found for ID: ${userId}`);
}
```

### Catching and Ignoring

```typescript
// ❌ FORBIDDEN - Silent failure
try {
  processData(data);
} catch {
  // ignore
}

// ✅ CORRECT - Log and handle appropriately
try {
  processData(data);
} catch (error) {
  logger.error({ error, data }, 'Failed to process data');
  return err({ code: 'PROCESSING_FAILED', message: getErrorMessage(error) });
}
```

### Surface-Level Fixes

```typescript
// ❌ FORBIDDEN - Doesn't address root cause
const name = user?.profile?.name ?? 'Unknown';

// ✅ CORRECT - Ensure profile exists when creating user
// (fix the data source, not the consumer)
```

## Escalation Criteria

Escalate to user if:

1. Root cause requires architectural changes
2. Fix would affect multiple services
3. Data migration is required
4. Issue is intermittent and not reproducible
5. You've spent >30 minutes without identifying root cause
