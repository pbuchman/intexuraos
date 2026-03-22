# Hellscript Agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                             |
| --------- | ----------------------------------------------------------------- |
| Name      | hellscript-agent                                                  |
| Role      | Accumulate user utterances into buffers, generate draft documents |
| Goal      | Convert unstructured thoughts into versioned markdown drafts      |

## Capabilities

### Impose on Buffer

**Endpoint:** `POST /hellscript/impose`

**When to use:** When you need to send a user utterance to a writing buffer. Creates a new buffer if `bufferId` is omitted.

**Input Schema:**

```typescript
interface ImposeInput {
  bufferId?: string;   // max 128 chars; omit to create new buffer
  utterance: string;   // 1-10000 chars
}
```

**Output Schema:**

```typescript
interface ImposeOutput {
  bufferId: string;
  action: string;                  // IntentKind or 'update_draft_failed'
  latestDraftVersionId?: string;   // present when action is 'update_draft'
}
```

**Example:**

```json
// Request
{
  "utterance": "The main benefit is reduced latency"
}

// Response
{
  "success": true,
  "data": {
    "bufferId": "abc123",
    "action": "append_thought"
  }
}
```

### List Buffers

**Endpoint:** `GET /hellscript/buffers`

**When to use:** When you need to list all writing buffers for the authenticated user.

**Output Schema:**

```typescript
interface ListBuffersOutput {
  id: string;
  userId: string;
  title: string;
  eventCount: number;
  latestDraftVersionNumber: number | null;
  latestDraftVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}[]
```

### Get Buffer Workspace

**Endpoint:** `GET /hellscript/buffers/:id`

**When to use:** When you need the full state of a buffer including events, draft versions, and materialized state.

**Output Schema:**

```typescript
interface BufferWorkspace {
  buffer: {
    id: string;
    userId: string;
    title: string;
    eventCount: number;
    latestDraftVersionNumber: number | null;
    latestDraftVersionId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  events: Array<{
    id: string;
    bufferId: string;
    rawUtterance: string;
    intent: {
      kind: IntentKind;
      payload: Record<string, unknown>;
      fallbackReason?: string;
    };
    createdAt: string;
  }>;
  draftVersions: Array<{
    id: string;
    bufferId: string;
    versionNumber: number;
    markdown: string;
    requestText: string;
    createdAt: string;
  }>;
  state: {
    thoughts: Array<{ id: string; text: string; addedAt: string }>;
    writingSamples: string[];
    styleInstructions: string | null;
    audience: string | null;
    contentGoal: string | null;
  } | null;
}
```

## Constraints

**Do NOT:**

- Send utterances longer than 10,000 characters
- Access buffers belonging to other users (returns 404)
- Assume draft generation always succeeds — check for `update_draft_failed` action

**Requires:**

- Valid Bearer token (JWT) for all endpoints
- Gemini 2.5 Flash API availability for intent interpretation and draft generation

## Usage Patterns

### Pattern 1: Create and Build a Buffer

```
1. POST /hellscript/impose with utterance only (no bufferId) to create buffer
2. Save returned bufferId
3. POST /hellscript/impose with bufferId + additional utterances
4. Repeat step 3 to accumulate thoughts, samples, style, metadata
```

### Pattern 2: Generate and Iterate on Drafts

```
1. POST /hellscript/impose with utterance like "write the draft"
2. Check response action — if "update_draft", draft was created
3. If "update_draft_failed", retry or add more thoughts first
4. GET /hellscript/buffers/:id to retrieve draft markdown
5. Add more thoughts, then request another draft for next version
```

### Pattern 3: Workspace Review

```
1. GET /hellscript/buffers to list all user buffers
2. GET /hellscript/buffers/:id for full workspace
3. Inspect state.thoughts, draftVersions, events
```

## Error Handling

| Error Code | Meaning               | Recovery Action                          |
| ---------- | --------------------- | ---------------------------------------- |
| 400        | Invalid request body  | Check utterance length (1-10000 chars)   |
| 401        | Unauthorized          | Refresh Bearer token                     |
| 404        | Buffer not found      | Verify buffer ID and ownership           |
| 500        | Internal server error | Retry with backoff                       |

## Events Published

None. Hellscript Agent does not publish Pub/Sub events.

## Dependencies

| Service          | Why Needed                            | Failure Behavior                               |
| ---------------- | ------------------------------------- | ---------------------------------------------- |
| Firestore        | Buffer, event, and draft persistence  | Request fails with 500                         |
| Gemini 2.5 Flash | Intent interpretation                 | Falls back to `fallback_append`                |
| Gemini 2.5 Flash | Draft generation                      | Returns `update_draft_failed`; state preserved |
