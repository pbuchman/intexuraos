# Technical Debt: @intexuraos/infra-firestore

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 4     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **4** | Medium   |

---

## Future Plans

- Add `collectionGroup()` support to the fake for cross-collection queries
- Add `onSnapshot()` listener simulation for real-time update testing
- Consider splitting `firestoreFake.ts` into separate files per class (`FakeQuery`, `FakeTransaction`, `FakeCollectionReference`)
- Add dot-notation support to `FakeQuery.where()` filter evaluation (currently uses direct property lookup only)

---

## Code Smells

### Medium Priority

| File                           | Issue                                                                                                          | Impact                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/testing/firestoreFake.ts` | `FakeQuery.where()` uses direct property lookup — does not support dot-notation field paths                    | Tests requiring nested field queries must restructure data or use flat field names |
| `src/testing/firestoreFake.ts` | `FakeQuery` sort comparison defaults to numeric (`typeof aVal === 'number' ? aVal : 0`) for all values         | String-based `orderBy` calls return incorrect ordering                             |

### Low Priority

| File                           | Issue                                                                                                          | Impact                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/testing/firestoreFake.ts` | Module-level `transactionQueue` persists across test cases if `clear()` is not called                          | Potential test interference; mitigated by following `beforeEach`/`afterEach` pattern |
| `src/testing/firestoreFake.ts` | `FakeBatch.commit()` executes operations via fire-and-forget `void` — not truly atomic                         | Tests relying on batch rollback semantics on failure will not detect that behavior   |

---

## Implementation Notes

### Global Transaction Queue

`firestoreFake.ts` uses a module-level `transactionQueue` variable for serializing fake transactions:

```ts
let transactionQueue: Promise<unknown> = Promise.resolve();
```

The queue is reset in `clear()` but persists across test cases if `clear()` is not called. All tests should follow the `beforeEach`/`afterEach` pattern and call `fakeDb.clear()`.

### JSON-Based Equality in arrayUnion

Deduplication in `FieldValue.arrayUnion()` uses `JSON.stringify` for comparison. Works for simple values and objects but is not order-independent for nested objects with different key ordering. Matches Firestore's actual behavior closely enough for testing purposes.

---

## TODOs / FIXMEs

No TODO/FIXME markers found in source code.

---

## Resolved Issues

| Date       | Issue                                               | Resolution                                                       |
| ---------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-02-19 | Subcollection paths not supported                   | Implemented composite path keys in `FakeDocumentReference`       |
| 2026-02-19 | Transactions lacked isolation                       | Implemented `FakeTransaction` with pending writes buffer         |

---

## Related

- [README](README.md) — Developer reference
- [Agent Reference](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
