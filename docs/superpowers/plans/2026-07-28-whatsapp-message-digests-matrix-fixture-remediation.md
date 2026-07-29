# WhatsApp Message Digests — Matrix Fixture Remediation

**Goal:** Restore the WhatsApp workspace test-typecheck after making the Message Digest service URL
mandatory, without changing runtime behavior or weakening the config contract.

## Evidence and root cause

- WhatsApp source typecheck passed.
- Workspace test typecheck failed only in
  `integration-tests/fixtures/intexAgentMatrixCorpusRuntimeHarness.ts`: its synthetic
  `ServiceConfig` predates `messageDigestServiceUrl`.
- Repository search shows every other `ServiceConfig` fixture already supplies the field.

## Implementation and verification

1. Add a non-routable `.example.test` Message Digest URL to the matrix-corpus synthetic fixture.
2. Re-run the tracked WhatsApp workspace gate; do not change production config defaults, make the
   field optional, or run full repository CI.

```bash
pnpm run verify:workspace:tracked whatsapp-service
```
