# WhatsApp Message Digests — Fishing Migration Review Remediation

**Status:** Complete

**Scope:** Close the three Important findings from the read-only review of the Fishing Assistant
migration before any data migration begins.

## Bounded chat retrieval

- A question without explicit dates searches the most recent 90 Fishing-local calendar days;
  older periods remain available through explicit dates.
- Digest scanning is capped at two 100-run pages, with the existing signed-cursor repeat guard.
- Raw WhatsApp expansion is performed only for the four highest-ranked digest runs.
- Those four bounded expansions run concurrently; each reads at most two 200-message pages and
  keeps the source fence, exact evidence-reference allowlist, time-window check, and cursor guard.
- Digest summaries remain available when any raw expansion is incomplete or fails.

This bounds the normal no-date path to at most two Message Digest calls and eight WhatsApp calls,
with at most two sequential WhatsApp timeout intervals on the critical path.

## Complete monthly list

The legacy Fishing digest route will default to its existing maximum page size of 100. A monthly UI
range has at most 31 scheduled daily summaries, so the existing UI receives the complete month
without needing cursor controls. Explicit bounded cursor pagination remains supported for other
callers.

## Friendly group label

The legacy alias remains the stable routing key, but the Fishing facade exposes the historical
human label `Grupa Wędkarska Skool`. The internal Message Digest projection stays content-minimal.

## Verification

1. Add failing tests for the 90-day range, page/run fan-out caps, default list limit 100, and friendly
   display name.
2. Implement the bounded behavior and rerun focused tests.
3. Run the full Fishing Assistant package tests, typecheck, lint, and a fresh read-only review.
