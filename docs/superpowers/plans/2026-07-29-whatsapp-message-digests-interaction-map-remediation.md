# Message Digest Interaction Map Remediation

## Evidence

`MessageDigestInteractionCoverage.test.ts` still names the superseded DETAIL-03 assertion
`pauses atomically with revision CAS, no optimistic status, and authoritative refresh`, while the
authoritative behavior test is now named `pauses atomically with revision CAS and adopts the
authoritative PATCH response`. The Web migration also broadens the LEGACY-01 route assertion from
one Mobile URL to all supported Mobile and Fishing legacy detail URLs, so its evidence name changes
to `resolves legacy detail route %s to the canonical run`.

## Plan

1. Keep the behavior test unchanged because it already proves revision CAS, no optimistic status,
   disabled conflicting actions, and adoption of the authoritative PATCH response.
2. Update the DETAIL-03 evidence map to the exact current assertion name.
3. Update LEGACY-01 to the broadened parameterized legacy-route assertion.
4. Re-run the interaction coverage contract and the focused Web migration/removal tests.
