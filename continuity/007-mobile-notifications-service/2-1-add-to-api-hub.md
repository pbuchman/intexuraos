# 2-1: Add to API Hub

## Tier

2 (Dependent)

## Context

Register mobile-notifications-service in the API docs hub.

## Problem Statement

API docs hub aggregates OpenAPI specs from all services.
Need to add the new service.

## Scope

- Update apps/api-docs-hub/src/config.ts
- Add environment variable for service URL
- Verify API docs hub shows the new service

## Non-Scope

- Service implementation (done in previous tasks)

## Required Approach

1. Add INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL to config
2. Add service entry to services array
3. Update .envrc if needed

## Step Checklist

- [ ] Update apps/api-docs-hub/src/config.ts
- [ ] Add environment variable handling
- [ ] Verify API hub configuration is correct
- [ ] Test locally if possible

## Definition of Done

- Service added to API hub config
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
```

## Rollback Plan

Revert config.ts changes
