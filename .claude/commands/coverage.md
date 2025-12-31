# Coverage Improvement Skill

You are executing a coverage improvement session.

## Phase 1: Check for Existing Continuity Task

**FIRST**, check if there's an active coverage continuity folder:

```bash
ls continuity/ | grep -i coverage
```

- If **found** (e.g., `017-coverage-improvements/`): Read `CONTINUITY.md` and resume from "Now" section
- If **not found**: Proceed to Phase 2

### When Resuming Existing Task

1. Read `CONTINUITY.md` to understand current state
2. Read the subtask file referenced in "Now" section
3. Continue working on pending items
4. Skip to Phase 5 (Working)

---

## Phase 2: Investigate Current State

If no active task exists, analyze current coverage:

```bash
npm run test:coverage
```

Parse the output to identify:

- Current coverage percentages (lines, statements, functions, branches)
- All files with < 100% coverage
- Specific uncovered lines/branches/functions for each file

---

## Phase 3: Create Continuity Structure

Create new continuity folder with next sequence number:

```bash
ls continuity/archive/ | sort -n | tail -1  # Find highest archived number
```

Create: `continuity/NNN-coverage-improvements/`

### Required Files

1. **`INSTRUCTIONS.md`** — Goal, scope, success criteria
2. **`CONTINUITY.md`** — Ledger with subtask registry
3. **Subtask files** — One per tier (see Phase 4)

---

## Phase 4: Create Subtask Files (MANDATORY)

**CRITICAL: All coverage gaps MUST be documented in physical `.md` files.**

Create tiered subtask files based on effort:

| File                           | Criteria                    | Est. Time  |
| ------------------------------ | --------------------------- | ---------- |
| `1-0-tier1-quick-fixes.md`     | Single line/branch missing  | < 5 mins   |
| `1-1-tier2-small-gaps.md`      | 2-5 lines missing           | 5-15 mins  |
| `1-2-tier3-small-functions.md` | Small function (< 20 lines) | 15-30 mins |
| `1-3-tier4-larger-efforts.md`  | Large gaps (> 20 lines)     | 30+ mins   |
| `2-0-remaining-coverage.md`    | Dependent/final integration | Variable   |

### Subtask File Format

Each file MUST contain:

- Status (PENDING/PARTIAL/COMPLETE)
- Table listing ALL files with gaps in that tier
- For each file: current coverage %, gap size, specific uncovered lines
- Verification commands

Example:

```markdown
# Tier 1: Quick Fixes (< 5 mins each)

## Status: PENDING

## Items

| #   | File                                     | Coverage | Gap    | Uncovered | Status  |
| --- | ---------------------------------------- | -------- | ------ | --------- | ------- |
| 1   | `packages/common-core/src/encryption.ts` | 95.83%   | 1 line | Line 41   | Pending |
| 2   | `apps/whatsapp-service/src/signature.ts` | 91.66%   | 1 line | Line 64   | Pending |

## Verification

\`\`\`bash
npx vitest run --coverage path/to/file.test.ts
\`\`\`
```

### CONTINUITY.md Must Include

```markdown
## Subtask Registry

| File                           | Status     | Description              |
| ------------------------------ | ---------- | ------------------------ |
| `1-0-tier1-quick-fixes.md`     | ⏳ Pending | Single line/branch fixes |
| `1-1-tier2-small-gaps.md`      | ⏳ Pending | 2-5 line gaps            |
| `1-2-tier3-small-functions.md` | ⏳ Pending | Small function additions |
| `1-3-tier4-larger-efforts.md`  | ⏳ Pending | 30+ min efforts          |
| `2-0-remaining-coverage.md`    | ⏳ Pending | Final coverage gap       |
```

---

## Phase 4.5: Request Permission (MANDATORY)

**STOP and ask user for permission before starting work:**

> I've documented all coverage gaps in the subtask files:
>
> - Tier 1: X items (quick fixes)
> - Tier 2: X items (small gaps)
> - Tier 3: X items (small functions)
> - Tier 4: X items (larger efforts)
>
> Ready to begin. Proceed?

Wait for user confirmation before proceeding to Phase 5.

---

## Phase 5: Work Continuously Until Complete

**Work through ALL tiers without stopping.** Update status after EACH item so work can resume if session is interrupted.

### Workflow

1. Start with Tier 1, work through all tiers sequentially
2. For each item:
   - Read the uncovered line(s)
   - Understand what scenario is missing
   - Add test case to cover it
   - **Immediately update subtask file** (mark item complete)
   - **Immediately update `CONTINUITY.md`** (update "Now" section)
3. Continue to next item without pausing
4. Move to next tier when current tier is complete
5. Stop only when:
   - All tiers complete, OR
   - Coverage thresholds met, OR
   - Session interrupted

### Status Update Pattern (CRITICAL)

After EACH completed item:

```markdown
# In subtask file (e.g., 1-0-tier1-quick-fixes.md)

| 1 | `file.ts` | 95% | 1 line | Line 41 | ✅ Done |

# In CONTINUITY.md

## Now

Working on item 5 of `1-0-tier1-quick-fixes.md`

## Done

1. ✅ Item 1 description
2. ✅ Item 2 description
   ...
```

This ensures work can resume from exact position if session is killed.

---

## Rules

- **NEVER** modify `vitest.config.ts` exclusions or thresholds
- Write tests to achieve coverage
- All gaps MUST be in physical `.md` files before starting work
- Ask permission ONCE before starting (Phase 4.5), then work continuously
- **Update status after EACH item** — critical for resumability
- Mark blockers (unreachable code, skipped tests) clearly
- Continue until complete or session interrupted

---

## Reference Patterns

See archived continuity projects:

- `continuity/archive/012-packages-coverage/`
- `continuity/archive/013-coverage-improvements/`

---

## Exit Criteria

Session complete when:

- All items in current tier addressed, OR
- Coverage thresholds met (95% statements, functions, branches, lines), OR
- User requests stop

---

## Quick Commands

```bash
# Run coverage report
npm run test:coverage

# View HTML report
open coverage/index.html

# Run single file coverage
npx vitest run --coverage path/to/file.test.ts
```
