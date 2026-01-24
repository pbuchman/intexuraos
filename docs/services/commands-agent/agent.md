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

### Tools (Endpoints)

```typescript
interface CommandsAgentTools {
  // List commands for authenticated user
  listCommands(): Promise<{ commands: Command[] }>;

  // Create command from shared text/link
  createCommand(params: {
    text: string;
    source: 'pwa-shared';
    externalId?: string;
  }): Promise<{ command: Command }>;

  // Delete unclassified command (received/pending/failed only)
  deleteCommand(commandId: string): Promise<void>;

  // Archive classified command
  archiveCommand(commandId: string, params: { status: 'archived' }): Promise<{ command: Command }>;
}
```

### Types

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
  | 'linear';

interface Classification {
  type: ClassificationType;
  confidence: number; // 0.0-1.0
  reasoning: string;
  classifiedAt: string; // ISO 8601
}

interface Command {
  id: string; // {sourceType}:{externalId}
  userId: string;
  sourceType: SourceType;
  externalId: string;
  text: string;
  summary?: string; // For voice transcriptions
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
| **Classification**      | Automatic via Gemini 2.5 Flash, GLM-4.7, or GLM-4.7-Flash (user's configured LLM) |
| **Idempotency**         | Commands keyed by {sourceType}:{externalId}; duplicates return existing command   |

---

## Classification Pipeline (v2.0.0)

The LLM prompt executes a 5-step decision tree in strict order:

```
Step 1: Explicit Prefix Override
  "linear: buy groceries" → linear (user override)
  "do lineara: fix bug" → linear (Polish)
        ↓ (no match)
Step 2: Explicit Intent Detection (HIGH PRIORITY)
  "save bookmark https://research-world.com" → link
  "research this https://example.com" → research
  "zbadaj" (Polish) → research
        ↓ (no match)
Step 3: Linear Detection
  "bug: mobile menu broken" → linear
  "create linear issue" → linear
        ↓ (no match)
Step 4: URL Presence Check
  "https://research-tools.com" → link
  (keywords in URLs IGNORED)
        ↓ (no URL)
Step 5: Category Detection (Fallback)
  "meeting tomorrow at 3pm" → calendar
  "remind me about X" → reminder
  "how does OAuth work?" → research
  "meeting notes: discussed X" → note
  "buy groceries" → todo (default)
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
// → type: link, confidence: 0.90+
```

### Override classification with explicit intent

```typescript
const { command } = await createCommand({
  text: 'research this https://competitor.io',
  source: 'pwa-shared',
});
// → type: research (Step 2 explicit intent overrides Step 4 URL presence)
```

### Use Polish command phrases

```typescript
const { command } = await createCommand({
  text: 'zapisz link https://example.com',
  source: 'pwa-shared',
});
// → type: link, confidence: 0.90+
```

### List and filter commands

```typescript
const { commands } = await listCommands();
const pendingCommands = commands.filter((c) => c.status === 'pending_classification');
```

---

## Internal Endpoints

| Method | Path                            | Purpose                                   |
| ------ | ------------------------------- | ----------------------------------------- |
| POST   | `/internal/commands`            | Ingest command from Pub/Sub (WhatsApp)    |
| POST   | `/internal/retry-pending`       | Retry pending classifications (Scheduler) |
| GET    | `/internal/commands/:commandId` | Get command for internal processing       |

---

## Event Flow

```
whatsapp-service → Pub/Sub (command.ingest) → /internal/commands → commands-agent
                                                                        ↓
                                                              5-step LLM Classification
                                                                        ↓
                                                              actions-agent (create action)
                                                                        ↓
                                                              Pub/Sub (action.created)
                                                                        ↓
                                                              Agent handlers (research, todos, etc.)
```

---

## Supported Languages

| Language | Explicit Prefix       | Explicit Intent Phrases              |
| -------- | --------------------- | ------------------------------------ |
| English  | linear:, todo:, note: | save bookmark, create todo, research |
| Polish   | do lineara, zadanie   | zapisz link, stwórz zadanie, zbadaj  |

---

**Last updated:** 2026-01-24
