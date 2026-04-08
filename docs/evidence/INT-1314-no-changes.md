# INT-1314: Fix code tasks filter showing wrong 'DONE' count

## No Changes Needed

The work for this issue was fully implemented and merged via PR #1713 (`plan/fix-done-count-phantom` branch) before this implementation task started.

### What was implemented (in PR #1713)

- Secondary `listGroupSummaries` query for statuses with non-zero precomputed counts that are absent from the current filter
- Task fetching and filtering for phantom-check summaries to identify true phantoms
- Phantom count subtraction from precomputed `user_group_counts`
- 5 new tests covering: phantom done count outside filter, multiple non-filtered statuses, real group preservation, error handling for linear issue fetch, error handling for standalone task fetch

### Evidence

- PR #1713 merged into development: https://github.com/pbuchman/intexuraos/pull/1713
- All 9 phantom tests pass
- Full CI (`pnpm run ci:tracked`) passes with 14733 tests

### Timestamp

2026-04-08T06:00:00Z
