# Commands Agent - Testing Guide

## Test Coverage

**Current Coverage:** >95%

Tests are located in `apps/commands-agent/src/__tests__//`

## Running Tests

```bash
# All tests
pnpm test --filter="commands-agent"

# Specific test file
pnpm test -- commands-agent/src/__tests__/usecases/processCommand.test.ts

# Watch mode
pnpm test --watch --filter="commands-agent"
```

## Test Structure

```
apps/commands-agent/src/__tests__/
  fakes.ts                      # Test doubles and mocks
  infra/
    actionsAgent/
      client.test.ts            # actions-agent HTTP client tests
    classifier.test.ts          # LLM classifier tests
    firestore/
      commandRepository.test.ts # Firestore repository tests
    pubsub/
      actionEventPublisher.test.ts # PubSub publisher tests
      config.test.ts            # PubSub config tests
    userServiceClient.test.ts   # User service client tests
  routes.test.ts                # Integration tests for routes
  usecases/
    processCommand.test.ts      # Main use case tests
    retryPendingCommands.test.ts # Retry use case tests
```

## Test Patterns

### Service Container Pattern

All tests use the service container pattern:

```typescript
import { setServices, resetServices } from './fakes.js';

describe('processCommand useCase', () => {
  beforeEach(() => {
    setServices({
      commandRepository: fakeCommandRepository,
      actionsAgentClient: fakeActionsAgentClient,
      classifierFactory: fakeClassifierFactory,
      userServiceClient: fakeUserServiceClient,
      eventPublisher: fakeEventPublisher,
      logger: fakeLogger,
    });
  });

  afterEach(() => {
    resetServices();
  });
});
```

### Fakes and Mocks

Located in `fakes.ts`:

```typescript
// Fake repository
export const fakeCommandRepository: CommandRepository = {
  getById: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  listByUserId: vi.fn().mockResolvedValue([]),
  listByStatus: vi.fn().mockResolvedValue([]),
};

// Fake classifier
export const fakeClassifier: Classifier = {
  classify: vi.fn().mockResolvedValue({
    type: 'todo',
    confidence: 0.9,
    title: 'Test todo',
    reasoning: 'Test reasoning',
  }),
};

// Fake logger
export const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
```

## Key Test Scenarios

### 1. Idempotent Command Processing

```typescript
it('returns existing command if duplicate externalId', async () => {
  const existingCommand = createCommand({...});
  fakeCommandRepository.getById.mockResolvedValue(existingCommand);

  const result = await processCommandUseCase.execute({
    userId: 'user-123',
    sourceType: 'pwa-shared',
    externalId: 'same-id',
    text: 'Some text',
    timestamp: new Date().toISOString(),
  });

  expect(result.isNew).toBe(false);
  expect(result.command).toEqual(existingCommand);
});
```

### 2. Classification with All Models

Tests verify classification works with:

- Gemini 2.5 Flash
- GLM-4.7
- GLM-4.7-Flash

### 3. Pending Classification on API Key Failure

```typescript
it('marks command as pending_classification when LLM client fetch fails', async () => {
  fakeUserServiceClient.getLlmClient.mockResolvedValue(
    err(new Error('No API key configured'))
  );

  const result = await processCommandUseCase.execute({...});

  expect(result.command.status).toBe('pending_classification');
});
```

### 4. URL Keyword Isolation

Tests verify URLs don't trigger incorrect classifications:

```typescript
it('classifies URL as link despite research keyword in domain', async () => {
  fakeClassifier.classify.mockResolvedValue({
    type: 'link',
    confidence: 0.95,
    title: 'Research Tools',
    reasoning: 'URL present, keyword isolation applied',
  });
});
```

### 5. Polish Language Support

```typescript
it('recognizes Polish command phrases', async () => {
  fakeClassifier.classify.mockResolvedValue({
    type: 'link',
    confidence: 0.92,
    title: 'Zapisz link',
    reasoning: 'Polish explicit intent detected',
  });
});
```

## Integration Tests

Route integration tests use Fastify's `app.inject()`:

```typescript
it('POST /commands creates and classifies command', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/commands',
    headers: { authorization: `Bearer ${validToken}` },
    payload: {
      text: 'Buy groceries',
      source: 'pwa-shared',
    },
  });

  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({
    success: true,
    data: { command: { status: 'classified' } },
  });
});
```

## Coverage Reports

```bash
# Generate coverage report
pnpm test --coverage --filter="commands-agent"

# View in browser
open apps/commands-agent/coverage/index.html
```

## Test Utilities

### Test Data Factories

```typescript
import { createCommand } from '../../domain/models/command.js';

const testCommand = createCommand({
  userId: 'test-user',
  sourceType: 'pwa-shared',
  externalId: 'test-external-id',
  text: 'Test command',
  timestamp: '2025-01-25T10:00:00.000Z',
});
```

### Mock LLM Client

```typescript
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

const mockLlmClient: LlmGenerateClient = {
  generate: vi.fn().mockResolvedValue(
    ok(JSON.stringify({ type: 'todo', confidence: 0.9, ... }))
  ),
};
```

## Common Gotchas

### Async Cleanup

Always `await` async operations in `afterEach`:

```typescript
afterEach(async () => {
  // Good: wait for cleanup
  await resetServices();
});
```

### Mock Clearing

Clear mocks between tests to prevent state leakage:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

### Logger Mocks

Logger methods return void - don't assert on return values:

```typescript
expect(fakeLogger.info).toHaveBeenCalledWith(
  expect.objectContaining({ commandId: expect.any(String) }),
  'Classification completed'
);
```

---

**Last updated:** 2025-01-25
