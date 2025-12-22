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

1. Run `npm run ci`
2. If terraform changed: `terraform fmt -check -recursive && terraform validate`
3. If CI fails → fix → repeat
4. Only when all pass → task complete
