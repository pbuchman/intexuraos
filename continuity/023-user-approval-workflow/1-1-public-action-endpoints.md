# Tier 1-1: Public Action Endpoints Migration

## Status: ⏳ PENDING

## Objective
Move all public action endpoints from commands-router to actions-agent (GET, PATCH, DELETE).

## Dependencies
- 0-0-setup (completed)

## Tasks
- [ ] Create publicRoutes.ts in actions-agent
- [ ] Implement GET /router/actions (list user's actions)
- [ ] Implement PATCH /router/actions/:actionId (update status)
- [ ] Implement DELETE /router/actions/:actionId (delete action)
- [ ] Add JWT authentication to public routes
- [ ] Register publicRoutes plugin in server.ts
- [ ] Copy action schemas from commands-router
- [ ] Write unit tests for all endpoints
- [ ] Write integration tests

## Files to Create
1. `apps/actions-agent/src/routes/publicRoutes.ts` - New public endpoints

## Files to Modify
1. `apps/actions-agent/src/server.ts` - Register publicRoutes plugin

## Endpoints to Implement

### GET /router/actions
- Auth: JWT (requireAuth)
- Response: Array of actions for authenticated user
- Calls: `actionRepository.listByUserId(userId)`

### PATCH /router/actions/:actionId
- Auth: JWT (requireAuth)
- Request: `{ status: ActionStatus }`
- Validation: User owns action (403 if not)
- Calls: `actionRepository.update()`

### DELETE /router/actions/:actionId
- Auth: JWT (requireAuth)
- Validation: User owns action (403 if not)
- Calls: `actionRepository.delete()`

## OpenAPI Schemas
Copy from commands-router routerRoutes.ts:
- actionSchema
- updateActionStatusSchema
- Request/response schemas

## Verification
- [ ] JWT authentication works
- [ ] Returns 401 for unauthenticated requests
- [ ] Returns 403 when user doesn't own action
- [ ] Returns 404 for non-existent actions
- [ ] All CRUD operations work correctly
- [ ] Integration tests pass

## Blocked By
None (independent of other tasks)

## Blocks
- 2-5-cleanup-commands-router (needs these endpoints working first)

## Notes
- Keep exact same API contract as commands-router
- No breaking changes to frontend
- Use actionRepository from services

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
