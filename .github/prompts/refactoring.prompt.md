You are performing a **repository-wide refactoring pass**.

================================================================================
PREREQUISITES
================================================================================

**You MUST read these files first — they contain all coding rules:**

- `.github/copilot-instructions.md` — global rules
- `.github/instructions/apps.instructions.md` — apps (services) rules
- `.github/instructions/packages.instructions.md` — packages (domain/infra) rules
- `.github/instructions/terraform.instructions.md` — terraform rules

This prompt provides **execution strategy only**. Do not duplicate rules from above files.

================================================================================
EXECUTION STRATEGY
================================================================================

## Phase 1: Analysis (do first)

1. Run coverage: `npm run test:coverage`
2. Identify files with <50% coverage or 0% coverage.
3. List duplicated patterns across files.
4. Note any boundary violations or architectural inconsistencies.

## Phase 2: Prioritization

Refactor in this order (highest impact first):

1. **Dead code removal** — quick wins, reduces noise.
2. **Duplicated logic extraction** — consolidate before adding tests.
3. **Test coverage gaps** — focus on business logic, domain, infra.
4. **Boundary violations** — enforce layer separation (common/domain/infra/apps).
5. **Pattern inconsistencies** — service organization, error handling.

## Phase 3: Execution

For each change:

1. Make the change.
2. Run `npm run typecheck && npm run lint && npm run test`.
3. If tests fail, fix before proceeding.
4. Commit logical units separately.

## Phase 4: Verification

Final checks before completion:

```bash
npm run ci   # runs all checks: lint, verify scripts, format, typecheck, test, build
```

For Terraform (if touched):

```bash
cd terraform && terraform fmt -check -recursive && terraform validate
```

================================================================================
DECISION RULES
================================================================================

When uncertain:

| Situation                       | Decision                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| Extract utility or keep inline? | Extract if used 2+ times                                   |
| Add test or skip?               | Add if logic has branches or error paths                   |
| Fix now or defer?               | Fix if <5 min, otherwise create TODO with issue reference  |
| Which layer for logic?          | Domain for business logic, Infra for external integrations |

================================================================================
OUTPUT
================================================================================

After completing refactoring, summarize:

1. **Changes made** — list of refactored areas
2. **Coverage delta** — before/after comparison
3. **Deferred items** — TODOs created with issue references
4. **Risks** — anything requiring follow-up attention
