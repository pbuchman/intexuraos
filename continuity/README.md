# ⚠️ Continuity Workflow - DEPRECATED

**Status:** This workflow has been deprecated. Use **Linear issues** instead.

---

## Migration Notice

As of 2026-01-22, the file-based continuity workflow has been replaced with a **Linear-based continuity pattern**.

### What Changed

- **Old:** `continuity/NNN-task-name/` directories with markdown files
- **New:** Linear issues with parent-child relationships

### Why

- Better visibility (team can see progress in Linear UI)
- Full history preserved (state transitions, comments)
- No manual cleanup needed
- Easier collaboration
- Better integration with project management

### New Workflow

See **[Linear-Based Continuity Pattern](../docs/patterns/linear-continuity.md)** for complete documentation.

**Quick Start:**

1. Create top-level Linear issue for the overall feature
2. Break down into child issues (tiered: 0-X, 1-X, 2-X)
3. Use parent issue as ledger (goal, decisions, state tracking)
4. Execute child issues sequentially
5. Mark all as Done when complete

---

## Archived Tasks

All previous continuity tasks have been archived to `continuity/archive/`:

- `001-test-coverage-improvements`
- `002-test-coverage-improvements-phase-2`
- `003-whatsapp-notes-refactor`
- ... (38+ archived tasks)

These remain for historical reference but **should not be used for new work**.

---

## Documentation

- **New Pattern:** `docs/patterns/linear-continuity.md`
- **Workflow:** `.claude/commands/continuity.md` (updated for Linear)
- **Linear Integration:** `.claude/commands/linear.md`

---

## Questions?

If you have questions about the new Linear-based workflow, refer to the documentation above or check existing Linear issues for examples.
