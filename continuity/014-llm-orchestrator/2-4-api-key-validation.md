# 2-4: API Key Validation

**Tier:** 2 - Encryption Infrastructure + User Service Extension
**Status:** Pending

## Context

Implement API key validation using cheap/fast models before saving.

## Problem Statement

When user provides an API key, validate it actually works before storing.

## Scope

**In Scope:**
- Create validation usecase
- Test each provider with cheapest model
- Return validation result (valid/invalid/error)

**Out of Scope:**
- Complex error messages (just valid/invalid)
- Rate limiting

## Required Approach

1. Use infra-gemini, infra-claude, infra-gpt packages
2. Call `validate()` method on each client
3. Use cheapest models: gemini-1.5-flash, gpt-4o-mini, claude-3-haiku

## Step Checklist

- [ ] Create `apps/user-service/src/domain/settings/usecases/validateApiKey.ts`
- [ ] Import LLM client packages
- [ ] Implement validation for each provider
- [ ] Return `{ valid: boolean; error?: string }`
- [ ] Call validation in PATCH route before saving
- [ ] Add tests (mock LLM clients)

## Definition of Done

- [ ] Validation rejects invalid keys
- [ ] Validation accepts valid keys
- [ ] Tests pass with mocked clients
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/user-service
npm run ci
```

## Rollback Plan

Remove validation usecase and route integration.
