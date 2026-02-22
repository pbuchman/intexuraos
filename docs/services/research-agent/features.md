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
6. **Intelligent model selection** - LLM-powered extraction of model preferences from natural language
7. **Notion export** - Automatic and manual export of completed research to Notion as structured pages

## Use Cases

### Multi-Model Research

- "What are the latest developments in quantum computing?"
- Research-agent queries Claude, GPT, Gemini, and Perplexity in parallel
- Each model provides its unique perspective and sources
- Results are synthesized into a comprehensive answer

### Natural Language Model Selection

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

### Notion Export

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

**Type-safe validation** - Zod schema validation for all LLM responses ensures data integrity

**Self-healing responses** - Parser + repair pattern automatically fixes malformed LLM JSON

**Notion integration** - Automatic export to Notion with structured page hierarchy and markdown conversion

**Distributed tracing** - Dash0 OpenTelemetry provides end-to-end visibility across all service boundaries

## Recent Changes (v3.1.0)

### LLM Prompt Audit

Adversarial dual-agent review (Opus architect + Sonnet challenger) audited and improved 27 prompts across all domains. Research-agent changes include simplified `ContextInferenceAdapter` with safer fallbacks replacing unsafe casts. Prompt versions bumped per semver rules.

### Version Bumps (v3.0.0, v3.1.0)

Package version aligned to v3.1.0 as part of the monorepo-wide release. No research-agent-specific code changes in these releases.

## Recent Changes (v2.4.0)

### Distributed Tracing (Observability)

Research-agent emits distributed traces to Dash0 via OpenTelemetry:

- Traces propagate across Pub/Sub, HTTP, and Firestore boundaries
- Enabled by `INTEXURAOS_DASH0_OTLP_ENDPOINT` environment variable
- No-op in local development when endpoint is unset
- Powered by `packages/infra-otel` preloaded via Node `--import` flag in Dockerfile

### Dev-Mode Log Formatting

PM2 log output is colorized and readable in development environments:

```
research-agent | 10:30:00 | INFO  | Research created | {id: "abc123"}
```

Production JSON logging is unchanged.

## Recent Changes (v2.3.0)

### Platform API Key Fallbacks

Research-agent supports platform-owned API keys as fallbacks for users without their own LLM provider keys:

- **Gemini primary fallback** -- `INTEXURAOS_GEMINI_APP_API_KEY` enables `gemini-2.0-flash` for users without a Google API key
- **Zai secondary fallback** -- `INTEXURAOS_ZAI_APP_API_KEY` enables `glm-4.7-flash` when Gemini fallback is unavailable
- Fallback ordering: user key -> Gemini platform key -> Zai platform key -> error

### Gemini 2.0 Flash for Internal Operations

Switched title generation and context inference fast model from `glm-4.7-flash` to `gemini-2.0-flash`:

- `glm-4.7-flash` was taking 29s for title generation, exceeding the 10s HTTP timeout
- `gemini-2.0-flash` is faster and already available via the platform Gemini key

## Limitations

**API key required** - Users must provide their own API keys for each LLM provider (unless platform fallback keys are configured)

**Max 6 models** - Research is limited to 6 simultaneous models to control costs

**Max 5 input contexts** - Each context max 60k characters for context window limits

**No streaming** - Research results are returned in bulk when complete (not real-time)

**Perplexity special handling** - Perplexity requires online search and has longer response times

**Zai API limitations** - Zai (GLM-4.7) has specific rate limits and regional availability

**No editing** - Once research is completed, it cannot be edited (only enhanced or deleted)

**One model per provider** - Model selection enforces maximum one model from each provider

**Single Notion export** - Each research can only be exported to Notion once (no re-export)

---

_Part of [IntexuraOS](../overview.md) -- AI-powered research orchestration._
