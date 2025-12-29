# 7-4: Sidebar Navigation

**Tier:** 7 - Frontend - Orchestrator UI
**Status:** Pending

## Context

Add collapsible LLM Orchestrator nav section to Sidebar.

## Problem Statement

Users need navigation to the LLM Orchestrator pages.

## Scope

**In Scope:**
- Add collapsible "LLM Orchestrator" section
- Sub-items: "New Research", "Previous Researches"

**Out of Scope:**
- Other nav sections (already exist)

## Required Approach

1. Follow existing collapsible section pattern (Notifications, Settings)
2. Add after Dashboard, before Notifications

## Step Checklist

- [ ] Update `apps/web/src/components/Sidebar.tsx`
- [ ] Add collapsible "LLM Orchestrator" section
- [ ] Add "New Research" link to `/#/llm-orchestrator`
- [ ] Add "Previous Researches" link to `/#/llm-orchestrator/history`
- [ ] Use appropriate icons

## Definition of Done

- [ ] Navigation section visible
- [ ] Collapsible behavior works
- [ ] Links navigate correctly
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run build --workspace=@intexuraos/web
```

## Rollback Plan

Revert Sidebar.tsx changes.
