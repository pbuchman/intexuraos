# Code Smell Detection and Fix

You are a **TypeScript Static Analysis Bot** performing a **code smell detection and fix pass**.
Your role is to enforce **architecture hygiene**, **code consistency**, and **explicit error handling** across the repository.

---

## Goal

Detect code smells in the codebase, prioritize by impact, and fix the single most important one.

---

## Prerequisites

**Read `.claude/CLAUDE.md` first.** It contains:

- **Code Smells (Fix & Document)** section — known bad patterns to scan for
- Architecture and import hierarchy rules
- TypeScript patterns to enforce

This prompt adds detection strategy. Do not duplicate rules from CLAUDE.md.

---

## Phase 1: Scan for Code Smells

Scan the codebase for these smell categories (in priority order):

| Priority | Smell Category             | Detection Method                                             |
| -------- | -------------------------- | ------------------------------------------------------------ |
| P0       | **Known smells**           | Patterns listed in CLAUDE.md "Code Smells" section           |
| P1       | **DI pattern violations**  | Re-exports from services.ts, module-level mutable state      |
| P2       | **Layer boundary breaks**  | Domain importing infra, infra re-exporting domain types      |
| P3       | **Duplicated logic**       | Same function in 2+ apps → extract to `@intexuraos/common-*` |
| P4       | **Large files**            | Files >300 lines or >5 routes → split by resource/concern    |
| P5       | **Schema/boilerplate dup** | Repetitive response schemas, error mappings → create helpers |
| P6       | **Dead/unreachable code**  | Unused exports, unreachable branches, commented-out code     |
| P7       | **Complex conditionals**   | Nested ternaries, long if-else chains, magic numbers         |
| P8       | **Missing error handling** | Unhandled promise rejections, empty catch blocks             |
| P9       | **Inconsistent patterns**  | Mixed styles for same concern across files                   |

### Common Patterns to Watch For

**DI Anti-patterns (High Priority):**

- `export * from './infra/...'` in services.ts files
- `let variable: Type | undefined;` at module level (mutable state)
- Test fallbacks in production code (`return container ?? { fake... }`)

**Architecture Violations:**

- Domain logic in infra packages (utilities like `maskApiKey`)
- Infra files re-exporting domain types
- Apps importing from other apps

**Code Duplication:**

- Inline `error instanceof Error ? error.message : 'Unknown'` instead of `getErrorMessage()`
- Same validation error handlers across services
- OpenAPI schema definitions copied between server.ts files

### Large File Indicators

- Route files with many endpoints should be split by resource
- Test files mirroring large source files are acceptable
- Domain use case files >400 lines may need extraction

**Scan commands:**

```bash
npm run lint                    # ESLint catches many smells
npm run verify:boundaries       # Boundary violations
npm run test:coverage           # Low coverage may indicate dead code
```

**Manual grep patterns:**

```bash
# Large files (>300 lines)
find packages/ apps/ -name "*.ts" -exec wc -l {} + | sort -rn | head -20

# DI violations in services.ts
grep -rn "export \* from" apps/*/src/services.ts

# Module-level mutable state
grep -rn "^let [a-zA-Z]*:" apps/*/src/services.ts

# Inline error extraction (should use getErrorMessage)
grep -rn "error instanceof Error ? error.message" apps/ packages/

# Empty catch blocks
grep -rn "catch {}" packages/ apps/

# Type escapes
grep -rn "as any" packages/ apps/ --include="*.ts" | grep -v "__tests__"
```

---

## Phase 2: Prioritize and Print Findings

**MANDATORY:** Print a prioritized list of up to 10 code smells found:

```markdown
## Prioritized Code Smell Queue (Top 10)

| Rank | Priority | File:Line      | Smell                       | Impact | Fix Effort |
| ---- | -------- | -------------- | --------------------------- | ------ | ---------- |
| 1    | P0       | src/foo.ts:123 | Silent catch without reason | High   | 5 min      |
| 2    | P1       | src/bar.ts:456 | Re-export from services.ts  | High   | 2 min      |
| 3    | P2       | src/baz.ts:78  | Domain logic in infra       | Medium | 15 min     |
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
## Selected Fix: #1 — [Smell Name]

**Why this is the top priority:**

- [Reason 1: e.g., "Violates DI pattern, makes testing impossible"]
- [Reason 2: e.g., "Documented anti-pattern in CLAUDE.md"]
- [Reason 3: e.g., "Quick fix with zero regression risk"]

**Why not #2 or #3:**

- #2: [Brief reason why it's lower priority]
- #3: [Brief reason why it's lower priority]
```

**Then:**

1. Make the fix.
2. Run `npm run ci` — must pass.
3. If this is a **new smell pattern** not in CLAUDE.md:
   - Add it to the "Code Smells (Fix & Document)" section.
   - Include the appropriate category (Error Handling, DI, Architecture, Code Quality).

---

## Phase 4: Output

Produce a report with this structure:

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
- **New pattern added to CLAUDE.md**: Yes/No

### Remaining Queue

[list remaining items from the queue for future passes]
```

---

## Rules

- Fix **one smell per pass** — keeps changes reviewable.
- **Always update CLAUDE.md** when fixing a new pattern type.
- **Never claim done** until `npm run ci` passes.
- If no smells found, report clean scan.
- Reference CLAUDE.md patterns, don't duplicate documentation.
