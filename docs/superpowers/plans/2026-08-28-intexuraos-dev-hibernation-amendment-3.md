# IntexuraOS DEV Hibernation Plan — Amendment 3

## Status

**Proposed effective revision — execution remains paused until the user explicitly accepts the
goal referencing the exact SHA-256 of the resulting plan.**

## Purpose

Close four final review findings without changing the requested outcome:

1. keep plan acceptance external so recording acceptance cannot change the accepted plan hash;
2. require one fully consistent automation-created Linear object before M0 can pass;
3. detect transient orchestrator log-forwarder activity between drain snapshots; and
4. remove the evidence PR's impossible requirement to prove its own future merge.

## Exact plan changes

### A1. Acceptance state

Keep the effective plan revision in proposed state. After acceptance, record the accepted SHA and
user-acceptance timestamp only in the new run's private bootstrap evidence; do not edit the plan's
status line.

### A2. Automatic Linear consistency

Replace M0.1 step 7 with a single consistency gate. The first non-draft implementation PR is the
sole trigger. PASS requires exactly one automation-created issue, or an idempotent relink proven to
refer to the same automation-created issue, and exact agreement among the PR title, Linear bot
linkback, and read-only Linear object. Capture the provider-native Linear UUID as well as its
identifier, team, title, and URL. Missing or inconsistent evidence blocks M0; no manual Linear
creation/update and no empty/no-op retry are allowed.

### A3. Forwarder activity telemetry

Add process-lifetime monotonic `forwarderActivityTotal` and `lastActivityAt` to
`logForwarderDrain`. Update both for enqueue, flush start and result, retry, and forwarder close.
Add tests proving transient activity completed between snapshots cannot yield `pendingStatus=zero`.

At M7.3, prove the live counter and timestamp advance during the canary and then stabilize. At
M8.1, establish each logical freeze boundary through a signed per-surface witness, then require
unchanged process/epoch identity and zero monotonic deltas across witness → anchor → read 1 → read
2. Wall-clock comparison is corroborating only and cannot establish continuity. Replace the vague
inherited-predicate reference with explicit zero-NONZERO/zero-UNKNOWN requirements for all
authoritative Firestore classes and explicit orchestrator, producer, Matrix-route, production, and
retained-host checks.

### A4. Non-cyclic evidence closeout

Render only the ledger frozen through M11.1. The tracked index reports PASS/FAIL only through
M11.1 and marks M11.2 `pending_external_closeout`. After the evidence PR merges, append its URL,
checks, merge SHA, and final repository states to the private ledger. M11.2 PASS is established only
by final ledger/schema/privacy validation together with GitHub metadata, never by the tracked index
itself.

## Acceptance effect

Acceptance authorizes applying exactly A1–A4 together with Amendments 1 and 2. It does not
authorize any external provider save, Cloudflare apply, live canary, queue disposition, service
stop, or other action already guarded by a just-in-time confirmation.
