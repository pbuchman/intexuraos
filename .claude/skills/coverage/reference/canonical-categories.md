# Canonical v8 Ignore Categories

This document lists all valid categories for `/* v8 ignore <CATEGORY> */` comments.

## Format

```typescript
/* v8 ignore <CATEGORY> -- <explanation> */
```

The category MUST be one of the 10 IDs below. The explanation after `--` is required.

---

## Categories

### 1. `ts-type` — TypeScript Type System

**When to use:** Type narrowing guarantees the branch is unreachable.

**Detection pattern:**
- Array access with `??` after `.length` check, `.filter()`, or type guard
- Ternary/conditional after `typeof` or `instanceof` narrowing

**Example:**
```typescript
if (items.length >= 1) {
  /* v8 ignore ts-type -- length check guarantees index 0 exists */
  const first = items[0] ?? fallback;
}
```

---

### 2. `regex` — Regex Match Guarantees

**When to use:** Capture group is guaranteed by the regex pattern.

**Detection pattern:**
- `.exec()` or `.match()` call with null check
- Capture group access like `match[1]` with `??` fallback
- Regex pattern contains quantifier (`.+`, `.*`, `\d+`) ensuring group captures

**Example:**
```typescript
const match = /^##\s+(.+)$/.exec(line);
if (match !== null) {
  /* v8 ignore regex -- .+ guarantees group 1 is captured */
  const title = match[1] ?? '';
}
```

---

### 3. `module-init` — Module-Level Initialization

**When to use:** Code runs at import time, before test setup can intercept.

**Detection pattern:**
- Code at module top-level (not inside any function, class, or block)
- Typically: environment variable defaults, singleton initialization

**Example:**
```typescript
/* v8 ignore module-init -- runs at import before test setup */
const timeout = process.env.TIMEOUT ?? 5000;

export function useTimeout() { return timeout; }
```

---

### 4. `async-timing` — Async Callback Timing

**When to use:** Callback is cancelled before it can fire in tests.

**Detection pattern:**
- `setTimeout` or `setInterval` call
- Paired with `clearTimeout` or `clearInterval` in `finally` block
- Async operation completes before timeout fires in tests

**Example:**
```typescript
const id = setTimeout(() => abort(), 30000);
try {
  return await fetch(url);
} finally {
  /* v8 ignore async-timing -- fetch resolves before timeout fires */
  clearTimeout(id);
}
```

---

### 5. `test-infra` — Test Infrastructure Constraints

**When to use:** Fake or mock cannot produce the required state.

**Detection pattern:**
- Auth null check after `requireAuth()` (FakeAuthPlugin always succeeds)
- Firestore subcollection chaining (fake doesn't support)
- Error states that fakes cannot simulate

**Example:**
```typescript
const user = await requireAuth(req);
/* v8 ignore test-infra -- FakeAuthPlugin always returns valid user */
if (user === null) { return reply.fail('UNAUTHORIZED'); }
```

---

### 6. `upstream` — Upstream Guards

**When to use:** A prior check makes the downstream branch unreachable.

**Detection pattern:**
- Early `return` or `throw` with specific condition
- Later code handles the same condition (now unreachable)
- Control flow analysis proves branch cannot execute

**Example:**
```typescript
if (result.value === null) {
  return reply.fail('NOT_FOUND');  // Early exit
}
// ... later in switch ...
/* v8 ignore upstream -- early return above prevents this case */
case 'NOT_FOUND': break;
```

---

### 7. `module-mock` — ES Module Mocking Limitations

**When to use:** SDK property getters cannot be mocked via `vi.mock()`.

**Detection pattern:**
- Known SDK client instantiation (`LinearClient`, `NotionClient`, etc.)
- Property getter access (no `()` after property name)
- `vi.mock()` cannot intercept property getters

**Example:**
```typescript
const client = new LinearClient({ apiKey });
/* v8 ignore module-mock -- client.viewer is a getter, not mockable */
const user = await client.viewer;
```

---

### 8. `schema` — Schema Validation

**When to use:** Zod or JSON schema validation makes the fallback unreachable.

**Detection pattern:**
- `.safeParse()` or `.parse()` call with success check
- Accessing `.data` field after validation
- Fallback with `??` on validated field

**Example:**
```typescript
const result = schema.safeParse(body);
if (!result.success) { return reply.fail('INVALID'); }
/* v8 ignore schema -- Zod guarantees field exists after parse */
const name = result.data.name ?? 'default';
```

---

### 9. `source-map` — Source Map Alignment

**When to use:** Tests cover the branch, but v8 doesn't detect it due to transpilation.

**Detection pattern:**
- SPECIAL: Cannot detect statically
- Verified by running coverage WITHOUT the comment
- If branch shows as covered without comment → comment is valid
- If branch still uncovered → REJECT (not a source-map issue)

**Example:**
```typescript
/* v8 ignore source-map -- ternary covered but v8 reports uncovered */
const name = typeof claims['name'] === 'string' ? claims['name'] : undefined;
```

---

### 10. `auth-guard` — Auth Guards

**When to use:** Auth failure paths tested at middleware level, not per-route.

**Detection pattern:**
- `isPubSubPush()` check with else branch
- `validateInternalAuth()` check with failure branch
- Failure branch returns 401 or 403 status

**Example:**
```typescript
if (isPubSubPush(request)) {
  log.info('Pub/Sub push');
} else {
  /* v8 ignore auth-guard -- internal auth tested at middleware level */
  if (!validateInternalAuth(request)) {
    return reply.status(401).send();
  }
}
```

---

## Category Consolidation

Old categories from `unreachable/*.md` files map to new IDs:

| Old Category | New ID |
|--------------|--------|
| TypeScript Type System Guarantees | `ts-type` |
| Type System Constraints | `ts-type` |
| Firestore Contract Guarantees | `ts-type` |
| Schema Validation Guarantees | `schema` |
| Schema Validation | `schema` |
| Auth Guards | `auth-guard` |
| Use Case Contract | `test-infra` |
| Non-Critical Error Handling | `test-infra` |
| Generic Error Path | `test-infra` |
| Code Logic Redundancy | `upstream` |
| Single-Threaded Testing | `test-infra` |
| Security Testing Scenarios | `test-infra` |
| External API Specific Error States | `test-infra` |
| Source Map Alignment Issues | `source-map` |
| Interface Definition | `module-init` |
| Module State | `module-init` |
| Testable but edge case | **REJECT** (write test) |
| Precondition Violation | **REJECT** (write test) |
