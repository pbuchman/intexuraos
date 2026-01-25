# Common Exemption Patterns

Recurring patterns that cause unreachable branches. Reference these in exemption entries.

---

## TypeScript Strict Mode Patterns

### `noUncheckedIndexedAccess`

TypeScript requires undefined checks for array index access, even when logically impossible.

```typescript
// Pattern: Array iteration within bounds
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === undefined) continue;  // ← Unreachable
}
```

**Why unreachable:** Iteration from 0 to `length - 1` on a dense array always yields defined elements.

```typescript
// Pattern: Split result access
const parts = str.split(';');
if (parts.length !== 3) throw new Error();
if (parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) {
  throw new Error();  // ← Unreachable
}
```

**Why unreachable:** Length check guarantees elements exist at indices 0-2.

---

### Regex Capture Groups

```typescript
const match = /^##\s+(.+)$/.exec(line);
if (match !== null) {
  const title = match[1];
  return title !== undefined ? { title } : null;  // ← null branch unreachable
}
```

**Why unreachable:** The regex `.+` requires at least one character. If the regex matches, group 1 is guaranteed to exist.

---

## Defensive Coding Patterns

### Auth Guards (Tests Authenticated)

```typescript
const user = await requireAuth(request, reply);
if (user === null) {
  return;  // ← Unreachable in tests
}
```

**Why unreachable:** Tests inject authenticated users via `FakeAuthPlugin`. Unauthenticated flows are tested separately at the auth middleware level.

---

### Error Fallbacks

```typescript
return await reply.fail('INTERNAL_ERROR', result.error ?? 'Unknown error');
//                                                       ^^^^^^^^^^^^^^^^
```

**Why unreachable:** Usecases always return specific error messages. The `??` fallback is defensive.

---

### Optional Property Spreads

```typescript
...(generatedBy !== undefined && { generatedBy }),
```

**Why unreachable:** The property extraction may always return defined in test flows.

---

## External API Patterns

### Nullable Fields from APIs

```typescript
// Google Calendar API
if (person.email !== undefined && person.email !== null) {
  result.email = person.email;
}
```

**Why unreachable:** Test fixtures provide complete data. Real API may return nulls.

---

### SDK Error Formats

```typescript
// Speechmatics error context
if (obj['status'] !== undefined) context['httpStatus'] = obj['status'];
if (obj['statusCode'] !== undefined) context['httpStatusCode'] = obj['statusCode'];
```

**Why unreachable:** SDK throws specific error formats. Tests mock specific scenarios, not all possible error shapes.

---

## Module Initialization Patterns

### Timeout Callbacks

```typescript
const timeoutId = setTimeout(() => {
  controller.abort();  // ← Unreachable
}, timeoutMs);
try {
  return await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeoutId);
}
```

**Why unreachable:** Mocked responses resolve immediately. The timeout callback is cancelled before it fires.

---

### Interval Cleanup

```typescript
setInterval(() => {
  cleanupExpiredClients();  // ← Unreachable
}, 60000);
```

**Why unreachable:** Tests don't wait for intervals. Module-level state cleanup is not testable.

---

## Wrapper Patterns

### ES Module Mocking Limitations

Some third-party SDKs cannot be effectively mocked due to:
- Property getters returning Promises
- Module-level caching
- Request deduplication with timeouts

**Example:** `@linear/sdk` client wrapper

**Solution:** Document entire file as exempted, test via interface-based fakes.

---

## Quick Reference Table

| Pattern | Typical Code | Why Unreachable |
|---------|--------------|-----------------|
| `noUncheckedIndexedAccess` | `arr[i] ?? fallback` | TS strict mode, array bounds guaranteed |
| Regex groups | `match[1] !== undefined` | Regex requires capture to match |
| Auth guard | `if (user === null)` | Tests always authenticated |
| Error fallback | `error ?? 'default'` | Usecases return specific errors |
| API nullables | `field !== null` | Test fixtures complete |
| Timeout callback | `setTimeout(fn, ms)` | Mocks resolve immediately |
| SDK wrapper | Entire file | ES module mocking limits |
