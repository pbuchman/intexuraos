# WhatsApp Message Digests — Incoming Request Logging Remediation

> Status: complete — all five route-local calls, focused tests, verifier, typecheck, lint, format,
> and diff checks are green; request body previews remain disabled.

## Goal

Make every new WhatsApp internal route satisfy the route-local incoming-request logging contract
without exposing private Message Digest request bodies.

## Evidence and root cause

- `pnpm run verify:incoming-request-logging` is RED for five new POST handlers.
- Each handler already logs through a file-local helper, but the repository verifier deliberately
  requires a visible `logIncomingRequest(...)` call inside every route declaration.
- The helpers already use `bodyPreviewLength: 0`; preserving that setting prevents user IDs, chat
  IDs, source tokens, idempotency keys, and payload digests from entering body previews.

## Implementation

1. Inline the existing privacy-preserving log call into each of the three outbound-delivery and two
   private-digest-source handlers.
2. Keep stable messages and explicit non-sensitive operation labels; remove the now-unused helpers.
3. Run the previously RED verifier, both focused route suites, WhatsApp typecheck/lint, Prettier,
   and `git diff --check`.

## Completion gate

All five handlers pass the static verifier, focused tests still prove `bodyPreviewLength: 0`, and no
request-body field is newly logged. No full CI run is allowed here.
