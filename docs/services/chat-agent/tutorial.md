# Chat Agent — Getting Started

**Time estimate:** 20 minutes
**Prerequisites:** Running IntexuraOS locally (`pnpm dev`), valid JWT token or guest session ID
**Outcomes:** Send a chat message, receive a RAG-powered response, create a command through conversation

---

## Part 1: Hello World — Send Your First Message

The simplest interaction: send a message as a guest user and get a response.

### Step 1: Start the service

```bash
pnpm dev --filter @intexuraos/chat-agent
```

The service starts on port 8129 locally.

### Step 2: Send a guest message

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: tutorial-session-1" \
  -d '{"message": "What is IntexuraOS?"}' | jq
```

### Expected response

```json
{
  "success": true,
  "data": {
    "response": "IntexuraOS is a personal productivity platform...",
    "sources": [
      {
        "filePath": "docs/overview.md",
        "section": "What is IntexuraOS"
      }
    ],
    "suggestedAction": null
  }
}
```

The assistant searches indexed documentation, builds context from matching chunks, and generates a response. The `sources` array tells you where the information came from.

---

## Part 2: Create a Command Through Conversation

The assistant can propose commands. Here you trigger the command creation flow.

### Step 1: Ask for command creation

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: tutorial-session-1" \
  -d '{"message": "Create a todo to review the quarterly report"}' | jq
```

The response includes a `suggestedAction` with `awaitingConfirmation: true`:

```json
{
  "success": true,
  "data": {
    "response": "I'll create a todo: 'review the quarterly report'. Shall I create this for you?",
    "sources": [],
    "suggestedAction": {
      "type": "create_command",
      "payload": { "text": "review the quarterly report", "source": "pwa-shared" },
      "awaitingConfirmation": true
    }
  }
}
```

### Step 2: Confirm the action

Pass the `suggestedAction` back as `pendingAction` with an affirmative message:

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: tutorial-session-1" \
  -d '{
    "message": "yes",
    "pendingAction": {
      "type": "create_command",
      "payload": { "text": "review the quarterly report", "source": "pwa-shared" },
      "awaitingConfirmation": true
    }
  }' | jq
```

The response confirms the action with `awaitingConfirmation: false`:

```json
{
  "data": {
    "suggestedAction": {
      "type": "create_command",
      "payload": { "text": "review the quarterly report", "source": "pwa-shared" },
      "awaitingConfirmation": false
    }
  }
}
```

The client application reads this and executes the command creation.

---

## Part 3: Handle Errors

### Empty message

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: tutorial-session-1" \
  -d '{"message": "   "}' | jq
```

Returns 400:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Message cannot be empty"
  }
}
```

### No authentication

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}' | jq
```

Returns 401:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required or guest session ID missing"
  }
}
```

### Rate limit exceeded

After 100 messages in one hour from the same guest session, further requests return 429:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again in 45 minutes."
  }
}
```

---

## Part 4: Authenticated User Flow

Authenticated users get their own LLM client based on user-service preferences (model selection, API keys).

### Step 1: Obtain a JWT token

Get a token from your Auth0 configuration or use the test credentials in your development environment.

### Step 2: Send an authenticated message

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "message": "How do I use the bookmarks agent API?",
    "conversationHistory": []
  }' | jq
```

The response uses the user's configured LLM model — defaulting to Gemini 2.5 Flash for new users.

### Step 3: Follow-up question with history

```bash
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "message": "Can I add tags when creating one?",
    "conversationHistory": [
      { "role": "user", "content": "How do I use the bookmarks agent API?" },
      { "role": "assistant", "content": "The bookmarks agent provides CRUD endpoints..." }
    ]
  }' | jq
```

The assistant uses conversation history to understand "one" refers to a bookmark.

---

## Troubleshooting

| Symptom                                 | Cause                                   | Fix                                                    |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| 401 on every request                    | Missing both JWT and `x-guest-session`  | Add `Authorization` header or `x-guest-session` header |
| 502 DOWNSTREAM_ERROR                    | user-service unreachable or LLM failure | Check user-service is running; verify LLM API keys     |
| Empty sources array                     | No indexed docs match the query         | Ensure `doc_embeddings` collection has data            |
| Service fails to start                  | `app-settings-service` unreachable      | Start app-settings-service first                       |
| `INTEXURAOS_OPENAI_APP_API_KEY` missing | `.envrc` not sourced                    | Run `direnv allow` or source `.envrc` manually         |
| suggestedAction always null             | LLM not outputting action annotations   | Check system prompt is correctly loaded                |
| Rate limit hit immediately              | Instance restarted (in-memory limiter)  | Expected behavior; limiter resets on restart           |

---

## Exercises

### Easy: Check the health endpoint

Call `GET /health` and verify the response includes Firestore and secrets checks.

<details>
<summary>Solution</summary>

```bash
curl -s http://localhost:8129/health | jq
```

Expected: `status` is `ok` with checks array containing `firestore` and `secrets` entries.

</details>

### Medium: Multi-turn conversation

Send three messages in sequence, building conversation history each time, and verify the assistant maintains context.

<details>
<summary>Solution</summary>

```bash
# Message 1
RESP1=$(curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: exercise-session" \
  -d '{"message": "What is the todos agent?"}')

echo "$RESP1" | jq .data.response

# Message 2 - with history
RESP2=$(curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: exercise-session" \
  -d '{
    "message": "How do I create one with items?",
    "conversationHistory": [
      {"role": "user", "content": "What is the todos agent?"},
      {"role": "assistant", "content": '"$(echo "$RESP1" | jq -r .data.response | jq -Rs .)"'}
    ]
  }')

echo "$RESP2" | jq .data.response

# Message 3 - create command
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: exercise-session" \
  -d '{
    "message": "Create a todo to plan the team offsite",
    "conversationHistory": [
      {"role": "user", "content": "What is the todos agent?"},
      {"role": "assistant", "content": "The todos agent manages tasks..."},
      {"role": "user", "content": "How do I create one with items?"},
      {"role": "assistant", "content": "Use POST /todos with an items array..."}
    ]
  }' | jq
```

</details>

### Hard: Explore the OpenAPI spec and test every error path

Fetch the OpenAPI spec, identify all documented error codes, and trigger each one.

<details>
<summary>Solution</summary>

```bash
# 1. Get the OpenAPI spec
curl -s http://localhost:8129/openapi.json | jq '.paths["/chat"].post.responses'

# 2. Trigger 400 - empty message
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: error-test" \
  -d '{"message": "   "}' | jq .error.code
# Expected: INVALID_REQUEST

# 3. Trigger 400 - missing message field
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: error-test" \
  -d '{"conversationHistory": []}' | jq

# 4. Trigger 401 - no auth
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}' | jq .error.code
# Expected: UNAUTHORIZED

# 5. Trigger 400 - invalid conversation history role
curl -s http://localhost:8129/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-guest-session: error-test" \
  -d '{"message": "test", "conversationHistory": [{"role": "invalid", "content": "x"}]}' | jq
```

</details>
