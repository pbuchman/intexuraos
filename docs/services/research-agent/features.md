# Research Agent

The AI-powered research orchestration engine that queries multiple LLM providers simultaneously and synthesizes comprehensive answers with intelligent model selection.

## The Problem

Getting comprehensive information from AI models today is fragmented:

1. **Single-model limitations** - Each AI model has unique knowledge and perspectives
2. **Manual aggregation** - Users must query multiple sources and combine results themselves
3. **Missing attribution** - AI responses often lack source citations
4. **Cost uncertainty** - Token usage and costs are unclear until after the fact
5. **No sharing** - Research results cannot be easily shared with others
6. **Manual model selection** - Users must know which models to use for different topics

## How It Helps

Research-agent automates multi-model AI research:

1. **Parallel queries** - Sends your prompt to multiple LLMs simultaneously (Claude, GPT, Gemini, Perplexity, GLM)
2. **Smart synthesis** - Combines all responses into a comprehensive, attributed summary
3. **Cost tracking** - Shows token usage and cost for each model in real-time
4. **Public sharing** - Generates shareable URLs with AI-generated cover images
5. **Context enhancement** - Add your own articles, notes, or previous research as context
6. **Intelligent model selection** - LLM-powered extraction of model preferences from natural language (v2.0.0)
7. **Notion export** - Automatic and manual export of completed research to Notion as structured pages (v2.2.0)

## Use Cases

### Multi-Model Research

- "What are the latest developments in quantum computing?"
- Research-agent queries Claude, GPT, Gemini, and Perplexity in parallel
- Each model provides its unique perspective and sources
- Results are synthesized into a comprehensive answer

### Natural Language Model Selection (v2.0.0)

- "Use Claude and Gemini to research sustainable energy" automatically selects those models
- "Research quantum computing with deep research models" selects deep research variants
- Model preferences are extracted from natural language using LLM-based inference
- Users no longer need to manually configure models for every research

### Enhanced Research with Context

- Add your own articles as input context
- Reference previous research as source material
- The synthesis includes and attributes your provided context

### Draft Research Approval Flow

- Actions-agent creates a "draft" research when confidence is low
- User reviews the draft in the web UI
- User approves and research-agent processes the query
- User receives WhatsApp notification when complete

### Research Sharing

- Completed research automatically generates a shareable URL
- AI generates a cover image for the research
- Share URL includes attribution and sources
- Unsharing removes the public page and deletes associated media

### Notion Export (v2.2.0)

- Completed research can be automatically exported to Notion as structured pages
- Automatic fire-and-forget export triggers after synthesis completion
- Manual export via `POST /research/:id/export-notion` for on-demand export
- Hierarchical page structure: main research page with child LLM report pages
- Markdown-to-Notion block conversion preserves formatting (headings, lists, code, bold, italic, links)
- Cover images included in Notion export when available
- Configurable target page via export settings UI
- Duplicate export prevention (skips if already exported)

## Key Benefits

**Comprehensive answers** - Multiple AI perspectives provide more complete information

**Cost transparency** - See exactly what each query costs before and after execution

**Attribution tracking** - Know which model contributed which information

**Idempotent processing** - Safe retry of failed LLM calls without duplication

**Smart failure handling** - Partial failures do not block completion; users decide how to proceed

**Public sharing** - Share research results with clean, attributed URLs

**Type-safe validation** - Zod schema validation for all LLM responses ensures data integrity (v2.0.0)

**Self-healing responses** - Parser + repair pattern automatically fixes malformed LLM JSON (v2.0.0)

**Notion integration** - Automatic export to Notion with structured page hierarchy and markdown conversion (v2.2.0)

## Recent Changes (v2.4.0)

### Distributed Tracing (Observability)

Research-agent now emits distributed traces to Dash0 via OpenTelemetry:

- Traces propagate across Pub/Sub, HTTP, and Firestore boundaries
- Enabled by `INTEXURAOS_DASH0_OTLP_ENDPOINT` environment variable
- No-op in local development when endpoint is unset
- Powered by `packages/infra-otel` preloaded via Node `--import` flag in Dockerfile

### Dev-Mode Log Formatting

PM2 log output is now colorized and readable in development environments:

```
research-agent | 10:30:00 | INFO  | Research created | {id: "abc123"}
```

Production JSON logging is unchanged.

## Recent Changes (v2.3.0)

### Platform API Key Fallbacks

Research-agent now supports platform-owned API keys as fallbacks for users without their own LLM provider keys:

- **Gemini primary fallback** — `INTEXURAOS_GEMINI_APP_API_KEY` enables `gemini-2.0-flash` for users without a Google API key
- **Zai secondary fallback** — `INTEXURAOS_ZAI_APP_API_KEY` enables `glm-4.7-flash` when Gemini fallback is unavailable
- Fallback ordering: user key → Gemini platform key → Zai platform key → error

### Gemini 2.0 Flash for Internal Operations

Switched title generation and context inference fast model from `glm-4.7-flash` to `gemini-2.0-flash`:

- `glm-4.7-flash` was taking 29s for title generation, exceeding the 10s HTTP timeout
- `gemini-2.0-flash` is faster and already available via the platform Gemini key

### API Key Naming Convention

Standardized platform-owned API key environment variables to the `INTEXURAOS_<PROVIDER>_APP_API_KEY` pattern:

- `INTEXURAOS_GUEST_ZAI_API_KEY` + `INTEXURAOS_ZAI_API_KEY` → `INTEXURAOS_ZAI_APP_API_KEY`

### LLM Prompt Improvements

- Simplified `buildSynthesisContextRepairPrompt` call signature in `ContextInferenceAdapter` — passes `originalPrompt` directly instead of a full params object, matching updated `@intexuraos/llm-prompts` API

## Recent Changes (v2.2.0)

### Notion Export Integration

- Automatic fire-and-forget Notion export after synthesis completes
- Manual export endpoint `POST /research/:id/export-notion` for on-demand export
- Markdown-to-Notion block converter supporting headings, lists, code blocks, tables, inline formatting, and links
- Batch append for exports exceeding Notion's 100-block API limit
- Cover image inclusion in Notion pages when available
- `NotionExportInfo` tracked on research model with `mainPageId`, `mainPageUrl`, and `llmReportPageIds`
- Duplicate export prevention via `notionExportInfo` check

### Research Export Settings

- New `research_export_settings` Firestore collection for user-level Notion configuration
- Settings endpoints: `GET/POST /research/settings/notion` for page configuration
- Validation endpoint: `POST /research/settings/notion/validate` with page preview via notion-service
- Page ID format validation (32 hex or UUID format) with normalization

### Auth0 Claims Namespace Support

- `extractGeneratedByInfo` now reads Auth0 claims under `https://intexuraos.cloud/` namespace
- Fallback to bare `name`/`email` claims for ID token compatibility
- Logging added for claims extraction diagnostics

### Response Contract Standardization

- Internal routes migrated from raw `reply.send()` to `reply.ok()`/`reply.fail()`
- PubSub endpoints consistently return 200 OK with errors logged separately
- Schema definitions updated with proper `required` fields and `const` boolean types

### 100% Branch Coverage Enforcement (INT-427)

- Strict 100% branch coverage with inline v8 ignore exemptions
- Comprehensive test suites for Notion exporter, markdown converter, export settings, and export routes
- Coverage exemptions use validated categories (`ts-type`, `test-infra`, `source-map`)

### Sentry Logger Migration

- Migrated to `createAppLogger()` from `@intexuraos/infra-sentry` for error forwarding to Sentry

## Recent Changes (v2.1.0)

### INT-269: Internal Clients Migration

- Migrated user-service client to `@intexuraos/internal-clients` package
- Standardized HTTP client across all services via shared infrastructure
- Improved error handling with typed `UserServiceError` codes
- Flat exports enable proper esbuild bundling for Docker deployment

### INT-218: Input Validation Zod Migration

- Created `InputQualitySchema` with backwards compatibility for `quality_scale` alias
- Migrated `InputValidationAdapter` to use Zod validation
- Added `formatZodErrors()` utility for detailed field-level error messages
- Comprehensive test coverage for schema validation scenarios

## Recent Changes (v2.0.0)

### INT-178: LLM Model Selection

- Natural language model preferences extraction during draft creation
- Users can specify models in conversational form ("use Claude and Gemini")
- Automatic filtering based on user's configured API keys
- One model per provider constraint enforced automatically

### INT-86: Zod Schema Migration

- Context inference guards migrated from manual type guards to Zod schemas
- ResearchContext and SynthesisContext validated with type-safe schemas
- Parser + repair pattern for resilient LLM response handling
- Detailed error messages for validation failures

### INT-167: Test Coverage Improvements

- Comprehensive test coverage for extractModelPreferences use case
- ContextInferenceAdapter tests with repair scenarios
- Route-level integration tests for model extraction flow

## Limitations

**API key required** - Users must provide their own API keys for each LLM provider

**Max 6 models** - Research is limited to 6 simultaneous models to control costs

**Max 5 input contexts** - Each context max 60k characters for context window limits

**No streaming** - Research results are returned in bulk when complete (not real-time)

**Perplexity special handling** - Perplexity requires online search and has longer response times

**Zai API limitations** - Zai (GLM-4.7) has specific rate limits and regional availability

**No editing** - Once research is completed, it cannot be edited (only enhanced or deleted)

**One model per provider** - Model selection enforces maximum one model from each provider

**Single Notion export** - Each research can only be exported to Notion once (no re-export)

---

_Part of [IntexuraOS](../overview.md) — AI-powered research orchestration._
