# 7-1: New Research Page

**Tier:** 7 - Frontend - Orchestrator UI
**Status:** Pending

## Context

Create LlmOrchestratorPage (main view) for submitting research.

## Problem Statement

Users need a UI to submit research prompts to multiple LLMs.

## Scope

**In Scope:**
- Large textarea for prompt
- Checkboxes for LLM providers
- Disable checkboxes if no API key
- Submit button
- Success message

**Out of Scope:**
- Previous Researches list (7-2)

## Required Approach

1. Follow existing page patterns
2. Check API keys on load
3. Disable providers without keys
4. Show tooltip on disabled checkboxes

## Step Checklist

- [ ] Create `apps/web/src/pages/LlmOrchestratorPage.tsx`
- [ ] Fetch user's API keys to determine availability
- [ ] Render intro text
- [ ] Render prompt textarea
- [ ] Render provider checkboxes (Google, OpenAI, Anthropic)
- [ ] Disable checkboxes without API keys
- [ ] Show tooltip: "Configure API key in Settings → API Keys"
- [ ] Submit handler calls API
- [ ] Show success message after submit
- [ ] Reset form
- [ ] Add route in App.tsx

## Definition of Done

- [ ] Page renders correctly
- [ ] Disabled checkboxes show tooltip
- [ ] Submit works
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run build --workspace=@intexuraos/web
```

## Rollback Plan

Delete page file and revert App.tsx.
