# WhatsApp Message Digests — Migration Run Fixture Remediation

**Problem:** Two store tests model hidden migration records by setting only
`visibilityMigrationId`. The production schema now correctly rejects that incoherent combination
because native runs cannot carry migration visibility and migrated runs require terminal silent
proof fields.

## Implementation plan

1. Keep the production schema unchanged.
2. Add one test helper that creates a complete terminal, silent legacy-import run with deterministic
   synthetic proof hashes and a non-null migration visibility fence.
3. Replace only the two incoherent hidden-run fixtures with that helper; keep the assertions and all
   visible native fixtures unchanged.
4. Re-run the complete Firestore store and document-codec tests.

No runtime behavior, production data, or deployment is changed by this remediation.
