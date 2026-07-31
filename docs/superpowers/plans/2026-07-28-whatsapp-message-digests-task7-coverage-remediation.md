# WhatsApp Message Digests — Task 7 Branch-Coverage Remediation

**Observed RED:** The one planned Message Digest service coverage run passed all 482 tests but
reported 94.66% branch coverage (2,129/2,249) against the repository's 95% gate. Statements, lines,
and functions already exceed 95%.

**Constraint:** Add assertions only. Do not change production behavior, coverage configuration, or
exclusions. Run the coverage command only once more after focused GREEN tests.

## Sequential test-only work

1. Extend `whatsappDigestClient.test.ts` with an otherwise-valid source response that omits both
   optional safe metadata fields; assert the adapter omits them without leaking internal data.
2. Extend `formatWhatsAppDigest.test.ts` with non-empty Markdown that normalizes to an empty plain
   excerpt; assert `INVALID_RUN_OUTPUT` before outbox creation.
3. Extend `config.test.ts` with a local environment that omits `INTEXURAOS_RUNTIME` while supplying
   both emulator hosts; assert the documented `dev` default.
4. Extend `createMessageDigest.test.ts` with a valid weekly definition and assert the weekday is part
   of idempotent request identity.
5. Extend `reserveMessageDigestRun.test.ts` with an existing deterministic run whose immutable
   request identity conflicts; assert `RUN_PREPARATION_STALE` and no second reservation.
6. Extend `messageDigestRoutes.test.ts` with an owner-visible legacy definition whose three optional
   source metadata values are absent; assert the public projection omits only those keys and still
   exposes no private source identity.
7. Run the six focused test files. If GREEN, rerun
   `pnpm --filter @intexuraos/message-digest-service test:coverage` once and require every global
   dimension, including branches, to be at least 95%.
