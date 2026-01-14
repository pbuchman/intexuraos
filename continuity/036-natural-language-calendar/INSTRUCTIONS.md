# Process Instructions

## Rules and Numbering

1. **Directory Structure**: All work must be contained within `continuity/036-natural-language-calendar/`.
2. **Task Execution**: Execute tasks in strict order:
   - Tier 0 (Setup): `0-0-shared-config-prompts.md`
   - Tier 1 (Implementation):
     - `1-0-actions-agent-dispatcher.md`
     - `1-1-calendar-agent-worker.md`
     - `1-2-frontend-implementation.md`
   - Tier 2 (Verification): `2-0-verify-and-polish.md`
3. **Ledger Updates**: Update `CONTINUITY.md` after EVERY step.
4. **Testing**: Run tests after every code change.
5. **Coverage**: Do NOT modify `vitest.config.ts`. Write tests if coverage fails.

## Idempotent Execution Process

1. Read `CONTINUITY.md` to determine current state.
2. Read the current task file (e.g., `0-0-shared-config-prompts.md`).
3. Execute steps in the task file.
4. Update `CONTINUITY.md` with progress and reasoning.
5. Commit changes.
6. Proceed to the next task if "Continuation Directive" is present.

## Resume Procedure

1. Check `CONTINUITY.md` for "State: Now".
2. If "Now" is empty, find the first non-completed task.
3. Resume execution from that task.
