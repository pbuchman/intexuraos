# Debt Categories

11 technical debt categories to scan for when generating `technical-debt.md`.

## Category Reference

### 1. TODO/FIXME Comments

**Detection:**
```bash
grep -rn "TODO:\|FIXME:\|HACK:\|XXX:" apps/<service-name>/src/
```

**Severity:** Based on keyword
- `FIXME:` → High
- `HACK:` → High
- `TODO:` → Medium
- `XXX:` → Medium

---

### 2. Console Logging

**Detection:**
```bash
grep -rn "console\.\(log\|warn\|error\|info\)" apps/<service-name>/src/ | grep -v "infra/"
```

**Severity:** Medium

**Exception:** Allowed in `infra/` layer if wrapped in logger interface.

---

### 3. Test Coverage

**Detection:**
```bash
pnpm run test:coverage --filter=<service-name>
```

**Severity:**
- <70% → High
- 70-90% → Medium
- 90-95% → Low

---

### 4. ESLint Violations

**Detection:**
```bash
pnpm run lint --filter=<service-name>
```

**Severity:**
- Error → High
- Warning → Medium

---

### 5. TypeScript Issues

**Detection:**
```bash
# any types
grep -rn ": any\|as any" apps/<service-name>/src/

# ts-ignore/ts-expect-error
grep -rn "@ts-ignore\|@ts-expect-error" apps/<service-name>/src/
```

**Severity:**
- `any` type → Medium
- `@ts-ignore` → High
- `@ts-expect-error` → Medium (acceptable if with comment)

---

### 6. Complex Functions

**Detection:** Manual review or complexity analysis tools

**Indicators:**
- Function >50 lines
- >5 nested levels
- >10 branches (cyclomatic complexity)

**Severity:** Medium (High if >15 complexity)

---

### 7. Deprecated APIs

**Detection:**
```bash
# Check package.json dependencies for known deprecated packages
# Check for @deprecated JSDoc tags in code
grep -rn "@deprecated" apps/<service-name>/src/
```

**Severity:**
- Security-related deprecation → High
- Feature deprecation → Medium
- Style deprecation → Low

---

### 8. Code Smells

From CLAUDE.md Code Smells table:

| Smell                      | Detection Pattern                           | Severity |
| -------------------------- | ------------------------------------------- | -------- |
| Silent catch               | `catch {}` or `catch { }` (empty body)      | High     |
| Inline error               | `error instanceof Error ? ...`              | Medium   |
| Throw in try               | `try { if (x) throw` same block             | Medium   |
| Re-export from services.ts | `export * from './infra`                    | Medium   |
| Module-level state         | `let` at module scope                       | High     |
| Test fallback in prod      | `container ?? {`                            | High     |
| Domain in infra            | Domain functions in `infra/` directory      | Medium   |
| Infra re-exports domain    | `export type from domain` in infra          | Low      |
| Manual header redaction    | `[REDACTED]` inline                         | Low      |
| Redundant variable         | `const r = f(); return r`                   | Low      |
| Redundant check            | Check after type guard                      | Low      |
| Console logging            | `console.info()` in non-infra               | Medium   |

---

### 9. SRP Violations

**Detection:**
```bash
# Find large files
find apps/<service-name>/src -name "*.ts" -exec wc -l {} \; | sort -rn | head -20
```

**Threshold:** >300 lines without good reason

**Severity:**
- >500 lines → High
- 300-500 lines → Medium

---

### 10. Code Duplicates

**Detection:** Manual review for patterns like:

- Error handling repeated across files
- Pagination logic duplicated
- Similar repository patterns

**Severity:** Medium (High if >5 occurrences)

---

### 11. Previous Runs

**Detection:**
```bash
grep -A 20 "## .* — <service-name>" docs/documentation-runs.md
```

**Purpose:** Check if previously identified issues are still present or resolved.

**Handling:**
- If issue still exists → Keep in active section
- If issue resolved → Move to "Resolved Issues" section

---

## Severity Summary

| Severity | Criteria                                    | Action                    |
| -------- | ------------------------------------------- | ------------------------- |
| High     | Security, data loss, production breaking    | Fix immediately           |
| Medium   | Performance, maintainability, coverage gaps | Fix in current sprint     |
| Low      | Style, minor optimization, documentation    | Fix when touching file    |
