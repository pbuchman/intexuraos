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

## Coverage Target: 100% (NOT 95%)

**CRITICAL: This skill does NOT target 95% coverage. The target is 100%.**

100% branch coverage means every uncovered branch is accounted for:

| Category        | What It Means                                                |
| --------------- | ------------------------------------------------------------ |
| **Covered**     | Tests exercise the branch                                    |
| **Exempted**    | Inline `/* v8 ignore <CATEGORY> -- reason */` comment present |
| **Tracked**     | Linear issue exists in ACTIVE status                         |

**Active Linear statuses that count toward 100%:**
- Backlog
- Todo
- In Progress
- In Review
- QA

**Statuses that do NOT count:**
- Done (already completed)
- Canceled
- Duplicate

**Why 100%?** The 95% CI threshold is a minimum safety net, not the goal. Untracked gaps indicate:
- Tests that should exist but don't
- Unreachable code that should be exempted
- Work that should be in the backlog

**An app is "covered" when:** Every branch with `pct < 100` either:
1. Has an inline v8 ignore comment with valid category, OR
2. Has an active Linear issue tracking it

---

## Scope Boundary — Analysis Only

**CRITICAL: This skill is ANALYSIS ONLY. It does NOT fix coverage.**

| DOES | DOES NOT |
|------|----------|
| Run coverage commands | Write test code |
| Parse coverage reports | Modify source files |
| Verify existing inline comments | Create branches for fixes |
| Update/delete stale inline comments | Commit code changes |
| Add new inline comments for unreachable code | Create PRs |
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

### Rule 1: Inline Comment Verification

**BEFORE adding any new exemptions**, verify existing entries:

1. Run `pnpm run verify:v8-ignore` to validate all existing comments
2. For EACH existing inline comment:
   - Verify the code pattern still matches the category
   - If code was refactored → update or remove comment
   - If comment no longer valid → remove it
3. Only AFTER verification → add new exemptions

**Comment format:** `/* v8 ignore <CATEGORY> -- <explanation> */`

**Valid categories:** `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

**Reference:** [canonical-categories.md](reference/canonical-categories.md)

### Rule 2: Linear Issue Deduplication

**BEFORE creating any Linear issue:**

1. Query Linear for issues matching:
   - Title contains `[coverage]`
   - State IN: Backlog, Todo, In Progress, In Review, QA
   - (NOT Done, NOT Canceled, NOT Duplicate)
2. For each found parent issue → fetch child issues (subtasks)
3. Check if any existing issue/subtask covers the SAME FILE
4. If match found → SKIP creation, log: "Already tracked by INT-XXX"
5. Only create issue if NO existing coverage exists

**Matching logic:** Parse issue titles for `[coverage][<name>] <filename>` pattern.

**Why status matters:** Done issues represent completed work. If a coverage issue
was marked Done but the branch is still uncovered, a NEW issue must be created.
The same applies to Canceled and Duplicate issues — they do not count toward
the 100% accounting.

### Rule 3: Proof by Construction (CRITICAL)

**A branch is only unreachable if you can explain the SPECIFIC MECHANISM that prevents test access.**

Before marking ANY branch as unreachable:

1. Identify one of the 10 valid categories (see [canonical-categories.md](reference/canonical-categories.md))
2. Document the PROOF — the specific mechanism, not just the conclusion
3. Ask: "Would another engineer agree this is structurally unreachable?"

**Valid categories:**
| Category | Example |
|----------|---------|
| `ts-type` | `noUncheckedIndexedAccess` after length check |
| `regex` | Capture group guaranteed by `.+` pattern |
| `module-init` | Code runs at import before tests |
| `async-timing` | Timeout cancelled before it fires |
| `test-infra` | Fake has no method to produce state |
| `upstream` | Prior check makes downstream redundant |
| `module-mock` | SDK property getters not mockable |
| `schema` | Zod validation guarantees field exists |
| `source-map` | Tests cover but v8 doesn't detect |
| `auth-guard` | Auth failure tested at middleware level |

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
| Exemptions | Inline comment: `/* v8 ignore <CATEGORY> -- reason */` |
| Linear issues | Title: `[coverage][<name>] <filename> <description>` |

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
- Canonical categories: [`reference/canonical-categories.md`](reference/canonical-categories.md)
