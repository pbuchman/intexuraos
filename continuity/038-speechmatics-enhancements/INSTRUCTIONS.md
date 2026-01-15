# Speechmatics Enhancements - Process Manual

## Rules and Numbering

Tasks are organized by tier:

- **Tier 0**: Setup and diagnostics (`0-0-*.md`)
- **Tier 1**: Independent deliverables (`1-0-*.md`, `1-1-*.md`, etc.)
- **Tier 2**: Dependent/integrative work (`2-0-*.md`)

The numbering pattern `[tier]-[sequence]-[title].md` ensures deterministic ordering and clear dependency visualization.

## Idempotent Execution Process

1. Read the task file from `continuity/038-speechmatics-enhancements/`
2. Execute step checklist sequentially
3. Mark completion in `CONTINUITY.md` ledger
4. Commit changes after each task
5. Proceed to next task (unless continuation directive absent)

## Ledger Semantics

The `CONTINUITY.md` file is the source of truth for:

- Current progress (Done / Now / Next)
- Key decisions with full reasoning
- Open questions requiring user input
- Working set of files and commands

Update the ledger after every significant action.

## Resume Procedure

If interrupted:

1. Read `CONTINUITY.md` to understand current state
2. Read the task file for the current "Now" item
3. Continue from where you left off
4. Update ledger as you progress
