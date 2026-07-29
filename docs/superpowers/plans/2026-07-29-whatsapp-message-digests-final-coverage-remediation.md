# WhatsApp Message Digests Final Coverage Remediation Plan

## Trigger

The fresh focused Message Digest coverage gate ran 588 passing tests but failed the configured global branch threshold: 94.76% observed versus 95% required. The threshold and ignore policy remain unchanged.

## Diagnosis

The V8 report shows executable error/recovery branches that are not exercised by the current package suite. The smallest meaningful gap is in owner-scoped erasure resume, internal delivery authorization/base64 validation, and public downstream-error mapping. These are production safety contracts, so tests should cover them directly rather than adding exemptions or artificial implementation branches.

## RED/GREEN changes

1. Extend `eraseMessageDigest.test.ts` to prove invalid resume identity/limits stop before storage and a store conflict is returned unchanged.
2. Extend `internalMessageDigestRoutes.test.ts` to prove an invalid acquire decision maps to the stable error envelope and non-canonical base64 is rejected before worker execution.
3. Extend `messageDigestRoutes.test.ts` to prove invalid list cursors and unavailable WhatsApp readiness map to safe public errors.
4. Run only the three changed tests first, then rerun `@intexuraos/message-digest-service test:coverage`.

## Acceptance

- New focused tests pass.
- Existing 588 tests remain green.
- Global branch coverage is at least 95%.
- No production code, threshold, coverage configuration, or ignore directive changes.
