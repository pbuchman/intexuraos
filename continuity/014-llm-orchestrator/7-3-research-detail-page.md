# 7-3: Research Detail Page

**Tier:** 7 - Frontend - Orchestrator UI
**Status:** Pending

## Context

Create ResearchDetailPage for viewing synthesis and individual results.

## Problem Statement

Users need a UI to view research results with synthesized report and individual LLM outputs.

## Scope

**In Scope:**
- Primary section: Synthesized result (markdown)
- Copy button with frame blink feedback
- Secondary section: Collapsed accordions per LLM
- Each accordion: status badge, duration, result/error

**Out of Scope:**
- Result editing
- Re-running research

## Required Approach

1. Follow existing detail page patterns
2. Use markdown renderer
3. Accordion component for collapsible sections

## Step Checklist

- [ ] Create `apps/web/src/pages/ResearchDetailPage.tsx`
- [ ] Fetch research by ID from route params
- [ ] Render title and metadata
- [ ] Render synthesized result as markdown
- [ ] Add copy button that blinks outer frame
- [ ] Render accordion for each LLM result
- [ ] Show status badge and duration in header
- [ ] Show result or error in body
- [ ] Per-section copy button
- [ ] Handle loading and error states
- [ ] Add route in App.tsx

## Definition of Done

- [ ] Detail view renders correctly
- [ ] Markdown renders properly
- [ ] Copy feedback works
- [ ] Accordions work
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run build --workspace=@intexuraos/web
```

## Rollback Plan

Delete page file and revert App.tsx.
