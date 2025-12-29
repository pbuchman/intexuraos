# 8-0: API Docs Hub

**Tier:** 8 - Integration & Testing
**Status:** Pending

## Context

Add llm-orchestrator-service to api-docs-hub aggregator.

## Problem Statement

The new service's OpenAPI spec needs to be included in the API documentation hub.

## Scope

**In Scope:**
- Add service to api-docs-hub config
- Update environment variables
- Update deploy configuration

**Out of Scope:**
- Service implementation (done in earlier tiers)

## Required Approach

1. Add to REQUIRED_ENV_VARS in config.ts
2. Update Terraform with new secret
3. Update deploy script

## Step Checklist

- [ ] Update `apps/api-docs-hub/src/config.ts`
- [ ] Add `LLM_ORCHESTRATOR_SERVICE_OPENAPI_URL` to REQUIRED_ENV_VARS
- [ ] Update `terraform/modules/api-docs-hub/` with new environment variable
- [ ] Update `cloudbuild/scripts/deploy-api-docs-hub.sh` if needed
- [ ] Verify api-docs-hub can fetch the spec

## Definition of Done

- [ ] Config includes new service
- [ ] Terraform updated
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/api-docs-hub
```

## Rollback Plan

Revert config.ts and Terraform changes.
