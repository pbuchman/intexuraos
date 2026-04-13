# INT-1357: Allow collapsing orchestrator and entrypoint log lines

## No Changes Needed

The requested changes were already implemented and merged into `development` before this execution agent ran.

### Evidence

- **Commit:** `dbe317cb0` — `fix(web): add orchestrator and entrypoint to collapsible log tags`
- **PR:** #1776 — merged at 2026-04-13T11:15:15Z
- **File:** `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`
  - `entrypoint` added to `TAG_STYLES` (line 45)
  - `orchestrator` added to `TAG_STYLES` (line 44)
  - Collapsible condition extended to include both tags (line 157)

### Timestamp

2026-04-13
