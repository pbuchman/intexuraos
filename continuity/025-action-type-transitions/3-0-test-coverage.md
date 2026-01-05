# 3-0: Test Coverage

## Objective

Add tests for all new functionality to maintain 95% coverage.

## Tasks

### 1. Unit tests for domain model

File: `apps/actions-agent/src/__tests__/domain/actionTransition.test.ts`

```typescript
describe('createActionTransition', () => {
  it('creates transition with all required fields');
  it('generates unique id');
  it('sets createdAt to current timestamp');
});
```

### 2. Unit tests for use case

File: `apps/actions-agent/src/__tests__/domain/changeActionType.test.ts`

```typescript
describe('ChangeActionTypeUseCase', () => {
  it('returns NOT_FOUND for non-existent action');
  it('returns NOT_FOUND for action belonging to different user');
  it('returns INVALID_STATUS for processing action');
  it('returns INVALID_STATUS for completed action');
  it('returns INVALID_STATUS for failed action');
  it('returns INVALID_STATUS for rejected action');
  it('returns INVALID_STATUS for archived action');
  it('allows type change for pending action');
  it('allows type change for awaiting_approval action');
  it('skips transition log when type unchanged');
  it('fetches command text from commands-router');
  it('returns COMMAND_NOT_FOUND if command missing');
  it('logs transition before updating action');
  it('updates action type and updatedAt');
});
```

### 3. Integration tests for route

File: `apps/actions-agent/src/__tests__/routes/publicRoutes.test.ts`

Add to existing file or create new section:

```typescript
describe('PATCH /router/actions/:actionId with type', () => {
  it('returns 401 without auth');
  it('returns 404 for non-existent action');
  it('returns 400 when changing type on processing action');
  it('changes type for pending action');
  it('changes type for awaiting_approval action');
  it('allows changing both type and status');
  it('creates transition record in Firestore');
  it('fetches command text from commands-router (not from request)');
});
```

### 3b. Integration tests for commands-router internal endpoint

File: `apps/commands-router/src/__tests__/routes/internalRoutes.test.ts`

```typescript
describe('GET /internal/router/commands/:commandId', () => {
  it('returns 401 without internal auth header');
  it('returns 404 for non-existent command');
  it('returns command with text for valid request');
});
```

### 4. Repository tests

File: `apps/actions-agent/src/__tests__/infra/actionTransitionRepository.test.ts`

```typescript
describe('ActionTransitionRepository', () => {
  it('saves transition to Firestore');
  it('lists transitions by userId');
  it('returns empty array for user with no transitions');
});
```

### 5. Fake implementations for tests

Add to test fakes:

- `FakeActionTransitionRepository`
- `FakeCommandsRouterClient`

## Verification

- [ ] All new code has corresponding tests
- [ ] `npm run test` passes
- [ ] Coverage report shows ≥95% for new files
- [ ] No coverage threshold violations

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
