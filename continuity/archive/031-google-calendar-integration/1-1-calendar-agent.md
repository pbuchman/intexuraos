# 1-1 calendar-agent Service

**Tier:** 1 (Independent Deliverable)

## Context

A new service to handle Google Calendar operations. It gets OAuth tokens from user-service and calls Google Calendar API. Follows the service creation pattern in `.claude/commands/create-service.md`.

## Problem Statement

We need a dedicated service to:

1. List calendar events
2. Create calendar events
3. Update calendar events
4. Delete calendar events
5. Query free/busy times

The service must get valid OAuth tokens from user-service's internal endpoint.

## Scope

**In scope:**

- Full service scaffold following create-service pattern
- Domain layer: CalendarEvent model, ports, use cases
- Infrastructure: Google Calendar API client, user-service HTTP client
- Routes: CRUD for events + freebusy query
- Tests (95% coverage)

**Not in scope:**

- Terraform deployment (Tier 2)
- Actions-agent integration (separate task)
- OAuth handling (user-service responsibility)

## Required Approach

Follow `.claude/commands/create-service.md` exactly:

1. Create app directory structure
2. Create package.json with correct dependencies
3. Create Dockerfile
4. Create src/index.ts, server.ts, config.ts, services.ts
5. Implement domain layer
6. Implement infrastructure layer
7. Implement routes
8. Write comprehensive tests

## Step Checklist

### Service Scaffold

- [ ] Create `apps/calendar-agent/package.json`
- [ ] Create `apps/calendar-agent/Dockerfile`
- [ ] Create `apps/calendar-agent/tsconfig.json`
- [ ] Create `apps/calendar-agent/vitest.config.ts`
- [ ] Create `apps/calendar-agent/src/index.ts`
- [ ] Create `apps/calendar-agent/src/server.ts`
- [ ] Create `apps/calendar-agent/src/config.ts`
- [ ] Create `apps/calendar-agent/src/services.ts`

### Domain Layer

- [ ] Create `apps/calendar-agent/src/domain/models.ts` (CalendarEvent, FreeBusySlot)
- [ ] Create `apps/calendar-agent/src/domain/errors.ts` (CalendarErrorCode)
- [ ] Create `apps/calendar-agent/src/domain/ports.ts` (GoogleCalendarClient, UserServiceClient interfaces)
- [ ] Create `apps/calendar-agent/src/domain/useCases/listEvents.ts`
- [ ] Create `apps/calendar-agent/src/domain/useCases/createEvent.ts`
- [ ] Create `apps/calendar-agent/src/domain/useCases/getEvent.ts`
- [ ] Create `apps/calendar-agent/src/domain/useCases/updateEvent.ts`
- [ ] Create `apps/calendar-agent/src/domain/useCases/deleteEvent.ts`
- [ ] Create `apps/calendar-agent/src/domain/useCases/getFreeBusy.ts`
- [ ] Create `apps/calendar-agent/src/domain/index.ts`

### Infrastructure Layer

- [ ] Create `apps/calendar-agent/src/infra/google/googleCalendarClient.ts`
- [ ] Create `apps/calendar-agent/src/infra/user/userServiceClient.ts`

### Routes

- [ ] Create `apps/calendar-agent/src/routes/calendarRoutes.ts`
- [ ] Create `apps/calendar-agent/src/routes/schemas.ts`

### Integration

- [ ] Add to root `tsconfig.json`
- [ ] Add to `scripts/dev.mjs` (assign port 8116)
- [ ] Add to `.envrc.local.example`
- [ ] Add to `cloudbuild/cloudbuild.yaml` \_SERVICE_CONFIGS
- [ ] Create `cloudbuild/scripts/deploy-calendar-agent.sh`
- [ ] Update `cloudbuild/scripts/check-affected.mjs`
- [ ] Register in `apps/api-docs-hub/src/config.ts`

### Tests

- [ ] Write domain use case tests
- [ ] Write infrastructure tests (mock Google API, mock user-service)
- [ ] Write route integration tests
- [ ] Ensure 95% coverage

### Verification

- [ ] Run `npm install`
- [ ] Run `npm run ci`

## Definition of Done

- [ ] Service scaffold complete following create-service pattern
- [ ] All routes functional: GET/POST/PATCH/DELETE /calendar/events, POST /freebusy
- [ ] Health and OpenAPI endpoints working
- [ ] Token retrieval from user-service working
- [ ] 95% test coverage
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm install
npm run test -w @intexuraos/calendar-agent
npm run typecheck -w @intexuraos/calendar-agent
npm run ci
```

## Rollback Plan

1. Delete `apps/calendar-agent/` directory
2. Revert changes to integration files (tsconfig.json, dev.mjs, cloudbuild.yaml, etc.)

## Environment Variables

```
INTEXURAOS_GCP_PROJECT_ID
INTEXURAOS_AUTH_JWKS_URL
INTEXURAOS_AUTH_ISSUER
INTEXURAOS_AUTH_AUDIENCE
INTEXURAOS_INTERNAL_AUTH_TOKEN
INTEXURAOS_USER_SERVICE_URL
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
