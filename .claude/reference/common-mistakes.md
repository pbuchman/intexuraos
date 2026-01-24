# Common LLM Mistakes

These patterns cause 80% of CI failures. Reference this file when debugging TypeScript or ESLint errors.

---

## 1. ESM Imports — Always use `.js` extension

```typescript
// ❌ import { foo } from '../services/bar';
// ✅ import { foo } from '../services/bar.js';
```

---

## 2. ServiceContainer — Check existing tests before adding services

When modifying `ServiceContainer`, **read existing test files first** to see all required fields.
New fields break ALL tests that use `setServices()`.

```typescript
// ❌ Adding new service without updating tests
setServices({ existingRepo: fakeRepo }); // Missing new required field!

// ✅ Check services.ts interface, update ALL test files
setServices({ existingRepo: fakeRepo, newService: fakeNewService });
```

---

## 3. exactOptionalPropertyTypes — Use `?:` not `| undefined`

```typescript
// ❌ type Deps = { logger: Logger | undefined };
// ✅ type Deps = { logger?: Logger };
```

---

## 4. Template Literals — Wrap non-strings with `String()`

```typescript
// ❌ `Status: ${response.status}` // status is number
// ✅ `Status: ${String(response.status)}`
```

---

## 5. Unsafe Type Operations — Resolve types before accessing

ESLint's `no-unsafe-*` rules fire when TypeScript can't resolve a type. Common causes:

```typescript
// ❌ Accessing Result without narrowing
const result = await repo.findById(id);
console.log(result.value); // no-unsafe-member-access: .value unresolved

// ✅ Narrow first, then access
const result = await repo.findById(id);
if (!result.ok) return result;
console.log(result.value); // TypeScript knows it's Success<T>

// ❌ Using enum from unresolved import
import { ModelId } from '@intexuraos/llm-factory';
const model = ModelId.Gemini25Flash; // no-unsafe-member-access

// ✅ Ensure package is built, or use string literal
const model = 'gemini-2.5-flash' as const;
```

**Root cause:** If `no-unsafe-*` errors appear, the type isn't resolving — check imports, run `pnpm build`, or add explicit type annotations.

---

## 6. Mock Logger — Include ALL required methods

The `Logger` interface requires `info`, `warn`, `error`, AND `debug`. Missing any causes TS2345.

```typescript
// ❌ Missing debug method
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}; // TS2345: not assignable to Logger

// ✅ Include all four methods
const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// ✅ Or use FakeLogger class if available in the service
import { FakeLogger } from './fakes.js';
const logger = new FakeLogger();
```

---

## 7. Empty Functions in Mocks — Use arrow functions

ESLint's `no-empty-function` forbids `() => {}`. Use explicit return or vi.fn().

```typescript
// ❌ Empty function body
const mock = { process: () => {} }; // no-empty-function

// ✅ Return undefined explicitly, or use vi.fn()
const mock = { process: (): undefined => undefined };
const mock = { process: vi.fn() };
```

---

## 8. Async Template Expressions — Await or wrap in `String()`

```typescript
// ❌ `Result: ${asyncFunction()}` // Promise<string> in template
// ✅ `Result: ${await asyncFunction()}`
// OR: `Result: ${String(asyncFunction())}`
```

---

## Code Smells Reference

| Smell                      | ❌ Wrong                       | ✅ Fix                    |
| -------------------------- | ------------------------------ | ------------------------- |
| Silent catch               | `catch {}`                     | `catch { /* reason */ }`  |
| Inline error               | `error instanceof Error ? ...` | `getErrorMessage(error)`  |
| Throw in try               | `try { if (x) throw } catch`   | Separate blocks           |
| Re-export from services.ts | `export * from './infra/...'`  | Only export DI functions  |
| Module-level state         | `let logger: Logger`           | Pass to factory functions |
| Test fallback in prod      | `container ?? { fake }`        | Throw if not init         |
| Domain in infra            | `maskApiKey()` in infra        | Move to common-core       |
| Infra re-exports domain    | `export type from domain`      | Import where needed       |
| Manual header redaction    | Inline `[REDACTED]`            | `logIncomingRequest()`    |
| Redundant variable         | `const r = f(); return r`      | `return f()`              |
| Redundant check            | Check after type guard         | Trust narrowing           |
| Console logging            | `console.info()` in infra      | Accept `logger?` param    |

**Known debt:** OpenAPI schemas duplicated per server.ts (Fastify types limitation).
