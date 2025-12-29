# 6-0: API Keys Service

**Tier:** 6 - Frontend - Settings API Keys
**Status:** Pending

## Context

Add API functions for managing LLM API keys in the web app.

## Problem Statement

Frontend needs to fetch and update API keys via user-service.

## Scope

**In Scope:**
- Add API functions to authApi.ts or new service file
- GET masked keys
- PATCH to update keys

**Out of Scope:**
- UI components (6-1)

## Required Approach

1. Follow existing service patterns
2. Use useApiClient hook
3. Handle errors consistently

## Step Checklist

- [ ] Add `getLlmApiKeys()` function to authApi.ts
- [ ] Returns masked keys object
- [ ] Add `updateLlmApiKey(provider, key)` function
- [ ] Validates key server-side
- [ ] Returns success/failure
- [ ] Add TypeScript types for API keys

## Definition of Done

- [ ] API functions work correctly
- [ ] Error handling consistent
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/web
```

## Rollback Plan

Revert authApi.ts changes.
