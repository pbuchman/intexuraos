# Evaluate PENDING-* v8 Ignores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all PENDING-* override entries from `v8-ignore-overrides.json` for every service except `code-agent` and `orchestrator`, by either writing tests to cover the blocks or converting them to permanent v8-ignore comments with valid categories.

**Architecture:** Each service's PENDING override is resolved independently. For each v8-ignore block, the action is one of: (A) remove the v8-ignore entirely because tests already cover it, (B) write new tests to cover the block then remove the v8-ignore, (C) convert the override to a permanent inline `/* v8 ignore ... */` comment with a valid category and proper blocker explanation. After all blocks are resolved, the PENDING entry is deleted from `v8-ignore-overrides.json`.

**Tech Stack:** TypeScript, Vitest, FakeFirestore, app.inject(), nock

**Policy:** Only `PENDING-apps-code-agent` and `PENDING-workers-orchestrator` may remain in `v8-ignore-overrides.json`. All other services must have their v8 blocks standardized inline.

---

## Analysis Summary

| Service          | PENDING Key                       | Files   | Blocks   | Primary Action                                                  |
| ---------------- | --------------------------------- | ------- | -------- | --------------------------------------------------------------- |
| bookmarks-agent  | PENDING-apps-bookmarks-agent      | 1       | 1        | Standardize (ts-type)                                           |
| todos-agent      | PENDING-apps-todos-agent          | 1       | 1        | Standardize (ts-type)                                           |
| user-service     | PENDING-apps-user-service         | 5       | ~6       | Mixed: remove some v8-ignores (tests exist), standardize others |
| whatsapp-service | PENDING-apps-whatsapp-service     | 3       | ~5       | Mixed: write tests for testable blocks, standardize ts-type     |
| linear-agent     | PENDING-apps-linear-agent         | 2       | 2        | Write tests (FakeFirestore supports `in` queries)               |
| internal-clients | PENDING-packages-internal-clients | 1       | 0        | Remove stale override (no v8-ignore blocks exist in file)       |

---

## Task 1: bookmarks-agent — Standardize ts-type v8-ignore

**Files:**
- Modify: `apps/bookmarks-agent/src/infra/firestore/firestoreBookmarkRepository.ts:208-212`
- Modify: `v8-ignore-overrides.json` (remove `PENDING-apps-bookmarks-agent` entry)

**Block analysis:**
- Line 208: `if (doc === undefined)` guard after `snapshot.empty` check on line 203 guarantees `docs[0]` exists. TypeScript's `noUncheckedIndexedAccess` requires the guard despite logical impossibility. Tests already cover the method extensively.
- **Action:** The existing v8-ignore comment already says `ts-type`. Verify it passes `verify-v8-ignore` without the override, then remove the override.

- [ ] **Step 1: Run verify-v8-ignore with --no-overrides, grep for bookmarks-agent**

```bash
node scripts/verify-v8-ignore.mjs --no-overrides 2>&1 | grep -i bookmark
```

Check if the block passes validation on its own.

- [ ] **Step 2a (if passes): Remove override entry**

Remove the `PENDING-apps-bookmarks-agent` key from `v8-ignore-overrides.json`.

- [ ] **Step 2b (if fails): Fix the v8-ignore comment to pass validation**

Update the comment to match the required format:
```typescript
/* v8 ignore next -- ts-type: noUncheckedIndexedAccess requires undefined guard despite snapshot.empty check on line 203 guaranteeing docs[0] exists @preserve */
```

Then remove the override entry from `v8-ignore-overrides.json`.

- [ ] **Step 3: Verify workspace passes**

```bash
pnpm run verify:workspace:tracked -- bookmarks-agent
```

- [ ] **Step 4: Commit**

```bash
git add apps/bookmarks-agent/src/infra/firestore/firestoreBookmarkRepository.ts v8-ignore-overrides.json
git commit -m "fix(bookmarks-agent): standardize v8-ignore from PENDING to permanent ts-type"
```

---

## Task 2: todos-agent — Standardize ts-type v8-ignore

**Files:**
- Modify: `apps/todos-agent/src/domain/usecases/reorderTodoItems.ts:61-65`
- Modify: `v8-ignore-overrides.json` (remove `PENDING-apps-todos-agent` entry)

**Block analysis:**
- Lines 61-65: `if (item === undefined) throw new Error(...)` after validation on lines 49-56 guarantees all IDs exist in itemMap. The `Map.get()` return type includes `undefined` per TypeScript, but the prior loop validates every ID. Unreachable branch.
- **Action:** Verify the existing v8-ignore passes validation without override, fix if needed, remove override.

- [ ] **Step 1: Run verify-v8-ignore with --no-overrides, grep for todos-agent**

```bash
node scripts/verify-v8-ignore.mjs --no-overrides 2>&1 | grep -i todos
```

- [ ] **Step 2a (if passes): Remove override entry**

Remove `PENDING-apps-todos-agent` from `v8-ignore-overrides.json`.

- [ ] **Step 2b (if fails): Fix the v8-ignore comment**

Update to:
```typescript
/* v8 ignore start -- ts-type: Map.get() returns T|undefined but itemIds validated against todo.items on lines 49-56 guarantees existence @preserve */
```

Then remove the override entry.

- [ ] **Step 3: Verify workspace passes**

```bash
pnpm run verify:workspace:tracked -- todos-agent
```

- [ ] **Step 4: Commit**

```bash
git add apps/todos-agent/src/domain/usecases/reorderTodoItems.ts v8-ignore-overrides.json
git commit -m "fix(todos-agent): standardize v8-ignore from PENDING to permanent ts-type"
```

---

## Task 3: user-service — Remove unnecessary v8-ignores and standardize remainder

**Files:**
- Modify: `apps/user-service/src/domain/settings/formatLlmError.ts:171-175`
- Modify: `apps/user-service/src/infra/firestore/oauthConnectionRepository.ts:215-219`
- Modify: `apps/user-service/src/routes/deviceRoutes.ts` (already has valid schema/ts-type categories)
- Modify: `apps/user-service/src/routes/gitHubOAuthConnectionRoutes.ts:86-88,96-100`
- Modify: `apps/user-service/src/routes/oauthConnectionRoutes.ts:86-88,96-100`
- Modify: `v8-ignore-overrides.json` (remove `PENDING-apps-user-service` entry)

**Block analysis per file:**

### formatLlmError.ts (lines 171-175)
- Block covers credit_balance detection inside parsed JSON message.
- **Finding:** Test already exists at `formatLlmError.test.ts` lines 55-62 (`detects credit_balance error inside parsed JSON message`) that exercises this exact branch.
- **Action: REMOVE the v8-ignore.** The branch is already covered by tests. Run coverage to confirm, then delete the ignore comment.

### oauthConnectionRepository.ts (lines 215-219)
- `if (doc === undefined)` guard after `snapshot.empty` check. Same `noUncheckedIndexedAccess` pattern as bookmarks-agent.
- **Action: Standardize as ts-type.** This is a legitimate type narrowing blocker.
- Target comment: `/* v8 ignore next -- ts-type: noUncheckedIndexedAccess requires undefined guard despite snapshot.empty check guaranteeing docs[0] exists @preserve */`

### deviceRoutes.ts (lines 94-98, 212-216, 307-309)
- Already has valid `schema` and `ts-type` categories inline.
- **Action: Verify these pass validation without override.** They should already be compliant.

### gitHubOAuthConnectionRoutes.ts (lines 86-88 and 96-100)
- Line 86-88: Host header fallback. Comment claims `app.inject()` always sets host header, but tests at lines 191-210 prove this is testable and IS tested.
- Line 96-100: OAuth error path. Comment claims fake always succeeds, but test at lines 352-364 uses `setFailNextExchange(true)`.
- **Action: REMOVE both v8-ignores.** Existing tests cover these branches. Run coverage to confirm.

### oauthConnectionRoutes.ts (lines 86-88 and 96-100)
- Identical pattern to gitHubOAuthConnectionRoutes.
- Test at lines 191-210 covers host fallback. Test at lines 318-330 covers exchange failure.
- **Action: REMOVE both v8-ignores.** Existing tests cover these branches.

### Steps

- [ ] **Step 1: Remove v8-ignore from formatLlmError.ts**

Delete the `/* v8 ignore start */` and `/* v8 ignore stop */` comments around lines 171-175.

- [ ] **Step 2: Remove v8-ignores from gitHubOAuthConnectionRoutes.ts**

Delete the v8-ignore comments at lines 86-88 and 96-100.

- [ ] **Step 3: Remove v8-ignores from oauthConnectionRoutes.ts**

Delete the v8-ignore comments at lines 86-88 and 96-100.

- [ ] **Step 4: Standardize oauthConnectionRepository.ts**

Update the v8-ignore comment at line 215 to proper format:
```typescript
/* v8 ignore next -- ts-type: noUncheckedIndexedAccess requires undefined guard despite snapshot.empty check guaranteeing docs[0] exists @preserve */
```

- [ ] **Step 5: Run coverage for user-service to verify removed blocks are covered**

```bash
pnpm run verify:workspace:tracked -- user-service
```

If coverage drops (unexpected), the v8-ignore was needed — investigate and fix by writing tests instead.

- [ ] **Step 6: Remove override entry**

Remove `PENDING-apps-user-service` from `v8-ignore-overrides.json`.

- [ ] **Step 7: Run verify-v8-ignore to confirm all blocks pass**

```bash
node scripts/verify-v8-ignore.mjs --no-overrides 2>&1 | grep -i user-service
```

- [ ] **Step 8: Commit**

```bash
git add apps/user-service/ v8-ignore-overrides.json
git commit -m "fix(user-service): remove unnecessary v8-ignores covered by tests, standardize remainder"
```

---

## Task 4: whatsapp-service — Write tests for testable blocks, standardize ts-type

**Files:**
- Modify: `apps/whatsapp-service/src/infra/firestore/phoneVerificationRepository.ts:253-287`
- Modify: `apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts:118-123`
- Test: `apps/whatsapp-service/src/__tests__/infra/phoneVerificationRepository.test.ts` (may need new tests)
- Test: `apps/whatsapp-service/src/__tests__/infra/userMappingRepository.test.ts` (may need new tests)
- Modify: `v8-ignore-overrides.json` (remove `PENDING-apps-whatsapp-service` entry)

**Note:** `apps/whatsapp-service/src/infra/whatsapp/sender.ts` is listed in the override but has NO v8-ignore blocks. No action needed for that file.

**Block analysis:**

### phoneVerificationRepository.ts (lines 253-287)
- Multiple blocks in `createVerificationWithChecks()` covering Firestore transaction operations.
- The v8-ignore blocks claim "fake repository behavior in tests" but FakeFirestore has full `FakeTransaction` support with query execution.
- **Action: Write direct unit tests** using FakeFirestore to exercise the transaction logic (pending query, cooldown calculation, rate limit query). Then remove the v8-ignores.
- **Key test scenarios:**
  1. Transaction finds existing pending verification within cooldown period → returns cooldown error
  2. Transaction finds no pending verification → proceeds
  3. Transaction rate limit check exceeds max → returns rate limit error
  4. Transaction rate limit check passes → creates verification

### userMappingRepository.ts (lines 118-123)
- Line 118: `if (!doc)` guard — ts-type narrowing after `snapshot.empty` check. Same pattern as bookmarks-agent.
- Line 121: Type cast `(doc.data() as WhatsAppUserMappingDoc).userId` — claimed untestable but FakeFirestore CAN produce this state.
- **Action:** Standardize line 118 as `ts-type`. For line 121, check if existing tests already cover the `findUserByPhoneNumber` success path. If so, remove the v8-ignore. If not, write a test.

### Steps

- [ ] **Step 1: Read existing test files to understand current coverage**

```bash
# Check existing tests
cat apps/whatsapp-service/src/__tests__/infra/phoneVerificationRepository.test.ts | head -50
cat apps/whatsapp-service/src/__tests__/infra/userMappingRepository.test.ts | head -50
```

- [ ] **Step 2: Write tests for phoneVerificationRepository transaction logic**

Add tests to the existing test file that directly call the real repository functions (not the fake) through FakeFirestore:
- Test `createVerificationWithChecks` when a pending verification exists within cooldown
- Test `createVerificationWithChecks` when rate limit is exceeded
- Test `createVerificationWithChecks` happy path (no pending, under rate limit)

- [ ] **Step 3: Run tests to verify they pass and cover the blocks**

```bash
pnpm run verify:workspace:tracked -- whatsapp-service
```

- [ ] **Step 4: Remove v8-ignores from phoneVerificationRepository.ts**

Delete the v8-ignore comments for blocks now covered by tests.

- [ ] **Step 5: Handle userMappingRepository.ts**

- Standardize line 118 as ts-type: `/* v8 ignore next -- ts-type: noUncheckedIndexedAccess requires undefined guard despite snapshot.empty check guaranteeing docs[0] exists @preserve */`
- Check if line 121 is covered by tests. If covered, remove v8-ignore. If not, write a test for `findUserByPhoneNumber` success path, then remove.

- [ ] **Step 6: Remove override entry**

Remove `PENDING-apps-whatsapp-service` from `v8-ignore-overrides.json`.

- [ ] **Step 7: Run full verification**

```bash
pnpm run verify:workspace:tracked -- whatsapp-service
node scripts/verify-v8-ignore.mjs --no-overrides 2>&1 | grep -i whatsapp
```

- [ ] **Step 8: Commit**

```bash
git add apps/whatsapp-service/ v8-ignore-overrides.json
git commit -m "fix(whatsapp-service): write tests for transaction blocks, standardize v8-ignores"
```

---

## Task 5: linear-agent — Write tests for Firestore batch query functions

**Files:**
- Modify: `apps/linear-agent/src/infra/firestore/linearCommentRepository.ts:122-170`
- Modify: `apps/linear-agent/src/infra/firestore/linearIssueRepository.ts:164-196`
- Test: `apps/linear-agent/src/__tests__/infra/linearCommentRepository.test.ts` (create or extend)
- Test: `apps/linear-agent/src/__tests__/infra/linearIssueRepository.test.ts` (extend)
- Modify: `v8-ignore-overrides.json` (remove `PENDING-apps-linear-agent` entry)

**Block analysis:**

### linearCommentRepository.ts — `getCommentSummaries` (lines 122-170)
- Entire function is v8-ignored. Chunks issueIds into groups of 30, queries with `.where('issueId', 'in', chunk)`, aggregates comment counts and max timestamps.
- **Finding:** FakeFirestore fully supports the `in` operator (line 320-321 of firestoreFake.ts). No test file exists for this repository.
- **Action: Write tests.** Create test file or add to existing. Test scenarios:
  1. Empty issueIds array → returns empty map
  2. Single issue with multiple comments → correct count and max timestamp
  3. Multiple issues → correct per-issue aggregation
  4. More than 30 issues → verifies chunking works correctly
  5. Issue with no comments → returns zero count

### linearIssueRepository.ts — `findLinearIssuesByIdentifiers` (lines 164-196)
- Entire function is v8-ignored. Chunks identifiers, queries with `.where('identifier', 'in', chunk)` AND `.where('userId', '==', userId)`.
- **Finding:** FakeFirestore supports chained `.where()` with AND semantics. Test file exists but only tests `findLinearIssueByIdentifier` (singular).
- **Action: Write tests.** Add to existing test file. Test scenarios:
  1. Empty identifiers array → returns empty array
  2. Single identifier match → returns matching issue
  3. Multiple identifiers → returns all matches
  4. More than 30 identifiers → verifies chunking
  5. Identifier exists but for different userId → returns nothing (user isolation)

### Steps

- [ ] **Step 1: Read existing test patterns**

```bash
# Check existing test structure
ls apps/linear-agent/src/__tests__/infra/
cat apps/linear-agent/src/__tests__/infra/linearIssueRepository.test.ts | head -80
```

- [ ] **Step 2: Write tests for getCommentSummaries**

Create/extend test file following existing patterns (FakeFirestore, setServices). Cover all 5 scenarios listed above.

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- linear-agent
```

- [ ] **Step 4: Write tests for findLinearIssuesByIdentifiers**

Add tests to existing `linearIssueRepository.test.ts` file. Cover all 5 scenarios listed above.

- [ ] **Step 5: Run tests again**

```bash
pnpm run verify:workspace:tracked -- linear-agent
```

- [ ] **Step 6: Remove v8-ignores from both files**

Delete the v8-ignore start/stop blocks now that tests cover the functions.

- [ ] **Step 7: Remove override entry**

Remove `PENDING-apps-linear-agent` from `v8-ignore-overrides.json`.

- [ ] **Step 8: Verify everything passes**

```bash
pnpm run verify:workspace:tracked -- linear-agent
node scripts/verify-v8-ignore.mjs --no-overrides 2>&1 | grep -i linear
```

- [ ] **Step 9: Commit**

```bash
git add apps/linear-agent/ v8-ignore-overrides.json
git commit -m "fix(linear-agent): write tests for batch query functions, remove PENDING v8-ignores"
```

---

## Task 6: internal-clients — Remove stale override entry

**Files:**
- Modify: `v8-ignore-overrides.json` (remove `PENDING-packages-internal-clients` entry)

**Block analysis:**
- `packages/internal-clients/src/user-service/client.ts` has **NO v8-ignore blocks** at all.
- The override entry is stale — likely the blocks were already resolved but the override was not cleaned up.
- Comprehensive tests already exist at `packages/internal-clients/src/user-service/__tests__/client.test.ts`.
- **Action: Simply remove the stale override entry.**

- [ ] **Step 1: Confirm no v8-ignore blocks exist**

```bash
grep -n "v8 ignore" packages/internal-clients/src/user-service/client.ts
```

Expected: no matches.

- [ ] **Step 2: Remove override entry**

Remove `PENDING-packages-internal-clients` from `v8-ignore-overrides.json`.

- [ ] **Step 3: Verify**

```bash
node scripts/verify-v8-ignore.mjs --no-overrides 2>&1 | grep -i internal-clients
pnpm run verify:workspace:tracked -- internal-clients
```

- [ ] **Step 4: Commit**

```bash
git add v8-ignore-overrides.json
git commit -m "chore: remove stale PENDING-packages-internal-clients override"
```

---

## Final Verification

After all tasks complete, the following MUST hold:

- [ ] `v8-ignore-overrides.json` contains ONLY these PENDING keys: `PENDING-apps-code-agent`, `PENDING-workers-orchestrator` (plus any `INT-*` keyed entries like `INT-900`)
- [ ] `node scripts/verify-v8-ignore.mjs` passes with zero errors
- [ ] `pnpm run ci:tracked` passes

```bash
# Final check: only allowed PENDING entries remain
cat v8-ignore-overrides.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for key in data['overrides']:
    if key.startswith('PENDING-') and key not in ('PENDING-apps-code-agent', 'PENDING-workers-orchestrator'):
        print(f'ERROR: {key} should have been removed')
        sys.exit(1)
print('OK: Only allowed PENDING entries remain')
"
```
