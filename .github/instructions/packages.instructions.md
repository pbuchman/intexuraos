---
applyTo: 'packages/**'
---

# Packages — Path-Specific Instructions

Applies to: `/packages` (common, domain/\*, infra/\*)

---

## Architecture

### Layer Hierarchy (Enforced by ESLint)

1. **common** — can only import from `common`
2. **domain** — can import from `common` and other `domain` packages
3. **infra** — can import from `common`, `domain`, and other `infra` packages
4. **apps** — can import from anything

**Violations are caught by:**

- ESLint `boundaries` plugin (real-time)
- `npm run verify:boundaries` (CI)

### Domain Layer (`packages/domain/*`)

**Purpose:** Pure business logic, no external dependencies.

**Rules:**

- No imports from `infra` or `apps`.
- No direct access to external services (Firestore, Auth0, Notion, etc.).
- Use Result types for operations that can fail.
- All logic is testable without mocks.

**Examples:**

- User validation, identity logic
- Prompt template logic
- Action definitions

### Infra Layer (`packages/infra/*`)

**Purpose:** External service adapters.

**Rules:**

- Wraps external SDKs (Firestore, Auth0, Notion).
- Translates external formats to domain types.
- Handles authentication, network errors, retries.
- Can import from `domain` to return domain types.

**Examples:**

- Firestore client wrapper
- Auth0 client wrapper
- Notion API client

### Common Layer (`packages/common`)

**Purpose:** Shared utilities with no business logic.

**Rules:**

- Result types, type guards, formatters.
- No domain-specific logic.
- No external dependencies except TypeScript utilities.

---

## Boundary Verification

Boundaries are enforced by:

1. **ESLint boundaries plugin** (real-time in editor)
2. **verify-boundaries.mjs script** (CI)

**Forbidden:**

- ❌ domain importing from infra
- ❌ domain importing from apps
- ❌ infra importing from apps
- ❌ common importing from domain/infra/apps

---

## Verification Commands

Run from repo root:

```bash
npm run lint             # Includes boundary checks
npm run typecheck        # Zero errors required
npm run test             # All tests pass
npm run test:coverage    # Review coverage thresholds
npm run verify:boundaries # Explicit boundary check
npm run verify:common    # Common package validation
npm run ci               # Full CI suite (MANDATORY before task completion)
```

---

## Task Completion Checklist

**When you finish a task in `/packages`, verify:**

- [ ] `npm run verify:boundaries` passes
- [ ] Logic changes have corresponding tests
- [ ] Coverage meets 90%+ thresholds
- [ ] Domain layer has no external dependencies
- [ ] Infra properly wraps external services
- [ ] Common contains only shared utilities
- [ ] Explicit return types on all exported functions
- [ ] **`npm run ci` passes** ← **MANDATORY**

**Additional requirements inherited from global rules (see `.github/copilot-instructions.md`):**

- TypeScript correctness (zero `tsc` errors, no `@ts-ignore`, explicit return types)
- Testing requirements and coverage thresholds (90/85/90/90)
- Code quality standards (no obvious comments, no magic strings, no `any` without justification)

**Verification is not optional.**
