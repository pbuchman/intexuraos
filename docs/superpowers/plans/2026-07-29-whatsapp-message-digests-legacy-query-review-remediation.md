# WhatsApp Message Digests — Legacy Query Review Remediation

**Status:** Complete

**Scope:** Close the three Important findings from the read-only review of the temporary legacy
query boundary used by Fishing Assistant. This remediation is part of migration Task 1 and must be
complete before implementation resumes in Fishing Assistant.

## Finding 1 — Historical local dates depend on mutable definition schedule

The legacy query currently derives Firestore bounds and projected dates from the definition's
current time zone. Editing a definition could therefore make an existing cursor invalid or move a
historical run to another local date.

### Decision

- Derive each returned run's local date exclusively from its immutable `scheduleSnapshot.timeZone`.
- Convert optional local-date filters into conservative UTC bounds that cover every valid IANA
  offset (`UTC-12` through `UTC+14`), independently of the current definition schedule.
- Re-filter the page by each run's immutable local date before projection.
- Bind the cursor fingerprint to the normalized local-date inputs and the resulting immutable UTC
  bounds, never to the definition's current schedule.
- Prove that changing the definition time zone does not change the historical projection or cursor
  fingerprint.

## Finding 2 — Internal client rejects valid persisted projections

The client's response schemas use unrelated bounds for fields copied directly from validated
Message Digest documents. A valid run can consequently be rejected at the service boundary.

### Decision

- Align projected definition and run response schemas with the persisted document contracts:
  private source IDs up to 512 characters, headline up to 200, summary up to 12,000, and at most
  1,000 SHA-256 evidence references.
- Keep request-side legacy alias bounds unchanged because they are a narrower public migration
  contract.
- Add boundary compatibility tests proving that maximal valid persisted projections are accepted
  and the first invalid value is rejected.

## Finding 3 — New query shapes have no production index artifact

The alias lookup and legacy scheduled-run query require composite Firestore indexes not yet present
in the deployable artifact.

### Decision

- Extend migration 128 (which has not been committed or deployed) with the exact alias and legacy
  run query shapes; do not allocate a second migration ID.
- Add the same shapes exactly once to `firestore.indexes.json`.
- Update the migration test and manifest checksum after the source is final.

## Verification

1. Add failing focused tests for immutable run time zones, conservative bounds, client boundary
   compatibility, and both index shapes.
2. Implement the smallest changes that make those tests pass.
3. Run only the affected Message Digest use-case, store, route, client, and migration tests.
4. Run affected package typechecks, scoped lint, and `git diff --check`.
5. Request a fresh read-only review before marking this plan Complete.

## Follow-up review findings

The first remediation review found two additional fail-closed gaps. They are part of this same
boundary and must be closed before the plan is Complete.

### Resolver pagination

`resolveLegacyDigestRun` must continue through the bounded conservative UTC result set when a newer
run projects to an adjacent local day. It will request full bounded pages, follow only signed
cursors returned by the query use case, reject a repeated cursor, and stop when it finds the exact
requested local date or exhausts the result set.

### Exhaustive duplicate-alias detection

`getOwnedDefinitionByLegacyAlias` must not apply a storage limit before validating activation and
group-source invariants. The exact owner-and-alias result set will be read and filtered completely,
so any two activated group definitions fail closed as `AMBIGUOUS_LEGACY_ALIAS`, even when inactive
or direct-source records precede them.

### Additional verification

- Add a resolver test where page one contains only a newer adjacent-day run and page two contains
  the requested run.
- Add a store test where more than three distracting alias records precede two activated group
  definitions.
- Re-run the same focused gate and obtain one more read-only review.
