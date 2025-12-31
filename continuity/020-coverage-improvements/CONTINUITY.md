# Coverage Improvements - Session 020

## Goal

Improve test coverage to 100% across all packages and apps.

## Current State

- Overall: 97.73% statements, 95.86% branches, 97.49% functions, 97.78% lines
- Thresholds: 95% all categories (passing)

## Subtask Registry

| File | Status | Description |
|------|--------|-------------|
| `1-0-tier1-quick-fixes.md` | Pending | Single line/branch fixes (6 items) |
| `1-1-tier2-small-gaps.md` | Pending | 2-5 line gaps (10 items) |
| `1-2-tier3-infra-clients.md` | Pending | New test files for research-agent (3 items) |
| `1-3-tier4-larger-gaps.md` | Pending | Complex branch coverage (1 item) |
| `2-0-type-only-files.md` | Blocked | Type-only files - no runtime code |

## Done

(None yet)

## Now

Awaiting approval to start work.

## Next

Start with Tier 1 quick fixes.

## Key Decisions

- `types.ts` files in llm-audit and llm-contract have 0% coverage because they contain only type definitions with no runtime code - this is expected and cannot be "fixed"
- Focus on meaningful coverage gaps, not type-only files

## Open Questions

None.
