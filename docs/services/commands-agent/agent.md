# Commands Agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Name      | commands-agent                                                                                            |
| Role      | Classify natural language input into typed actions using a structured 5-step LLM prompt                   |
| Goal      | Transform unstructured user messages into typed, actionable commands routed to the right downstream agent |

## Capabilities

### Ingest Command (Pub/Sub path)

**Endpoint:** `POST /internal/commands`

**When to use:** When delivering a `command.ingest` event from Pub/Sub push (primary production path from whatsapp-service)

**Auth:** Pub/Sub OIDC token (validated by Cloud Run) or `X-Internal-Auth` header for direct calls

**Input Schema:**

```typescript
interface PubSubPushBody {
  message: {
    data: string;       // base64-encoded CommandEvent JSON
    messageId: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface CommandEvent {
  type: 'command.ingest';
  userId: string;
  sourceType: 'whatsapp_text' | 'whatsapp_voice' | 'pwa-shared';
  externalId: string;
  text: string;
  summary?: string;    // for voice transcriptions
  timestamp: string;   // ISO 8601
}
```

**Output Schema:**

```typescript
interface IngestCommandOutput {
  success: true;
  data: {
    commandId: string;  // "{sourceType}:{externalId}"
    isNew: boolean;     // false if command already existed (idempotent)
  };
}
```

**Example:**

```json
// message.data is base64 of: {"type":"command.ingest","userId":"auth0|123","sourceType":"whatsapp_text","externalId":"wamid.abc","text":"investigate competitor pricing","timestamp":"2026-03-15T10:00:00Z"}

// Response
{
  "success": true,
  "data": {
    "commandId": "whatsapp_text:wamid.abc",
    "isNew": true
  }
}
```

---

### Create Command (PWA path)

**Endpoint:** `POST /commands`

**When to use:** When the PWA user shares text or a link directly from the web app

**Auth:** `Authorization: Bearer <token>` (Auth0 JWT)

**Input Schema:**

```typescript
interface CreateCommandBody {
  text: string;           // minLength: 1
  source: 'pwa-shared';
  externalId?: string;    // auto-generated if omitted
}
```

**Output Schema:**

```typescript
interface CreateCommandOutput {
  success: true;
  data: {
    command: Command;
  };
}

interface Command {
  id: string;             // "{sourceType}:{externalId}"
  userId: string;
  sourceType: 'whatsapp_text' | 'whatsapp_voice' | 'pwa-shared';
  externalId: string;
  text: string;
  summary?: string;
  timestamp: string;
  status: 'received' | 'classified' | 'pending_classification' | 'failed' | 'archived';
  classification?: CommandClassification;
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface CommandClassification {
  type: 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear' | 'code';
  confidence: number;     // 0–1
  reasoning: string;
  promptVersion: string;  // semver
  classifiedAt: string;
}
```

---

### List Commands

**Endpoint:** `GET /commands`

**When to use:** To retrieve all commands for the authenticated user

**Auth:** `Authorization: Bearer <token>` (Auth0 JWT)

**Output Schema:**

```typescript
interface ListCommandsOutput {
  success: true;
  data: {
    commands: Command[];  // ordered by createdAt desc, limit 100
  };
}
```

---

### Get Command (internal)

**Endpoint:** `GET /internal/commands/:commandId`

**When to use:** When another service needs to look up a command by its composite ID

**Auth:** `X-Internal-Auth` header

**Output Schema:**

```typescript
interface GetCommandInternalOutput {
  success: true;
  data: {
    command: {
      id: string;
      text: string;
      sourceType: string;
    };
  };
}
```

---

### Retry Pending Classifications

**Endpoint:** `POST /internal/retry-pending`

**When to use:** Triggered by Cloud Scheduler to flush commands stuck in `pending_classification`. Can also be called manually after configuring a user's LLM API key.

**Auth:** OIDC token (Cloud Scheduler) or `X-Internal-Auth` header

**Output Schema:**

```typescript
interface RetryPendingOutput {
  success: true;
  data: {
    processed: number;  // successfully classified
    skipped: number;    // LLM client still unavailable
    failed: number;     // classification or action creation errored
    total: number;      // total pending commands found
  };
}
```

---

### Archive Command

**Endpoint:** `PATCH /commands/:commandId`

**When to use:** To mark a classified command as archived after the user has acted on it

**Auth:** `Authorization: Bearer <token>` (Auth0 JWT)

**Input Schema:**

```typescript
interface ArchiveCommandBody {
  status: 'archived';
}
```

**Constraint:** Command must be in `classified` status. Returns 400 otherwise.

---

### Delete Command

**Endpoint:** `DELETE /commands/:commandId`

**When to use:** To permanently remove a command that is unclassified or failed

**Auth:** `Authorization: Bearer <token>` (Auth0 JWT)

**Constraint:** Command must be in `received`, `pending_classification`, or `failed` status. Returns 400 for `classified` commands — use archive instead.

---

## Constraints

**Do NOT:**

- Call `DELETE /commands/:commandId` on classified commands — use `PATCH` with `status: "archived"` instead
- Submit the same `externalId` expecting re-classification — deduplication is by composite key `{sourceType}:{externalId}`; a duplicate returns the existing command with `isNew: false`
- Expect synchronous classification always — if LLM API key is unavailable, the command returns with `status: "pending_classification"` and will be classified on the next retry cycle
- Use fabricated `externalId` values for WhatsApp messages — use the actual WhatsApp message ID to ensure idempotency

**Requires:**

- The `command.ingest` Pub/Sub event must have `type: "command.ingest"` — any other type is rejected with 400
- Bearer tokens must be valid Auth0 JWTs for public endpoints
- Internal calls must include the `X-Internal-Auth` header (unless coming from Pub/Sub or Cloud Scheduler via OIDC)
- `text` field must have at least 1 character

## Usage Patterns

### Pattern 1: WhatsApp Message → Classify → Action

```
1. whatsapp-service receives a WhatsApp message
2. whatsapp-service publishes command.ingest event to Pub/Sub
3. Pub/Sub pushes to POST /internal/commands
4. commands-agent deduplicates by {sourceType}:{externalId}
5. commands-agent classifies via Gemini 2.5 Flash (5-step prompt)
6. commands-agent calls POST /internal/actions on actions-agent
7. commands-agent publishes action.created to INTEXURAOS_PUBSUB_ACTIONS_QUEUE
8. Response: {commandId, isNew: true}
```

### Pattern 2: PWA Share → Classify → Display

```
1. User shares text or link from PWA web app
2. PWA calls POST /commands with source: "pwa-shared"
3. commands-agent classifies and creates action synchronously
4. Response includes fully-populated command with classification
5. PWA displays classification type and confidence to user
```

### Pattern 3: Pending Retry Cycle

```
1. Command arrives but user has no LLM API key configured
2. Command saved with status: "pending_classification"
3. Cloud Scheduler triggers POST /internal/retry-pending
4. retry-pending fetches all pending_classification commands (limit 100)
5. For each: attempt getLlmClient → classify → createAction
6. Success: status → "classified"
   Still no key: skipped (counted in response)
   Error: status → "failed"
```

### Pattern 4: Service Lookup

```
1. Another service needs command text by ID
2. Call GET /internal/commands/{commandId} with X-Internal-Auth
3. Returns {id, text, sourceType} — minimal projection only
```

## Error Handling

| Error Code | Meaning                                | Recovery Action                                                    |
| ---------- | -------------------------------------- | ------------------------------------------------------------------ |
| 400        | Invalid input or lifecycle violation   | Check constraint (e.g., cannot delete classified command)          |
| 401        | Auth failed                            | Refresh bearer token or verify X-Internal-Auth header              |
| 404        | Command not found or not owned by user | Verify commandId format `{sourceType}:{externalId}` and ownership  |
| 500        | Server error                           | Retry with backoff; check Sentry for details                       |

## Classification Types

| Type       | When assigned                                                                             |
| ---------- | ----------------------------------------------------------------------------------------- |
| `todo`     | Explicit task creation instruction, or actionable request                                 |
| `research` | Investigation intent ("investigate", "zbadaj", "how does X work")                         |
| `note`     | Note-taking intent, or fallback when confidence < 0.50                                    |
| `link`     | URL present and no explicit override intent; pwa-shared source gets +0.1 confidence boost |
| `calendar` | Scheduling intent with time reference                                                     |
| `reminder` | Reminder intent ("remind me", "przypomnij mi")                                            |
| `linear`   | Explicit Linear issue tracking intent ("create issue", "report bug")                      |
| `code`     | Engineering task (fix, implement, refactor) not explicitly routing to linear              |

## Events Published

| Event            | Topic env var                     | When                                                | Payload Schema                                                                                               |
| ---------------- | --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `action.created` | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE` | After successful classification and action creation | `{type, actionId, userId, commandId, actionType, title, payload: {prompt, confidence, summary?}, timestamp}` |

## Dependencies

| Service                | Why Needed                                | Failure Behavior                                        |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `user-service`         | Fetch LLM client (API key + model config) | Command set to `pending_classification`; retried later  |
| `actions-agent`        | Create action from classification result  | Command set to `failed` with `failureReason`            |
| `app-settings-service` | LLM pricing data at startup               | Service fails to initialize entirely                    |
| Firestore              | Persist commands                          | Request fails with 500                                  |
| Pub/Sub                | Publish `action.created` event            | Logged as error; command is still marked `classified`   |
