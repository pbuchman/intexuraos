# 6-1: API Keys Page

**Tier:** 6 - Frontend - Settings API Keys
**Status:** Pending

## Context

Create ApiKeysSettingsPage component for managing LLM API keys.

## Problem Statement

Users need a UI to view (masked) and update their API keys.

## Scope

**In Scope:**
- Create ApiKeysSettingsPage component
- Show 3 API key inputs (Google, OpenAI, Anthropic)
- Masked display with show toggle
- Edit/Save flow with validation

**Out of Scope:**
- Navigation (6-2)

## Required Approach

1. Follow existing settings page patterns
2. Card layout for each provider
3. Validation spinner during save

## Step Checklist

- [ ] Create `apps/web/src/pages/ApiKeysSettingsPage.tsx`
- [ ] Fetch existing masked keys on load
- [ ] Render card for each provider
- [ ] Masked input with show/hide toggle
- [ ] Edit mode with save/cancel buttons
- [ ] Loading state during validation
- [ ] Success/error feedback
- [ ] Add route in App.tsx

## Definition of Done

- [ ] Page renders correctly
- [ ] Can view masked keys
- [ ] Can update keys with validation
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/web
npm run build --workspace=@intexuraos/web
```

## Rollback Plan

Delete page file and revert App.tsx route.
