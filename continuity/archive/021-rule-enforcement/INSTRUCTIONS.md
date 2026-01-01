# Rule Enforcement Implementation - Instructions

## Goal

Implement automated enforcement for 15 currently unenforced rules from CLAUDE.md to prevent future violations.

## Success Criteria

1. All 15 unenforced rules have automated enforcement mechanisms
2. ESLint rules integrated into existing config (7 rules)
3. Verification scripts created following existing pattern (5 scripts)
4. CI integration updated to run new verifications
5. All scripts pass when run individually
6. `npm run ci` passes with all new enforcement
7. Code formatted with Prettier
8. No violations introduced during implementation

## Scope

**In Scope:**

- ESLint rule additions to eslint.config.js
- Verification scripts in scripts/ directory
- CI integration updates
- Package.json script additions
- Git hooks installer (optional)
- Documentation of enforcement mechanisms

**Out of Scope:**

- Changing existing enforcement mechanisms
- Modifying vitest.config.ts (protected file)
- Changing test files or application code
- Infrastructure changes

## Constraints

- Follow existing patterns (ESLint config blocks, verify-\*.mjs scripts)
- Codebase is currently compliant (no violations to fix)
- Must pass `npm run ci` before archival
- Use existing tooling (ESLint, Node.js scripts, no new dependencies)
- Maintain fast CI execution (verification scripts in Phase 1)

## Subtask Numbering Pattern

```
0-0-setup.md              ← Tier 0: Initial setup and validation
1-0-verification-scripts.md  ← Tier 1: Create verification scripts
1-1-eslint-rules.md       ← Tier 1: Add ESLint rules
1-2-ci-integration.md     ← Tier 1: Integrate into CI
2-0-testing.md            ← Tier 2: Test all enforcement
2-1-coverage-verification.md ← Tier 2: Final coverage check
```

## Ledger Semantics (CONTINUITY.md)

The ledger tracks:

- **Goal:** Current objective and success criteria
- **Done:** Completed subtasks with outcomes
- **Now:** Current subtask being executed
- **Next:** Upcoming subtask
- **Decisions:** Key implementation choices with reasoning
- **Open Questions:** Unresolved issues or blockers

## Idempotent Execution

Each subtask file contains:

- Problem statement
- Step-by-step checklist
- Verification commands
- Definition of done
- Continuation directive (except final task)

If interrupted, resume from CONTINUITY.md ledger state.

## Resume Procedure

1. Read CONTINUITY.md to understand current state
2. Check "Now" section for current subtask
3. Review "Done" to see completed work
4. Continue from current subtask
5. Update ledger after each step
