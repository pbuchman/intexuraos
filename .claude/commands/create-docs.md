# Create Documentation

Generate up-to-date project documentation by analyzing the codebase.

**Vision:** One command, 30 minutes of analysis, full documentation regenerated and in sync with the project.

---

## Usage

```
/create-docs [section]
```

**Available sections:**

- `pub-sub` — Pub/Sub topics, publishers, subscribers, and logging patterns
- `schedulers` — Cloud Scheduler jobs (retries, cron tasks)
- `llm` — LLM providers, models, usage patterns, and audit

**Future sections (not yet implemented):**

- `architecture` — High-level system architecture
- `services` — Service catalog with endpoints and responsibilities
- `api` — API contracts and schemas
- `terraform` — Infrastructure overview
- `all` — Regenerate all documentation

---

## Output Structure

Documentation is generated to `docs/current/` directory:

```
docs/current/
├── pub-sub.md        # Pub/Sub flow documentation
├── schedulers.md     # Cloud Scheduler jobs
├── llm.md            # LLM usage documentation
├── architecture.md   # (future)
├── services.md       # (future)
├── api.md            # (future)
└── terraform.md      # (future)
```

---

## Section: pub-sub

**Output file:** `docs/current/pub-sub.md`

### Analysis Steps

1. **Launch Explore agents in parallel:**

   **Agent 1 - Publishers:**

   ```
   Analyze Pub/Sub PUBLISHING patterns. Find:
   - All publisher implementations (BasePubSubPublisher extensions and standalone)
   - What logging exists (before/after/error)
   - What context data is logged per event type
   - Inconsistencies in logging patterns

   Search in: packages/infra-pubsub/, apps/*/src/infra/pubsub/
   ```

   **Agent 2 - Subscribers:**

   ```
   Analyze Pub/Sub RECEIVING patterns. Find:
   - All subscription handler endpoints
   - What logging exists (receive/process/success/error)
   - What context data is logged
   - Inconsistencies in logging patterns

   Search in: apps/*/src/routes/ for pubsub routes
   ```

   **Agent 3 - Topic Mapping:**

   ```
   Map Pub/Sub topics to publishers and subscribers:
   - Topic names (environment variables)
   - Who publishes to each topic
   - Who subscribes (endpoint path)
   - Terraform configuration (topic/subscription definitions)

   Search in: terraform/, apps/*/src/services.ts, apps/*/src/config.ts
   ```

2. **Compile findings into documentation**

3. **Generate improvement suggestions** (output to chat, NOT in docs)

### Documentation Template

Write the following structure to `docs/current/pub-sub.md`:

```markdown
# Pub/Sub Architecture

[Brief description of how Pub/Sub is used in the system]

## Flow Summary

| #   | Topic           | Publisher    | Subscriber Endpoint  | Event Type   |
| --- | --------------- | ------------ | -------------------- | ------------ |
| 1   | `TOPIC_ENV_VAR` | service-name | `POST /internal/...` | `event.type` |

...

## Topics Detail

### 1. [Topic Name]

| Aspect           | Value                           |
| ---------------- | ------------------------------- |
| **Topic**        | `topic-name-{env}`              |
| **Env Variable** | `INTEXURAOS_PUBSUB_X_TOPIC`     |
| **Publisher**    | `service/path/file.ts:method()` |
| **Subscriber**   | `POST /internal/path`           |
| **Handler**      | `service/path/file.ts:lines`    |
| **Purpose**      | Description                     |
| **Ack Deadline** | Xs                              |
| **DLQ**          | Yes/No                          |

**Publishing Logging:**
| Phase | Level | Context Fields |
|-------|-------|----------------|
| Before | `info` | `field1`, `field2` |
| Success | `info` | `field1`, `field2` |
| Error | `error` | `field1`, `field2`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|-------|-------|----------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | event-specific fields |
| Success | `info` | event-specific fields |
| Error | `error` | event-specific fields, error |

[Repeat for each topic]

## Reusable Components

### BasePubSubPublisher

**Location:** `packages/infra-pubsub/src/basePublisher.ts`

**Purpose:** Abstract base class providing consistent logging for all publishers.

**Logging Pattern:**
| Phase | Level | Fields | Lines |
|-------|-------|--------|-------|
| Before publish | `info` | topic, context, event description | 74-77 |
| After success | `info` | topic, context | 81-84 |
| On error | `error` | topic, context, error message | 90-93 |

**Implementations:**
| Publisher | Service | Logger Name |
|-----------|---------|-------------|
| Name | service | `logger-name` |
...

### logIncomingRequest()

**Location:** `packages/common-http/src/http/logger.ts`

**Purpose:** Standard logging for incoming HTTP requests with header redaction.

**Usage:** All Pub/Sub subscriber endpoints call this before authentication.

## Logging Coverage Summary

### Publishers

| Publisher | Logging | Base Class | File |
| --------- | ------- | ---------- | ---- |
| Name      | ✅/❌   | Yes/No     | path |

...

### Subscribers

| Endpoint        | Logging | Success Level  | Timing |
| --------------- | ------- | -------------- | ------ |
| `/internal/...` | ✅/⚠️   | `info`/`debug` | Yes/No |

...

## Sensitive Data Protection

| Data Type     | Protection        | Implementation               |
| ------------- | ----------------- | ---------------------------- |
| Phone numbers | Masked (\*\*\*\*) | `maskPhoneNumber()`          |
| Headers       | Redacted          | `SENSITIVE_FIELDS` in logger |
| Body          | Truncated preview | `logIncomingRequest()`       |
```

### Improvement Suggestions Output

After generating documentation, output to chat (NOT in docs):

```
## Pub/Sub Improvement Suggestions

### Critical
- [List critical issues found]

### High Priority
- [List high priority issues]

### Medium Priority
- [List medium priority issues]

Files to modify:
- `path/to/file.ts` — description
```

---

## Section: schedulers

**Output file:** `docs/current/schedulers.md`

### Analysis Steps

1. **Launch Explore agent:**

   ```
   Find all Cloud Scheduler jobs in the project:
   - Terraform definitions (google_cloud_scheduler_job resources)
   - Target endpoints and services
   - Schedule expressions (cron format)
   - Purpose and retry configuration
   - OIDC authentication setup

   Search in: terraform/environments/*/main.tf
   ```

2. **For each scheduler job, find the handler endpoint:**

   ```
   For each scheduler target URL, find:
   - Route handler implementation
   - What the endpoint does (retry logic, cleanup, etc.)
   - Logging patterns
   - Error handling

   Search in: apps/*/src/routes/
   ```

3. **Compile findings into documentation**

### Documentation Template

Write the following structure to `docs/current/schedulers.md`:

```markdown
# Cloud Scheduler Jobs

> **Auto-generated documentation** - Do not edit manually.
> Last updated: YYYY-MM-DD

Cloud Scheduler is used for periodic tasks like retrying failed operations and cleanup jobs.

## Jobs Summary

| #   | Job Name         | Service      | Endpoint             | Schedule    | Purpose       |
| --- | ---------------- | ------------ | -------------------- | ----------- | ------------- |
| 1   | `job-name-{env}` | service-name | `POST /internal/...` | `0 * * * *` | Brief purpose |

## Jobs Detail

### 1. [Job Name]

| Aspect             | Value                                   |
| ------------------ | --------------------------------------- |
| **Job**            | `intexuraos-job-name-{env}`             |
| **Service**        | service-name                            |
| **Endpoint**       | `POST /internal/path`                   |
| **Handler**        | `apps/service/src/routes/file.ts:lines` |
| **Schedule**       | `cron expression` (description)         |
| **Timezone**       | UTC / Europe/Warsaw                     |
| **Purpose**        | What this job does                      |
| **Retry Count**    | N                                       |
| **Retry Duration** | Xs                                      |
| **OIDC Auth**      | Yes/No                                  |

**Handler Logic:**

- Step 1: What the handler does
- Step 2: ...
- Step 3: ...

**Logging:**
| Phase | Level | Context Fields |
|---------|---------|-----------------------|
| Start | `info` | `field1`, `field2` |
| Success | `info` | `processed`, `failed` |
| Error | `error` | `error` |

[Repeat for each job]

## Terraform Configuration

**Location:** `terraform/environments/dev/main.tf`

Each scheduler job is created with:

- OIDC authentication (service account identity)
- Retry configuration
- HTTP target to Cloud Run service
```

---

## Section: llm

**Output file:** `docs/current/llm.md`

### Analysis Steps

1. **Launch Explore agents in parallel:**

   **Agent 1 - Provider Packages:**

   ```
   Analyze LLM provider packages. Find:
   - All infra-* packages for LLM providers (infra-claude, infra-gpt, infra-gemini)
   - Client implementations and methods (research, synthesize, generate)
   - Model names used (hardcoded or configurable)
   - API call patterns

   Search in: packages/infra-claude/, packages/infra-gpt/, packages/infra-gemini/
   ```

   **Agent 2 - LLM Adapters:**

   ```
   Analyze LLM adapter implementations in llm-orchestrator. Find:
   - Adapter classes (ClaudeAdapter, GptAdapter, GeminiAdapter)
   - How adapters wrap provider clients
   - Error mapping patterns
   - Which operations each adapter supports

   Search in: apps/llm-orchestrator/src/infra/llm/
   ```

   **Agent 3 - LLM Usage:**

   ```
   Find where LLM calls are made. Look for:
   - Research orchestration (parallel calls to multiple LLMs)
   - Synthesis logic (combining results)
   - Title generation
   - Which models are used for what purpose
   - Fallback strategies

   Search in: apps/llm-orchestrator/src/domain/
   ```

   **Agent 4 - Audit & Configuration:**

   ```
   Find LLM audit and configuration. Look for:
   - Audit logging (llm-audit package)
   - API key configuration (user-service, env vars)
   - Required vs optional providers
   - Default provider logic

   Search in: packages/llm-audit/, apps/user-service/, apps/llm-orchestrator/src/config.ts
   ```

2. **Compile findings into documentation**

3. **Generate improvement suggestions** (output to chat, NOT in docs)

### Documentation Template

Write the following structure to `docs/current/llm.md`:

```markdown
# LLM Usage

> **Auto-generated documentation** - Do not edit manually.
> Last updated: YYYY-MM-DD

IntexuraOS uses multiple LLM providers for research, synthesis, and text generation.

## Critical Requirement

⚠️ **Gemini API key is REQUIRED** for the project to function. Gemini is the default and fallback provider. Without a valid Gemini key, research operations will fail completely.

## Providers Summary

| Provider  | Package        | Required | Primary Use Case    | Model               |
| --------- | -------------- | -------- | ------------------- | ------------------- |
| Google    | `infra-gemini` | **Yes**  | Research, Synthesis | `gemini-2.0-flash`  |
| Anthropic | `infra-claude` | No       | Research            | `claude-3-5-sonnet` |
| OpenAI    | `infra-gpt`    | No       | Research            | `gpt-4o`            |

## Provider Details

### Google Gemini (Required)

| Aspect           | Value                                                  |
| ---------------- | ------------------------------------------------------ |
| **Package**      | `packages/infra-gemini`                                |
| **Model**        | `gemini-2.0-flash-exp` / `gemini-2.0-flash`            |
| **API Key Env**  | User-specific (stored encrypted in Firestore)          |
| **Adapter**      | `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts` |
| **Why Required** | Default provider, fallback for synthesis               |

**Capabilities:**

- `research(prompt)` — Web-grounded research with sources
- `synthesize(prompt, results, contexts?)` — Combine multiple LLM results
- `generate(prompt)` — Simple text generation (titles, etc.)

**Model Selection Rationale:**

- `gemini-2.0-flash` — Fast, cost-effective, good quality for research
- Supports grounding with Google Search for up-to-date information
- Best price/performance ratio for high-volume usage

### Anthropic Claude (Optional)

| Aspect          | Value                                                  |
| --------------- | ------------------------------------------------------ |
| **Package**     | `packages/infra-claude`                                |
| **Model**       | `claude-3-5-sonnet-20241022`                           |
| **API Key Env** | User-specific (stored encrypted in Firestore)          |
| **Adapter**     | `apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts` |

**Capabilities:**

- `research(prompt)` — Research with web search tool
- `synthesize(prompt, results, contexts?)` — Result synthesis
- `generate(prompt)` — Text generation

**Model Selection Rationale:**

- Claude 3.5 Sonnet — Best balance of intelligence and speed
- Strong reasoning capabilities for complex research
- Good at following nuanced instructions

### OpenAI GPT (Optional)

| Aspect          | Value                                               |
| --------------- | --------------------------------------------------- |
| **Package**     | `packages/infra-gpt`                                |
| **Model**       | `gpt-4o`                                            |
| **API Key Env** | User-specific (stored encrypted in Firestore)       |
| **Adapter**     | `apps/llm-orchestrator/src/infra/llm/GptAdapter.ts` |

**Capabilities:**

- `research(prompt)` — Research (no native web search)
- `synthesize(prompt, results, contexts?)` — Result synthesis
- `generate(prompt)` — Text generation

**Model Selection Rationale:**

- GPT-4o — Multimodal, fast, widely compatible
- Good general-purpose model for diverse tasks

## Research Flow
```

User Request
|
v
[llm-orchestrator]
|
+---> [Gemini] research(prompt) ──┐
| |
+---> [Claude] research(prompt) ──┼──> Parallel execution
| |
+---> [GPT] research(prompt) ──┘
|
v
Collect results (wait for all or timeout)
|
v
[Gemini] synthesize(prompt, results) ← Always Gemini for synthesis
|
v
Final synthesized response

````

## Code Examples

### Creating an LLM Client

```typescript
// packages/infra-gemini/src/client.ts
import { createGeminiClient } from '@intexuraos/infra-gemini';

const client = createGeminiClient(apiKey);
const result = await client.research('What is quantum computing?');

if (result.ok) {
  console.log(result.value.content);
  console.log(result.value.sources); // URLs from grounding
}
````

### Using Adapters in Orchestrator

```typescript
// apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts
const adapter = new GeminiAdapter(apiKey);

// Research with grounding
const research = await adapter.research(prompt);

// Synthesize multiple results
const synthesis = await adapter.synthesize(
  prompt,
  [
    { model: 'claude', content: claudeResult },
    { model: 'gpt', content: gptResult },
  ],
  externalContexts
);

// Generate title
const title = await adapter.generateTitle(prompt);
```

### Parallel Research Execution

```typescript
// apps/llm-orchestrator/src/domain/usecases/processResearch.ts
const providers = getEnabledProviders(userKeys);

const results = await Promise.allSettled(
  providers.map((provider) => adapters[provider].research(prompt))
);
```

## Audit System

**Package:** `packages/llm-audit`

All LLM calls are audited with:

| Field          | Description            |
| -------------- | ---------------------- |
| `provider`     | LLM provider name      |
| `model`        | Model identifier       |
| `inputTokens`  | Tokens in prompt       |
| `outputTokens` | Tokens in response     |
| `durationMs`   | Call duration          |
| `success`      | Whether call succeeded |
| `errorCode`    | Error code if failed   |

**Audit Flow:**

1. LLM call starts → timestamp recorded
2. Call completes → metrics collected
3. Pub/Sub event published to analytics topic
4. Analytics handler updates user usage stats

## API Key Management

| Aspect         | Implementation                          |
| -------------- | --------------------------------------- |
| **Storage**    | Firestore `user_settings` collection    |
| **Encryption** | AES-256-GCM with per-user keys          |
| **Access**     | Via `user-service` internal API         |
| **Validation** | Keys validated on first use per session |

**Key Configuration UI:** `apps/web` → Settings → API Keys

## Error Handling

| Error Code         | Meaning                   | Handling                   |
| ------------------ | ------------------------- | -------------------------- |
| `RATE_LIMITED`     | Provider rate limit hit   | Retry with backoff         |
| `INVALID_KEY`      | API key invalid/expired   | Notify user, skip provider |
| `TIMEOUT`          | Request timed out         | Skip provider, use others  |
| `API_ERROR`        | Generic provider error    | Log, skip provider         |
| `CONTENT_FILTERED` | Content blocked by safety | Return partial results     |

```

### Improvement Suggestions Output

After generating documentation, output to chat (NOT in docs):

```

## LLM Improvement Suggestions

### Critical

- [Missing required provider support]

### High Priority

- [Model version updates needed]
- [Missing fallback strategies]

### Medium Priority

- [Audit gaps]
- [Error handling improvements]

````

---

## Implementation Notes

- Always use Explore agents for analysis (not direct grep/glob)
- Generate documentation in English
- Include file paths and line numbers for traceability
- Improvement suggestions go to chat output, never in docs
- Docs are auto-generated - include "Do not edit manually" notice
- Include last updated date in docs

### Table Formatting

**Tables MUST be properly formatted with aligned columns:**

```markdown
| Column One | Column Two   | Column Three |
| ---------- | ------------ | ------------ |
| short      | medium value | longer value |
| value      | another      | here         |
````

Rules:

- Align column separators (`|`) vertically
- Pad cells with spaces to match column width
- Header separator row (`|---|`) must match column widths
- Keep descriptions concise but columns readable

---

## Future Extensions

When adding new sections:

1. Add section name to "Available sections" list
2. Define analysis steps (which agents, what to search)
3. Define documentation template
4. Define improvement suggestions format
5. Update `docs/current/` structure

Goal: `/create-docs all` regenerates entire `docs/current/` directory in ~30 minutes.
