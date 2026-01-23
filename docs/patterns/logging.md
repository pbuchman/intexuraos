# Logging Patterns

IntexuraOS uses **pino** for structured logging. This document covers all logging patterns used across the codebase.

## Logger Patterns

### 1. Module-Level Logger (Infra Adapters)

**When to use:** Infra adapters with a single, well-defined purpose.

```typescript
// src/infra/whatsapp/cloudApiAdapter.ts
import pino from 'pino';

const logger = pino({ name: 'whatsapp-cloud-api' });

export function getMediaUrl(mediaId: string): Promise<Result<string>> {
  logger.info({ mediaId }, 'Fetching media URL from WhatsApp');
  // ...
}
```

**Use cases:**

- HTTP clients wrapping external APIs
- Database adapters
- PubSub publishers
- Service-specific infra implementations

**Examples:**

- `apps/whatsapp-service/src/infra/whatsapp/cloudApiAdapter.ts`
- `apps/whatsapp-service/src/infra/speechmatics/adapter.ts`

---

### 2. Factory Config Logger (HTTP Clients)

**When to use:** Factory functions that create configurable clients.

```typescript
// src/infra/http/todosServiceHttpClient.ts
import pino, { type Logger } from 'pino';

export interface TodosServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger; // ← Optional for flexibility
}

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'todosServiceHttpClient',
});

export function createTodosServiceHttpClient(
  config: TodosServiceHttpClientConfig
): TodosServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async createTodo(request: CreateTodoRequest) {
      logger.info({ url, userId: request.userId }, 'Creating todo via todos-agent');
      // ...
    },
  };
}
```

**In services.ts:**

```typescript
import pino from 'pino';

const todosServiceClient = createTodosServiceHttpClient({
  baseUrl: config.todosAgentUrl,
  internalAuthToken: config.internalAuthToken,
  logger: pino({ name: 'todosServiceClient' }), // ← Required in production
});
```

**Use cases:**

- HTTP clients for internal service communication
- Clients that may be used in multiple contexts

**Examples:**

- `apps/actions-agent/src/infra/http/todosServiceHttpClient.ts`
- `apps/commands-agent/src/infra/user/userServiceClient.ts`

---

### 3. Constructor Injection (Reusable Libraries)

**When to use:** Reusable classes from shared packages.

```typescript
// packages/infra-open-graph/src/fetcher.ts
export class OpenGraphFetcher {
  constructor(
    private readonly timeoutMs: number | undefined,
    private readonly logger: Logger // ← Required, no default
  ) {}

  async fetch(url: string): Promise<Result<OpenGraphData>> {
    this.logger.info({ url }, 'Fetching OpenGraph data');
    // ...
  }
}
```

**In services.ts:**

```typescript
import pino from 'pino';

linkPreviewFetcher: new OpenGraphFetcher(
  undefined,
  pino({ name: 'openGraphFetcher' })
),
```

**Use cases:**

- Reusable packages that may be used across different services
- Classes where caller should control logger configuration

**Examples:**

- `packages/infra-open-graph/src/fetcher.ts`

---

### 4. Use Case Dependency Injection

**When to use:** Domain layer use cases with business logic.

See [use-case-logging.md](./use-case-logging.md) for full documentation.

```typescript
export function createProcessCommandUseCase(deps: {
  commandRepository: CommandRepository;
  classifierFactory: ClassifierFactory;
  eventPublisher: EventPublisherPort;
  logger: Logger; // ← Required dependency
}): ProcessCommandUseCase {
  const { logger /* ... */ } = deps;

  return {
    async execute(input: ProcessCommandInput) {
      logger.info({ commandId, userId }, 'Starting command processing');
      // ...
    },
  };
}
```

---

## Log Levels

| Level   | When to Use                           | Example                               |
| -------  | -------------------------------------  | -------------------------------------  |
| `trace` | Very detailed debugging (rarely used) | Individual loop iterations            |
| `debug` | Detailed flow information             | State values, intermediate results    |
| `info`  | Normal operation, key events          | "Starting X", "Completed Y"           |
| `warn`  | Unexpected but recoverable            | Using fallback, missing optional data |
| `error` | Failure that breaks operation         | API errors, failed operations         |
| `fatal` | Service-threatening error             | Unhandled exceptions (rare)           |

---

## Structured Context

**DO include:**

- Entity IDs: `commandId`, `userId`, `actionId`
- Status/state: `status`, `classificationType`
- Metadata: `textLength`, `url`, `timeoutMs`
- Error context: `error: getErrorMessage(error)`

**DO NOT include:**

- Secrets: API keys, tokens, passwords
- Full payloads: entire request/response bodies
- PII: email addresses, phone numbers (unless hashed)

```typescript
// ✅ Good
logger.info(
  { userId, textLength: input.text.length, sourceType: input.sourceType },
  'Processing command'
);

// ❌ Bad - logs full text (may contain PII)
logger.info({ userId, text: input.text }, 'Processing command');
```

---

## Message Format

Use present continuous for in-progress, past tense for completed:

```typescript
// ✅ Good
logger.info({}, 'Starting classification');
logger.info({}, 'Classification completed');
logger.info({}, 'Publishing event to PubSub');

// ❌ Bad
logger.info({}, 'classify'); // Not a sentence
logger.info({}, 'Classified'); // Vague
```

---

## Testing

**Silent logger for tests:**

```typescript
import pino from 'pino';

const logger = pino({ name: 'service-test', level: 'silent' });
```

---

## Verification

Run the logging standards check:

```bash
pnpm run verify:logging
```

This verifies that factory functions accepting `logger?: Logger` are called with a logger in production code.

---

## Quick Reference

| Pattern        | Location                     | Logger Passing                 |
| --------------  | ----------------------------  | ------------------------------  |
| Module-level   | `infra/` adapters            | None (created at file scope)   |
| Factory config | `infra/http/`, `infra/user/` | Via `logger:` in config object |
| Constructor    | Reusable packages            | Via constructor parameter      |
| Use case deps  | `domain/usecases/`           | Via `deps.logger`              |
