# Research Agent -- Technical Reference

## Overview

Research-agent orchestrates AI research across multiple LLM providers (Claude, GPT, Gemini, Perplexity, GLM). It queries models in parallel via Pub/Sub, tracks costs and attribution, synthesizes results, and manages public sharing with generated cover images. Runs on Cloud Run with auto-scaling. Current version: v3.1.0.

## Architecture

```mermaid
graph TB
    subgraph "Research Request Flow"
        User[User Request] --> Web[Web UI]
        Web --> AA[Actions Agent]
        AA -->|draft| RA[Research Agent]
        AA -->|approve| RA

        RA --> ModelExtract[Model Extraction<br/>extractModelPreferences]
        ModelExtract --> UserSvc[User Service:<br/>internal-clients]

        RA --> PubSub[PubSub:<br/>llm-call topic]
        PubSub --> Worker1[Worker: Claude]
        PubSub --> Worker2[Worker: GPT]
        PubSub --> Worker3[Worker: Gemini]
        PubSub --> Worker4[Worker: Perplexity]
        PubSub --> Worker5[Worker: GLM]

        Worker1 --> RA
        Worker2 --> RA
        Worker3 --> RA
        Worker4 --> RA
        Worker5 --> RA

        RA --> ContextInfer[Context Inference<br/>Zod Schema Validation]
        ContextInfer --> Synthesizer[Synthesis LLM]
        Synthesizer --> RA

        RA --> GCS[GCS:<br/>shared research HTML]
        RA --> ImageSvc[Image Service:<br/>cover generation]
        RA --> Notify[WhatsApp Notification]
        RA --> NotionSvc[Notion Service:<br/>OAuth tokens]
        RA --> NotionExport[Notion Export:<br/>page creation]
    end

    Pricing[Pricing Service] --> RA
    InternalClients["@intexuraos/internal-clients"] --> UserSvc
    ExportSettings["Firestore:<br/>research_export_settings"] --> RA
```

## Recent Changes

| Commit     | Description                                           | Date       |
| ---------- | ----------------------------------------------------- | ---------- |
| `b3f34d85` | Release v3.1.0 (version bump only)                    | 2026-02-22 |
| `c8a42105` | Release v3.0.0 (version bump only)                    | 2026-02-19 |
| `f451d51a` | Audit and improve 27 LLM prompts across all domains   | 2026-02-19 |
| `6063175b` | Add dev-mode log formatting for PM2 readability       | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration                   | 2026-02-16 |
| `e60eafc1` | Standardize API key secrets to APP naming convention  | 2026-02-15 |
| `c72b7c53` | Switch default LLM to Gemini 2.5 Flash + fallback     | 2026-02-15 |
| `d7c6a061` | Add consistent icons to all WhatsApp messages         | 2026-02-10 |
| `0f69a74b` | Add default model selector with platform Zai fallback | 2026-02-08 |
| `308ba74e` | Add v8 ignore for JWT claims type guards              | 2026-02-08 |
| `f33b6251` | Fix: Read namespaced Auth0 claims for user profile    | 2026-02-08 |
| `5aa3e1bd` | Enable strict 100% coverage enforcement (Phase 3)     | 2026-02-01 |

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Web
    participant Actions
    participant Research
    participant PubSub
    participant LLMs
    participant Synthesizer
    participant GCS
    participant Image

    User->>Web: Submit research query
    Web->>Actions: Create action
    Actions->>Research: Create draft research
    Research->>Research: Extract model preferences
    Research->>Web: Return draft ID

    User->>Web: Approve draft
    Web->>Research: Submit research
    Research->>PubSub: Publish llm.call events (one per model)

    par Parallel LLM Calls
        PubSub->>LLMs: Claude call
        PubSub->>LLMs: GPT call
        PubSub->>LLMs: Gemini call
        PubSub->>LLMs: Perplexity call
        PubSub->>LLMs: GLM call
    end

    LLMs-->>Research: Results (async)
    Research->>Research: Check completion

    Note over Research: All models completed

    Research->>Research: Infer ResearchContext (Zod validated)
    Research->>Synthesizer: Synthesize with context
    Research->>Research: Infer SynthesisContext (Zod validated)
    Synthesizer-->>Research: Synthesized content

    Research->>Image: Generate cover image
    Image-->>Research: Image ID

    Research->>GCS: Upload shared HTML
    GCS-->>Research: Share URL

    Research->>User: WhatsApp notification
```

## Model Extraction Flow

```mermaid
sequenceDiagram
    participant User
    participant Actions
    participant Research
    participant UserSvc
    participant LLM

    User->>Actions: "Use Claude and Gemini to research X"
    Actions->>Research: POST /internal/research/draft
    Research->>UserSvc: getApiKeys(userId) via internal-clients
    UserSvc-->>Research: {google: "key1", anthropic: "key2"}
    Research->>Research: buildAvailableModels(keys)
    Research->>UserSvc: getLlmClient(userId) via internal-clients
    UserSvc-->>Research: LlmGenerateClient
    Research->>LLM: extractModelPreferences(message, availableModels)
    LLM-->>Research: {selectedModels: ["gemini-2.5-pro", "claude-opus-4.5"], synthesisModel: "gemini-2.5-pro"}
    Research->>Research: validateSelectedModels (one per provider)
    Research->>Research: createDraftResearch
    Research-->>Actions: {researchId, selectedModels}
```

## Zod Schema Validation

### Parser + Repair Pattern

The `ContextInferenceAdapter` implements a resilient parsing strategy:

```mermaid
flowchart TD
    A[LLM Response] --> B[Strip markdown fences]
    B --> C[JSON.parse]
    C -->|Success| D[Zod schema.safeParse]
    C -->|Fail| E[Create detailed error]
    D -->|Success| F[Return validated data]
    D -->|Fail| G[Attempt repair]
    G --> H[Build repair prompt with errors]
    H --> I[Call LLM again]
    I --> J[Parse repaired response]
    J -->|Success| F
    J -->|Fail| K[Return error with both attempts]
    E --> K
```

### ResearchContext Schema

```typescript
const ResearchContextSchema = z.object({
  language: z.string(),
  domain: DomainSchema, // 'technical' | 'legal' | 'medical' | ...
  mode: ModeSchema, // 'compact' | 'standard' | 'audit'
  intent_summary: z.string(),
  defaults_applied: z.array(DefaultAppliedSchema),
  assumptions: z.array(z.string()),
  answer_style: z.array(AnswerStyleSchema), // 'practical' | 'evidence_first' | ...
  time_scope: TimeScopeSchema,
  locale_scope: LocaleScopeSchema,
  research_plan: ResearchPlanSchema,
  output_format: OutputFormatSchema,
  safety: SafetyInfoSchema,
  red_flags: z.array(z.string()),
});
```

### SynthesisContext Schema

```typescript
const SynthesisContextSchema = z.object({
  language: z.string(),
  domain: DomainSchema,
  mode: ModeSchema,
  synthesis_goals: z.array(SynthesisGoalSchema), // 'merge' | 'dedupe' | 'conflict_audit' | ...
  missing_sections: z.array(z.string()),
  detected_conflicts: z.array(DetectedConflictSchema),
  source_preference: SourcePreferenceSchema,
  defaults_applied: z.array(DefaultAppliedSchema),
  assumptions: z.array(z.string()),
  output_format: SynthesisOutputFormatSchema,
  safety: SafetyInfoSchema,
  red_flags: z.array(z.string()),
});
```

## API Endpoints

### Public Endpoints

| Method | Path                                 | Description                        | Auth         |
| ------ | ------------------------------------ | ---------------------------------- | ------------ |
| POST   | `/research`                          | Create new research                | Bearer token |
| POST   | `/research/draft`                    | Save as draft                      | Bearer token |
| PATCH  | `/research/:id`                      | Update draft research              | Bearer token |
| GET    | `/research`                          | List researches for user           | Bearer token |
| GET    | `/research/:id`                      | Get research by ID                 | Bearer token |
| DELETE | `/research/:id`                      | Delete research                    | Bearer token |
| POST   | `/research/:id/approve`              | Approve draft research             | Bearer token |
| POST   | `/research/:id/enhance`              | Enhance with more models/context   | Bearer token |
| POST   | `/research/:id/retry`                | Retry failed LLM calls             | Bearer token |
| POST   | `/research/:id/confirm`              | Confirm partial failure decision   | Bearer token |
| POST   | `/research/:id/export-notion`        | Manually export to Notion          | Bearer token |
| DELETE | `/research/:id/share`                | Remove public sharing              | Bearer token |
| PATCH  | `/research/:id/favourite`            | Toggle favourite status            | Bearer token |
| POST   | `/research/validate-input`           | Validate input quality             | Bearer token |
| POST   | `/research/improve-input`            | Improve research prompt            | Bearer token |
| GET    | `/research/settings/notion`          | Get Notion export settings         | Bearer token |
| POST   | `/research/settings/notion`          | Save Notion export settings        | Bearer token |
| POST   | `/research/settings/notion/validate` | Validate Notion page ID            | Bearer token |

### Internal Endpoints

| Method | Path                                    | Description                           | Auth            |
| ------ | --------------------------------------- | ------------------------------------- | --------------- |
| POST   | `/internal/research/draft`              | Create draft research with extraction | Internal header |
| POST   | `/internal/llm/pubsub/process-research` | Process research from Pub/Sub         | Pub/Sub OIDC    |
| POST   | `/internal/llm/pubsub/process-llm-call` | Process individual LLM call           | Pub/Sub OIDC    |
| POST   | `/internal/llm/pubsub/report-analytics` | Report LLM analytics                  | Pub/Sub OIDC    |

## Domain Models

### Research

| Field               | Type              | Description                          |
| ------------------- | ----------------- | ------------------------------------ |
| `id`                | string (UUID)     | Unique research identifier           |
| `userId`            | string            | User who owns the research           |
| `title`             | string            | AI-generated title (empty initially) |
| `prompt`            | string            | Original user query                  |
| `originalPrompt`    | string            | Pre-improvement prompt (if improved) |
| `selectedModels`    | ResearchModel[]   | Models to query                      |
| `synthesisModel`    | ResearchModel     | Model for synthesis                  |
| `status`            | ResearchStatus    | Current state                        |
| `llmResults`        | LlmResult[]       | Results from each model              |
| `inputContexts`     | InputContext[]    | User-provided context                |
| `synthesizedResult` | string            | Final synthesized content            |
| `synthesisError`    | string            | Synthesis failure message            |
| `partialFailure`    | PartialFailure    | Partial failure metadata             |
| `startedAt`         | string (ISO 8601) | Start timestamp                      |
| `completedAt`       | string            | Completion timestamp                 |
| `totalDurationMs`   | number            | Total processing time                |
| `totalInputTokens`  | number            | Sum of input tokens                  |
| `totalOutputTokens` | number            | Sum of output tokens                 |
| `totalCostUsd`      | number            | Total cost                           |
| `sourceActionId`    | string            | Originating action ID                |
| `skipSynthesis`     | boolean           | Skip synthesis (raw results only)    |
| `researchContext`   | ResearchContext   | Inferred context metadata            |
| `shareInfo`         | ShareInfo         | Public sharing details               |
| `sourceResearchId`  | string            | Enhanced from this ID                |
| `attributionStatus` | AttributionStatus | Source attribution state             |
| `auxiliaryCostUsd`  | number            | Non-LLM costs (images, etc)          |
| `sourceLlmCostUsd`  | number            | Cost from source research            |
| `favourite`         | boolean           | User favorited                       |
| `userName`          | string            | User's name for "Generated by"       |
| `userEmail`         | string            | User's email for "Generated by"      |
| `notionExportInfo`  | NotionExportInfo  | Notion export details                |

### ResearchStatus Enum

| Value                   | Description                             |
| ----------------------- | --------------------------------------- |
| `draft`                 | Awaiting user approval                  |
| `pending`               | Approved, awaiting processing           |
| `processing`            | LLMs are being queried                  |
| `awaiting_confirmation` | Partial failure, awaiting user decision |
| `retrying`              | Retrying failed LLMs                    |
| `synthesizing`          | Combining results                       |
| `completed`             | Successfully completed                  |
| `failed`                | All LLMs failed                         |

### LlmResult

| Field              | Type            | Description                             |
| ------------------ | --------------- | --------------------------------------- |
| `provider`         | LlmProvider     | claude, openai, google, perplexity, zai |
| `model`            | string          | Model name                              |
| `status`           | LlmResultStatus | pending, processing, completed, failed  |
| `result`           | string          | LLM response content                    |
| `error`            | string          | Error message if failed                 |
| `sources`          | string[]        | Source citations (if provided)          |
| `startedAt`        | string          | Start timestamp                         |
| `completedAt`      | string          | End timestamp                           |
| `durationMs`       | number          | Processing duration                     |
| `inputTokens`      | number          | Tokens consumed                         |
| `outputTokens`     | number          | Tokens generated                        |
| `costUsd`          | number          | Cost of this call                       |
| `copiedFromSource` | boolean         | Copied from enhanced source research    |

### ShareInfo

| Field           | Type   | Description            |
| --------------- | ------ | ---------------------- |
| `shareToken`    | string | HMAC-based share token |
| `slug`          | string | URL-friendly slug      |
| `shareUrl`      | string | Full shareable URL     |
| `sharedAt`      | string | Share timestamp        |
| `gcsPath`       | string | GCS storage path       |
| `coverImageId`  | string | Cover image identifier |
| `coverImageUrl` | string | Full-size cover image  |

### NotionExportInfo

| Field              | Type                                  | Description                  |
| ------------------ | ------------------------------------- | ---------------------------- |
| `mainPageId`       | string                                | Notion main research page ID |
| `mainPageUrl`      | string                                | Notion main page URL         |
| `llmReportPageIds` | `{ model: string; pageId: string }[]` | LLM report child page IDs    |
| `exportedAt`       | string (ISO 8601)                     | Export timestamp             |

### ResearchExportSettings

| Field               | Type              | Description           |
| ------------------- | ----------------- | --------------------- |
| `researchPageId`    | string            | Target Notion page ID |
| `researchPageTitle` | string            | Cached page title     |
| `researchPageUrl`   | string            | Cached page URL       |
| `createdAt`         | string (ISO 8601) | Creation timestamp    |
| `updatedAt`         | string (ISO 8601) | Last update timestamp |

## Model Filtering Logic

The `extractModelPreferences` use case filters models based on:

1. **API Key Availability** - Only models for which the user has configured API keys
2. **One Per Provider** - Maximum one model from each provider (first match wins)
3. **Synthesis Eligibility** - Synthesis model must be in `SYNTHESIS_MODELS` list

```typescript
// Available research models
const REQUIRED_MODELS: (ResearchModel | FastModel)[] = [
  LlmModels.Gemini25Pro,
  LlmModels.Gemini25Flash,
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
  // Fast model for title generation
  LlmModels.Gemini20Flash,
];
```

## Pub/Sub Events

### Published

| Event Type         | Topic               | Purpose                          |
| ------------------ | ------------------- | -------------------------------- |
| `research.process` | `llm-process-queue` | Trigger research processing      |
| `llm.call`         | `llm-call-queue`    | Execute individual LLM call      |
| `llm.report`       | `llm-analytics`     | Report LLM success for analytics |

### Subscribed

| Subscription        | Handler                                 |
| ------------------- | --------------------------------------- |
| `llm-process-queue` | `/internal/llm/pubsub/process-research` |
| `llm-call-queue`    | `/internal/llm/pubsub/process-llm-call` |
| `llm-analytics`     | `/internal/llm/pubsub/report-analytics` |

## Dependencies

### Internal Services

| Service          | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `user-service`   | API keys, LLM usage, LLM client via `@intexuraos/internal-clients`  |
| `image-service`  | Cover image generation                                              |
| `notion-service` | Notion OAuth tokens and page previews                               |

### Infrastructure

| Component                                         | Purpose                     |
| ------------------------------------------------- | --------------------------- |
| Firestore (`researches` collection)               | Research persistence        |
| `app-settings-service` (HTTP)                     | LLM pricing configuration   |
| Firestore (`llm_api_logs` collection)             | API call audit              |
| Firestore (`research_export_settings` collection) | Notion export configuration |
| Pub/Sub (`llm-call-queue`)                        | LLM call distribution       |
| Pub/Sub (`llm-process-queue`)                     | Research processing trigger |
| Pub/Sub (`whatsapp-send`)                         | Notification delivery       |
| GCS                                               | Shared research HTML        |

### LLM Providers

| Provider   | Models                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Anthropic  | `claude-opus-4.5`, `claude-sonnet-4.5`                                     |
| OpenAI     | `gpt-5.2`, `o4-mini-deep-research`                                         |
| Google     | `gemini-2.5-pro`, `gemini-2.5-flash` (research); `gemini-2.0-flash` (fast) |
| Perplexity | `sonar`, `sonar-pro`, `sonar-deep-research`                                |
| Zai        | `glm-4.7`, `glm-4.7-flash`                                                 |

**Fast model** (`gemini-2.0-flash`): Used for title generation and context inference via the platform Gemini key. Not available as a user-selectable research model.

### Shared Packages

| Package                        | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `@intexuraos/internal-clients` | User service client                         |
| `@intexuraos/infra-notion`     | Notion client and error mapping             |
| `@intexuraos/infra-otel`       | Dash0 OpenTelemetry preload instrumentation |
| `@intexuraos/infra-sentry`     | Sentry-enabled logger factory               |
| `@intexuraos/llm-contract`     | Model types, provider mapping               |
| `@intexuraos/llm-prompts`      | Zod schemas, prompt builders                |
| `@intexuraos/llm-pricing`      | Pricing context interface                   |
| `@intexuraos/llm-utils`        | Parse error formatting                      |
| `@intexuraos/infra-gemini`     | Gemini client wrapper                       |
| `@intexuraos/common-http`      | HTTP utilities, auth                        |
| `@intexuraos/common-core`      | Result types, logging                       |

## Configuration

| Environment Variable                       | Required | Description                                               |
| ------------------------------------------ | -------- | --------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`                | Yes      | Google Cloud project ID                                   |
| `INTEXURAOS_AUTH_JWKS_URL`                 | Yes      | Auth0 JWKS URL                                            |
| `INTEXURAOS_AUTH_ISSUER`                   | Yes      | Auth0 issuer URL                                          |
| `INTEXURAOS_AUTH_AUDIENCE`                 | Yes      | Auth0 audience                                            |
| `INTEXURAOS_USER_SERVICE_URL`              | Yes      | User-service base URL                                     |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | Yes      | Shared secret for service-to-service                      |
| `INTEXURAOS_WEB_APP_URL`                   | Yes      | Web app URL for notifications                             |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`      | Yes      | App settings service for pricing                          |
| `INTEXURAOS_NOTION_SERVICE_URL`            | Yes      | Notion-service base URL                                   |
| `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`         | Yes      | Public base URL for images                                |
| `INTEXURAOS_IMAGE_SERVICE_URL`             | Yes      | Image-service base URL                                    |
| `INTEXURAOS_SHARE_BASE_URL`                | Yes      | Base URL for shared research                              |
| `INTEXURAOS_SHARED_CONTENT_BUCKET`         | Yes      | GCS bucket for shared research                            |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | Yes      | WhatsApp send topic                                       |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | Yes      | Research process queue topic                              |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | Yes      | LLM call queue topic                                      |
| `INTEXURAOS_GEMINI_APP_API_KEY`            | No       | Platform Gemini key; enables `gemini-2.0-flash` fallback  |
| `INTEXURAOS_ZAI_APP_API_KEY`               | No       | Platform Zai key; enables `glm-4.7-flash` fallback        |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`           | No       | Dash0 OTLP endpoint; enables distributed tracing          |
| `INTEXURAOS_SENTRY_DSN`                    | No       | Sentry DSN for error reporting                            |

## Gotchas

**Platform API key fallbacks**: When a user has no API key for their preferred model's provider, `getLlmClient` in `@intexuraos/internal-clients` tries platform keys in order: Gemini (`gemini-2.0-flash`) -> Zai (`glm-4.7-flash`). Both platform keys are optional. If neither is set, the service returns `NO_API_KEY` error.

**Idempotent LLM calls**: The `process-llm-call` endpoint checks if an LLM result is already `completed` or `failed` and skips processing if so. This enables safe retry without duplication.

**Partial failure handling**: When some LLMs fail, research enters `awaiting_confirmation` status. User can choose to proceed with completed results, retry failed models, or cancel.

**Context window limits**: Input contexts are max 60k characters each, max 5 contexts. This prevents exceeding model context windows.

**Perplexity online search**: The Perplexity models (`sonar-*`) perform actual web search during inference, making them slower but more current.

**Share token generation**: Uses HMAC-based token generation for secure, unguessable share URLs.

**Attribution repair**: Synthesized content may have incomplete attribution. A repair process attempts to fix missing attribution lines before marking complete.

**Cost calculation**: Costs are calculated from pricing data fetched via `app-settings-service` HTTP. If pricing is missing, cost is not calculated but result is still saved.

**Image cleanup**: When research is unshared, the cover image is deleted via call to image-service's internal endpoint.

**Draft research flow**: Low-confidence actions create draft research that requires explicit approval before processing.

**Model extraction graceful degradation**: If model extraction fails (LLM error, no API keys), the draft is created with empty `selectedModels` array. User selects models manually in UI.

**Zod repair pattern**: When initial Zod validation fails, a repair prompt is sent to the LLM with the specific validation errors. If repair also fails, both error messages are combined for debugging.

**One model per provider**: The `validateSelectedModels` function enforces maximum one model per provider to prevent duplicate costs and conflicting results.

**Internal-clients flat exports**: The `@intexuraos/internal-clients` package uses flat exports (not subpath exports) to enable proper esbuild bundling for Docker deployment.

**Notion export ordering**: The fire-and-forget Notion export in `runSynthesis` must happen AFTER the database save so the export can read the updated `shareInfo` with `coverImageUrl`. Previously this caused a race condition where cover images were missing.

**Notion 100-block limit**: The Notion API limits `pages.create` to 100 children blocks. The exporter uses `appendBlocksInBatches` to handle larger exports by appending in batches of 100.

**Notion export deduplication**: Both automatic and manual export check `research.notionExportInfo` before exporting. If already set, the export is skipped to prevent duplicate pages.

**Notion page ID normalization**: Page IDs can be either 32 hex characters or UUID format with dashes. The validation endpoint normalizes by removing dashes before passing to notion-service.

**Auth0 namespaced claims**: Auth0 Actions add user claims under `https://intexuraos.cloud/` namespace for API audience tokens. The service tries namespaced keys first, then falls back to bare `name`/`email`.

**Prompt versioning**: All prompts follow semver versioning. The v3.1.0 prompt audit bumped versions for improved prompts with safer fallbacks and XML delimiters.

## File Structure

```
apps/research-agent/src/
  domain/research/
    models/
      Research.ts                   # Core research entity and factories
    config/
      synthesisPrompt.ts            # Synthesis prompt template
    ports/
      repository.ts                 # Research storage interface
      llmProvider.ts                # LLM adapter interface
      contextInference.ts           # Context inference interface
      modelExtraction.ts            # Model extraction types
      shareStorage.ts               # Shared HTML storage interface
      researchExportSettings.ts     # Export settings port interface
      notification.ts               # Notification sender interface
    services/
      contextLabels.ts              # Context labeling utilities
    usecases/
      extractModelPreferences.ts    # Model extraction from natural language
      processResearch.ts            # Main orchestration
      submitResearch.ts             # Submit for processing
      enhanceResearch.ts            # Add models/context
      unshareResearch.ts            # Remove public share
      runSynthesis.ts               # Combine results + fire-and-forget Notion export
      retryFromFailed.ts            # Retry failed LLMs
      retryFailedLlms.ts            # Retry specific models
      checkLlmCompletion.ts         # Completion status check
      repairAttribution.ts          # Fix attribution issues
      toggleResearchFavourite.ts    # Toggle favourite status
      listResearches.ts             # List user researches
      getResearch.ts                # Get single research
      deleteResearch.ts             # Delete research
    utils/
      htmlGenerator.ts              # Shared HTML generation
      slugify.ts                    # URL-friendly IDs
    formatLlmError.ts               # Error message formatting
  infra/
    llm/
      ClaudeAdapter.ts              # Claude API integration
      GptAdapter.ts                 # OpenAI API integration
      GeminiAdapter.ts              # Google API integration
      PerplexityAdapter.ts          # Perplexity API integration
      GlmAdapter.ts                 # GLM (Zai) API integration
      ContextInferenceAdapter.ts    # Zod-validated context inference
      InputValidationAdapter.ts     # Zod-validated input validation
      LlmAdapterFactory.ts          # Factory pattern
    research/
      FirestoreResearchRepository.ts  # Research persistence
    firestore/
      researchExportSettingsRepository.ts  # Notion export settings
    notion/
      notionServiceClient.ts        # HTTP client for notion-service
      notionResearchExporter.ts     # Exports research to Notion pages
      markdownToNotionBlocks.ts     # Markdown to Notion block converter
      exportResearchToNotionUseCase.ts  # Fire-and-forget export use case
    pricing/
      PricingClient.ts              # Fetch pricing from settings
    pubsub/
      researchEventPublisher.ts     # Publish research.process events
      llmCallPublisher.ts           # Publish llm.call events
      analyticsEventPublisher.ts    # Publish llm.report events
    gcs/
      shareStorageAdapter.ts        # Upload shared HTML to GCS
    image/
      imageServiceClient.ts         # Generate cover images
    notification/
      WhatsAppNotificationSender.ts # Send WhatsApp via Pub/Sub
      NoopNotificationSender.ts     # No-op for development
  routes/
    researchRoutes.ts               # User-facing endpoints
    researchExportRoutes.ts         # Notion export settings endpoints
    internalRoutes.ts               # Service-to-service + Pub/Sub
    helpers/
      completionHandlers.ts         # Post-LLM completion logic
      synthesisHelper.ts            # Synthesis provider setup
    schemas/
      common.ts                     # Shared schema components
      researchSchemas.ts            # Request/response schemas
      validationSchemas.ts          # Input validation schemas
  services.ts                       # DI container with factories
  server.ts                         # Fastify server setup
  index.ts                          # Entry point with env validation
```
