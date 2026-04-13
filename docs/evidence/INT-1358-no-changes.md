# INT-1358: Restore missing merge button for code tasks

## No Changes Needed

The work described in INT-1358 was already implemented and merged into `development` via PR #1777.

### Evidence

- **Commit:** `78cd4ff985ba6cd28fc7e37b638479c03f19f898` — "fix(orchestrator): exclude operational steps from needs_remediation definition"
- **PR:** https://github.com/pbuchman/intexuraos/pull/1777 (merged 2026-04-13T12:34:28Z)
- **Changes:** Updated `needs_remediation` prompt in both `system-prompt.ts` and `completion-verifier.ts` to explicitly exclude operational/manual verification steps. Bumped `reviewPrompt` version 9.2.0 → 9.2.1. Tests updated.

### Timestamp

2026-04-13
