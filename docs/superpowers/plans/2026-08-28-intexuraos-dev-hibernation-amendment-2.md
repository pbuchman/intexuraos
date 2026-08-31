# IntexuraOS DEV Hibernation Plan — Amendment 2

## Status

**Proposed effective revision — execution remains paused until the user explicitly accepts the
goal referencing the exact SHA-256 of the resulting plan.**

## Purpose

Align the M0 Linear gate with the repository's `$commit-push` contract. The new Linear issue must
be created or linked by GitHub automation after the first non-draft IntexuraOS pull request is
opened. It must not be created or updated manually.

## Authorized change

1. Record `linearLinkStatus=pending_auto` during the pre-branch bootstrap.
2. After the revision and working-tree safety checks pass, create the descriptive IntexuraOS
   implementation branch without an `INT-XXX` identifier.
3. Add the accepted plan and test-first ledger contract, pass `pnpm run ci:tracked`, commit, push,
   and open the implementation PR as non-draft against `development` with the exact `$commit-push`
   Linear omission note.
4. Treat that PR as the sole automatic issue-creation trigger. Do not create or update a Linear
   issue manually and do not use an empty or no-op commit to trigger a retry.
5. Poll read-only for at most ten minutes. PASS requires exactly one automation-created Linear
   issue, or a proven idempotent relink to that issue, with exact agreement among the PR-title
   prefix, Linear bot linkback, and read-only Linear object. Capture its provider-native UUID,
   identifier, team, title, and URL.
6. Automation failure blocks M0. Diagnose it and allow only a natural implementation commit to
   produce a `synchronize` retry. No implementation beyond the accepted plan and ledger bootstrap
   may proceed until the genuine identifier is verified.
7. Reuse the already-open IntexuraOS implementation PR at M6; do not create a duplicate.

## Acceptance effect

This amendment overrides only the ordering of Linear issue creation in M0.1 and the corresponding
M6.2 wording. It does not relax any test, review, merge, deployment, evidence, privacy, or
just-in-time confirmation gate.
