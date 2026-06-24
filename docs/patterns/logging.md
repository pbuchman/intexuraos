# Logging Patterns

IntexuraOS uses **pino** for structured logging. This document covers all logging patterns used across the codebase.

## CRITICAL: Logger Creation in Apps

**RULE:** In `apps/` code, NEVER use `pino()` directly. Always use `createAppLogger()`.

| Location                 | Logger Creation                     | Why                     |
| ------------------------ | ----------------------------------- | ----------------------- |
| `apps/*/src/services.ts` | `createAppLogger({ name })`         | Sentry integration      |
| `apps/*/src/infra/*.ts`  | `createAppLogger({ name })`         | Sentry integration      |
| `apps/*/src/server.ts`   | `createSentryStream(multistream)`   | Fastify integration     |
| `packages/**`            | Accept `Logger` interface           | No creation in packages |
| Tests                    | Mock or `pino({ level: 'silent' })` | No Sentry needed        |

**Enforcement:** `pnpm run verify:sentry-logging` fails CI if violated.

```typescript
// apps/*/src/services.ts or apps/*/src/infra/*.ts

// WRONG - logs won't reach Sentry
import pino from 'pino';
const logger = pino({ name: 'my-service' });

// CORRECT - errors automatically sent to Sentry
import { createAppLogger } from '@intexuraos/infra-sentry';
const logger = createAppLogger({ name: 'my-service' });
```

**Why:** Direct `pino()` creates loggers that don't send errors to Sentry. The `UsageLogger` Firestore permission error went unnoticed for 44+ hours because of this.

---

## Logger Patterns

### 1. Module-Level Logger (Infra Adapters)

**When to use:** Infra adapters with a single, well-defined purpose.

```typescript
// src/infra/whatsapp/cloudApiAdapter.ts
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'whatsapp-cloud-api' });

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
// src/infra/http/notesServiceHttpClient.ts
import type { Logger } from 'pino';
import { createAppLogger } from '@intexuraos/infra-sentry';

export interface NotesServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger; // ← Optional for flexibility
}

const defaultLogger = createAppLogger({ name: 'notesServiceHttpClient' });

export function createNotesServiceHttpClient(
  config: NotesServiceHttpClientConfig
): NotesServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async createNote(request: CreateNoteRequest) {
      logger.info({ url, userId: request.userId }, 'Creating note via notes-agent');
      // ...
    },
  };
}
```

**In services.ts:**

```typescript
import { createAppLogger } from '@intexuraos/infra-sentry';

const notesServiceClient = createNotesServiceHttpClient({
  baseUrl: config.notesAgentUrl,
  internalAuthToken: config.internalAuthToken,
  logger: createAppLogger({ name: 'notesServiceClient' }), // ← Required in production
});
```

**Use cases:**

- HTTP clients for internal service communication
- Clients that may be used in multiple contexts

**Examples:**

- `apps/actions-agent/src/infra/http/notesServiceHttpClient.ts`
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
import { createAppLogger } from '@intexuraos/infra-sentry';

linkPreviewFetcher: new OpenGraphFetcher(
  undefined,
  createAppLogger({ name: 'openGraphFetcher' })
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
| ------- | ------------------------------------- | ------------------------------------- |
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

Run the logging standards checks:

```bash
pnpm run verify:logging          # Factory functions called with logger
pnpm run verify:sentry-logging   # No direct pino() in apps/
```

- `verify:logging` - Ensures factory functions with `logger?: Logger` are called with a logger
- `verify:sentry-logging` - Ensures all loggers in `apps/` use `createAppLogger()` for Sentry integration

---

## Quick Reference

| Pattern        | Location                     | Logger Passing                 |
| -------------- | ---------------------------- | ------------------------------ |
| Module-level   | `infra/` adapters            | None (created at file scope)   |
| Factory config | `infra/http/`, `infra/user/` | Via `logger:` in config object |
| Constructor    | Reusable packages            | Via constructor parameter      |
| Use case deps  | `domain/usecases/`           | Via `deps.logger`              |
