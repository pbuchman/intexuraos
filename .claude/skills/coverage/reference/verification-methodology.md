# Verification Methodology

## Core Principle: Proof by Construction

**A branch is only unreachable if you can explain the SPECIFIC MECHANISM that prevents test access.**

"This looks hard to test" is NOT a valid exemption.
"I tried and couldn't figure it out" is NOT a valid exemption.

You must identify and document the **structural blocker**.

---

## Valid Blocker Categories

### 1. TypeScript Type System Guarantees

**Mechanism:** TypeScript's control flow analysis proves the branch cannot execute.

```typescript
// Example: Array bounds after length check
const parts = str.split(';');
if (parts.length !== 3) throw new Error();

// TypeScript KNOWS parts[0], parts[1], parts[2] exist
if (parts[0] === undefined) { /* unreachable */ }
```

**Proof:** The type system guarantees array indices 0-2 exist after the length check. No runtime path can reach the undefined branch.

**Required documentation:**
- The preceding check that establishes the guarantee
- Why TypeScript's narrowing makes the branch dead code

---

### 2. Regex Match Guarantees

**Mechanism:** Regex capture groups only exist when the pattern matches.

```typescript
const match = /^##\s+(.+)$/.exec(line);
if (match !== null) {
  const title = match[1];
  if (title === undefined) { /* unreachable */ }
}
```

**Proof:** The regex requires `.+` (one or more characters) in group 1. If the regex matches, group 1 is guaranteed to contain a string.

**Required documentation:**
- The regex pattern
- Which part of the pattern guarantees the capture group exists

---

### 3. Module-Level Initialization

**Mechanism:** Code runs at import time, before any test can intercept.

```typescript
// At module top level (not inside a function)
const client = new SomeClient({
  timeout: process.env['TIMEOUT'] ?? 5000  // ← fallback unreachable
});
```

**Proof:** Module initialization happens during `import`. Tests cannot set `TIMEOUT` env var before the module loads (without complex module mocking that defeats the purpose).

**Required documentation:**
- That the code is module-level (not inside a function)
- Why test setup cannot run before module initialization

---

### 4. Async Callback Timing

**Mechanism:** Callbacks are cancelled/resolved before they can fire.

```typescript
const timeoutId = setTimeout(() => {
  controller.abort();  // ← unreachable
}, 30000);

try {
  const result = await fetch(url, { signal: controller.signal });
  return result;
} finally {
  clearTimeout(timeoutId);  // Always cancels the timeout
}
```

**Proof:** Mocked fetch resolves immediately. The `clearTimeout` in `finally` always runs before the 30-second timeout fires.

**Required documentation:**
- The timing relationship (mock resolves instantly)
- Why the callback is cancelled before execution

---

### 5. Test Infrastructure Constraints

**Mechanism:** Test fakes/mocks structurally cannot produce certain states.

```typescript
const user = await requireAuth(request, reply);
if (user === null) {
  return;  // ← unreachable in tests
}
```

**Proof:** `FakeAuthPlugin` always returns an authenticated user. There is no `setUnauthenticated()` method. Auth failure testing is done at the middleware level, not route level.

**Required documentation:**
- Which fake/mock is involved
- That the fake has no mechanism to produce the blocked state
- Where the blocked state IS tested (if anywhere)

---

### 6. Upstream Guards

**Mechanism:** A prior check in the call chain makes a downstream check redundant.

```typescript
// In route handler (line 100):
if (existing.value === null) {
  return reply.fail('NOT_FOUND');  // ← Returns here
}

// ... call usecase ...

// In error handler (line 150):
case 'NOT_FOUND':  // ← Unreachable, caught at line 100
  return reply.fail('NOT_FOUND', result.error.message);
```

**Proof:** The route checks for NOT_FOUND before calling the usecase. The usecase's NOT_FOUND error code can never reach the error handler.

**Required documentation:**
- The upstream guard location and line
- Why the downstream check is redundant

---

### 7. ES Module Mocking Limitations

**Mechanism:** The module system prevents effective mocking of SDK internals.

```typescript
// @linear/sdk uses property getters
const client = new LinearClient({ apiKey });
await client.viewer;  // `viewer` is a getter, not mockable
```

**Proof:**
1. Vitest's `vi.mock()` runs at module load time
2. Cannot configure mock behavior per-test
3. SDK uses property getters, not callable methods
4. Client caching adds module-level state

**Required documentation:**
- The specific SDK/library
- The technical limitation (getters, caching, etc.)
- That interface-based fakes are used for testing consumers

---

## Invalid "Blockers" (Excuses)

| Excuse | Why Invalid |
|--------|-------------|
| "Hard to set up" | Difficulty is not impossibility |
| "Would need complex mocking" | Complex ≠ impossible |
| "Tests don't currently cover this" | Write the test |
| "Edge case" | Edge cases should be tested |
| "Defensive coding" | Defensive code CAN be tested unless blocked |
| "Unlikely in production" | Likelihood ≠ unreachability |
| "Would require integration test" | Then write an integration test |

---

## Verification Checklist

Before adding ANY exemption, answer ALL of these:

| Question | Required Answer |
|----------|-----------------|
| Can I identify a SPECIFIC blocker category from this document? | YES |
| Can I explain the MECHANISM that prevents test access? | YES |
| Is this a structural impossibility, not just difficulty? | YES |
| Have I documented the proof, not just the conclusion? | YES |
| Would another engineer agree this is unreachable? | YES |

**If ANY answer is NO → Write a test instead.**

---

## Exemption Entry Requirements

Every exemption MUST include:

1. **Code snippet** — the actual unreachable code
2. **Blocker category** — one of the 7 categories above
3. **Proof** — specific explanation of the mechanism
4. **Pattern reference** — link to `common-patterns.md` if applicable

Example:

```markdown
### Line ~45: `if (parts[0] === undefined)` check

\`\`\`typescript
const parts = str.split(';');
if (parts.length !== 3) throw new Error('Invalid format');
if (parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) {
  throw new Error('Missing parts');  // ← Unreachable
}
\`\`\`

- **Blocker:** TypeScript Type System Guarantees
- **Proof:** Line 1 splits string into array. Line 2 verifies length is exactly 3. After line 2, TypeScript knows indices 0-2 exist. The undefined check on line 3 is dead code required by `noUncheckedIndexedAccess`.
- **Pattern:** noUncheckedIndexedAccess (see common-patterns.md)
```
