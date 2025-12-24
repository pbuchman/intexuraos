---
applyTo: 'packages/**'
---

# Packages Instructions

**Verification:** `npm run ci` (includes `npm run verify:boundaries` and `npm run verify:common`).

---

## Current State

Only `packages/common` exists. Domain and infra logic is colocated in apps (`apps/*/src/domain/` and `apps/*/src/infra/`).

---

## Common Package Rules

| Rule                     | Verification            |
| ------------------------ | ----------------------- |
| No domain-specific logic | `npm run verify:common` |
| No external service deps | Code review             |
| Imports nothing          | ESLint boundaries       |

**`packages/common` contains:**

- Result types and utilities
- HTTP response helpers
- Redaction utilities
- JWT/auth utilities
- Firestore/Notion client wrappers (shared utilities only)

**Forbidden in common:**

- ❌ Business logic / domain rules
- ❌ App-specific code
- ❌ External service implementations (only client wrappers)

---

## Package Naming

- `@intexuraos/common` — the only shared package

---

## Testing

- Common package has unit tests
- Coverage enforced by `npm run test:coverage`
