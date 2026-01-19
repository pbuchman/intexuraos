# commands-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with commands-agent.

---

## Identity

| Field | Value |
| ----- | ----- |
| **Name** | commands-agent |
| **Role** | AI Intent Classifier |
| **Goal** | Classify natural language input into action types using Gemini LLM |

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
  }): Promise<{ command: Command }>;

  // Delete unclassified command
  deleteCommand(commandId: string): Promise<void>;

  // Archive classified command
  archiveCommand(commandId: string, params: {
    status: 'archived';
  }): Promise<{ command: Command }>;
}
```

### Types

```typescript
type SourceType = 'whatsapp_text' | 'whatsapp_voice' | 'pwa-shared';

type CommandStatus =
  | 'received'
  | 'classified'
  | 'pending_classification'
  | 'failed'
  | 'archived';

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
  confidence: number;
  reasoning: string;
  classifiedAt: string;
}

interface Command {
  id: string;
  userId: string;
  sourceType: SourceType;
  externalId: string;
  text: string;
  timestamp: string;
  status: CommandStatus;
  classification?: Classification;
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Constraints

| Rule | Description |
| ---- | ----------- |
| **Delete Restriction** | Can only delete commands with status: received, pending_classification, or failed |
| **Archive Restriction** | Can only archive commands with status: classified |
| **Source Types** | Create endpoint only supports 'pwa-shared' source |
| **Classification** | Automatic via Gemini 2.5 Flash or GLM-4.7 |

---

## Usage Patterns

### Create Command from PWA Share

```typescript
const { command } = await createCommand({
  text: 'Check out this article https://example.com/article',
  source: 'pwa-shared',
});
// Command will be auto-classified and action created
```

### List and Filter Commands

```typescript
const { commands } = await listCommands();
const pendingCommands = commands.filter(
  (c) => c.status === 'pending_classification'
);
```

### Archive Processed Command

```typescript
await archiveCommand(commandId, { status: 'archived' });
```

---

## Classification Output

When a command is classified, the LLM returns:

```json
{
  "type": "research",
  "confidence": 0.92,
  "reasoning": "User is asking a question that requires multi-source research",
  "extractedData": {
    "title": "Implications of quantum computing",
    "modelPreference": "gemini-2.5-pro"
  }
}
```

---

## Internal Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/internal/commands` | Create command from whatsapp-service |
| GET | `/internal/commands/:id` | Get command for internal processing |

---

## Event Flow

```
whatsapp-service → /internal/commands → commands-agent
                                            ↓
                                    Gemini Classification
                                            ↓
                                    actions-agent (create action)
```

---

**Last updated:** 2026-01-19
