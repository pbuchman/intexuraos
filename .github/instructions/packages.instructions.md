---
applyTo: 'packages/**'
---

# Packages Instructions

**Verification:** `npm run ci` (includes `npm run verify:boundaries`).

---

## Layer Rules

| Layer      | Can Import           | Verification                |
|------------|----------------------|-----------------------------|
| `common`   | nothing              | `npm run verify:common`     |
| `domain/*` | common, other domain | `npm run verify:boundaries` |
| `infra/*`  | common, domain       | `npm run verify:boundaries` |

**Forbidden imports** (caught by ESLint + verify scripts):

- ❌ domain → infra
- ❌ domain → apps
- ❌ infra → apps
- ❌ common → domain/infra/apps

---

## Package Naming

- `@praxos/common`
- `@praxos/domain-<name>` (e.g., `@praxos/domain-inbox`)
- `@praxos/infra-<name>` (e.g., `@praxos/infra-firestore`)

---

## Layer Purposes

| Layer  | Purpose                    | External Deps                  |
|--------|----------------------------|--------------------------------|
| common | Utilities (Result, guards) | None                           |
| domain | Business logic             | None                           |
| infra  | SDK wrappers               | Yes (Firestore, Auth0, Notion) |

---

## Testing

- Infra packages provide fakes in `src/testing/` for domain tests
- Domain tests use fakes, no real external calls
- Coverage: 90%+ (enforced by `npm run test:coverage`)
