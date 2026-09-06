# WhatsApp Message Digests — Migration Source Request Remediation

**Problem:** The fishing migration preflight passes `sourceRevision` in the Private WhatsApp
message-query request even though the internal route intentionally rejects every key outside its
strict request allowlist. The source revision is a response fence and must still be verified on
every returned page.

**Scope:** Correct only the migration source-query request shape. Keep source validation, page
response revision checks, candidate hashing, and replay behavior unchanged.

## Implementation plan

1. Add a focused migration test that captures every `queryMessages` input and proves its exact keys
   match the WhatsApp internal endpoint contract, including cursor only on continuation pages.
2. Run that test alone and confirm it fails because `sourceRevision` is currently present.
3. Remove `sourceRevision` from the request passed by `readSourceWindow`; continue comparing the
   response `sourceRevision` with the validated source revision.
4. Re-run the focused migration suite and confirm request-shape and stale-revision rejection both
   pass.

No production data, network request, deployment, or full CI run is part of this remediation.
