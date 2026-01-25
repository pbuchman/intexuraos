# Category Audit Workflow

**Trigger:** `/coverage apps` or `/coverage packages`
**Scope:** All directories in the specified category

## Execution Steps

### Phase 1: Determine Category

| Input | Category | Directory |
|-------|----------|-----------|
| `/coverage apps` | apps | `apps/` |
| `/coverage packages` | packages | `packages/` |

### Phase 2: List Targets

```bash
# For apps
ls -d apps/*/ | xargs -n1 basename

# For packages
ls -d packages/*/ | xargs -n1 basename
```

### Phase 3: Run Coverage

```bash
pnpm run test:coverage --coverage.reporter=json-summary 2>&1 | tee /tmp/coverage-output.txt
```

### Phase 4: Filter Gaps

1. Read `coverage/coverage-summary.json`
2. Extract files where `branches.pct < 100`
3. Filter to ONLY files matching the category:
   - If `apps` → only `apps/**/*`
   - If `packages` → only `packages/**/*`

### Phase 5: Process Each Target

For each app/package in category with gaps, follow the same process as [full-audit.md](full-audit.md):

1. Load existing exemptions
2. Verify existing exemptions (Rule 1)
3. Check Linear for existing issues (Rule 2)
4. Investigate each new gap
5. Execute actions (exemptions + issues)

### Phase 6: Generate Report

Output summary scoped to the category.

## Example Run

```
/coverage packages

Processing packages...
  ✓ common-core: 0 gaps
  ✓ common-http: 0 gaps
  ✓ http-contracts: 0 gaps
  ✓ http-server: 1 exemption verified
  ✓ infra-claude: 2 new exemptions
  ✓ infra-perplexity: 2 exemptions, 1 stale removed
  ...

Summary (packages only):
  Total exemptions: 19
  New exemptions: 3
  Stale removed: 1
  Issues created: 5
  Issues skipped (duplicate): 1
```
