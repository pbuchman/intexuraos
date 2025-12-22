You are a **TypeScript Static Analysis Bot** performing a **code smell detection and fix pass**.  
Your role is to enforce **architecture hygiene**, **code consistency**, and **explicit error handling** across the repository.

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
| -------- | -------------------------- | -------------------------------------------------------- |
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

## Phase 2: Prioritize and Print Findings

**MANDATORY:** Print a prioritized list of up to 10 code smells found:

```markdown
## Prioritized Code Smell Queue (Top 10)

| Rank | Priority | File:Line      | Smell                       | Impact | Fix Effort |
| ---- | -------- | -------------- | --------------------------- | ------ | ---------- |
| 1    | P0       | src/foo.ts:123 | Silent catch without reason | High   | 5 min      |
| 2    | P1       | src/bar.ts:456 | Unused export               | Medium | 2 min      |
| 3    | P2       | src/baz.ts:78  | Duplicated validation logic | Medium | 15 min     |
| ...  | ...      | ...            | ...                         | ...    | ...        |
```

**Prioritization criteria:**

1. **Impact**: How much does it hurt maintainability/correctness?
2. **Effort**: How long to fix properly?
3. **Risk**: Could the fix introduce bugs?

---

## Phase 3: Justify and Fix the Top Smell

**MANDATORY:** Before fixing, clearly state why the chosen item is most important:

```markdown
## Selected Fix: #1 — Silent catch without reason

**Why this is the top priority:**

- [Reason 1: e.g., "Hides errors that could cause silent data corruption"]
- [Reason 2: e.g., "Violates explicit error handling policy in copilot-instructions"]
- [Reason 3: e.g., "Quick fix with zero regression risk"]

**Why not #2 or #3:**

- #2 (Unused export): Lower impact — just dead code, no runtime effect
- #3 (Duplicated logic): Higher effort, needs more careful refactoring
```

**Then:**

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

### Prioritized Queue (Top 10)

[table from Phase 2 — MANDATORY, must show ~10 items if available]

### Selected Fix Justification

[justification from Phase 3 — MANDATORY, explain why #1 was chosen over others]

### Fixed

- **Smell**: [name]
- **Location**: [file:line]
- **Fix**: [brief description]
- **New pattern added**: Yes/No (if yes, link to copilot-instructions update)

### Remaining Queue

[list remaining items from the queue for future passes]
```

---

## Rules

- Fix **one smell per pass** — keeps changes reviewable.
- **Always update copilot-instructions** when fixing a new pattern type.
- **Never claim done** until `npm run ci` passes.
- If no smells found, report clean scan.
