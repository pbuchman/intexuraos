# WhatsApp Message Digests — Migration Window Revision Remediation

**Problem:** The WhatsApp validation endpoint issues a binding-level source token, while the message
query issues a different token bound to the exact window and high watermark. The migration compared
those intentionally different tokens, so a real first page would always fail despite a stable source.

## Implementation plan

1. Change the synthetic source fixture to return a stable but distinct query revision for each date,
   while keeping the validation token different.
2. Add an explicit test proving this real contract succeeds and continuation-page revision drift in
   the same window fails closed.
3. In `readSourceWindow`, capture the non-empty revision from page one and require every subsequent
   page in that window to match it. Keep generation/account/chat inputs fenced on every request.
4. Re-run all pure migration and production-port tests.
5. Treat the encrypted `highWatermark` token as an in-request fence only. Add a resume test with
   rotated revision/watermark ciphertext and derive the persisted watermark proof from stable safe
   page boundaries (page count plus last `eventTimestamp/messageRef`) so unchanged source data keeps
   byte-identical migration hashes.

No cross-window token equality is introduced. Activation still re-reads every window and verifies
the complete source-plan hash before visibility changes.
