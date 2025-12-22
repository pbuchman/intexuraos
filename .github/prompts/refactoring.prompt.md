You are performing a **code smell detection and fix pass**.

---

## Goal

Detect code smells in the codebase, prioritize by impact, and fix the single most important one.

---

## Prerequisites

**Read `.github/copilot-instructions.md` first.** It contains:

- **Code Smells (Fix & Document)** section — known bad patterns to scan for
- Architecture and import hierarchy rules
- TypeScript patterns to enforce

This prompt adds detection strategy. Do not duplicate rules from copilot-instructions.

---

## Phase 1: Scan for Code Smells

Scan the codebase for these smell categories (in priority order):

| Priority | Smell Category             | Detection Method                                         |
|----------|----------------------------|----------------------------------------------------------|
| P0       | **Known smells**           | Patterns listed in copilot-instructions "Code Smells"    |
| P1       | **Dead/unreachable code**  | Unused exports, unreachable branches, commented-out code |
| P2       | **Duplicated logic**       | Same logic in 2+ places (copy-paste)                     |
| P3       | **Boundary violations**    | Domain importing infra, common importing domain          |
| P4       | **Complex conditionals**   | Nested ternaries, long if-else chains, magic numbers     |
| P5       | **Missing error handling** | Unhandled promise rejections, empty catch blocks         |
| P6       | **Inconsistent patterns**  | Mixed styles for same concern across files               |

**Scan commands:**

```bash
npm run lint                    # ESLint catches many smells
npm run verify:boundaries       # Boundary violations
npm run test:coverage           # Low coverage may indicate dead code
```

**Manual grep patterns:**

```bash
grep -rn "catch {}" packages/ apps/           # Empty catch
grep -rn "@ts-ignore" packages/ apps/         # Suppressed errors
grep -rn "// TODO" packages/ apps/            # Deferred work
grep -rn "as any" packages/ apps/             # Type escapes
```

---

## Phase 2: Prioritize Findings

Create a prioritized list:

```markdown
## Code Smell Findings

| #   | Priority | File:Line | Smell                       | Impact | Fix Effort |
| --- | -------- | --------- | --------------------------- | ------ | ---------- |
| 1   | P0       | path:123  | Silent catch without reason | High   | 5 min      |
| 2   | P1       | path:456  | Unused export               | Medium | 2 min      |

...
```

**Prioritization criteria:**

1. **Impact**: How much does it hurt maintainability/correctness?
2. **Effort**: How long to fix properly?
3. **Risk**: Could the fix introduce bugs?

Pick **one smell** to fix — the highest-impact item that can be fixed safely.

---

## Phase 3: Fix the Top Smell

1. Make the fix.
2. Run `npm run ci` — must pass.
3. If this is a **new smell pattern** not in copilot-instructions:
  - Add it to the "Code Smells (Fix & Document)" section.
  - Include ❌ bad example and ✅ good example.

---

## Phase 4: Output

Use `show_content` tool with this structure:

```markdown
## Code Smell Report

### Scan Summary

- Files scanned: X
- Smells found: Y
- Top priority: [description]

### Prioritized Findings

[table from Phase 2]

### Fixed

- **Smell**: [name]
- **Location**: [file:line]
- **Fix**: [brief description]
- **New pattern added**: Yes/No (if yes, link to copilot-instructions update)

### Remaining (for future passes)

[list top 3 unfixed items]
```

---

## Rules

- Fix **one smell per pass** — keeps changes reviewable.
- **Always update copilot-instructions** when fixing a new pattern type.
- **Never claim done** until `npm run ci` passes.
- If no smells found, report clean scan.
