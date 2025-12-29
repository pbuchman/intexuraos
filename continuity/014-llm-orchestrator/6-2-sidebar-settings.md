# 6-2: Sidebar Settings

**Tier:** 6 - Frontend - Settings API Keys
**Status:** Pending

## Context

Add API Keys to Settings nav section in Sidebar.

## Problem Statement

Users need navigation to the API Keys settings page.

## Scope

**In Scope:**
- Add "API Keys" item under Settings section
- Link to /#/settings/api-keys

**Out of Scope:**
- LLM Orchestrator nav section (7-4)

## Required Approach

1. Follow existing settings navigation pattern
2. Add to collapsible Settings section

## Step Checklist

- [ ] Update `apps/web/src/components/Sidebar.tsx`
- [ ] Add "API Keys" nav item under Settings
- [ ] Link to `/#/settings/api-keys`
- [ ] Use appropriate icon

## Definition of Done

- [ ] Navigation link visible under Settings
- [ ] Link works correctly
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run build --workspace=@intexuraos/web
```

## Rollback Plan

Revert Sidebar.tsx changes.
