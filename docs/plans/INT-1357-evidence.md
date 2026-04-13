# INT-1357 Evidence Document

## Task Summary

Add `[orchestrator]` and `[entrypoint]` log tags to the collapsible patterns in the CodeTaskLogViewer component.

## Complexity Judgment

**Decision: SIMPLE**

- Single file modification: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`
- Two mechanical additions:
  1. Add `entrypoint` to `TAG_STYLES` (it's missing)
  2. Add `orchestrator` and `entrypoint` to the collapsible tags condition
- No design decisions needed - pattern is obvious from existing implementation

## Analysis

### Current Implementation

The log collapsing mechanism in `CodeTaskLogViewer.tsx`:

1. **TAG_STYLES** (lines 31-48): Maps tag names to styling. `orchestrator` exists, `entrypoint` is missing.

2. **Collapsible blocks** (lines 156-157): Only `tool` and `cmd` tags create collapsible blocks:
   ```typescript
   if (tag === 'tool' || tag === 'cmd') {
     // Creates a block...
   }
   ```

3. **Body lines** (lines 62-65): Indented lines (starting with `→`, `✗`, or spaces) become block content.

### Required Changes

1. Add `entrypoint` to `TAG_STYLES` with appropriate styling (similar to `orchestrator`)
2. Extend the collapsible tags condition to include `orchestrator` and `entrypoint`

## Date

2026-04-13

## Task Reference

- Linear: [INT-1357](https://linear.app/pbuchman/issue/INT-1357)
- Code Task: [View task](https://intexuraos.cloud/#/code-tasks/task_47b8523c-c8b2-4fab-a2cd-a23ae75a3c01)