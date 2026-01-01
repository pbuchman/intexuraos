# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# IntexuraOS — Claude Instructions

**All rules below are verified by `npm run ci`. If CI passes, rules are satisfied.**

---

## Verification (MANDATORY)

```bash
npm run ci                    # MUST pass before task completion
tf fmt -check -recursive      # If terraform changed (from /terraform)
tf validate                   # If terraform changed
```

**IMPORTANT:** Use `tf` command instead of `terraform`. This is an alias configured in the user's shell environment. Note: The alias may not be available in spawned subshells - if `tf` is not found, the user should run commands manually.

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

---

## Architecture

```
apps/
  <app>/src/
    domain/     → Business logic, models, usecases (no external deps)
    infra/      → Adapters (Firestore, Notion, Auth0, etc.)
    routes/     → HTTP transport layer
    services.ts → Dependency injection container
packages/
  common-core/    → Result types, error utilities (leaf package)
  common-http/    → HTTP response helpers, JWT utilities (leaf package)
  http-contracts/ → OpenAPI schemas, Fastify JSON schemas (leaf package)
  http-server/    → Health checks, validation error handler
  infra-firestore/→ Firestore client wrapper
  infra-notion/   → Notion client wrapper
  infra-whatsapp/ → WhatsApp API client
  infra-claude/   → Anthropic Claude API client
  infra-gemini/   → Google Gemini API client
  infra-gpt/      → OpenAI GPT API client
terraform/        → Infrastructure as code
docs/             → All documentation
```

### Import Rules (enforced by ESLint boundaries)

| From             | Can Import                                             |
| ---------------- | ------------------------------------------------------ |
| `common-core`    | nothing (leaf package)                                 |
| `common-http`    | nothing (leaf package)                                 |
| `http-contracts` | nothing (leaf package)                                 |
| `http-server`    | `common-core`, `common-http`                           |
| `infra-*`        | `common-core`, `common-http`                           |
| `apps/*`         | `common-*`, `http-contracts`, `http-server`, `infra-*` |

**Forbidden:**

- Apps importing from other apps
- Deep imports into package internals (`@intexuraos/*/src/*`)

### Intra-App Import Rules (enforced by ESLint)

Within each app, imports must respect layer boundaries:

| From             | Must NOT Import        | Reason                                     |
| ---------------- | ---------------------- | ------------------------------------------ |
| `routes/*`       | `../infra/firestore/*` | Use `getServices()` to access repositories |
| `infra/notion/*` | `../firestore/*`       | Accept repositories as function parameters |
| `infra/llm/*`    | `../firestore/*`       | Accept repositories as function parameters |

**Anti-Pattern (FORBIDDEN):**

```ts-example
// In routes/promptRoutes.ts - WRONG
import { getPromptVaultPageId } from '../infra/firestore/promptVaultSettingsRepository.js';

// In infra/notion/promptApi.ts - WRONG
import { getPromptVaultPageId } from '../firestore/promptVaultSettingsRepository.js';
```

**Correct Pattern:**

```ts-example
// In services.ts - create and wire dependencies
const promptVaultSettings = createPromptVaultSettingsRepository();

// In routes - access via getServices()
const { promptVaultSettings } = getServices();

// In infra functions - accept as parameter
async function getUserContext(userId: string, promptVaultSettings: PromptVaultSettingsPort) { ... }
```

### Service-to-Service Communication

Apps communicate via HTTP-based internal endpoints following the pattern:

```
/internal/{service-prefix}/{resource-path}
```

**Service Prefixes:**

| Service               | Prefix        | Example Endpoint                         |
| --------------------- | ------------- | ---------------------------------------- |
| `notion-service`      | `notion`      | `/internal/notion/users/:userId/context` |
| `user-service`        | `user`        | `/internal/users/:uid/llm-keys`          |
| `promptvault-service` | `promptvault` | (future endpoints)                       |
| `whatsapp-service`    | `whatsapp`    | (future endpoints)                       |
| `llm-orchestrator`    | `llm`         | (future endpoints)                       |

**Authentication:**

- Header: `X-Internal-Auth: <token>`
- Env var: `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- Returns `401 Unauthorized` for missing/invalid tokens

**Implementation:**

- Server: Use `validateInternalAuth()` helper (see [service-to-service-communication.md](../docs/architecture/service-to-service-communication.md))
- Client: Create typed service client with `fetch()` + auth header
- Testing: Inject fake clients via dependency injection

**Full documentation:** [docs/architecture/service-to-service-communication.md](../docs/architecture/service-to-service-communication.md)

### Internal Endpoint Logging

**RULE: ALL internal endpoints (`/internal/*`) MUST use `logIncomingRequest()` at entry.**

**Pattern:**

```typescript
async (request: FastifyRequest, reply: FastifyReply) => {
  // STEP 1: Log incoming request BEFORE auth check (for debugging)
  logIncomingRequest(request, {
    message: 'Received request to /internal/endpoint/path',
    bodyPreviewLength: 200, // Adjust based on expected payload size
    includeParams: true, // Optional: include URL params
  });

  // STEP 2: Validate authentication
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    request.log.warn({ reason: authResult.reason }, 'Internal auth failed');
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  // STEP 3: Process request
  // ...
};
```

**Why log BEFORE auth check:**

- Captures diagnostic information even for failed auth attempts
- Helps debug authorization issues (e.g., missing headers, token mismatch)
- Safe because `logIncomingRequest()` automatically redacts sensitive headers

**Sensitive headers automatically redacted:**

- `x-internal-auth`, `authorization`, `x-goog-iap-jwt-assertion`
- All fields in `SENSITIVE_FIELDS` from `@intexuraos/common-core`

### Pub/Sub Push Endpoints

**Pattern:** `/internal/{service-prefix}/pubsub/{resource}`

**MANDATORY Logging Requirements:**

All Pub/Sub push endpoint handlers MUST log at these points:

1. **Auth Failures (401):**

   ```typescript
   const authResult = validateInternalAuth(request);
   if (!authResult.valid) {
     request.log.warn(
       {
         reason: authResult.reason,
         headers: {
           'x-internal-auth': request.headers['x-internal-auth'] ? '[REDACTED]' : '[MISSING]',
         },
       },
       'Pub/Sub auth failed'
     );
     // ... return 401
   }
   ```

2. **Message Format Errors (400):**

   ```typescript
   request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
   ```

3. **Event Type Validation (400):**

   ```typescript
   request.log.warn(
     {
       type: parsedType,
       messageId: body.message.messageId,
       // Include entity IDs (userId, actionId, commandId, etc.)
     },
     'Unexpected event type'
   );
   ```

4. **Entry Point (Before Processing):**

   ```typescript
   request.log.info(
     {
       messageId: body.message.messageId,
       userId: eventData.userId,
       // Include relevant entity IDs and context
     },
     'Processing {event-name} event'
   );
   ```

5. **Processing Errors (500):**

   ```typescript
   request.log.error(
     {
       error: result.error.message,
       messageId: body.message.messageId,
       // Include full context for debugging
     },
     'Failed to process event'
   );
   ```

6. **Success (200):**

   ```typescript
   request.log.info(
     {
       messageId: body.message.messageId,
       // Include result IDs and summary
     },
     'Successfully processed event'
   );
   ```

**Rule:** Every rejected message (auth, validation, processing failure) MUST be logged with:

- Message ID
- Rejection reason
- Relevant entity IDs for correlation
- NO secrets/tokens in logs (use [REDACTED])

**Verification:** `npm run ci` includes log coverage checks via tests.

### Pub/Sub Subscriptions (Cloud Run)

**RULE: Never use pull subscriptions. All Pub/Sub consumers MUST use HTTP push.**

```ts-example
// ❌ Pull subscription (FORBIDDEN)
const subscription = pubsub.subscription('my-sub');
subscription.on('message', (message) => { ... });

// ✅ Push subscription (CORRECT)
fastify.post('/internal/pubsub/my-topic', async (request, reply) => {
  const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
  // Process message
  return { success: true };
});
```

**Why:** Cloud Run scales to zero. Pull subscriptions require persistent background processes. Messages accumulate and are never processed.

**Reference Implementation:** See `apps/actions-agent/src/routes/internalRoutes.ts`

**Verification:** ESLint `no-restricted-syntax` rule fails build on pull subscription patterns.

### Webhook Endpoint Logging

**REQUIREMENT: All webhook endpoints MUST use consistent logging patterns like internal endpoints.**

Webhooks receive external events (GitHub, WhatsApp, Stripe, etc.) and should log comprehensively for debugging and traceability.

#### Entry Point Logging

Use `logIncomingRequest()` at webhook entry (before validation):

```typescript
async (request: FastifyRequest<{ Body: WebhookPayload }>, reply: FastifyReply) => {
  // Log incoming request (before validation for debugging)
  logIncomingRequest(request, {
    message: 'Received WhatsApp webhook POST',
    bodyPreviewLength: 500,
  });

  // Validate signature
  const signature = request.headers[SIGNATURE_HEADER];
  if (typeof signature !== 'string' || signature === '') {
    request.log.warn({ reason: 'missing_signature' }, 'Webhook rejected');
    return await reply.fail('UNAUTHORIZED', 'Missing signature header');
  }

  // Process webhook
  // ...
};
```

**Why use `logIncomingRequest()` for webhooks:**

- Automatic header redaction (sensitive auth headers)
- Consistent logging format across all entry points
- Body preview for debugging without logging full payload
- Helps diagnose webhook delivery issues

#### Asynchronous Processing Logging

For webhooks that return 200 immediately and process asynchronously:

```typescript
async function processWebhookAsync(
  request: FastifyRequest<{ Body: WebhookPayload }>,
  savedEvent: { id: string },
  config: Config
): Promise<void> {
  // Entry point
  request.log.info(
    { eventId: savedEvent.id },
    'Starting asynchronous webhook processing'
  );

  try {
    // Extraction
    const fromNumber = extractSenderPhoneNumber(request.body);
    const messageType = extractMessageType(request.body);

    request.log.info(
      {
        eventId: savedEvent.id,
        fromNumber,
        messageType,
        hasText: messageText !== null,
      },
      'Extracted message details from webhook payload'
    );

    // Validation - log each rejection reason
    if (messageType === null || !supportedTypes.includes(messageType)) {
      request.log.info(
        { eventId: savedEvent.id, messageType },
        'Ignoring unsupported message type'
      );
      await updateStatus('IGNORED', { code: 'UNSUPPORTED_MESSAGE_TYPE' });
      return;
    }

    // User lookup
    request.log.info(
      { eventId: savedEvent.id, fromNumber },
      'Looking up user by phone number'
    );

    const userIdResult = await userMappingRepository.findUserByPhoneNumber(fromNumber);

    if (userIdResult.value === null) {
      request.log.info(
        { eventId: savedEvent.id, fromNumber },
        'No user mapping found for phone number'
      );
      await updateStatus('USER_UNMAPPED', { code: 'USER_UNMAPPED' });
      return;
    }

    const userId = userIdResult.value;

    request.log.info(
      { eventId: savedEvent.id, fromNumber, userId },
      'User mapping found for phone number'
    );

    // Routing
    request.log.info(
      {
        eventId: savedEvent.id,
        userId,
        messageType,
        waMessageId,
      },
      'Routing message to handler'
    );

    // Handler invocation
    await handleImageMessage(...);

    // Success
    request.log.info(
      { eventId: savedEvent.id, userId, messageId },
      'Text message processing completed successfully'
    );

  } catch (error) {
    request.log.error(
      {
        eventId: savedEvent.id,
        error: getErrorMessage(error),
      },
      'Unexpected error during asynchronous webhook processing'
    );
  }
}
```

#### What to Log in Webhook Processing

**Always log:**

- Entry point with event/webhook ID
- Extracted entities (user IDs, message IDs, types)
- Validation failures with rejection reasons
- External service lookups (before/after)
- Routing decisions
- Processing completion
- Errors with full context

**Use structured data:**

- `eventId`: Webhook event identifier for correlation
- `userId`, `messageId`, `fromNumber`: Entity IDs
- `messageType`, `status`: State information
- `reason`, `code`: Rejection/error reasons

**Avoid logging:**

- Full webhook payload (use previews)
- Sensitive user data (PII, tokens, secrets)
- Large binary data (media, attachments)

#### Error Handling Pattern

Always use `getErrorMessage()` from common-core:

```typescript
} catch (error) {
  request.log.error(
    {
      eventId: savedEvent.id,
      error: getErrorMessage(error),
    },
    'Webhook processing failed'
  );
}
```

**Never use inline error extraction:**

```typescript
// ❌ WRONG - violates ESLint rule
error: error instanceof Error ? error.message : String(error),

// ✅ CORRECT - use utility
error: getErrorMessage(error),
```

#### Reference Implementation

`apps/whatsapp-service/src/routes/webhookRoutes.ts` - Comprehensive webhook logging with:

- Entry point logging via `logIncomingRequest()`
- Asynchronous processing with full lifecycle logs
- Structured data at all decision points
- Proper error handling

#### Verification Checklist

For new/updated webhook endpoints:

- [ ] Uses `logIncomingRequest()` at entry point
- [ ] Logs validation failures with rejection reasons
- [ ] Logs user/entity lookup operations
- [ ] Logs routing decisions
- [ ] Logs processing completion
- [ ] Uses `getErrorMessage()` for error logging
- [ ] No sensitive data in logs
- [ ] Event ID included in all log entries
- [ ] Tests verify logging behavior

### Use Case Logging (Domain Layer)

**REQUIREMENT: All business-critical use cases MUST include comprehensive logging for action tracing.**

Use cases that process important business flows (commands, actions, events, payments, etc.) must log at key decision points to enable full traceability from request to database entry.

#### When to Add Use Case Logging

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

#### Logging Pattern

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

#### What to Log

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

#### Service Integration

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

#### Benefits of Use Case Logging

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

#### Reference Implementations

- `apps/commands-router/src/domain/usecases/processCommand.ts` - Comprehensive command classification logging (13 log points)
- `apps/research-agent/src/domain/usecases/handleResearchAction.ts` - Research action processing

#### Verification Checklist

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

### Firestore Collections

**RULE: Each Firestore collection MUST be owned by exactly ONE service.**

**Verification:** `npm run verify:firestore` (runs automatically in `npm run ci`)

**Registry:** All collections declared in `firestore-collections.json` at repo root.

| Collection                       | Owner                          | Description                              |
| -------------------------------- | ------------------------------ | ---------------------------------------- |
| `notion_connections`             | `notion-service`               | Notion OAuth tokens and connection state |
| `promptvault_settings`           | `promptvault-service`          | Prompt Vault page ID configuration       |
| `whatsapp_messages`              | `whatsapp-service`             | WhatsApp messages with metadata          |
| `whatsapp_user_mappings`         | `whatsapp-service`             | Phone number to user ID mappings         |
| `whatsapp_webhook_events`        | `whatsapp-service`             | Raw webhook events for audit             |
| `mobile_notifications`           | `mobile-notifications-service` | Push notifications from devices          |
| `mobile_notification_signatures` | `mobile-notifications-service` | Device signature to user ID bindings     |
| `user_settings`                  | `user-service`                 | User preferences and encrypted API keys  |
| `auth_tokens`                    | `user-service`                 | Encrypted Auth0 refresh tokens           |
| `researches`                     | `llm-orchestrator`             | LLM research queries and results         |

**Ownership Rules:**

✅ **Allowed:**

- Service directly accesses its OWN collections via `getFirestore()`
- Service exposes internal HTTP endpoints for other services to access data
- Read from service-owned collections only

❌ **Forbidden:**

- Accessing collections owned by other services
- Sharing collections between multiple services
- Cross-service Firestore queries

**Adding New Collections:**

1. Add to `firestore-collections.json`:

   ```json
   {
     "collections": {
       "my_new_collection": {
         "owner": "my-service",
         "description": "What this collection stores"
       }
     }
   }
   ```

2. Access only from owning service:

   ```typescript
   import { getFirestore } from '@intexuraos/infra-firestore';

   const db = getFirestore();
   const collection = db.collection('my_new_collection');
   ```

3. Verify: `npm run verify:firestore`

**Cross-Service Data Access:**

If you need data from another service's collection, use service-to-service HTTP:

```typescript
// ❌ Direct Firestore access (VIOLATION)
const db = getFirestore();
const doc = await db.collection('whatsapp_messages').doc(id).get();

// ✅ Service-to-service HTTP (CORRECT)
const response = await fetch(`${WHATSAPP_SERVICE_URL}/internal/whatsapp/messages/${id}`, {
  headers: { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN },
});
```

**Full documentation:** [docs/architecture/firestore-ownership.md](../docs/architecture/firestore-ownership.md)

---

## Apps (`apps/**`)

### Requirements

| Requirement                     | Verification                                           |
| ------------------------------- | ------------------------------------------------------ |
| OpenAPI spec at `/openapi.json` | `curl http://localhost:PORT/openapi.json` returns JSON |
| Swagger UI at `/docs`           | `curl http://localhost:PORT/docs` returns 200/302      |
| CORS enabled                    | OpenAPI accessible from api-docs-hub                   |
| Terraform module exists         | Check `terraform/environments/dev/main.tf`             |
| Included in api-docs-hub        | Check `apps/api-docs-hub/src/config.ts`                |
| Health endpoint                 | `GET /health` returns 200                              |

**Exception:** api-docs-hub is exempt from `/openapi.json` (it aggregates other specs).

### App Structure

- `src/domain/**` — business logic, models, usecases (no external deps)
- `src/infra/**` — adapters for external services (Firestore, Notion, Auth0)
- `src/routes/**` — HTTP transport layer
- `src/services.ts` — dependency injection container

Routes obtain dependencies via `getServices()`, not direct instantiation:

```ts-example
// ❌ Direct instantiation — blocks tests
const tokenRepo = new FirestoreAuthTokenRepository();

// ✅ Dependency injection — allows fake injection
const tokenRepo = getServices().authTokenRepository;
```

### Firestore Access

Use the singleton from `@intexuraos/infra-firestore`, never instantiate directly:

```ts-example
// ❌ Direct instantiation — creates separate instance
import { Firestore } from '@google-cloud/firestore';
const firestore = new Firestore();

// ✅ Singleton — shared instance, testable via setFirestore()
import { getFirestore } from '@intexuraos/infra-firestore';
const db = getFirestore();
```

Repositories should call `getFirestore()` within methods, not accept Firestore as constructor parameter.

### Secrets

- Use `INTEXURAOS_*` prefix for environment variables
- Access via env vars or Secret Manager

### Environment Variable Validation (MANDATORY)

**FAIL FAST:** Every service MUST validate required environment variables at startup and crash immediately if any are missing.

**Rule:** Validate in service entry point (before starting HTTP server):

```typescript
function validateRequiredEnv(vars: string[]): void {
  const missing = vars.filter((v) => process.env[v] === undefined || process.env[v] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `Ensure these are set in Terraform env_vars or .envrc.local for local development.`
    );
  }
}

// In index.ts (BEFORE starting server)
validateRequiredEnv([
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  // ... all required vars
]);
```

**Why:** Missing environment variables must cause immediate startup failure, not runtime errors after deployment. This prevents:

- Services running in degraded state
- Silent failures in production
- Runtime crashes during request handling
- Debugging environment issues post-deployment

**Deployment:** Services must be created via Terraform FIRST (with all env vars configured) before Cloud Build can deploy updates.

### Validation Best Practices

**Rule:** Validation array MUST match Terraform configuration exactly.

**Verification Process:**

1. Find service Terraform module in `terraform/environments/dev/main.tf`
2. List all keys in `secrets = {}` block
3. List all keys in `env_vars = {}` block
4. Ensure ALL are in `validateRequiredEnv()` array (or Zod schema for whatsapp-service)
5. **CRITICAL:** Verify each variable is ACTUALLY USED in code (search codebase)

**Example:**

Terraform configuration:

```hcl
secrets = {
  AUTH_JWKS_URL         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
  INTERNAL_AUTH_TOKEN   = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
}
env_vars = {
  GOOGLE_CLOUD_PROJECT = var.project_id
  USER_SERVICE_URL     = module.user_service.service_url
}
```

Service validation:

```typescript
validateRequiredEnv([
  'GOOGLE_CLOUD_PROJECT', // from env_vars
  'USER_SERVICE_URL', // from env_vars
  'AUTH_JWKS_URL', // from secrets (uses left-hand key name)
  'INTERNAL_AUTH_TOKEN', // from secrets (uses left-hand key name)
]);
```

**Audit Commands:**

1. **Check what service validates:**

   ```bash
   grep "validateRequiredEnv\|REQUIRED_ENV" apps/service-name/src/index.ts
   ```

2. **Check what Terraform configures:**

   ```bash
   grep -A 20 "module \"service-name\"" terraform/environments/dev/main.tf | grep -E "secrets|env_vars" -A 5
   ```

3. **Verify variable is used in code:**
   ```bash
   grep -r "process.env\['VAR_NAME'\]" apps/service-name/src --include="*.ts" --exclude-dir=__tests__
   ```

**Warning Signs:**

- Variable in Terraform but never accessed in code → **Remove from Terraform**
- Variable used in code but not in Terraform → **Add to Terraform**
- Variable validated at startup but never used → **Remove from validation**

### New Service Checklist

1. Copy structure from existing service (domain/, infra/, routes/)
2. Create Dockerfile with correct workspace deps
3. Add startup validation in index.ts with `validateRequiredEnv()` from `@intexuraos/http-server`
   - Include `GOOGLE_CLOUD_PROJECT` if service uses Firestore
   - Include all required secrets (AUTH\_\*, service-specific vars)
4. Run `npx prettier --write .`
5. Add Terraform module in `terraform/environments/dev/main.tf`
   - Include `GOOGLE_CLOUD_PROJECT = var.project_id` in `env_vars` if service uses Firestore
6. Add service account to IAM module
7. Add OpenAPI URL to `apps/api-docs-hub/src/config.ts`
8. Add project reference to root `tsconfig.json`
9. Add to ESLint `no-restricted-imports` patterns in `eslint.config.js`
10. Run `npm run ci`
11. Run `tf fmt -check -recursive && tf validate`
12. **CRITICAL:** Run `terraform apply` in `terraform/environments/dev/` to create service with env vars BEFORE pushing code
13. Add Cloud Build deployment script in `cloudbuild/scripts/deploy-<service>.sh`
    - Script must check if service exists before deploying (fail if not)
    - Only updates image, does NOT modify env vars/secrets (managed by Terraform)

---

## Packages (`packages/**`)

**Verification:** `npm run ci` (includes `npm run verify:boundaries` and `npm run verify:common`).

### Package Structure

| Package           | Purpose                                 | Dependencies       |
| ----------------- | --------------------------------------- | ------------------ |
| `common-core`     | Result types, error utilities           | none (leaf)        |
| `common-http`     | HTTP response helpers, JWT utilities    | none (leaf)        |
| `http-contracts`  | OpenAPI schemas, Fastify JSON schemas   | none (leaf)        |
| `http-server`     | Health checks, validation error handler | `common-core/http` |
| `infra-firestore` | Firestore client wrapper                | `common-core/http` |
| `infra-notion`    | Notion API client wrapper               | `common-core/http` |
| `infra-whatsapp`  | WhatsApp Business API client            | `common-core/http` |
| `infra-claude`    | Anthropic Claude API client             | `common-core/http` |
| `infra-gemini`    | Google Gemini API client                | `common-core/http` |
| `infra-gpt`       | OpenAI GPT API client                   | `common-core/http` |
| `infra-pubsub`    | GCP Pub/Sub base publisher              | `common-core`      |

### Common Package Rules

| Rule                     | Verification            |
| ------------------------ | ----------------------- |
| No domain-specific logic | `npm run verify:common` |
| No external service deps | Code review             |
| Imports nothing          | ESLint boundaries       |

**`packages/common-core` contains:**

- Result types and utilities (`Result<T, E>`)
- Error message extraction utilities
- Redaction utilities

**`packages/common-http` contains:**

- HTTP response helpers
- JWT/auth utilities

**Forbidden in common packages:**

- Business logic / domain rules
- App-specific code
- External service implementations

### Package Naming

- `@intexuraos/common-core`
- `@intexuraos/common-http`
- `@intexuraos/http-contracts`
- `@intexuraos/http-server`
- `@intexuraos/infra-firestore`
- `@intexuraos/infra-notion`
- `@intexuraos/infra-whatsapp`
- `@intexuraos/infra-claude`
- `@intexuraos/infra-gemini`
- `@intexuraos/infra-gpt`
- `@intexuraos/infra-pubsub`

---

## Pub/Sub Publishers (`packages/infra-pubsub`)

**All Pub/Sub publishers MUST extend `BasePubSubPublisher`.**

### Creating a Publisher

```ts-example
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';

export class MyPublisher extends BasePubSubPublisher {
  constructor(config: { projectId: string; topicName: string }) {
    super({ projectId: config.projectId, loggerName: 'my-publisher' });
    this.topicName = config.topicName;
  }

  async publishMyEvent(event: MyEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { eventId: event.id },  // Context for logging
      'my event'              // Human-readable description
    );
  }
}
```

### Rules

| Rule                                               | Verification            |
| -------------------------------------------------- | ----------------------- |
| Extend `BasePubSubPublisher`                       | `npm run verify:pubsub` |
| Topic from env var                                 | Code review             |
| Use `PublishError` from `@intexuraos/infra-pubsub` | ESLint                  |

### Topic Configuration

**❌ Wrong - hardcoded topic:**

```ts-example
const topicName = 'intexuraos-my-topic-dev';
```

**✅ Correct - from environment:**

```ts-example
const topicName = process.env['INTEXURAOS_PUBSUB_MY_TOPIC'];
```

**Full documentation:** [docs/architecture/pubsub-standards.md](../docs/architecture/pubsub-standards.md)

---

## Terraform (`terraform/**`)

**Verification:**

```bash
tf fmt -check -recursive      # From /terraform
tf validate                   # From /terraform or environment dir
```

### Rules

| Rule                              | Verification               |
| --------------------------------- | -------------------------- |
| Formatted                         | `tf fmt -check -recursive` |
| Valid syntax                      | `tf validate`              |
| No hardcoded secrets              | Manual review              |
| Variables have description + type | `tf validate`              |
| Outputs have description          | `tf validate`              |

### Structure

```
terraform/
├── environments/dev/   # Environment config
├── modules/            # Reusable modules
├── variables.tf        # Input variables
└── outputs.tf          # Outputs
```

### Change Process

1. `tf fmt -recursive`
2. `tf validate`
3. `tf plan` (review before apply)
4. Document in commit message

### Web Hosting Gotcha

When changing `terraform/modules/web-app`:

- Backend buckets do **not** honor GCS `website.main_page_suffix`
- `GET /` will 404 unless the URL map rewrites `/` → `/index.html`

Reference: `docs/architecture/web-app-hosting.md`

### Checklist

- [ ] `tf fmt -check -recursive` passes
- [ ] `tf validate` passes
- [ ] No hardcoded secrets/regions/project IDs
- [ ] Plan reviewed (if environment access available)

---

## Web App (`apps/web/**`)

**Verification:** `npm run ci` from repo root.

### Hosting & Routing (CRITICAL)

The web app is deployed as static assets to GCS and served via HTTP(S) Load Balancer with backend bucket.

**Hash routing required** — backend buckets do NOT support SPA fallback:

```ts-example
// ❌ /notion (will 404 in production)
// ✅ /#/notion (works with HashRouter)
```

**Implementation:** `apps/web/src/App.tsx` uses `HashRouter`.

### Component Architecture

| Location             | Purpose                |
| -------------------- | ---------------------- |
| `src/components/`    | Feature components     |
| `src/components/ui/` | Reusable UI components |
| `src/context/`       | Context providers      |
| `src/hooks/`         | Custom hooks           |
| `src/pages/`         | Route target pages     |
| `src/services/`      | API service clients    |

**Rules:**

- Each file has ONE clear responsibility (SRP)
- Components exceeding ~150 lines should be split
- Avoid prop drilling beyond 2 levels
- All API calls through typed service clients
- Use `useApiClient` hook for authenticated requests

### Authentication

- Use `@auth0/auth0-react` SDK for SPA authentication
- Never store tokens in localStorage directly — SDK handles it
- Protected routes must check `isAuthenticated` from `useAuth`
- Login redirects through Auth0 Universal Login

### Styling

- TailwindCSS for all styling
- No inline style objects
- Color palette: blue primary (`blue-600`), yellow accents (`amber-400`)
- Consistent spacing using Tailwind scale

### Environment Variables

- Exposed to client via `envPrefix: 'INTEXURAOS_'` in Vite
- Access via `import.meta.env.INTEXURAOS_*`
- Extract constants, no magic strings

### Testing Requirements

**Must test:**

- Custom hooks
- Context providers
- API service clients (mocked fetch)
- Page-level user interactions
- Form validation logic

**Coverage:** 80%+ line coverage for hooks and services.

### Web Task Checklist

- [ ] `npm run ci` passes
- [ ] Logic changes have corresponding tests
- [ ] No `any` without documented justification
- [ ] Components are minimal and focused (SRP)
- [ ] New links/routes use hash routing (`/#/...`)

---

## Code Rules

| Rule                                 | Verification            |
| ------------------------------------ | ----------------------- |
| Zero `tsc` errors                    | `npm run typecheck`     |
| Zero ESLint warnings                 | `npm run lint`          |
| Test coverage (see vitest.config.ts) | `npm run test:coverage` |
| ESM only (`import`/`export`)         | `npm run lint`          |
| Explicit return types on exports     | `npm run lint`          |
| No `@ts-ignore`, `@ts-expect-error`  | `npm run lint`          |
| No unused code                       | `npm run lint`          |
| Prettier formatted                   | `npm run format:check`  |
| No `console.log`                     | `npm run lint`          |
| No `any` without justification       | `npm run lint`          |

**After creating or modifying files:** Run `npx prettier --write .` before `npm run ci`.

---

## Protected Files — ABSOLUTE PROHIBITION

| File               | Protected Section     | Reason                                 |
| ------------------ | --------------------- | -------------------------------------- |
| `vitest.config.ts` | `coverage.thresholds` | Coverage thresholds are project policy |
| `vitest.config.ts` | `coverage.exclude`    | Exclusions require justification       |

**ABSOLUTE RULE — NO EXCEPTIONS:**

1. **NEVER** modify `vitest.config.ts` coverage exclusions or thresholds
2. **NEVER** ask for permission to modify them — the answer is always NO
3. **ALWAYS** write tests to achieve coverage instead
4. If coverage fails, write more tests — do not touch exclusions

This rule exists because excluding code from coverage is technical debt that compounds over time.

---

## TypeScript Patterns

**Array access** — `noUncheckedIndexedAccess` returns `T | undefined`:

```ts-example
// ❌ const first = arr[0];
// ✅ const first = arr[0] ?? fallback;
```

**Optional properties** — `exactOptionalPropertyTypes` forbids `undefined`:

```ts-example
// ❌ { optional: condition ? value : undefined }
// ✅ if (condition) { obj.optional = value; }
```

**Non-null assertion** — forbidden:

```ts-example
// ❌ obj.prop!
// ✅ obj.prop as Type (or runtime check)
```

**Strict boolean expressions** — nullable values require explicit checks:

```ts-example
// ❌ {error ? <div>{error}</div> : null}
// ✅ {error !== null && error !== '' ? <div>{error}</div> : null}

// ❌ {status?.connected ? 'Connected' : 'Disconnected'}
// ✅ {status?.connected === true ? 'Connected' : 'Disconnected'}
```

**Explicit return types** — all inline functions must have return types:

```ts-example
// ❌ login: () => { doLogin(); }
// ✅ login: (): void => { doLogin(); }
```

**Template literals** — numbers must be converted:

```ts-example
// ❌ `Found ${items.length} items`
// ✅ `Found ${String(items.length)} items`
```

---

## Code Smells (Fix & Document)

**RULE: When fixing a new code smell not listed here, YOU MUST add it to this section.**

### Error Handling

**Silent catch** — always document why errors are ignored:

```ts-example
// ❌ try { await op(); } catch {}
// ✅ try { await op(); } catch { /* Best-effort cleanup */ }
```

**Inline error extraction** — use utility:

```ts-example
// ❌ error instanceof Error ? error.message : 'Unknown'
// ✅ getErrorMessage(error, 'Unknown Firestore error')
```

**Throw inside try-catch** — don't throw exceptions caught by same block:

```ts-example
// ❌ try { if (bad) throw new Error(); } catch (e) { ... }
// ✅ Separate try-catch from conditional throw
```

### Dependency Injection

**Re-exports from services.ts** — services.ts should only export DI container:

```ts-example
// ❌ export * from './infra/firestore/index.js';  // Bypasses DI
// ✅ Only export getServices, setServices, resetServices, initServices
```

**Module-level mutable state** — pass dependencies explicitly:

```ts-example
// ❌ let logger: Logger | undefined;  // Mutated at runtime
//    getServices() captures via closure
// ✅ Pass logger into factory functions: createAdapter(logger)
```

**Test fallbacks in production** — throw if not initialized:

```ts-example
// ❌ return container ?? { fakeRepo: new FakeRepo() };
// ✅ if (!container) throw new Error('Call initServices() first');
```

### Architecture

**Domain logic in infra layer** — keep domain pure:

```ts-example
// ❌ packages/infra-*/src/client.ts contains maskApiKey()
// ✅ Move to domain layer or common-core
```

**Infra re-exporting domain types** — respect layer boundaries:

```ts-example
// ❌ // infra/firestore/messageRepository.ts
//    export type { WhatsAppMessage } from '../../domain/index.js';
// ✅ Import domain types where needed, don't re-export from infra
```

### Request Logging (Internal Endpoints)

**Inline request logging with manual redaction** — use centralized utility:

**APPLIES TO:** All `/internal/*` endpoints (service-to-service, Pub/Sub push)

```ts-example
// ❌ Manual header redaction (error-prone, duplicated)
try {
  const headersObj = { ...(request.headers as Record<string, unknown>) };
  if (headersObj['x-internal-auth'] !== undefined) {
    headersObj['x-internal-auth'] = '[REDACTED]';
  }
  if (headersObj['authorization'] !== undefined) {
    headersObj['authorization'] = '[REDACTED]';
  }
  request.log.info({ headers: headersObj, bodyPreview: '...' }, 'Message');
} catch { /* Best-effort logging */ }

// ✅ Centralized utility with automatic redaction
import { logIncomingRequest } from '@intexuraos/common-http';

logIncomingRequest(request, {
  message: 'Received request to /internal/endpoint',
  bodyPreviewLength: 200,
  includeParams: true,
});
```

**Why:** Manual redaction creates duplication and risks missing sensitive fields. The utility ensures consistent handling across all services using SENSITIVE_FIELDS from common-core.

### Code Quality

**Redundant variable** — return directly:

```ts-example
// ❌ const result = await fetch(url); return result;
// ✅ return await fetch(url);
```

**Redundant defensive check** — trust TypeScript's type narrowing:

```ts-example
// ❌ After isErr(result), checking !result.ok is redundant
// ✅ Direct access after type guard
```

**Duplicated documentation** — single source of truth:

```ts-example
// ❌ Same doc block in multiple files
// ✅ Canonical location, reference elsewhere
```

### Known Technical Debt (Documented)

**Duplicated OpenAPI schemas** — each server.ts has inline schemas:

```ts-example
// Issue: coreComponentSchemas from http-contracts can't be spread
//        due to Fastify's strict swagger types
// Status: Keep inline until Fastify types improve or custom wrapper created
// Files: apps/*/src/server.ts buildOpenApiOptions()
```

---

## Code Auditing & Consistency

**When to audit:** When implementing a fix or pattern in one service, ALWAYS audit other services for the same issue.

### Audit Process

1. **Identify the Pattern**
   - What issue did you just fix?
   - What pattern should be applied consistently?
   - Which services might have the same issue?

2. **Search Systematically**

   ```bash
   # Find all files with pattern
   grep -r "pattern" apps/*/src --include="*.ts"

   # Find specific route handlers
   grep -r "fastify.post('/internal" apps/*/src/routes

   # Find authentication checks
   grep -r "validateInternalAuth" apps/*/src
   ```

3. **Verify Consistency**
   - Compare implementations across services
   - Check for missing patterns where expected
   - Verify test coverage for the pattern

4. **Apply Fixes Systematically**
   - Fix all instances in a single commit
   - Update tests for all affected services
   - Document the pattern in CLAUDE.md

### Common Audit Scenarios

#### Authentication Patterns

**Example:** Pub/Sub endpoints using wrong authentication detection

```bash
# Find all Pub/Sub push endpoints
grep -r "'/internal/.*/pubsub/" apps/*/src/routes --include="*.ts"

# Check authentication pattern
grep -B5 -A10 "isPubSubPush" apps/*/src/routes/*.ts
```

**What to verify:**

- All Pub/Sub endpoints check `from: noreply@google.com` header
- All have dual-mode auth (Pub/Sub OIDC OR x-internal-auth)
- All log authentication failures with context
- Tests cover both authentication modes

#### Logging Patterns

**Example:** Internal endpoints missing request logging

```bash
# Find all internal endpoints
grep -r "'/internal/" apps/*/src/routes --include="*.ts" -A 20

# Check for logIncomingRequest usage
grep -r "logIncomingRequest" apps/*/src/routes --include="*.ts"
```

**What to verify:**

- All `/internal/*` endpoints use `logIncomingRequest()` at entry
- Logging happens BEFORE authentication check
- Sensitive headers are redacted automatically
- Log messages are descriptive and searchable

#### Dependency Injection

**Example:** Use cases missing logger parameter

```bash
# Find all usecase factory functions
grep -r "createProcessCommandUseCase\|createHandleResearchActionUseCase" apps/*/src/domain/usecases --include="*.ts"

# Check logger parameter
grep -B3 "export function create.*UseCase" apps/*/src/domain/usecases/*.ts | grep "logger"
```

**What to verify:**

- All use cases accept logger in dependencies
- Logger is passed from services.ts
- Test fakes create logger with `level: 'silent'`
- Critical decision points are logged

### Cross-Service Pattern Application

When you fix a pattern in one service, apply it everywhere:

**Step 1: Document the pattern**

```typescript
// ✅ CORRECT PATTERN (apply everywhere)
const fromHeader = request.headers.from;
const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

if (isPubSubPush) {
  // Pub/Sub OIDC auth (validated by Cloud Run)
  request.log.info({ from: fromHeader }, 'Authenticated Pub/Sub push request');
} else {
  // Direct service call auth
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }
}
```

**Step 2: Find all instances**

```bash
# Find services with Pub/Sub endpoints
find apps -name "pubsubRoutes.ts" -o -name "internalRoutes.ts" | xargs grep -l "pubsub"
```

**Step 3: Verify and fix each**

- Read the current implementation
- Compare to the correct pattern
- Apply fix if different
- Update tests to match

**Step 4: Commit atomically**

- All fixes in a single commit
- Clear commit message explaining the pattern
- Reference the original issue/fix

### Debugging with Production Logs

**When issues occur in production:**

1. **Gather logs from Cloud Logging**

   ```bash
   gcloud logging read "resource.labels.service_name=intexuraos-commands-router" \
     --project=intexuraos-dev-pbuchman \
     --limit=50 \
     --format=json
   ```

2. **Identify the failure pattern**
   - What error message appears?
   - What request headers are present?
   - What's the failure rate?
   - Which endpoint is affected?

3. **Reproduce locally with tests**

   ```typescript
   it('handles Pub/Sub push without x-internal-auth', async () => {
     const response = await app.inject({
       method: 'POST',
       url: '/internal/endpoint',
       headers: {
         from: 'noreply@google.com', // Simulate Pub/Sub
       },
       payload: validPayload,
     });

     expect(response.statusCode).toBe(200);
   });
   ```

4. **Fix and verify**
   - Fix the code
   - Add/update tests
   - Run CI locally
   - Deploy and monitor logs

### Verification Checklist

After applying a pattern across services:

- [ ] Pattern applied to ALL affected services
- [ ] Tests updated for ALL affected services
- [ ] `npm run ci` passes
- [ ] Pattern documented in CLAUDE.md (if novel)
- [ ] Commit message references all affected services
- [ ] Deployment verified with production logs

### Example Audit Session

**Context:** Fixed Pub/Sub authentication in commands-router

**Audit steps:**

1. **Search for similar endpoints**

   ```bash
   grep -r "'/internal/.*/pubsub/" apps/*/src/routes --include="*.ts"
   # Found: whatsapp-service, research-agent
   ```

2. **Check current implementation**

   ```bash
   grep -A30 "'/internal/whatsapp/pubsub/" apps/whatsapp-service/src/routes/pubsubRoutes.ts
   # Found: Using wrong header check
   ```

3. **Apply fix systematically**
   - Fixed whatsapp-service (2 endpoints)
   - Fixed research-agent (1 endpoint)
   - Updated all tests with Pub/Sub auth coverage

4. **Verify deployment**
   ```bash
   ./scripts/verify-deployment.sh
   # All services healthy, logs show correct auth
   ```

**Result:** Pattern applied consistently across 3 services, 4 endpoints total.

### Red Flags Requiring Audit

Watch for these patterns that indicate inconsistency:

- **Same functionality, different implementations** → Standardize on one
- **Tests pass but production fails** → Missing test scenario
- **Pattern exists in 80% of services** → Apply to remaining 20%
- **Repeated manual redaction code** → Extract to utility
- **Similar endpoints with different auth** → Verify correct pattern
- **Logging only in some endpoints** → Add to all

### Audit Documentation

When you complete an audit and apply a pattern:

1. **Update CLAUDE.md** with the pattern (if not already documented)
2. **Note the audit in commit message**

   ```
   Fix Pub/Sub authentication across all internal endpoints

   Applied consistent authentication pattern to all Pub/Sub push endpoints:
   - whatsapp-service (2 endpoints)
   - research-agent (1 endpoint)
   - commands-router (2 endpoints)

   All endpoints now check for `from: noreply@google.com` header to detect
   Pub/Sub push vs direct service calls.
   ```

3. **Add to Code Smells section** if it's a recurring anti-pattern

---

## Testing

**No external dependencies.** Tests use in-memory fake repositories.

- Tests do NOT require `gcloud`, Firebase emulator, or cloud connectivity
- All Firestore operations mocked via fake repositories
- All external HTTP calls mocked via `nock`
- Just run `npm run test` — everything is self-contained

### Test File TypeScript Configuration

**Test files have a SEPARATE TypeScript configuration from production code.**

Two tsconfig files:

- `tsconfig.json` — production code only (excludes `__tests__`)
- `tsconfig.tests-check.json` — test files only (type-checking, no emit)

**Key differences:**

| Check                  | Production (`tsconfig.json`) | Tests (`tsconfig.tests-check.json`) |
| ---------------------- | ---------------------------- | ----------------------------------- |
| Command                | `npm run typecheck`          | `npm run typecheck:tests`           |
| Runs in CI             | ✅ Yes                       | ✅ Yes                              |
| Affects `npm run build`| ✅ Yes                       | ❌ No                               |
| Strictness             | Full strict mode             | Full strict mode                    |

**TypeScript errors in test files ARE REAL errors.** Fix them by:

1. Running `npm run typecheck:tests` to see all errors
2. Fixing each error (proper types, imports, mock signatures)
3. Verifying fix with `npm run typecheck:tests` again

**Common test file TypeScript issues:**

```ts-example
// ❌ Mock with wrong signature
const mockFn = vi.fn();  // Returns unknown

// ✅ Mock with explicit type
const mockFn = vi.fn<[], string>().mockReturnValue('result');

// ❌ Type assertion through incompatible type
(createAudit as MockInstance).mockReturnValue(...);

// ✅ Type assertion through unknown
(createAudit as unknown as MockInstance).mockReturnValue(...);

// ❌ Setting optional property to undefined (exactOptionalPropertyTypes)
const obj = { optional: condition ? value : undefined };

// ✅ Conditionally add optional property
const obj: Partial<Type> = {};
if (condition) { obj.optional = value; }
```

**DO NOT modify the main `tsconfig.json` to include test files.** This would:

- Break `npm run build` (test deps like `nock` not in production)
- Add test code to production bundles
- Slow down production type-checking

**Verification:**

```bash
npm run typecheck:tests         # Type-check test files (runs in CI)
npm run typecheck               # Type-check production code
npm run test                    # Run tests (uses esbuild, not tsc)
```

### Common Commands

```bash
npm run test                           # Run all tests
npm run test:watch                     # Watch mode
npm run test:coverage                  # With coverage report
npx vitest path/to/file.test.ts        # Run single test file
npx vitest -t "test name pattern"      # Run tests matching pattern
```

### Test Setup Pattern

```ts-example
import { setServices, resetServices } from '../services.js';
import { FakeRepository } from './fakes.js';

describe('MyRoute', () => {
  let fakeRepo: FakeRepository;

  beforeEach(() => {
    fakeRepo = new FakeRepository();
    setServices({ repository: fakeRepo });
  });

  afterEach(() => {
    resetServices();
  });
});
```

### Test Architecture

| Component                | Test Strategy                                               |
| ------------------------ | ----------------------------------------------------------- |
| Routes (`src/routes/**`) | Integration tests via `app.inject()` with fake repositories |
| Domain (`src/domain/**`) | Unit tests with fake ports                                  |
| Infra (`src/infra/**`)   | Tested indirectly through route integration tests           |

### Coverage Thresholds

Current values in `vitest.config.ts`: lines 95%, branches 95%, functions 95%, statements 95%.

**NEVER modify coverage thresholds or exclusions. Write tests to meet thresholds.**

---

## Git Commits

**Format:**

1. First line: imperative, max 50 chars
2. Second line: empty
3. Body: optional, 1-3 sentences explaining what/why

```
Fix login redirect handling

Added proper redirect URL validation to prevent open redirect vulnerability.
```

**Rules:**

- No emojis, no markdown, no AI references
- If branch matches `^[A-Z]+[0-9]+-(.*)`$, prefix commit with ticket ID

---

## Complex Tasks — Continuity Workflow

For multi-step features or refactoring, use the continuity process:

### Setup

1. Create numbered directory: `continuity/NNN-task-name/`
2. Create files:
   - `INSTRUCTIONS.md` — goal, scope, constraints, success criteria
   - `CONTINUITY.md` — ledger tracking progress and decisions
   - `[tier]-[seq]-[title].md` — individual subtask files

### Subtask Numbering

```
0-0-setup.md       ← Tier 0: diagnostics/setup
1-0-feature-a.md   ← Tier 1: independent deliverables
1-1-feature-b.md
2-0-integration.md ← Tier 2: dependent/integrative work
```

### Ledger (CONTINUITY.md)

Must track:

- Goal and success criteria
- Done / Now / Next status
- Key decisions with reasoning
- Open questions

### Completion

1. Second-to-last task: verify test coverage
2. Archive to `continuity/archive/NNN-task-name/`
3. Only claim complete after archival

---

## API Contracts

### Response Envelopes

**Success:**

```json
{ "success": true, "data": {...}, "diagnostics": { "requestId": "...", "durationMs": 42 } }
```

**Error:**

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "diagnostics": {...} }
```

### Error Codes

| Code               | HTTP | Description                      |
| ------------------ | ---- | -------------------------------- |
| `INVALID_REQUEST`  | 400  | Malformed request                |
| `UNAUTHORIZED`     | 401  | Missing/invalid authentication   |
| `FORBIDDEN`        | 403  | Authenticated but not authorized |
| `NOT_FOUND`        | 404  | Resource does not exist          |
| `CONFLICT`         | 409  | Resource state conflict          |
| `DOWNSTREAM_ERROR` | 502  | External service failure         |
| `INTERNAL_ERROR`   | 500  | Unexpected server error          |
| `MISCONFIGURED`    | 503  | Missing configuration            |

### Required Endpoints (all apps except api-docs-hub)

- `GET /health` — returns health status (no auth required)
- `GET /openapi.json` — OpenAPI spec (no auth required)
- `GET /docs` — Swagger UI (no auth required)

---

## Task Completion

1. Run `npm run ci` — must pass
2. If terraform changed: `tf fmt -check -recursive && tf validate`
3. If CI fails → fix → repeat
4. **If coverage fails → write tests. NEVER modify vitest.config.ts exclusions.**
5. Only when all pass → task complete
