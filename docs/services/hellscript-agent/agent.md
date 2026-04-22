# Hellscript Agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Name      | hellscript-agent                                                                                       |
| Role      | Accumulate user utterances into buffers, generate platform-styled draft documents                      |
| Goal      | Convert unstructured thoughts into versioned markdown drafts with category-aware writing configuration |

## Capabilities

### Impose on Buffer

**Endpoint:** `POST /hellscript/impose`

**When to use:** When you need to send a user utterance to a writing buffer. Creates a new buffer if `bufferId` is omitted. The user's LLM client is resolved per-request via user-service.

**Input Schema:**

```typescript
interface ImposeInput {
  bufferId?: string;   // max 128 chars; omit to create new buffer
  utterance: string;   // 1-10000 chars
  category?: 'threads' | 'linkedin' | 'general';  // required for draft generation
}
```

**Output Schema:**

```typescript
interface ImposeOutput {
  bufferId: string;
  action: string;                  // IntentKind or 'category_required'
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
      kind: 'append_thought' | 'delete_thought' | 'reorder_thoughts' | 'update_draft' | 'fallback_append';
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
  } | null;
}
```

### Get Writing Config

**Endpoint:** `GET /hellscript/writing-config`

**When to use:** When you need to retrieve the user's style instructions across all categories.

**Output Schema:**

```typescript
interface WritingStyleConfig {
  threads: string | null;
  linkedin: string | null;
  general: string | null;
  updatedAt: string;
}
```

### Update Style Instructions

**Endpoint:** `PUT /hellscript/writing-config/:category/style`

**When to use:** When setting or updating style instructions for a specific writing category.

**Input Schema:**

```typescript
interface StyleInput {
  text: string;  // 1-5000 chars
}
```

### Manage Writing Samples

**Endpoints:**

- `GET /hellscript/writing-config/:category/samples` — list samples
- `POST /hellscript/writing-config/:category/samples` — create sample (max 5 per category)
- `PUT /hellscript/writing-config/:category/samples/:sampleId` — update sample
- `DELETE /hellscript/writing-config/:category/samples/:sampleId` — delete sample

**Create/Update Input Schema:**

```typescript
interface SampleInput {
  title: string;  // 1-200 chars
  text: string;   // 1-10000 chars
}
```

**Sample Output Schema:**

```typescript
interface WritingSample {
  id: string;
  category: 'threads' | 'linkedin' | 'general';
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
```

## Constraints

**Do NOT:**

- Send utterances longer than 10,000 characters
- Access buffers belonging to other users (returns 404)
- Create more than 5 writing samples per category (returns 409 CONFLICT)
- Assume draft generation always succeeds — check for `category_required` and error responses
- Use category values other than `threads`, `linkedin`, or `general`

**Requires:**

- Valid Bearer token (JWT) for all endpoints
- User must have a configured LLM client (own Gemini API key or platform fallback key)
- A resolved category (from request body or LLM inference) for draft generation

## Usage Patterns

### Pattern 1: Create and Build a Buffer

```
1. POST /hellscript/impose with utterance only (no bufferId) to create buffer
2. Save returned bufferId
3. POST /hellscript/impose with bufferId + additional utterances
4. Repeat step 3 to accumulate thoughts
```

### Pattern 2: Configure Writing Style

```
1. PUT /hellscript/writing-config/:category/style to set style instructions
2. POST /hellscript/writing-config/:category/samples to add writing samples (up to 5)
3. Repeat for each category you want to configure
```

### Pattern 3: Generate and Iterate on Drafts

```
1. POST /hellscript/impose with utterance like "write the draft" and category field
2. If action is "category_required", re-send with category field
3. If action is "update_draft", draft was created — latestDraftVersionId is returned
4. GET /hellscript/buffers/:id to retrieve draft markdown
5. Add more thoughts, then request another draft for next version
```

### Pattern 4: Workspace Review

```
1. GET /hellscript/buffers to list all user buffers
2. GET /hellscript/buffers/:id for full workspace
3. Inspect state.thoughts, draftVersions, events
```

## Error Handling

| Error Code | Meaning                 | Recovery Action                                                |
| ---------- | ----------------------- | -------------------------------------------------------------- |
| 400        | Invalid request body    | Check utterance length, category validity                      |
| 401        | Unauthorized            | Refresh Bearer token                                           |
| 404        | Buffer/sample not found | Verify ID and ownership                                        |
| 409        | Max samples exceeded    | Delete an existing sample before creating                      |
| 500        | Internal server error   | Retry with backoff; may indicate LLM client resolution failure |

## Events Published

None. Hellscript Agent does not publish Pub/Sub events.

## Dependencies

| Service           | Why Needed                                | Failure Behavior                               |
| ----------------- | ----------------------------------------- | ---------------------------------------------- |
| user-service      | Resolve per-user LLM client               | Returns 500 — impose cannot proceed            |
| llm-usage-service | LLM usage tracking                        | Non-blocking — tracking failure logged only    |
| Firestore         | Buffer, event, draft, config storage      | Request fails with 500                         |
| Gemini            | Intent interpretation                     | Falls back to `fallback_append`                |
| Gemini            | Draft generation                          | Returns `DraftGenerationError`; no draft saved |
