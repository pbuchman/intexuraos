# Continuity Workflow

For multi-step features or refactoring, use the continuity process to maintain context across sessions.

## Setup

1. Create numbered directory: `continuity/NNN-task-name/`
2. Create files:
   - `INSTRUCTIONS.md` — goal, scope, constraints, success criteria
   - `CONTINUITY.md` — ledger tracking progress and decisions
   - `[tier]-[seq]-[title].md` — individual subtask files

## Subtask Numbering

```
0-0-setup.md       ← Tier 0: diagnostics/setup
1-0-feature-a.md   ← Tier 1: independent deliverables
1-1-feature-b.md
2-0-integration.md ← Tier 2: dependent/integrative work
```

## Ledger (CONTINUITY.md)

Must track:

- Goal and success criteria
- Done / Now / Next status
- Key decisions with reasoning
- Open questions

## Completion

1. Second-to-last task: verify test coverage
2. Archive to `continuity/archive/NNN-task-name/`
3. Only claim complete after archival
