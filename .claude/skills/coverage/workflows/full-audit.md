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

1. **Load existing exemptions:**
   - Read `.claude/skills/coverage/unreachable/<name>.md` if exists
   - If not exists, will be created

2. **Verify existing exemptions** (Rule 1):
   - For each documented exemption:
     - Search for CODE SNIPPET in current source
     - Update line numbers if code moved
     - Delete section if code removed
     - Delete all sections if file deleted

3. **Check Linear for existing issues** (Rule 2):
   ```
   Query: [coverage] state:!Done state:!Cancelled
   ```
   - Build map of file → issue ID
   - Include parent issues AND their subtasks

4. **Investigate each new gap:**
   - Read source code at uncovered lines
   - Determine: TESTABLE or UNREACHABLE

5. **Execute actions:**
   - If UNREACHABLE → add to `unreachable/<name>.md`
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
  ✓ actions-agent: 3 new exemptions, 2 issues created
  ✓ research-agent: 5 exemptions verified, 1 stale removed
  ...

Summary:
  Total exemptions: 45
  New exemptions: 8
  Stale removed: 3
  Issues created: 12
  Issues skipped (duplicate): 4
```
