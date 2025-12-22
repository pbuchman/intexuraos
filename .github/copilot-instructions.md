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
| 90%+ test coverage                  | `npm run test:coverage` |
| ESM only (`import`/`export`)        | `npm run lint`          |
| Explicit return types on exports    | `npm run lint`          |
| No `@ts-ignore`, `@ts-expect-error` | `npm run lint`          |
| No unused code                      | `npm run lint`          |

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

---

## Testing

- Coverage: 90% lines, 85% branches, 90% functions, 90% statements
- Mock external systems only (Auth0, Firestore, Notion)
- Assert observable behavior, not implementation

**Verification:** `npm run test:coverage`

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
