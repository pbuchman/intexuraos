# Full Audit Workflow

**Trigger:** `/coverage` (no arguments)
**Scope:** All apps + all packages

## Execution Steps

### Phase 1: Run Coverage

```bash
pnpm run test:coverage --coverage.reporter=json-summary 2>&1 | tee /tmp/coverage-output.txt
```

Capture output for analysis. Do NOT re-run just to grep different patterns.

### Phase 2: Parse Gaps

1. Read `coverage/coverage-summary.json`
2. Extract ALL files where `branches.pct < 100`
3. Group by app/package:
   - Files under `apps/<name>/` → app gaps
   - Files under `packages/<name>/` → package gaps

### Phase 3: Process Each Target

For each app and package with gaps:

1. **Verify existing inline comments** (Rule 1):
   - Run `pnpm run verify:v8-ignore` to validate existing comments
   - For each inline comment in the target:
     - Verify the code pattern still matches the category
     - Update or remove comment if code was refactored
     - Remove comment if no longer valid

2. **Check Linear for existing issues** (Rule 2):
   ```
   Query: [coverage] state IN (Backlog, Todo, In Progress, In Review, QA)
   ```
   - Build map of file → issue ID
   - Include parent issues AND their subtasks (if parent is in active status)
   - **IMPORTANT:** Only issues in ACTIVE statuses count toward coverage accounting.
     Issues in Done, Canceled, or Duplicate do NOT count — they represent completed
     or abandoned work, not tracked gaps.

3. **Investigate each new gap:**
   - Read source code at uncovered lines
   - Determine: TESTABLE or UNREACHABLE

4. **Execute actions:**
   - If UNREACHABLE → add inline `/* v8 ignore <CATEGORY> -- reason */` comment
   - If TESTABLE and no existing issue → create Linear issue

### Phase 4: Generate Report

Output summary using [summary-report.md](../templates/summary-report.md) template.

## Ordering

Process in this order:
1. `packages/` (alphabetical) — leaf dependencies first
2. `apps/` (alphabetical)

## Example Run

```
/coverage

Processing packages...
  ✓ common-core: 0 gaps
  ✓ common-http: 0 gaps
  ✓ infra-perplexity: 2 exemptions updated
  ...

Processing apps...
  ✓ actions-agent: 3 new inline exemptions, 2 issues created
  ✓ research-agent: 5 exemptions verified, 1 stale removed
  ...

Summary:
  Total exemptions: 45
  New inline comments: 8
  Stale removed: 3
  Issues created: 12
  Issues skipped (duplicate): 4
```
