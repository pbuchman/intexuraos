# PraxOS — Copilot Instructions

**All rules below are verified by `npm run ci`. If CI passes, rules are satisfied.**

---

## Verification (MANDATORY)

```bash
npm run ci                        # MUST pass before task completion
terraform fmt -check -recursive   # If terraform changed (from /terraform)
terraform validate                # If terraform changed
```

**Do not claim complete until verification passes.**

---

## Architecture

```
apps/           → Fastify services (thin orchestration)
packages/
  common/       → Shared utilities (no domain logic)
  domain/       → Business logic (no external deps)
  infra/        → External service adapters
terraform/      → Infrastructure as code
docs/           → All documentation
```

**Import hierarchy** (enforced by `npm run verify:boundaries`):

- common → (nothing)
- domain → common
- infra → common, domain
- apps → anything

---

## Code Rules

| Rule                                | Verification            |
| ----------------------------------- | ----------------------- |
| Zero `tsc` errors                   | `npm run typecheck`     |
| Zero ESLint warnings                | `npm run lint`          |
| 89%+ test coverage                  | `npm run test:coverage` |
| ESM only (`import`/`export`)        | `npm run lint`          |
| Explicit return types on exports    | `npm run lint`          |
| No `@ts-ignore`, `@ts-expect-error` | `npm run lint`          |
| No unused code                      | `npm run lint`          |
| Prettier formatted                  | `npm run format:check`  |

**IMPORTANT:** After creating or modifying files, always run `npx prettier --write .` before `npm run ci`.

---

## New Service Checklist

When creating a new service (e.g., splitting an existing service):

1. **Create files** - Copy structure from existing service
2. **Run Prettier** - `npx prettier --write .` (BEFORE running CI)
3. **Update Terraform** - Add to `locals.services`, create module, update IAM, add outputs
4. **Update api-docs-hub** - Add OpenAPI URL env var to config.ts
5. **Update detect-affected.mjs** - Add service to `SERVICE_DEPS`
6. **Update documentation** - README.md, api-contracts.md, setup guides
7. **Run CI** - `npm run ci`
8. **Validate Terraform** - `terraform fmt -check -recursive && terraform validate`

---

## TypeScript Patterns

**Array access** — `noUncheckedIndexedAccess` returns `T | undefined`:

```ts-example
// ❌ const first = arr[0];
// ✅ const first = arr[0] ?? fallback;
```

**Optional properties** — `exactOptionalPropertyTypes` forbids `undefined`:

```ts-example
// ❌ { optional: condition ? value : undefined }
// ✅ if (condition) { obj.optional = value; }
```

**Non-null assertion** — forbidden:

```ts-example
// ❌ obj.prop!
// ✅ obj.prop as Type (or runtime check)
```

**Strict boolean expressions** — nullable values require explicit checks:

```ts-example
// ❌ Nullable string in conditional
{error ? <div>{error}</div> : null}

// ✅ Explicit null/empty check
{error !== null && error !== '' ? <div>{error}</div> : null}

// ❌ Nullable boolean in conditional
{status?.connected ? 'Connected' : 'Disconnected'}

// ✅ Explicit boolean comparison
{status?.connected === true ? 'Connected' : 'Disconnected'}
```

**Cleanup function return type** — useEffect cleanup must have explicit return type:

```ts-example
// ❌ Missing return type
useEffect(() => {
  document.addEventListener('click', handler);
  return () => {
    document.removeEventListener('click', handler);
  };
}, []);

// ✅ Explicit void return type
useEffect(() => {
  document.addEventListener('click', handler);
  return (): void => {
    document.removeEventListener('click', handler);
  };
}, []);
```

**Inline function return types** — all inline functions in objects must have explicit return types:

```ts-example
// ❌ Missing return types on inline functions
const value = useMemo(() => ({
  login: () => { doLogin(); },
  logout: () => { doLogout(); },
  getData: async () => { return await fetch(); },
}), []);

// ✅ Explicit return types
const value = useMemo(() => ({
  login: (): void => { doLogin(); },
  logout: (): void => { doLogout(); },
  getData: async (): Promise<Data> => { return await fetch(); },
}), []);
```

**Template literal expressions** — numbers must be converted to strings:

```ts-example
// ❌ Number in template literal
const msg = `Found ${items.length} items`;

// ✅ Explicit string conversion
const msg = `Found ${String(items.length)} items`;
```

**Optional props with exactOptionalPropertyTypes** — conditional rendering for optional props:

```ts-example
// ❌ Passing potentially undefined value to optional prop
<Component optionalProp={state.value} /> // where value is string | undefined

// ✅ Conditionally include the prop
{state.value !== undefined ? (
  <Component optionalProp={state.value} />
) : (
  <Component />
)}

// OR use helper function with type narrowing
const renderWidget = (): JSX.Element => {
  if (state.value !== undefined) {
    return <Component optionalProp={state.value} />;
  }
  return <Component />;
};
```

**Full pattern table:** See ESLint config. When encountering new pattern, add to this section.

---

## Code Smells (Fix & Document)

Patterns to avoid. Not all are ESLint-enforced, but must be fixed when found.

**RULE: When fixing a new code smell not listed here, YOU MUST add it to this section.**
_This rule is non-negotiable._

**Throw inside try-catch** — don't throw exceptions caught by the same block:

```ts-example
// ❌ Anti-pattern: throw caught locally
try {
  if (bad) throw new Error('fail');
} catch (e) {
  if (e.message.includes('fail')) throw e;
}

// ✅ Separate try-catch from conditional throw
let result;
try {
  result = await riskyOperation();
} catch {
  return; // handle error
}
if (!result.ok) throw new Error('fail');
```

**Silent catch without reason** — always document why errors are ignored:

```ts-example
// ❌ Silent catch
try { await op(); } catch {}

// ✅ Document intent
try {
  await op();
} catch {
  // Best-effort cleanup, failure is acceptable
}
```

**Redundant local variable** — return directly when no transformation needed:

```ts-example
// ❌ Redundant variable
async function safeFetch(url: string): Promise<Response | null> {
  try {
    const result = await fetch(url);
    return result;
  } catch {
    return null;
  }
}

// ✅ Direct return
async function safeFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}
```

**Redundant defensive check after type guard** — trust TypeScript's type narrowing:

```ts-example
// ❌ Redundant check after isErr()
const result = await operation();
if (isErr(result)) {
  return handleError(result.error);
}
if (!result.ok) {
  // Unreachable: isErr() already narrowed the type
  return handleError();
}
const value = result.value;

// ✅ Direct access after type guard
const result = await operation();
if (isErr(result)) {
  return handleError(result.error);
}
// TypeScript knows result.ok is true here
const value = result.value;
```

**Duplicated documentation** — keep canonical docs in one place, reference from others:

```ts-example
// ❌ Same doc block in multiple files
// file: routes.ts
/**
 * Route mapping:
 * GET /api/foo → fooRoutes.ts
 */
export { routes } from './routes/index.js';

// file: routes/index.ts
/**
 * Route mapping:
 * GET /api/foo → fooRoutes.ts   // DUPLICATED!
 */

// ✅ Single source of truth, reference elsewhere
// file: routes.ts (canonical location)
/**
 * Route mapping:
 * GET /api/foo → ./routes/fooRoutes.ts
 */
export { routes } from './routes/index.js';

// file: routes/index.ts
/**
 * See ../routes.ts for route mapping.
 */
```

**Inline error message extraction** — use `getErrorMessage()` utility:

```ts-example
// ❌ Repeated inline pattern
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return err({ code: 'INTERNAL_ERROR', message });
}

// ✅ Use getErrorMessage() from @praxos/common
import { getErrorMessage } from '@praxos/common';

} catch (error) {
  return err({
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, 'Unknown Firestore error'),
  });
}
```

---

## Testing

- Coverage: 89% lines, 85% branches, 90% functions, 89% statements
- Mock external systems only (Auth0, Firestore, Notion)
- Assert observable behavior, not implementation

**Verification:** `npm run test:coverage`

---

## Output Rules

**MANDATORY:** Use `show_content` tool for non-trivial output. Never print summaries, explanations, or results directly
in conversation.

Examples of non-trivial output:

- Task completion summaries
- Investigation findings
- Multi-line code suggestions (when not using edit tools)
- Architecture explanations
- Comparison tables

---

## Markdown Code Blocks

Use ` ```ts-example ` (not ` ```typescript `) to prevent IDE parsing errors.

---

## Path-Specific Rules

| Path           | Instructions                                     | Key Verification                                    |
| -------------- | ------------------------------------------------ | --------------------------------------------------- |
| `apps/**`      | `.github/instructions/apps.instructions.md`      | OpenAPI at `/openapi.json`, Terraform module exists |
| `packages/**`  | `.github/instructions/packages.instructions.md`  | Boundary rules pass                                 |
| `terraform/**` | `.github/instructions/terraform.instructions.md` | `terraform fmt -check && terraform validate`        |

---

## Task Completion

1. If output is non-trivial, show it with `show_content` tool. Do not output it to the conversation directly.
2. Run `npm run ci`
3. If terraform changed: `terraform fmt -check -recursive && terraform validate`
4. If CI fails → fix → repeat
5. Only when all pass → task complete
