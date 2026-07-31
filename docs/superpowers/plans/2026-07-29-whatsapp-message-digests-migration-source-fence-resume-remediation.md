# WhatsApp Message Digests — Migration Source Fence Resume Remediation

**Problem:** Private WhatsApp `sourceRevision` is an encrypted short-lived response fence with a
random IV. A fresh migration preflight therefore receives a different token even when the owned
account generation and chat are unchanged. Treating the complete source snapshot as immutable would
block deterministic resume after a partial apply.

## Implementation plan

1. Add a production-port test that creates a shell, rotates only ephemeral source observation fields
   (`sourceRevision`, counts, last activity), and requires `createShell` to return `existing`.
2. Keep immutable source identity strict: type, owner account, generation, chat ID, chat type, and
   display name must remain exact.
3. Replace whole-object source equality in shell compatibility with that identity comparison.
4. Add a conflicting-generation assertion and re-run production-port plus pure migrator tests.

No source token is persisted to output or logs, and no production data is read in this remediation.
