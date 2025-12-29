# 2-3: User Settings Routes

**Tier:** 2 - Encryption Infrastructure + User Service Extension
**Status:** Pending

## Context

Add API endpoints for managing LLM API keys in user settings.

## Problem Statement

Frontend needs to GET (masked) and PATCH API keys.

## Scope

**In Scope:**
- Update GET /users/:uid/settings to return masked keys
- Update PATCH /users/:uid/settings to accept API keys
- Mask format: `••••...last4` or `null` if not set

**Out of Scope:**
- Validation (2-4)
- Frontend (Tier 6)

## Required Approach

1. Add masking logic for API keys in response
2. Accept plain keys in PATCH (encrypt in repository)
3. Allow removing keys by setting to null/empty

## Step Checklist

- [ ] Update GET handler to mask API keys in response
- [ ] Create `maskApiKey(key: string): string` helper
- [ ] Update PATCH handler to accept llmApiKeys
- [ ] Update JSON schemas for request/response
- [ ] Add tests for new functionality

## Definition of Done

- [ ] GET returns masked keys
- [ ] PATCH saves encrypted keys
- [ ] Tests pass
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/user-service
npm run ci
```

## Rollback Plan

Revert route handlers and schemas.
