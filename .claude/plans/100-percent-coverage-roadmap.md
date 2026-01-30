# Roadmap: 100% Branch Coverage with Binary Enforcement

**Goal:** Achieve and maintain 100% branch coverage through organized exemptions, systematic test writing, and CI enforcement.

---

## Phase 1: Organize Exemptions (Current)

**Plan:** `~/.claude/plans/drifting-enchanting-scone.md`

**What it does:**

- Replace `unreachable/*.md` files with inline `/* v8 ignore <CATEGORY> */` comments
- Standardize 22+ categories → 10 canonical categories
- Add `verify-v8-ignore` script to CI (Static Validation phase)
- Validate: syntax, pattern matching, obsolete comment detection
- Report uncovered branches without exemptions (informational, no CI fail)

**Outcome:**

- All exemptions are inline, validated, and categorized
- Phase E report lists all uncovered branches without exemptions
- Foundation is set for Phase 2

**CI behavior:** Fails on invalid exemptions, reports missing exemptions

---

## Phase 2: Write Tests for Reported Branches

**Prerequisite:** Phase 1 complete

**Process:**

```
1. Run `pnpm run verify:v8-ignore`
2. Look at "📋 N uncovered branches without exemption" output
3. For each reported branch:
   a. Can it be tested? → Write test
   b. Cannot be tested? → Add /* v8 ignore <CATEGORY> -- reason */
4. Run verification again
5. Repeat until report shows 0 missing
```

**Tracking:**

- Create Linear issue for batch of uncovered branches
- Use `/coverage <service>` skill to systematically address each service
- Track progress: `pnpm run verify:v8-ignore | grep "uncovered branches"`

**Outcome:**

- Every branch is either covered by tests OR has valid exemption
- Phase E report shows 0 missing

**CI behavior:** Same as Phase 1 (report-only for missing)

---

## Phase 3: Enforce 100% Coverage

**Prerequisite:** Phase 2 complete (0 uncovered branches without exemption)

**Changes to make:**

1. **Edit `scripts/verify-v8-ignore.mjs`:**

   ```javascript
   // Change Phase E from report-only to fail
   // Before:
   process.exit(allErrors.length > 0 ? 1 : 0);

   // After:
   const hasErrors = allErrors.length > 0;
   const hasMissing = missingReport.length > 0;
   process.exit(hasErrors || hasMissing ? 1 : 0);
   ```

2. **Update error message:**
   ```javascript
   if (missingReport.length > 0) {
     console.log(`\n❌ ${missingReport.length} uncovered branches without exemption:\n`);
     missingReport.forEach((m) => console.log(`  ${m.file}:${m.line}`));
     console.log(`\nAdd /* v8 ignore <CATEGORY> -- reason */ or write tests.`);
   }
   ```

**Outcome:**

- CI fails if ANY branch is uncovered without exemption
- No new uncovered code can be merged
- 100% coverage is locked in

**CI behavior:** Fails on invalid exemptions AND missing exemptions

---

## Summary

| Phase | Focus               | CI Behavior                  | Outcome            |
| ----- | ------------------- | ---------------------------- | ------------------ |
| 1     | Organize exemptions | Fail invalid, report missing | Clean foundation   |
| 2     | Write tests         | Same as Phase 1              | 0 missing branches |
| 3     | Enforce             | Fail invalid AND missing     | 100% locked in     |

---

## Metrics to Track

```bash
# Count of valid exemptions (should decrease over time as tests are written)
pnpm run verify:v8-ignore 2>&1 | grep "v8 ignore comments validated"

# Count of uncovered branches without exemption (target: 0)
pnpm run verify:v8-ignore 2>&1 | grep "uncovered branches without exemption"

# Overall branch coverage
pnpm run test:coverage 2>&1 | grep "Branches"
```

---

## Timeline

| Phase   | Estimated Effort                      |
| ------- | ------------------------------------- |
| Phase 1 | 1-2 days (implementation + migration) |
| Phase 2 | Ongoing (as capacity allows)          |
| Phase 3 | 1 hour (flip the switch when ready)   |
