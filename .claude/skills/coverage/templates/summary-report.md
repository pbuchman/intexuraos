# Summary Report Template

## Output Format

After completing analysis, output this summary:

```markdown
## Coverage Analysis Complete

### Scope

| Field | Value |
|-------|-------|
| Command | `/coverage [args]` |
| Targets | <list of apps/packages analyzed> |
| Date | <YYYY-MM-DD HH:MM> |

---

### Exemptions Summary

| Target | Verified | Updated | Removed | Added | Total |
|--------|----------|---------|---------|-------|-------|
| actions-agent | 8 | 2 | 1 | 3 | 12 |
| research-agent | 15 | 0 | 2 | 0 | 13 |
| infra-perplexity | 2 | 0 | 0 | 1 | 3 |
| ... | | | | | |
| **TOTAL** | **25** | **2** | **3** | **4** | **28** |

**Legend:**
- Verified: Existing exemptions confirmed still valid
- Updated: Line numbers updated (code moved)
- Removed: Stale exemptions deleted
- Added: New exemptions created

---

### Linear Issues Summary

| Target | Created | Skipped (dup) | Total Gaps |
|--------|---------|---------------|------------|
| actions-agent | 4 | 2 | 6 |
| research-agent | 0 | 3 | 3 |
| infra-claude | 2 | 0 | 2 |
| ... | | | |
| **TOTAL** | **6** | **5** | **11** |

**Skipped issues (already tracked):**
- `[coverage][actions-agent] client.ts` → INT-234
- `[coverage][research-agent] researchRoutes.ts` → INT-245
- ...

---

### Created Issues

| Issue | Target | File | Description |
|-------|--------|------|-------------|
| INT-301 | actions-agent | executeAction.ts | Error handling branches |
| INT-302 | actions-agent | actionRoutes.ts | Optional query params |
| INT-303 | infra-claude | client.ts | Retry logic |
| ... | | | |

---

### Stale Exemptions Removed

| Target | File | Code Snippet | Reason |
|--------|------|--------------|--------|
| research-agent | src/old.ts | `if (!x)` | File deleted |
| actions-agent | src/utils.ts | `?? []` | Now covered by tests |
| ... | | | |

---

### Verification Checklist

- [ ] Every file with `branches.pct < 100` has ALL gaps accounted for
- [ ] All exemptions verified by code snippet (not line number)
- [ ] Stale exemptions removed
- [ ] No duplicate Linear issues created
- [ ] Exhaustive analysis completed (no "quick wins" approach)
```

## Minimal Output (No Changes)

If no changes needed:

```markdown
## Coverage Analysis Complete

### Scope

Command: `/coverage actions-agent`
Target: apps/actions-agent
Date: 2026-01-25 14:30

### Result

No changes required.

- Exemptions: 12 verified, 0 updates
- Linear issues: 0 new gaps found
- All coverage gaps are already tracked
```

## Error Output

If errors occurred:

```markdown
## Coverage Analysis Failed

### Error

<error-message>

### Partial Results

<any completed work before failure>

### Recovery

<steps to retry or fix>
```
