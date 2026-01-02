# Use Case Logging (Domain Layer)

**REQUIREMENT: All business-critical use cases MUST include comprehensive logging for action tracing.**

Use cases that process important business flows (commands, actions, events, payments, etc.) must log at key decision points to enable full traceability from request to database entry.

## When to Add Use Case Logging

**Always log in use cases that:**

- Process user commands or actions
- Make external API calls (LLM, payment processors, etc.)
- Create or update critical domain entities
- Publish events to other services
- Handle state transitions with business logic
- Can fail with multiple error scenarios

**Examples requiring logging:**

- Command classification and routing
- LLM research processing
- Payment processing
- Notification delivery
- Data synchronization workflows

## Logging Pattern

**Step 1: Accept logger as dependency**

```typescript
import type { Logger } from 'pino';

export function createProcessCommandUseCase(deps: {
  commandRepository: CommandRepository;
  classifierFactory: ClassifierFactory;
  eventPublisher: EventPublisherPort;
  logger: Logger; // ← Required
}): ProcessCommandUseCase {
  const { commandRepository, classifierFactory, eventPublisher, logger } = deps;

  return {
    async execute(input: ProcessCommandInput): Promise<ProcessCommandResult> {
      // Use logger throughout
    },
  };
}
```

**Step 2: Log at critical decision points**

```typescript
// Entry point - always log start
logger.info(
  {
    commandId,
    userId: input.userId,
    sourceType: input.sourceType,
    textPreview: input.text.substring(0, 100),
  },
  'Starting command processing'
);

// Deduplication check
const existingCommand = await commandRepository.getById(commandId);
if (existingCommand !== null) {
  logger.info(
    { commandId, status: existingCommand.status },
    'Command already exists, skipping processing'
  );
  return { command: existingCommand, isNew: false };
}

// State transitions
logger.info({ commandId, status: command.status }, 'Created new command');

// External dependencies
logger.info({ commandId, userId }, 'Fetching user API keys');

// Conditional logic / error scenarios
if (!apiKeysResult.ok || apiKeysResult.value.google === undefined) {
  logger.warn(
    {
      commandId,
      userId,
      reason: !apiKeysResult.ok ? 'fetch_failed' : 'no_google_key',
    },
    'User has no Google API key, marking as pending'
  );
  command.status = 'pending_classification';
  await commandRepository.update(command);
  return { command, isNew: true };
}

// External API calls
logger.info({ commandId, textLength: input.text.length }, 'Starting LLM classification');
const classification = await classifier.classify(input.text);
logger.info(
  {
    commandId,
    classificationType: classification.type,
    confidence: classification.confidence,
  },
  'Classification completed'
);

// Action creation and publishing
logger.info({ commandId, actionId: action.id }, 'Created action from classification');
logger.info({ commandId, actionId }, 'Publishing action.created event to PubSub');
await eventPublisher.publishActionCreated(event);
logger.info({ commandId, actionId }, 'Action event published successfully');

// Success
logger.info(
  {
    commandId,
    status: command.status,
    classificationType: classification.type,
    hasAction: command.actionId !== undefined,
  },
  'Command processing completed successfully'
);

// Errors
catch (error) {
  logger.error(
    { commandId, error: getErrorMessage(error) },
    'Classification failed'
  );
  command.status = 'failed';
  command.failureReason = getErrorMessage(error);
  await commandRepository.update(command);
}
```

## What to Log

**Include in log context (structured data):**

- **Entity IDs**: commandId, actionId, userId, researchId, etc.
- **Status/state**: current status, state transitions
- **Decisions**: classification type, selected options, confidence scores
- **Metadata**: timestamps, source types, lengths/counts
- **Errors**: error messages (via `getErrorMessage()`), failure reasons

**Log message (human-readable string):**

- Use present continuous for in-progress: "Starting classification", "Fetching API keys"
- Use past tense for completed: "Classification completed", "Action published"
- Be specific and searchable: "User has no Google API key" not "Missing dependency"

**Do NOT log:**

- Sensitive data (API keys, tokens, passwords, PII)
- Full request/response payloads (use previews/lengths)
- Redundant information already in structured context

## Service Integration

**Step 1: Create logger in services.ts**

```typescript
import pino from 'pino';

export function initServices(config: ServiceConfig): void {
  const logger = pino({ name: 'service-name' });

  container = {
    // ... other dependencies
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository,
      classifierFactory,
      eventPublisher,
      logger, // ← Pass to use case
    }),
  };
}
```

**Step 2: Create silent logger in tests**

```typescript
import pino from 'pino';

export function createFakeServices(deps: {
  commandRepository: FakeCommandRepository;
  // ... other fakes
}): Services {
  const logger = pino({ name: 'service-test', level: 'silent' });

  return {
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository: deps.commandRepository,
      logger, // ← Silent logger for tests
    }),
  };
}
```

## Benefits

**Operational visibility:**

- Trace full lifecycle: "request accepted → entry in DB"
- Identify bottlenecks (slow external API calls)
- Monitor error rates by failure reason
- Track business metrics (classification types, confidence)

**Debugging:**

- Understand why a command failed at specific step
- See exact decision path taken
- Correlate across services using entity IDs
- Reproduce issues with actual input data

**Compliance & audit:**

- Full audit trail for critical operations
- Timestamps for all state transitions
- Evidence of proper error handling

## Reference Implementations

- `apps/commands-router/src/domain/usecases/processCommand.ts` - Comprehensive command classification logging (13 log points)
- `apps/actions-agent/src/domain/usecases/handleResearchAction.ts` - Research action processing

## Verification Checklist

For new/updated use cases with business logic:

- [ ] Logger accepted as dependency parameter
- [ ] Entry point logged with context
- [ ] All conditional branches logged (if/else paths)
- [ ] External API calls logged before and after
- [ ] State transitions logged
- [ ] Entity creation logged with IDs
- [ ] Event publishing logged
- [ ] Success path logged with summary
- [ ] Error scenarios logged with context
- [ ] Tests pass logger (silent level)
- [ ] Production logs verify traceability
