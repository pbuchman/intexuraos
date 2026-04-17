# INT-1405 — Plan evidence

**Linear:** https://linear.app/pbuchman/issue/INT-1405/fix-overlapping-filters-on-llm-usage-page-for-mobile

**Code Task:** task_c86d9184-7e75-457b-9cd6-8a42bc09003c

**Created:** 2026-04-17

## Summary

LLM Usage page mobile FilterBar (`apps/web/src/components/llm-usage/FilterBar.tsx`,
mobile variant `<div data-variant="mobile">` near line 88) is `sticky top-16 z-40`.
The `Sidebar.tsx` mobile drawer is `fixed top-16 left-0 z-40` and the mobile
overlay is `fixed inset-0 z-40`.

Identical z-index plus DOM order (`<Header/> → <Sidebar/> → <main>{<FilterBar/>}</main>`)
means the FilterBar wins the stacking contest and overlays the open sidebar drawer
on mobile, hiding the first menu item(s).

## Decision

Classified as **SIMPLE**: one mechanical class change in one file (`z-40` → `z-30`)
plus a regression test in the existing test file. No design decisions, no multi-step
sequence, no cross-service work.

## Implementation pointer

The full plan lives in the Linear issue description.
Implementer should:

1. Edit `apps/web/src/components/llm-usage/FilterBar.tsx` mobile variant: `z-40` → `z-30`.
2. Update the file header comment to record the z-index intent (sits below sidebar drawer).
3. Add a regression test in `apps/web/src/components/llm-usage/__tests__/FilterBar.test.tsx`
   asserting the mobile variant's class list contains `z-30` and not `z-40`.
4. Run `pnpm run ci:tracked` from repo root and confirm exit 0.
