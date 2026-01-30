# Targeted Audit Workflow

**Trigger:** `/coverage <name>` (e.g., `/coverage actions-agent`, `/coverage infra-claude`)
**Scope:** Single app or package

## Execution Steps

### Phase 1: Validate Target

1. Check if `<name>` exists in `apps/<name>/` or `packages/<name>/`
2. If found in both → error (should not happen, names are unique)
3. If found in neither → error with suggestions:
   ```
   ERROR: '<name>' not found in apps/ or packages/

   Did you mean one of these?
     apps: actions-agent, research-agent, ...
     packages: common-core, infra-claude, ...
   ```

### Phase 2: Run Coverage (Targeted)

```bash
# Run coverage for specific workspace
pnpm run test:coverage --coverage.reporter=json-summary 2>&1 | tee /tmp/coverage-output.txt
```

Note: Coverage runs for entire monorepo, but we filter to target.

### Phase 3: Filter Gaps

1. Read `coverage/coverage-summary.json`
2. Extract files where `branches.pct < 100`
3. Filter to ONLY files under the target:
   - If app → `apps/<name>/**/*`
   - If package → `packages/<name>/**/*`

### Phase 4: Verify Existing Inline Comments (Rule 1)

Run `pnpm run verify:v8-ignore` to validate all existing comments.

For EACH inline comment in the target:

1. **Find source file:**
   ```bash
   # e.g., src/infra/http/client.ts → apps/<name>/src/infra/http/client.ts
   ```

2. **Verify code pattern:**
   - Check if the code pattern still matches the category
   - Use the category detectors to validate

3. **Determine action:**
   | Scenario | Action |
   |----------|--------|
   | Pattern still valid | Keep as-is |
   | Code moved/changed | Update comment |
   | Pattern no longer applies | Remove comment |
   | Source file deleted | Remove all comments for file |

### Phase 6: Check Linear Deduplication (Rule 2)

1. Query Linear:
   ```
   title contains "[coverage][<name>]"
   state IN (Backlog, Todo, In Progress, In Review, QA)
   ```

   **IMPORTANT:** Only issues in ACTIVE statuses count toward coverage accounting.
   Issues in Done, Canceled, or Duplicate do NOT count — they represent completed
   or abandoned work, not tracked gaps. If a Done issue's branch is still uncovered,
   a NEW issue must be created.

2. Build map: `filename → issue ID`

3. Include subtasks of parent issues (if parent is in active status)

### Phase 7: Investigate New Gaps

For each file with `branches.pct < 100` not yet exempted:

1. **Read source code** at uncovered lines
2. **Analyze branch type:**
   - TypeScript narrowing (`noUncheckedIndexedAccess`)
   - Defensive coding (impossible states)
   - Auth guards (tests always authenticated)
   - Error fallbacks (`?? 'default'`)
   - Module initialization
   - External SDK limitations

3. **Determine fate:**
   | Analysis | Action |
   |----------|--------|
   | Truly unreachable | Add inline `/* v8 ignore <CATEGORY> -- reason */` comment |
   | Testable with setup | Create Linear issue (if not duplicate) |

### Phase 8: Execute Actions

1. **Update inline comments:**
   - Remove stale comments
   - Update moved/changed comments
   - Add new inline comments: `/* v8 ignore <CATEGORY> -- reason */`
   - Run `pnpm run verify:v8-ignore` to confirm all valid

2. **Create Linear issues:**
   - Use [linear-issue.md](../templates/linear-issue.md) template
   - Naming: `[coverage][<name>] <filename> <description>`
   - Skip if duplicate found

### Phase 9: Generate Report

```
/coverage actions-agent

Target: apps/actions-agent

Exemptions:
  Verified: 8
  Updated (line moved): 2
  Removed (stale): 1
  Added: 3
  Total: 12

Linear Issues:
  Created: 4
  Skipped (duplicate): 2

Files Analyzed:
  src/infra/http/client.ts: 2 exemptions
  src/routes/actionRoutes.ts: 3 exemptions, 2 issues
  src/domain/usecases/executeAction.ts: 2 issues
```
