# commands-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with commands-agent.

---

## Identity

| Field    | Value                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| **Name** | commands-agent                                                                               |
| **Role** | AI Intent Classifier                                                                         |
| **Goal** | Classify natural language input into action types using structured 5-step LLM classification |

---

## Capabilities

### Create Command

**Endpoint:** `POST /commands`

**When to use:** When a user submits text or a shared link from the PWA and you need it classified into an action type.

**Input Schema:**

```typescript
interface CreateCommandInput {
  text: string;           // The command text to classify (min 1 char)
  source: 'pwa-shared';  // Source identifier
  externalId?: string;    // Optional dedup key (auto-generated if omitted)
}
```

**Output Schema:**

```typescript
interface CreateCommandOutput {
  command: Command;
}
```

**Example:**

```json
// Request
{
  "text": "Fix the login bug in auth module",
  "source": "pwa-shared"
}

// Response
{
  "success": true,
  "data": {
    "command": {
      "id": "pwa-shared:1706097600000-abc123",
      "userId": "user-123",
      "sourceType": "pwa-shared",
      "status": "classified",
      "classification": {
        "type": "code",
        "confidence": 0.92,
        "reasoning": "Programming-related command: fix bug",
        "promptVersion": "2.0.0",
        "classifiedAt": "2026-02-22T10:00:00.000Z"
      },
      "actionId": "action-uuid"
    }
  }
}
```

### List Commands

**Endpoint:** `GET /commands`

**When to use:** When you need to retrieve all commands for the authenticated user (ordered by creation time, descending, max 100).

**Input Schema:** None (uses Bearer token for user identification)

**Output Schema:**

```typescript
interface ListCommandsOutput {
  commands: Command[];
}
```

### Delete Command

**Endpoint:** `DELETE /commands/:commandId`

**When to use:** When removing a command that has not been classified yet (status: received, pending_classification, or failed).

**Input Schema:** Command ID in URL path

**Output Schema:**

```typescript
interface DeleteCommandOutput {} // Empty object on success
```

### Archive Command

**Endpoint:** `PATCH /commands/:commandId`

**When to use:** When soft-deleting a classified command. Only works for commands with status `classified`.

**Input Schema:**

```typescript
interface ArchiveCommandInput {
  status: 'archived';
}
```

**Output Schema:**

```typescript
interface ArchiveCommandOutput {
  command: Command;
}
```

---

## Types

```typescript
type SourceType = 'whatsapp_text' | 'whatsapp_voice' | 'pwa-shared';

type CommandStatus = 'received' | 'classified' | 'pending_classification' | 'failed' | 'archived';

type ClassificationType =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'linear'
  | 'code';

interface Classification {
  type: ClassificationType;
  confidence: number;      // 0.0-1.0
  reasoning: string;
  promptVersion: string;   // semver of the prompt that produced this result
  classifiedAt: string;    // ISO 8601
}

interface Command {
  id: string;              // {sourceType}:{externalId}
  userId: string;
  sourceType: SourceType;
  externalId: string;
  text: string;
  summary?: string;        // For voice transcriptions
  timestamp: string;
  status: CommandStatus;
  classification?: Classification;
  actionId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Constraints

| Rule                    | Description                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- |
| **Delete Restriction**  | Can only delete commands with status: received, pending_classification, or failed |
| **Archive Restriction** | Can only archive commands with status: classified                                 |
| **Source Types**        | Create endpoint only supports 'pwa-shared' source; WhatsApp uses Pub/Sub          |
| **Classification**      | Automatic via Gemini 2.5 Flash (default), GLM-4.7, or GLM-4.7-Flash               |
| **Idempotency**         | Commands keyed by {sourceType}:{externalId}; duplicates return existing command   |
| **Title Limit**         | Classification titles are capped at 200 characters by Zod schema validation       |

---

## Classification Pipeline (v2.0.0+)

The LLM prompt executes a 5-step decision tree in strict order:

```
Step 1: Explicit Prefix Override
  "linear: buy groceries" -> linear (user override)
  "do lineara: fix bug" -> linear (Polish)
        | (no match)
Step 2: Explicit Intent Detection (HIGH PRIORITY)
  "save bookmark https://research-world.com" -> link
  "research this https://example.com" -> research
  "create issue for auth bug" -> linear (explicit "create issue")
  "fix the login bug" -> code (engineering task, not explicit tracking)
  "zbadaj" (Polish) -> research
  NOTE: linear requires explicit "linear"/"issue"/"track" language;
        code is the default for all other engineering tasks
        | (no match)
Step 3: Code Detection (Engineering Task Fallback)
  "implement dark mode" -> code (engineering task, no explicit intent)
  "refactor auth module" -> code
        | (no match)
Step 4: URL Presence Check
  "https://research-tools.com" -> link
  (keywords in URLs IGNORED)
        | (no URL)
Step 5: Category Detection (Fallback)
  "meeting tomorrow at 3pm" -> calendar
  "remind me about X" -> reminder
  "how does OAuth work?" -> research
  "meeting notes: discussed X" -> note
  "fix the login bug" -> code
  "buy groceries" -> todo (default)
```

---

## Confidence Semantics

| Range     | Meaning                                         | Example                |
| --------- | ----------------------------------------------- | ---------------------- |
| 0.90+     | Clear match (explicit prefix, multiple signals) | "linear: fix auth bug" |
| 0.70-0.90 | Strong match (single clear signal)              | "bug in mobile menu"   |
| 0.50-0.70 | Choosing between 2-3 plausible categories       | "remember the meeting" |
| <0.50     | Genuinely uncertain, defaults to note           | "abc123"               |

---

## Usage Patterns

### Create command from PWA share

```typescript
const { command } = await createCommand({
  text: 'Check out https://example.com/article',
  source: 'pwa-shared',
});
// -> type: link, confidence: 0.90+
```

### Override classification with explicit intent

```typescript
const { command } = await createCommand({
  text: 'research this https://competitor.io',
  source: 'pwa-shared',
});
// -> type: research (Step 2 explicit intent overrides Step 4 URL presence)
```

### Use Polish command phrases

```typescript
const { command } = await createCommand({
  text: 'zapisz link https://example.com',
  source: 'pwa-shared',
});
// -> type: link, confidence: 0.90+
```

### List and filter commands

```typescript
const { commands } = await listCommands();
const pendingCommands = commands.filter((c) => c.status === 'pending_classification');
```

---

## Internal Endpoints

| Method | Path                            | Purpose                                   | Auth                           |
| ------ | ------------------------------- | ----------------------------------------- | ------------------------------ |
| POST   | `/internal/commands`            | Ingest command from Pub/Sub (WhatsApp)    | Pub/Sub OIDC or internal token |
| POST   | `/internal/retry-pending`       | Retry pending classifications (Scheduler) | OIDC or internal token         |
| GET    | `/internal/commands/:commandId` | Get command for internal processing       | Internal token                 |

---

## Event Flow

```
whatsapp-service -> Pub/Sub (command.ingest) -> /internal/commands -> commands-agent
                                                                        |
                                                              5-step LLM Classification
                                                                        |
                                                              actions-agent (create action)
                                                                        |
                                                              Pub/Sub (action.created)
                                                                        |
                                                              Agent handlers (research, todos, etc.)
```

---

## Error Handling

| Error Code | Meaning                    | Recovery Action                              |
| ---------- | -------------------------- | -------------------------------------------- |
| 400        | Invalid input / bad state  | Fix request payload or check command status  |
| 401        | Unauthorized               | Refresh Bearer token or fix internal auth    |
| 404        | Command not found          | Verify command ID and user ownership         |
| 500        | Server error               | Retry with backoff; check service logs       |

---

## Supported Languages

| Language | Explicit Prefix       | Explicit Intent Phrases              |
| -------- | --------------------- | ------------------------------------ |
| English  | linear:, todo:, note: | save bookmark, create todo, research |
| Polish   | do lineara, zadanie   | zapisz link, stworz zadanie, zbadaj  |

---

**Last updated:** 2026-03-07
