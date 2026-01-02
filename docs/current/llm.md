# LLM Usage

> **Auto-generated documentation** - Do not edit manually.
> Last updated: 2026-01-02

IntexuraOS uses multiple LLM providers for research, synthesis, and text generation.

## Critical Requirement

⚠️ **At least one provider API key is REQUIRED** for the project to function. Users must configure API keys for their chosen providers. The default synthesis provider is **Anthropic (Claude)**, but any configured provider can be selected.

## Providers Summary

| Provider  | Package        | Required | Primary Use Case    | Research Model             | Default Model                |
| --------- | -------------- | -------- | ------------------- | -------------------------- | ---------------------------- |
| Google    | `infra-gemini` | No       | Research, Title Gen | `gemini-2.5-pro`           | `gemini-2.5-flash`           |
| Anthropic | `infra-claude` | No       | Research, Synthesis | `claude-opus-4-5-20251101` | `claude-sonnet-4-5-20250929` |
| OpenAI    | `infra-gpt`    | No       | Research            | `o4-mini-deep-research`    | `gpt-5.2`                    |

## Provider Details

### Google Gemini

| Aspect               | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| **Package**          | `packages/infra-gemini`                                |
| **Research Model**   | `gemini-2.5-pro`                                       |
| **Default Model**    | `gemini-2.5-flash`                                     |
| **Validation Model** | `gemini-2.5-flash-lite`                                |
| **API Key**          | User-specific (stored encrypted in Firestore)          |
| **Adapter**          | `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts` |
| **Web Search**       | `googleSearch` tool with grounding metadata            |

**Capabilities:**

- `research(prompt)` — Web-grounded research with sources from grounding metadata
- `synthesize(prompt, results, contexts?)` — Combine multiple LLM results
- `generate(prompt)` — Simple text generation
- `generateTitle(prompt)` — Enhanced title generation with examples (preferred for titles)

**Model Selection Rationale:**

- `gemini-2.5-flash` — Fast, cost-effective for general generation
- `gemini-2.5-pro` — More capable for deep research
- Supports grounding with Google Search for up-to-date information

### Anthropic Claude

| Aspect               | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| **Package**          | `packages/infra-claude`                                |
| **Research Model**   | `claude-opus-4-5-20251101`                             |
| **Default Model**    | `claude-sonnet-4-5-20250929`                           |
| **Validation Model** | `claude-haiku-4-5-20251001`                            |
| **API Key**          | User-specific (stored encrypted in Firestore)          |
| **Adapter**          | `apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts` |
| **Web Search**       | `web_search_20250305` tool with URL extraction         |

**Capabilities:**

- `research(prompt)` — Research with web search tool
- `synthesize(prompt, results, contexts?)` — Result synthesis (default synthesizer)
- `generate(prompt)` — Text generation
- `generateTitle(prompt)` — Title generation

**Model Selection Rationale:**

- Claude Opus 4.5 — Most capable for complex research tasks
- Claude Sonnet 4.5 — Best balance of intelligence and speed for general tasks
- Strong reasoning capabilities for synthesis and conflict resolution

### OpenAI GPT

| Aspect               | Value                                               |
| -------------------- | --------------------------------------------------- |
| **Package**          | `packages/infra-gpt`                                |
| **Research Model**   | `o4-mini-deep-research`                             |
| **Default Model**    | `gpt-5.2`                                           |
| **Validation Model** | `gpt-4.1`                                           |
| **API Key**          | User-specific (stored encrypted in Firestore)       |
| **Adapter**          | `apps/llm-orchestrator/src/infra/llm/GptAdapter.ts` |
| **Web Search**       | `web_search_preview` tool (medium context)          |

**Capabilities:**

- `research(prompt)` — Research with web search preview tool
- `synthesize(prompt, results, contexts?)` — Result synthesis
- `generate(prompt)` — Text generation
- `generateTitle(prompt)` — Title generation

**Model Selection Rationale:**

- o4-mini-deep-research — Optimized for deep research tasks
- GPT-5.2 — Fast, multimodal, widely compatible for general tasks

## Research Flow

```
User submits research
        |
        v
POST /research (researchRoutes.ts)
        |
        v
submitResearch() creates Research doc
        |
        v
Publish 'research.process' event to Pub/Sub
        |
        v
POST /internal/llm/pubsub/process-research
  → Fetch user API keys & search settings
  → Generate title (Gemini preferred)
  → For each selectedLlm: Publish 'llm.call' event
        |
        v (Parallel execution in separate Cloud Run instances)
POST /internal/llm/pubsub/process-llm-call (one per LLM)
  → Execute LLM research call
  → Store result or error
  → checkLlmCompletion()
    ├─ If all_completed → runSynthesis()
    ├─ If partial_failure → await user decision
    └─ If all_failed → mark research failed
        |
        v
runSynthesis() (triggered when ready)
  → Fetch synthesis provider key
  → Call synthesizer.synthesize(prompt, reports, externalReports)
  → Store synthesizedResult
  → Send notification
```

## Search Modes

| Mode    | Research Model Used                 | Use Case                         |
| ------- | ----------------------------------- | -------------------------------- |
| `deep`  | Provider's research model (default) | Thorough, comprehensive research |
| `quick` | Provider's default model            | Faster, lighter responses        |

Search mode is configured per-user in settings and passed to the adapter factory when creating providers.

## Adapter Architecture

### Domain Interfaces (Ports)

**Location:** `apps/llm-orchestrator/src/domain/research/ports/llmProvider.ts`

```typescript
interface LlmResearchProvider {
  research(prompt: string): Promise<Result<LlmResearchResult, LlmError>>;
}

interface LlmSynthesisProvider {
  synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    externalReports?: { content: string; model?: string }[]
  ): Promise<Result<string, LlmError>>;
  generateTitle(prompt: string): Promise<Result<string, LlmError>>;
}

interface TitleGenerator {
  generateTitle(prompt: string): Promise<Result<string, LlmError>>;
}
```

### Factory Pattern

**Location:** `apps/llm-orchestrator/src/infra/llm/LlmAdapterFactory.ts`

| Function                   | Purpose                                    | Returns                                    |
| -------------------------- | ------------------------------------------ | ------------------------------------------ |
| `createLlmProviders()`     | Create adapters for all available API keys | `Record<LlmProvider, LlmResearchProvider>` |
| `createSynthesizer()`      | Create synthesizer for specific provider   | `LlmSynthesisProvider`                     |
| `createTitleGenerator()`   | Create title generator (always Gemini)     | `TitleGenerator`                           |
| `createResearchProvider()` | Create research provider with search mode  | `LlmResearchProvider`                      |

### Provider Selection Logic

1. **Research providers** — Created for each provider with a configured API key
2. **Title generator** — Always uses Gemini (falls back to synthesis provider if no Google key)
3. **Synthesizer** — Uses `synthesisLlm` from research config (defaults to Anthropic)

## Audit System

**Package:** `packages/llm-audit`

**Firestore Collection:** `llm_api_logs`

**Control:** `INTEXURAOS_AUDIT_LLMS` environment variable (defaults to `true`)

All LLM calls are audited with:

| Field         | Description                                     |
| ------------- | ----------------------------------------------- |
| `id`          | Unique audit log ID                             |
| `provider`    | LLM provider name                               |
| `model`       | Model identifier                                |
| `method`      | Operation type (research, generate, synthesize) |
| `prompt`      | Input prompt (or promptLength)                  |
| `status`      | `success` or `error`                            |
| `response`    | Output (or responseLength)                      |
| `error`       | Error message if failed                         |
| `startedAt`   | Request start timestamp                         |
| `completedAt` | Request completion timestamp                    |
| `durationMs`  | Call duration in milliseconds                   |
| `userId`      | User ID (optional)                              |
| `researchId`  | Research ID (optional)                          |

**Audit Flow:**

1. Create audit context at request start with provider, model, method, prompt
2. Execute LLM call
3. Complete context with `.success(response)` or `.error(message)`
4. Audit log written to Firestore

## API Key Management

| Aspect         | Implementation                               |
| -------------- | -------------------------------------------- |
| **Storage**    | Firestore `user_settings` collection         |
| **Encryption** | AES-256-GCM with `INTEXURAOS_ENCRYPTION_KEY` |
| **Format**     | `iv:authTag:ciphertext` (all base64)         |
| **Access**     | Via `user-service` internal API              |
| **Masking**    | First 4 + last 4 chars shown in UI           |

**Key Configuration Endpoints** (user-service):

| Endpoint                                       | Method | Purpose              |
| ---------------------------------------------- | ------ | -------------------- |
| `/users/:uid/settings/llm-keys`                | GET    | Get masked keys      |
| `/users/:uid/settings/llm-keys`                | PATCH  | Add/update key       |
| `/users/:uid/settings/llm-keys/:provider/test` | POST   | Test key with prompt |
| `/users/:uid/settings/llm-keys/:provider`      | DELETE | Remove key           |

**Key Retrieval at Runtime:**

```
llm-orchestrator → GET /internal/users/{userId}/llm-keys → user-service
                                                                |
                                                                v
                                                      Decrypt from Firestore
                                                                |
                                                                v
                                                      Return { google?, openai?, anthropic? }
```

## Error Handling

| Error Code       | Meaning                          | Handling                   |
| ---------------- | -------------------------------- | -------------------------- |
| `API_ERROR`      | Generic provider error           | Log, skip provider         |
| `TIMEOUT`        | Request timed out                | Skip provider, use others  |
| `INVALID_KEY`    | API key invalid/expired          | Notify user, skip provider |
| `RATE_LIMITED`   | Provider rate limit hit          | Log, skip provider         |
| `OVERLOADED`     | Provider overloaded (Claude 529) | Retry or skip              |
| `CONTEXT_LENGTH` | Input too long (GPT)             | Log, skip provider         |

**Provider-level Error Mapping:**

| Provider | HTTP 401    | HTTP 429     | HTTP 529   | Timeout |
| -------- | ----------- | ------------ | ---------- | ------- |
| Claude   | INVALID_KEY | RATE_LIMITED | OVERLOADED | TIMEOUT |
| GPT      | INVALID_KEY | RATE_LIMITED | —          | TIMEOUT |
| Gemini   | INVALID_KEY | RATE_LIMITED | —          | TIMEOUT |

## Partial Failure Handling

When some LLM calls succeed and others fail:

1. **`all_completed`** — All LLMs succeeded → proceed to synthesis
2. **`partial_failure`** — Mixed results → user chooses:
   - `proceed` — Synthesize with successful results only
   - `retry` — Retry failed providers (max 2 retries)
   - `cancel` — Abort research
3. **`all_failed`** — All LLMs failed → research marked as failed

## Environment Variables

| Variable                    | Purpose                            | Default                   |
| --------------------------- | ---------------------------------- | ------------------------- |
| `INTEXURAOS_ENCRYPTION_KEY` | AES-256 key for API key encryption | (required for production) |
| `INTEXURAOS_AUDIT_LLMS`     | Enable/disable LLM audit logging   | `true`                    |

## File Locations Summary

| Purpose                 | File                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| **Gemini Client**       | `packages/infra-gemini/src/client.ts`                                      |
| **Claude Client**       | `packages/infra-claude/src/client.ts`                                      |
| **GPT Client**          | `packages/infra-gpt/src/client.ts`                                         |
| **Gemini Adapter**      | `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts`                     |
| **Claude Adapter**      | `apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts`                     |
| **GPT Adapter**         | `apps/llm-orchestrator/src/infra/llm/GptAdapter.ts`                        |
| **Adapter Factory**     | `apps/llm-orchestrator/src/infra/llm/LlmAdapterFactory.ts`                 |
| **Domain Ports**        | `apps/llm-orchestrator/src/domain/research/ports/llmProvider.ts`           |
| **Research Processing** | `apps/llm-orchestrator/src/domain/research/usecases/processResearch.ts`    |
| **Synthesis Logic**     | `apps/llm-orchestrator/src/domain/research/usecases/runSynthesis.ts`       |
| **Completion Check**    | `apps/llm-orchestrator/src/domain/research/usecases/checkLlmCompletion.ts` |
| **Retry Logic**         | `apps/llm-orchestrator/src/domain/research/usecases/retryFailedLlms.ts`    |
| **LLM Call Route**      | `apps/llm-orchestrator/src/routes/internalRoutes.ts:439-777`               |
| **Audit Package**       | `packages/llm-audit/src/audit.ts`                                          |
| **API Key Encryption**  | `apps/user-service/src/infra/firestore/encryption.ts`                      |
| **User Settings Repo**  | `apps/user-service/src/infra/firestore/userSettingsRepository.ts`          |
| **LLM Keys Routes**     | `apps/user-service/src/routes/llmKeysRoutes.ts`                            |
