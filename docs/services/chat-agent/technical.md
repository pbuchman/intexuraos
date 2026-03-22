# Chat Agent — Technical Reference

## Overview

Chat-agent is the in-app AI assistant for IntexuraOS. It combines Retrieval-Augmented Generation (RAG) with conversational LLM capabilities to answer documentation questions, explain APIs, and create commands on behalf of users. Runs on Cloud Run with auto-scaling, uses Firestore vector search for semantic document retrieval, and supports both authenticated and guest sessions. OpenTelemetry instrumentation via `@intexuraos/infra-otel` is loaded as a Node.js preload module (`--import ./dist/otel-register.js`), exporting traces, metrics, and logs to Dash0 when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is configured.

## Architecture

```mermaid
graph TB
    subgraph "External"
        WebApp[Web App / PWA]
        Guest[Guest Users]
    end

    subgraph "chat-agent"
        Routes[Fastify Routes]
        Auth[Auth / tryAuth]
        RateLimit[Guest Rate Limiter]
        GenResponse[generateResponse]
        SearchDocs[searchDocumentation]
        ChatClient[Chat Client Factory]
    end

    subgraph "Dependencies"
        Firestore[(Firestore<br/>doc_embeddings)]
        OpenAI[OpenAI<br/>Embeddings API]
        UserService[user-service]
        AppSettings[app-settings-service]
        LLM[LLM Provider<br/>Gemini 2.5 Flash]
    end

    WebApp --> Routes
    Guest --> Routes
    Routes --> Auth
    Routes --> RateLimit
    Routes --> GenResponse
    GenResponse --> SearchDocs
    GenResponse --> ChatClient
    SearchDocs --> OpenAI
    SearchDocs --> Firestore
    ChatClient --> LLM
    Routes --> UserService
    Routes --> AppSettings

    classDef service fill:#e1f5ff
    classDef storage fill:#fff4e6
    classDef external fill:#f0f0f0

    class Routes,Auth,RateLimit,GenResponse,SearchDocs,ChatClient service
    class Firestore storage
    class WebApp,Guest,LLM,OpenAI external
```

## Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant API as chat-agent
    participant UserSvc as user-service
    participant OpenAI as OpenAI Embeddings
    participant Firestore as Firestore (doc_embeddings)
    participant LLM as LLM Provider

    Client->>+API: POST /chat { message, conversationHistory }
    alt Authenticated User
        API->>UserSvc: getLlmClient(userId)
        UserSvc-->>API: LlmGenerateClient
    else Guest User
        API->>API: Check x-guest-session header
        API->>API: Rate limit check
    end
    API->>OpenAI: Generate embedding for message
    OpenAI-->>API: 1536-dim vector
    API->>Firestore: findNearest(vector, limit=5)
    Firestore-->>API: DocChunkWithScore[]
    API->>API: Build RAG context + system prompt
    API->>LLM: Generate response (prompt + context + history)
    LLM-->>API: Response text + optional action
    API-->>-Client: { response, sources[], suggestedAction }
```

## Recent Changes

| Hash       | Description                                                       | Date       |
| ---------- | ----------------------------------------------------------------- | ---------- |
| `47b1b9e9` | Remove redundant "Say yes to confirm" from system prompt          | 2026-03-17 |
| `c4e3a13c` | Release v3.3.0                                                    | 2026-03-15 |
| `cea26781` | Add tests for v8-ignore blocks in generateResponse and chatClient | 2026-03-13 |
| `93aeac4a` | Remove ZAI provider and GLM-4.7 models, finalize GLM-5            | 2026-03-12 |
| `78228bcf` | Migrate GLM worker from Z.ai to DashScope                         | 2026-03-12 |
| `44ea683a` | Release v3.2.0                                                    | 2026-03-07 |
| `99febe66` | Wire GitHub OAuth integration, update cross-service mocks         | 2026-03-02 |
| `b3f34d85` | Release v3.1.0                                                    | 2026-02-22 |
| `c8a42105` | Release v3.0.0                                                    | 2026-02-19 |
| `6063175b` | Add dev-mode log formatting for PM2 readability                   | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration                               | 2026-02-16 |
| `e60eafc1` | Standardize API key secrets to APP naming convention              | 2026-02-15 |
| `c72b7c53` | Switch default LLM to Gemini 2.5 Flash + Gemini fallback          | 2026-02-15 |
| `45f001c1` | Switch PM2 ecosystem to pnpm --filter with start:local            | 2026-02-14 |
| `0f69a74b` | Add default model selector with platform fallback                 | 2026-02-09 |

## API Endpoints

### Public Endpoints

| Method | Path    | Auth         | Description                       |
| ------ | ------- | ------------ | --------------------------------- |
| POST   | `/chat` | JWT or Guest | Send a message and get a response |
| GET    | `/docs` | None         | Swagger UI documentation          |

### System Endpoints

| Method | Path            | Auth | Description               |
| ------ | --------------- | ---- | ------------------------- |
| GET    | `/health`       | None | Health check              |
| GET    | `/openapi.json` | None | OpenAPI 3.1.1 spec (JSON) |

### POST /chat

**Request:**

```json
{
  "message": "How do I create a todo?",
  "conversationHistory": [
    { "role": "user", "content": "Previous question" },
    { "role": "assistant", "content": "Previous answer" }
  ],
  "pendingAction": {
    "type": "create_command",
    "payload": { "text": "buy groceries", "source": "pwa-shared" },
    "awaitingConfirmation": true
  }
}
```

| Field                 | Type                        | Required | Description                              |
| --------------------- | --------------------------- | -------- | ---------------------------------------- |
| `message`             | `string`                    | Yes      | User message (min 1 char)                |
| `conversationHistory` | `ConversationHistory[]`     | No       | Previous messages (max 20 used)          |
| `pendingAction`       | `SuggestedAction` or `null` | No       | Action from previous response to confirm |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "response": "To create a todo, use POST /todos...",
    "sources": [{ "filePath": "docs/services/todos-agent/API.md", "section": "POST /todos" }],
    "suggestedAction": {
      "type": "create_command",
      "payload": { "text": "buy groceries", "source": "pwa-shared" },
      "awaitingConfirmation": true
    }
  }
}
```

**Authentication modes:**

- **JWT Bearer token**: Authenticated users. LLM client fetched from user-service based on user preferences.
- **`x-guest-session` header**: Guest users. Uses platform-provided Gemini 2.5 Flash model. Rate limited to 100 messages/hour/session.
- **Neither**: Returns 401.

**Error codes:**

| HTTP | Code               | When                                   |
| ---- | ------------------ | -------------------------------------- |
| 400  | `INVALID_REQUEST`  | Empty message or invalid body          |
| 401  | `UNAUTHORIZED`     | No JWT and no guest session header     |
| 429  | `RATE_LIMITED`     | Guest session exceeded hourly limit    |
| 502  | `DOWNSTREAM_ERROR` | LLM generation or user-service failure |

## Domain Model

### ChatMessage

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: DocSource[];
  suggestedAction?: SuggestedAction;
}
```

### DocChunk (Firestore: `doc_embeddings`)

```typescript
interface DocChunk {
  id: string;                          // Firestore document ID
  content: string;                     // Chunk text content
  embedding: number[];                 // 1536-dimension OpenAI embedding vector
  filePath: string;                    // Source file path
  section: string;                     // Section heading within the source file
  docType: 'markdown' | 'openapi';    // Document type
  createdAt: Firestore.Timestamp;      // Creation timestamp
}
```

### SuggestedAction

```typescript
interface SuggestedAction {
  type: 'create_command';              // Action type (only command creation)
  payload: Record<string, unknown>;    // Action data (text, source fields)
  awaitingConfirmation: boolean;       // true until user confirms
}
```

### ConversationHistory

```typescript
interface ConversationHistory {
  role: 'user' | 'assistant';
  content: string;
}
```

## Pub/Sub Events

Chat-agent does not publish or subscribe to any Pub/Sub topics. All communication is synchronous HTTP.

## Dependencies

### External Services

| Service           | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| OpenAI Embeddings | Generate 1536-dim vectors (text-embedding-3-small)   |
| LLM (Gemini)      | Generate chat responses via Gemini 2.5 Flash         |
| Firestore         | Store and search document embeddings (vector search) |

### Internal Services

| Service              | Purpose                                |
| -------------------- | -------------------------------------- |
| user-service         | Fetch per-user LLM client and API keys |
| app-settings-service | Fetch LLM pricing data at startup      |

### Packages

| Package                        | Purpose                             |
| ------------------------------ | ----------------------------------- |
| `@intexuraos/common-core`      | Result types, error helpers         |
| `@intexuraos/common-http`      | Auth plugins, request logging       |
| `@intexuraos/http-server`      | Health checks, env validation       |
| `@intexuraos/http-contracts`   | Core API schema definitions         |
| `@intexuraos/infra-firestore`  | Firestore singleton + vector search |
| `@intexuraos/infra-otel`       | Dash0 OpenTelemetry instrumentation |
| `@intexuraos/infra-sentry`     | Sentry logging, error handler       |
| `@intexuraos/internal-clients` | user-service client                 |
| `@intexuraos/llm-contract`     | LLM model enums, error types        |
| `@intexuraos/llm-factory`      | LLM client factory                  |
| `@intexuraos/llm-pricing`      | Pricing context for LLM models      |

## Configuration

### Environment Variables

| Variable                              | Required | Description                                                   |
| ------------------------------------- | -------- | ------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | Yes      | GCP project ID for Firestore                                  |
| `INTEXURAOS_AUTH_JWKS_URL`            | Yes      | JWKS URL for JWT validation                                   |
| `INTEXURAOS_AUTH_ISSUER`              | Yes      | JWT issuer for token validation                               |
| `INTEXURAOS_AUTH_AUDIENCE`            | Yes      | JWT audience for token validation                             |
| `INTEXURAOS_OPENAI_APP_API_KEY`       | Yes      | OpenAI API key for embeddings                                 |
| `INTEXURAOS_USER_SERVICE_URL`         | Yes      | URL for user-service                                          |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | Yes      | Token for internal service-to-service calls                   |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | Yes      | URL for app-settings-service (pricing data)                   |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | Yes      | Platform Gemini API key for guest sessions and user fallback  |
| `INTEXURAOS_SENTRY_DSN`               | No       | Sentry DSN for error tracking                                 |
| `INTEXURAOS_ENVIRONMENT`              | No       | Environment name (defaults to `development`)                  |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`      | No       | Dash0 OTLP endpoint for distributed tracing and metrics       |
| `OTEL_SERVICE_NAME`                   | No       | OpenTelemetry service name (set to `chat-agent` in Docker)    |
| `PORT`                                | No       | Server port (defaults to `8080`)                              |
| `HOST`                                | No       | Server host (defaults to `0.0.0.0`)                           |
| `LOG_LEVEL`                           | No       | Pino log level (defaults to `info`)                           |

### Supported Chat Models

The following models are validated at startup for pricing availability:

| Model              | Provider | Role                                        |
| ------------------ | -------- | ------------------------------------------- |
| Gemini 2.5 Flash   | Google   | Default for authenticated and guest users   |

### Terraform

Deployed as `intexuraos-chat-agent` via Cloud Run module. Secrets `INTEXURAOS_OPENAI_APP_API_KEY` and `INTEXURAOS_GEMINI_APP_API_KEY` injected from Secret Manager. `INTEXURAOS_DASH0_OTLP_ENDPOINT` injected for Dash0 observability. Common service env vars inherited. Scales from 0 to 1 instance. Dockerfile runs with `--import ./dist/otel-register.js` preload for transparent OpenTelemetry instrumentation.

### Local Development

Port `8129` in `ecosystem.config.cjs`. Requires `INTEXURAOS_OPENAI_APP_API_KEY` and `INTEXURAOS_GEMINI_APP_API_KEY` in `.envrc`.

## Gotchas

1. **Pricing fetch at startup**: The service calls `app-settings-service` on startup to load LLM pricing. If app-settings-service is down, chat-agent fails to start.

2. **Firestore vector search requires composite index**: The `doc_embeddings` collection uses Firestore `findNearest()` for vector search. The embedding field must be indexed as a vector field.

3. **Conversation history is truncated**: Only the last 20 messages from `conversationHistory` are passed to the LLM. Older messages are silently dropped.

4. **Guest rate limiter is in-memory**: The rate limiter resets when the service restarts or scales to a new instance. This means rate limiting is per-instance, not global.

5. **Action extraction depends on LLM output format**: The `[ACTION: create_command {...}]` annotation must appear in the LLM response exactly matching the regex pattern. If the LLM outputs a slightly different format, the action is not detected.

6. **Embedding model is hardcoded**: The OpenAI embedding model (`text-embedding-3-small`) is hardcoded in `EmbeddingClient`. Changing it requires reindexing all existing embeddings.

7. **`tryAuth` returns null for guests**: The route uses `tryAuth` (not `requireAuth`), so unauthenticated requests fall through to the guest path rather than being rejected.

## File Structure

```
apps/chat-agent/src/
  index.ts                            # Entry point, env validation, Sentry init
  server.ts                           # Fastify server, plugins, health check
  services.ts                         # DI container, service wiring
  domain/
    index.ts                          # Domain exports
    models/
      chatMessage.ts                  # ChatMessage, ChatRequest, ChatResponse, SuggestedAction
      docChunk.ts                     # DocChunk, DocChunkWithScore, EmbeddingRepositoryPort
    ports/
      embeddingRepository.ts          # Re-exports from models (port interface)
    prompts/
      systemPrompt.ts                 # Intex system prompt definition
    usecases/
      generateResponse.ts             # Main use case: RAG + LLM + confirmation flow
      generateResponse.test.ts        # Unit tests
      searchDocumentation.ts          # Semantic search use case
      searchDocumentation.test.ts     # Unit tests
  infra/
    firestore/
      embeddingRepository.ts          # Firestore vector search implementation
      embeddingRepository.test.ts     # Repository tests
    llm/
      chatClient.ts                   # LLM adapter with action extraction
      chatClient.test.ts              # Chat client tests
      embeddingClient.ts              # OpenAI embedding client with retry logic
      embeddingClient.test.ts         # Embedding client tests
    rateLimit/
      guestRateLimiter.ts             # In-memory guest rate limiter
      guestRateLimiter.test.ts        # Rate limiter tests
      index.ts                        # Rate limiter exports
  routes/
    chatRoutes.ts                     # POST /chat route handler
    index.ts                          # Route exports
  __tests__/
    fakes.fixture.ts                  # Fake implementations for testing
    routes.test.ts                    # Integration tests (app.inject)
    services.test.ts                  # Service container tests
    testUtils.ts                      # JWKS server setup for auth testing
    logger.test.ts                    # Logger integration test
```
