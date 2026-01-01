# Task 1-1: Add ESLint Rules

**Tier:** 1 (Independent Deliverable)
**Dependencies:** 0-0-setup (baseline validated)

## Context

Add 7 new ESLint configuration blocks to `/Users/p.buchman/personal/intexuraos/eslint.config.js` to enforce rules at build-time.

## Problem Statement

Need ESLint rules to catch violations during `npm run lint`:

1. Singleton Firestore usage (packages)
2. Test isolation (network calls in tests)
3. No auth tokens in localStorage (web app)
4. TailwindCSS only (no inline styles in web app)
5. Repository Firestore singleton pattern
6. No empty catch blocks
7. Use error utilities (no inline error extraction)

## Scope

**In Scope:**

- Add 7 new ESLint config blocks to eslint.config.js
- Follow existing patterns (no-restricted-imports, no-restricted-syntax)
- Provide clear error messages
- Use appropriate file targeting and ignores

**Out of Scope:**

- Creating new ESLint plugins
- Modifying existing rules
- Testing the rules (separate task)

## Required Approach

Add config blocks following existing patterns in eslint.config.js:

- Use `files` to target specific paths
- Use `ignores` for exceptions
- Provide helpful `message` in each rule
- Insert at logical locations (group related rules)

## Step Checklist

- [ ] **Rule 1.1:** Singleton Firestore (after line 263)
  - Target: `packages/*/src/**/*.ts`
  - Ignore: `packages/infra-firestore/**`
  - Block: `@google-cloud/firestore`, `firebase-admin/firestore`

- [ ] **Rule 1.2:** Test isolation (after line 481)
  - Target: `**/__tests__/**/*.ts`, `**/*.test.ts`, `**/*.spec.ts`
  - Block: `http.request`, `https.request` via no-restricted-syntax

- [ ] **Rule 1.3:** No localStorage tokens (after test isolation)
  - Target: `apps/web/src/**/*.{ts,tsx}`
  - Ignore: `apps/web/src/context/pwa-context.tsx`
  - Block: `localStorage.setItem/getItem` with token patterns

- [ ] **Rule 1.4:** TailwindCSS only (after localStorage)
  - Target: `apps/web/src/**/*.{ts,tsx}`
  - Ignore: `apps/web/src/pages/HomePage.tsx`
  - Block: JSX `style` attribute with expression containers

- [ ] **Rule 1.5:** Repository Firestore pattern (after TailwindCSS)
  - Target: `apps/*/src/infra/firestore/**/*.ts`, `packages/*/src/**/*Repository.ts`
  - Block: Firestore constructor parameters via AST selector

- [ ] **Rule 1.6:** No empty catch (add to base rules after line 161)
  - Use built-in: `'no-empty': ['error', { allowEmptyCatch: false }]`

- [ ] **Rule 1.7:** Error utilities (after no-empty)
  - Block: `error instanceof Error ? error.message : ...` pattern

- [ ] Update CONTINUITY.md ledger with completion

## Definition of Done

- All 7 ESLint rule blocks added to eslint.config.js
- Each rule has clear error message
- File targeting uses appropriate patterns
- Ignores documented where needed
- Ledger updated with "Done" status

## Verification Commands

```bash
# Check ESLint config syntax
npm run lint -- --print-config apps/web/src/App.tsx > /dev/null
echo $?  # Should be 0 (valid config)

# Grep for new rules
grep -c "no-restricted-imports" eslint.config.js
grep -c "no-restricted-syntax" eslint.config.js
grep -c "no-empty" eslint.config.js
```

Expected: Config is valid, rule counts increased

## Rollback Plan

If ESLint config becomes invalid:

1. Restore from git: `git checkout eslint.config.js`
2. Document failure in ledger
3. Fix syntax errors
4. Retry

---

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 1-2-ci-integration.md without waiting for user input.
