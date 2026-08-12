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

// ❌ Using an unresolved model import or a raw Google model ID
import { ModelId } from '@intexuraos/llm-factory';
const model = ModelId.Gemini25Flash; // unresolved and direct Google is disabled

// ✅ Build the package and use the exported OpenRouter-backed constant
import { IntexAgentModels } from '@intexuraos/llm-contract';
const model = IntexAgentModels.Gemini3FlashPreview; // or:google/...
```

**Root cause:** If `no-unsafe-*` errors appear, the type isn't resolving — check imports, run `pnpm build`, or add explicit type annotations.

---

## 6. Google LLM Routing — Never call Gemini directly

Every executable Google-family model must use an `or:google/...` identifier and the OpenRouter client. Platform-owned LLM traffic also uses OpenRouter.

```typescript
// ❌ Raw Google model and direct Google credential
const model = 'gemini-2.5-flash';
const apiKey = process.env['INTEXURAOS_GEMINI_APP_API_KEY'];

// ✅ Google-family model routed through OpenRouter
const model = createOpenRouterModelId('google/gemini-3-flash-preview');
const apiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
```

- Do not add `INTEXURAOS_GEMINI_APP_API_KEY`, a Google LLM key setting, `GeminiAdapter`, or a new `@intexuraos/infra-gemini` runtime dependency.
- Raw `gemini-*` values may exist in historical persisted data or compatibility types. Normalize them before execution; never revive them as a valid runtime route.
- Google OAuth tokens for Calendar are unrelated and remain supported. Do not remove or route OAuth through OpenRouter.

---

## 7. Mock Logger — Include ALL required methods

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

## 8. Empty Functions in Mocks — Use arrow functions

ESLint's `no-empty-function` forbids `() => {}`. Use explicit return or vi.fn().

```typescript
// ❌ Empty function body
const mock = { process: () => {} }; // no-empty-function

// ✅ Return undefined explicitly, or use vi.fn()
const mock = { process: (): undefined => undefined };
const mock = { process: vi.fn() };
```

---

## 9. Async Template Expressions — Await or wrap in `String()`

```typescript
// ❌ `Result: ${asyncFunction()}` // Promise<string> in template
// ✅ `Result: ${await asyncFunction()}`
// OR: `Result: ${String(asyncFunction())}`
```

---

## 10. Fastify Type Parameters — Specify generics for route handlers

FastifyReply/FastifyRequest need generic type parameters to infer response/request types.

```typescript
// ❌ Missing generics — TS2339: Property 'status' does not exist
app.get('/route', async (request, reply) => {
  reply.status(200); // Property 'status' not found
  return { data: 'value' };
});

// ✅ Specify response schema for type inference
app.get(
  '/route',
  {
    schema: {
      response: { 200: { type: 'object', properties: { data: { type: 'string' } } } },
    },
  },
  async (request, reply) => {
    reply.status(200); // Now TypeScript knows .status exists
    return { data: 'value' };
  }
);

// ✅ Or use explicit type parameter
import { FastifyInstance } from 'fastify';
app.get<{ Params: { id: string } }>('/route/:id', async (request, reply) => {
  const id = request.params.id; // TypeScript knows id is string
  return { id };
});
```

---

## 11. Strict Boolean Expressions — Use explicit comparisons

`strictBooleanExpressions` requires explicit boolean checks, no truthy/falsy shortcuts.

```typescript
// ❌ Implicit boolean conversion
const value = getValue();
if (value) {
} // Unexpected any value in conditional

// ✅ Explicit comparison or type guard
const value = getValue();
if (value !== null && value !== undefined) {
}
if (Boolean(value)) {
}
if (!!value) {
}

// ❌ Nullable string in conditional
const name: string | null = getName();
if (name) {
} // Unexpected nullable string value

// ✅ Handle nullish explicitly
const name: string | null = getName();
if (name !== null && name !== '') {
}
if (name?.length > 0) {
}

// ❌ Boolean flag without explicit check
const isEnabled = getSetting();
if (isEnabled) {
} // Unexpected any value

// ✅ Use explicit === true
const isEnabled = getSetting();
if (isEnabled === true) {
}
```

**Rule of thumb:** Any value in an `if` condition must be explicitly compared or type-guarded.

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
