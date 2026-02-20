# Technical Debt: @intexuraos/infra-firestore

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### Global Transaction Queue

`firestoreFake.ts` uses a module-level `transactionQueue` variable for serializing fake transactions:

```ts
let transactionQueue: Promise<unknown> = Promise.resolve();
```

The queue is reset in `clear()` but persists across test cases if `clear()` is not called. This is by design but could cause test interference if misused.

**Impact:** Low. The `clear()` method handles it, and all tests follow the `beforeEach/afterEach` pattern.

### JSON-Based Equality in arrayUnion

`extractArrayUnionElements` deduplication uses `JSON.stringify` for comparison:

```ts
if (!currentArray.some((e) => JSON.stringify(e) === JSON.stringify(elem))) {
```

**Impact:** Low. Works for simple values and objects but is not order-independent for nested objects with different key ordering.

**Recommendation:** This matches Firestore's actual behavior closely enough for testing purposes. No action needed unless edge cases are discovered.

### FakeQuery Does Not Support Nested Field Queries

`FakeQuery.where()` accesses fields using direct property lookup (`data[filter.field]`) without dot-notation support. Queries on nested fields like `where('user.name', '==', 'Alice')` will not work.

**Impact:** Medium. Any test requiring nested field queries must restructure data or use flat fields.

**Recommendation:** Add dot-notation support to `FakeQuery` filter evaluation using the existing `getNestedField()` helper.

### Sorting Limited to Numeric Values

`FakeQuery` sort comparison defaults to numeric comparison (`typeof aVal === 'number' ? aVal : 0`), which produces incorrect results for string sorting.

**Impact:** Medium. Tests relying on string-based ordering (e.g., alphabetical) will get incorrect results.

**Recommendation:** Add type-aware comparison (string vs number) in the sorting logic.

### FakeBatch Is Not Truly Atomic

`FakeBatch.commit()` executes operations sequentially via fire-and-forget `void` calls. Unlike real Firestore batches, failures in individual operations do not roll back preceding operations.

**Impact:** Low for tests. In production, real Firestore batches are atomic. Tests that rely on batch atomicity semantics (rollback on failure) will not catch that behavior.

**Recommendation:** Acceptable for the test-only use case. Document the limitation in test utilities.

## Future Improvements

- Add `collectionGroup()` support to the fake for cross-collection queries
- Add `onSnapshot()` listener simulation for real-time update testing
- Consider splitting `firestoreFake.ts` (~800 lines) into separate files per class (FakeQuery, FakeTransaction, FakeCollectionReference)
- Add dot-notation support to `FakeQuery.where()` filter evaluation (currently uses direct property lookup only)
