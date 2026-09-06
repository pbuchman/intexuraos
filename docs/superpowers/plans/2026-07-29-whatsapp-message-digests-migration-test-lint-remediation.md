# WhatsApp Message Digests — Migration Test Lint Remediation

**Problem:** The focused migration suites pass, but the repository lint contract rejects newly added
test helpers that rely on inferred return types, `any`, non-null assertions, dynamic deletion, and
the non-canonical generic array spelling.

## Implementation plan

1. Add explicit fixture and helper return types derived from the production-port contracts.
2. Replace `any`, non-null assertions, and dynamic deletion with typed records and fail-closed test
   helpers; normalize array spellings mechanically.
3. Keep all assertions and runtime behavior unchanged.
4. Re-run focused ESLint, the migration tests, and the repository test typecheck without invoking
   the full CI pipeline.
