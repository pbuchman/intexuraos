# chat-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with chat-agent.

---

## Identity

| Field    | Value                                                                   |
| -------- | ----------------------------------------------------------------------- |
| **Name** | chat-agent                                                              |
| **Role** | In-App AI Assistant                                                     |
| **Goal** | Answer documentation questions and create commands via natural language |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ChatAgentTools {
  // Send a chat message and receive a RAG-powered response
  chat(params: {
    message: string;
    conversationHistory?: ConversationHistory[];
    pendingAction?: SuggestedAction | null;
  }): Promise<ChatResponse>;
}
```

### chat

**Endpoint:** `POST /chat`

**When to use:** When a user asks a question about IntexuraOS documentation, needs help understanding an API, or wants to create a command through conversation.

**Input:**

```typescript
interface ChatInput {
  /** The user's message (min 1 character, trimmed) */
  message: string;
  /** Previous conversation messages for context (max 20 used) */
  conversationHistory?: ConversationHistory[];
  /** Pending action from a previous response, for confirmation flow */
  pendingAction?: SuggestedAction | null;
}

interface ConversationHistory {
  role: 'user' | 'assistant';
  content: string;
}

interface SuggestedAction {
  type: 'create_command';
  payload: Record<string, unknown>;
  awaitingConfirmation: boolean;
}
```

**Output:**

```typescript
interface ChatResponse {
  /** The assistant's response text */
  response: string;
  /** Documentation sources cited in the response */
  sources: DocSource[];
  /** Proposed command action, or null if none */
  suggestedAction: SuggestedAction | null;
}

interface DocSource {
  /** Path to the source document */
  filePath: string;
  /** Section heading within the document */
  section: string;
}
```

**Example — documentation question:**

```json
// Request
{
  "message": "How do I create a bookmark with tags?"
}

// Response
{
  "success": true,
  "data": {
    "response": "To create a bookmark with tags, send a POST request to /bookmarks with...",
    "sources": [
      { "filePath": "docs/services/bookmarks-agent/API.md", "section": "POST /bookmarks" }
    ],
    "suggestedAction": null
  }
}
```

**Example — command creation:**

```json
// Request
{
  "message": "Create a todo to buy groceries"
}

// Response
{
  "success": true,
  "data": {
    "response": "I'll create a todo: 'buy groceries'. Shall I create this for you?",
    "sources": [],
    "suggestedAction": {
      "type": "create_command",
      "payload": { "text": "buy groceries", "source": "pwa-shared" },
      "awaitingConfirmation": true
    }
  }
}
```

**Example — confirm action:**

```json
// Request
{
  "message": "yes",
  "pendingAction": {
    "type": "create_command",
    "payload": { "text": "buy groceries", "source": "pwa-shared" },
    "awaitingConfirmation": true
  }
}

// Response
{
  "success": true,
  "data": {
    "response": "Done! I've created the todo 'buy groceries'.",
    "sources": [],
    "suggestedAction": {
      "type": "create_command",
      "payload": { "text": "buy groceries", "source": "pwa-shared" },
      "awaitingConfirmation": false
    }
  }
}
```

---

## Constraints

### Do NOT

- Send empty messages (returns `INVALID_REQUEST`)
- Send more than 100 guest messages per hour per session (returns `RATE_LIMITED`)
- Expect the service to store conversation history (stateless; client manages history)
- Assume suggested actions are executed by the service (client must execute after confirmation)
- Send requests without authentication or guest session header (returns `UNAUTHORIZED`)

### Requires

- **Authenticated users:** Valid JWT Bearer token in `Authorization` header
- **Guest users:** `x-guest-session` header with a non-empty session ID string
- **LLM availability:** user-service must be reachable for authenticated users
- **Indexed documentation:** `doc_embeddings` collection must contain data for relevant answers

---

## Usage Patterns

### Pattern 1: Single Question

Send a message, receive answer with sources. No follow-up needed.

```
POST /chat { message: "What endpoints does the notes agent have?" }
```

### Pattern 2: Multi-Turn Conversation

Build up `conversationHistory` across messages for contextual follow-ups.

```
POST /chat { message: "Tell me about the research agent" }
POST /chat { message: "How does it handle multiple sources?", conversationHistory: [...] }
POST /chat { message: "What about error handling?", conversationHistory: [...] }
```

### Pattern 3: Command Creation Flow

1. User requests command -> response includes `suggestedAction` with `awaitingConfirmation: true`
2. Pass `suggestedAction` as `pendingAction` with affirmative message
3. Response returns same action with `awaitingConfirmation: false`
4. Client reads the confirmed action and executes command creation

### Pattern 4: Guest Trial

Use `x-guest-session` header instead of JWT. Runs on platform-provided Gemini 2.5 Flash. Authenticated users also default to Gemini 2.5 Flash. Limited to 100 messages/hour/session for guests.

```
POST /chat
Headers: { "x-guest-session": "uuid-or-random-string" }
Body: { "message": "What can IntexuraOS do?" }
```

---

## Error Handling

| HTTP | Code               | Meaning                                  | Recovery                                |
| ---- | ------------------ | ---------------------------------------- | --------------------------------------- |
| 400  | `INVALID_REQUEST`  | Empty message or malformed body          | Validate input before sending           |
| 401  | `UNAUTHORIZED`     | No JWT and no guest session header       | Add authentication                      |
| 429  | `RATE_LIMITED`     | Guest session exceeded 100 messages/hour | Wait for the time specified in message  |
| 502  | `DOWNSTREAM_ERROR` | LLM provider or user-service failure     | Retry after delay; check service health |

---

## Events Published

Chat-agent does not publish any Pub/Sub events. All interactions are synchronous request-response over HTTP.
