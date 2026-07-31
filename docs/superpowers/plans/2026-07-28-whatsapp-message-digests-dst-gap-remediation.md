# WhatsApp Message Digests — DST Gap Remediation Plan

**Status:** Completed — focused schedule suite 39/39 and service typecheck green on 2026-07-28.

**Goal:** Make the Message Digest schedule engine follow the authoritative feature-completion rule
for a local send time that does not exist during a spring-forward transition.

## Observed contradiction

- The feature-completion contract says that a nonexistent wall time advances to the first valid
  instant that day.
- The MVP regression test instead describes Temporal `compatible` behavior and expects Warsaw
  `2026-03-29 02:30` to become `03:30`.
- In Warsaw the first valid instant after the `02:00..02:59` gap is `03:00`, so both expectations
  cannot be true.

## Decision

The written feature-completion contract is authoritative. A nonexistent scheduled wall time resolves
to the earliest valid local instant after the gap on the same local date (`03:00` in the Warsaw
example). An ambiguous fall-back wall time continues to use its earlier real occurrence. This is a
schedule calculation change only; persisted daily records remain byte-compatible.

## Sequential TDD execution

1. Replace the contradictory test expectation with a schedule-union regression that expects the
   first valid local instant, and add the fall-back earlier-occurrence assertion.
2. Run only `messageDigestSchedule.test.ts` and capture the expected RED result before implementation.
3. Change local-boundary resolution minimally so an invalid wall time searches forward to the first
   representable minute on the requested local date while preserving exact/ambiguous behavior.
4. Re-run the focused schedule test to GREEN, including daily, weekdays, weekly, Warsaw winter/summer,
   gap, overlap, and invalid-input cases.
5. Reuse the same backend preview in the Web UI and describe this rule in the schedule helper copy;
   do not duplicate DST calculations in the browser.

## Verification boundary

No full CI run is authorized for this remediation. It is complete after the focused schedule suite,
the relevant backend typecheck, and the later feature-completion review gate are green.
