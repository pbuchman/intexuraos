# [INT-1351] Fix Firestore Migration 091 Failure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `aggregateIndexes()` filter so indexes where `__name__` is the only companion field are treated as single-field (skipped), unblocking migration 091.

**Architecture:** The migration runner's `aggregateIndexes()` function already skips single-field indexes but doesn't account for `__name__` being implicitly appended by Firestore. A two-field index `[realField, __name__]` is effectively single-field and must be filtered out. The fix is in the aggregation filter logic; migration 091 itself is NOT modified.

**Tech Stack:** Node.js (ESM), Vitest, Firestore

---

## Root Cause Analysis

Migration `091_llm-usage-events-asc-index` defines:
```js
fields: [
  { fieldPath: 'occurredAt', order: 'ASCENDING' },
  { fieldPath: '__name__', order: 'ASCENDING' },
]
```

Firestore rejects this with HTTP 400: "this index is not necessary, configure using single field index controls" because `__name__` (document ID) is always implicitly appended to every index. An index of `[occurredAt ASC, __name__ ASC]` is just a single-field index on `occurredAt`, which Firestore auto-creates.

The `aggregateIndexes()` function in `scripts/migrate.mjs` (line 65) already filters single-field indexes:
```js
if ((index.fields?.length ?? 0) < 2 && !hasVectorField) continue;
```

But this index has 2 fields, so it passes the check. The filter needs to count **non-`__name__` fields** instead.

## File Structure

| File                                               | Action               | Responsibility                                        |
| -------------------------------------------------- | -------------------- | ----------------------------------------------------- |
| `scripts/migrate.mjs`                              | Modify (lines 62-67) | Filter logic in `aggregateIndexes()`                  |
| `migrations/__tests__/migrate-aggregation.test.ts` | Modify               | Add test for `__name__`-only companion edge case      |
| `firestore.indexes.json`                           | Regenerate           | Remove the invalid index (101 indexes instead of 102) |

---

### Task 1: Add Failing Test for `__name__`-Only Companion Index

**Files:**
- Modify: `migrations/__tests__/migrate-aggregation.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test after the existing "skips regular single-field indexes" test:

```typescript
it('skips indexes where __name__ is the only companion field (effectively single-field)', () => {
  const migrations = [
    {
      indexes: [
        {
          collectionGroup: 'llm_usage_events',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'occurredAt', order: 'ASCENDING' },
            { fieldPath: '__name__', order: 'ASCENDING' },
          ],
        },
      ],
    },
  ];

  const result = aggregateIndexes(migrations);

  expect(result.indexes).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run migrations/__tests__/migrate-aggregation.test.ts`
Expected: FAIL — the index has 2 fields so it passes the current filter and gets included.

- [ ] **Step 3: Commit failing test**

```bash
git add migrations/__tests__/migrate-aggregation.test.ts
git commit -m "test: add failing test for __name__-only companion index filter"
```

---

### Task 2: Fix `aggregateIndexes()` Filter Logic

**Files:**
- Modify: `scripts/migrate.mjs` (lines 62-67)

- [ ] **Step 1: Update the filter in `aggregateIndexes()`**

Replace the existing single-field check (lines 62-67):

```javascript
// Skip single-field indexes - Firestore creates them automatically
// UNLESS the index has a vectorConfig field (Firestore does NOT auto-create vector indexes)
const hasVectorField = index.fields?.some((f) => f.vectorConfig != null) === true;
if ((index.fields?.length ?? 0) < 2 && !hasVectorField) {
  continue;
}
```

With:

```javascript
// Skip single-field indexes - Firestore creates them automatically
// UNLESS the index has a vectorConfig field (Firestore does NOT auto-create vector indexes)
// __name__ is always implicitly appended by Firestore, so an index like
// [occurredAt ASC, __name__ ASC] is effectively single-field and must be skipped.
const hasVectorField = index.fields?.some((f) => f.vectorConfig != null) === true;
const realFields = index.fields?.filter((f) => f.fieldPath !== '__name__') ?? [];
if (realFields.length < 2 && !hasVectorField) {
  continue;
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm vitest run migrations/__tests__/migrate-aggregation.test.ts`
Expected: ALL PASS — the new test now correctly filters the `__name__`-only companion index.

- [ ] **Step 3: Also add a test that real composite indexes with `__name__` are kept**

Add to `migrate-aggregation.test.ts`:

```typescript
it('keeps composite indexes that include __name__ alongside 2+ real fields', () => {
  const migrations = [
    {
      indexes: [
        {
          collectionGroup: 'events',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'occurredAt', order: 'DESCENDING' },
            { fieldPath: '__name__', order: 'DESCENDING' },
          ],
        },
      ],
    },
  ];

  const result = aggregateIndexes(migrations);

  expect(result.indexes).toHaveLength(1);
});
```

- [ ] **Step 4: Run all aggregation tests**

Run: `pnpm vitest run migrations/__tests__/migrate-aggregation.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate.mjs migrations/__tests__/migrate-aggregation.test.ts
git commit -m "fix: skip __name__-only companion fields in aggregateIndexes filter"
```

---

### Task 3: Regenerate Firestore Indexes

**Files:**
- Regenerate: `firestore.indexes.json`

- [ ] **Step 1: Regenerate the indexes file**

Run: `node scripts/generate-firestore-config.mjs`
Expected: Output shows `Total indexes: 101` (was 102 — the invalid `llm_usage_events` single-field index is now excluded).

- [ ] **Step 2: Verify the bad index is gone**

Run: `grep -A8 '"collectionGroup": "llm_usage_events"' firestore.indexes.json | grep -c '__name__'`
Expected: `0` — no `llm_usage_events` index entry should have `__name__` as a field anymore.

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add firestore.indexes.json
git commit -m "chore: regenerate firestore.indexes.json after __name__ filter fix"
```

---

## Why Migration 091 Is NOT Modified

Migration 091 failed and was marked `status: 'failed'` in the `_migrations` Firestore collection. On the next deploy:
1. The migration runner finds it as pending (failed = pending).
2. Its `up()` calls `context.deployIndexes()`, which regenerates `firestore.indexes.json` using the now-fixed `aggregateIndexes()`.
3. The invalid index is excluded from the generated file.
4. `firebase deploy --only firestore:indexes` succeeds.
5. Migration 091 is marked `status: 'applied'`.

No manual intervention or new migration needed.
