# WhatsApp Message Digests — Task 7 Coverage Threshold Addendum

> **For the primary agent:** Execute sequentially. This addendum changes tests only; do not lower
> thresholds, add coverage exclusions, or modify production behavior.

**Goal:** Restore the `message-digest-service` branch-coverage gate from the observed 94.78% to at
least the required 95% by exercising meaningful validation and default-clock branches in the new
delivery-authorization use case.

## Evidence and root cause

- `pnpm run verify:workspace:tracked message-digest-service` passed source typecheck, test
  typecheck, lint, and all 517 tests.
- Coverage reported 2,256 of 2,380 branches (94.78%); five additional covered branches are needed
  to reach 95%.
- The new `authorizeMessageDigestDelivery.ts` boundary has untested branches for the service-owned
  default clock and invalid release envelopes (identity, timestamp, and fence). These are security
  and retry-safety decisions worth asserting directly.

## Sequential implementation

1. Extend `authorizeMessageDigestDelivery.test.ts` with a deterministic fake-clock case proving
   acquire and release use the service clock when no clock dependency is injected.
2. Add table-driven release-envelope cases for malformed identity, invalid service time,
   non-integer fence, and non-positive fence. Assert zero storage calls in every invalid case.
3. If the measured result remains below 95%, cover the adjacent internal release boundary: reject
   a wrong caller role before the use case and map an invalid use-case result through the stable
   public error envelope.
4. Run the focused authorization/internal-route suites, then rerun the tracked Message Digest
   workspace gate.
5. Continue Task 6 only if the branch threshold passes without production-code or configuration
   changes.

## Verification

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts
pnpm exec vitest run apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts
pnpm run verify:workspace:tracked message-digest-service
```

The first failed coverage run remains recorded as verification run #25; this addendum does not
erase or rewrite that evidence.
