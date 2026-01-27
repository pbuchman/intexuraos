# Coverage Analysis Skill

Analyze branch coverage gaps and convert them into Linear issues or documented exemptions.

**Team:** `IntexuraOS`
**Project Key:** `INT-`

## Usage

```
/coverage                    # Full audit: all apps + packages + workers
/coverage apps               # Category audit: all apps
/coverage packages           # Category audit: all packages
/coverage workers            # Category audit: all workers
/coverage <name>             # Targeted audit: specific app, package, or worker
```

## Scope Boundary — Analysis Only

**CRITICAL: This skill is ANALYSIS ONLY. It does NOT fix coverage.**

| DOES | DOES NOT |
|------|----------|
| Run coverage commands | Write test code |
| Parse coverage reports | Modify source files |
| Verify existing exemptions | Create branches for fixes |
| Update/delete stale exemptions | Commit code changes |
| Add new exemptions for unreachable code | Create PRs |
| Create Linear issues for testable gaps | Work on created issues |
| Generate summary reports | |

**Workflow separation:**
1. **Analysis phase:** `/coverage` → identifies gaps, creates issues + exemptions
2. **Implementation phase:** `/linear INT-XXX` → work on individual coverage issues

## Invocation Detection

| Input Pattern      | Workflow                                          | Scope                           |
| ------------------ | ------------------------------------------------- | ------------------------------- |
| `/coverage`        | [full-audit.md](workflows/full-audit.md)          | All apps + packages + workers   |
| `/coverage apps`   | [category-audit.md](workflows/category-audit.md)  | All directories in `apps/`      |
| `/coverage packages` | [category-audit.md](workflows/category-audit.md) | All directories in `packages/` |
| `/coverage workers` | [category-audit.md](workflows/category-audit.md) | All directories in `workers/`  |
| `/coverage <name>` | [targeted-audit.md](workflows/targeted-audit.md)  | Single app, package, or worker  |

**Auto-detection logic:**
1. No args → full audit (apps + packages + workers)
2. Arg is `apps`, `packages`, or `workers` → category audit
3. Arg matches directory in `apps/`, `packages/`, or `workers/` → targeted audit
4. Arg doesn't match → error with suggestions

## Mandatory Rules

### Rule 1: Unreachable File Verification

**BEFORE adding any new exemptions**, verify existing entries:

1. Read existing `unreachable/<name>.md` for the target
2. For EACH existing entry:
   - Search for **CODE SNIPPET** in current source (NOT line number)
   - If snippet FOUND at different line → update line reference
   - If snippet NOT FOUND (deleted/refactored) → DELETE the section
   - If source file deleted → DELETE all sections for that file
3. Only AFTER verification → add new exemptions

### Rule 2: Linear Issue Deduplication

**BEFORE creating any Linear issue:**

1. Query Linear for issues matching:
   - Title contains `[coverage]`
   - State NOT in: Done, Cancelled
   - (includes: Backlog, Todo, In Progress, In Review, QA)
2. For each found parent issue → fetch child issues (subtasks)
3. Check if any existing issue/subtask covers the SAME FILE
4. If match found → SKIP creation, log: "Already tracked by INT-XXX"
5. Only create issue if NO existing coverage exists

**Matching logic:** Parse issue titles for `[coverage][<name>] <filename>` pattern.

### Rule 3: Proof by Construction (CRITICAL)

**A branch is only unreachable if you can explain the SPECIFIC MECHANISM that prevents test access.**

Before marking ANY branch as unreachable:

1. Identify one of the 7 valid blocker categories (see [verification-methodology.md](reference/verification-methodology.md))
2. Document the PROOF — the specific mechanism, not just the conclusion
3. Ask: "Would another engineer agree this is structurally unreachable?"

**Valid blocker categories:**
| Category | Example |
|----------|---------|
| TypeScript Type System | `noUncheckedIndexedAccess` after length check |
| Regex Match Guarantees | Capture group guaranteed by `.+` pattern |
| Module-Level Initialization | Code runs at import before tests |
| Async Callback Timing | Timeout cancelled before it fires |
| Test Infrastructure Constraints | Fake has no method to produce state |
| Upstream Guards | Prior check makes downstream redundant |
| ES Module Mocking Limitations | SDK internals not mockable |

**INVALID excuses:**
- "Hard to set up" — difficulty ≠ impossibility
- "Would need complex mocking" — complex ≠ impossible
- "Edge case" / "Unlikely" — write the test

### Rule 4: No Fixes

This skill MUST NOT:
- Write tests
- Modify source code
- Create fix branches
- Make commits

The skill's job ends when all gaps are either exempted or have Linear issues.

## Output Locations

| Type | Location |
|------|----------|
| Exemptions | `.claude/skills/coverage/unreachable/<name>.md` |
| Linear issues | Title: `[coverage][<name>] <filename> <description>` |

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
- Exemptions: [`unreachable/`](unreachable/)
