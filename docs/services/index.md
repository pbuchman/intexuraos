# Services Catalog

Catalog for IntexuraOS services, workers, and packages.

**Version 3.8.0** — June 26, 2026

---

## v3.8.0 Highlights

| Component                        | Key Changes                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **intex-agent**                  | Unified action workflow for code tasks, research drafts, bookmarks, notes, and calendar actions, with explicit intent gates and WhatsApp session continuity                     |
| **whatsapp-service**             | Private WhatsApp workspace with private ingest, read-only conversations, sender/day views, Matrix sync, outgoing/group event sync, and preserved group classification           |
| **message-digest-service**       | WhatsApp group and direct-chat summaries with user-defined schedules and prompts, source-fenced private reads, run history, and delivery through the user's primary WhatsApp mapping |
| **code-agent**                   | Documentation review dispatch reliability and unified Intex Agent code-task creation path                                                                                        |
| **orchestrator**                 | More reliable completion finalization when Docker hangs, with reduced handled Sentry noise for code-task reliability paths                                                       |
| **web**                          | Homepage and README showcase now lead with the current Intex Agent unified actions and private WhatsApp workspace capabilities                                                   |

## v3.7.0 Highlights (Previous)

| Component                         | Key Changes                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **fishing-assistant-service**     | New Fishing Assistant RAG foundation with knowledge folders/pages, embedding-backed retrieval, persisted chat history, digest/raw-message evidence, citation validation, ISO response timestamps, and web/mobile chat support |
| **llm-usage-service**             | Richer cost visibility with prompt-type grouping, research-run cost summaries, image generation metadata, and OpenRouter/MiMo Pro 2.5 model reporting                                                                         |
| **code-agent**                    | Scheduled execution dispatch, custom per-task timeout overrides, and OpenRouter Gemini 3 Flash Preview for GitHub Agent tool-calling triage                                                                                   |
| **mobile-notifications-service**  | Internal digest evidence routes for Fishing Assistant, cleaned group-message retrieval, digest state lookup, subscription-scoped access, and digest output-language preservation                                               |
| **whatsapp-service/bookmarks**    | Reliable async recovery paths for WhatsApp bookmark saves and duplicate-safe bookmark replay; bookmark rows remain scannable on mobile                                                                                         |
| **orchestrator / model catalog**  | Worker presets and usage reporting include Xiaomi MiMo Pro 2.5, OpenRouter catalog support includes Gemini 3 Flash Preview for tool-calling flows, and Grafana Cloud PM2 log dashboards improve ops visibility               |

## v3.6.0 Highlights (Previous)

| Component                        | Key Changes                                                                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **code-worker**                  | Claude resume fix — `--resume <sessionId>` replaces `--continue` for reliable session resumption, `CLAUDE_SESSION_ID` now required for Claude resumes                                                                                                                         |
| **mobile-notifications-service** | WhatsApp Group Digest pipeline — end-to-end AI-generated daily digests from WhatsApp group messages with headline/bullets summaries, persistent group state, backfill, and WhatsApp delivery via Pub/Sub                                                                      |
| **hellscript-agent**             | Per-user LLM client resolution via user-service (INT-1369), centralized LLM pricing removal (INT-1387), usage tracking via `HttpInternalAuthUsageSink`                                                                                                                        |
| **orchestrator**                 | Execution memory pipeline simplification (soft-warning for memory_acknowledgment), log cap raised to 8MB, task timeout default extended to 5h, StatusUpdateClient for redundant status delivery, mimo-pro worker type, test_quality review scope, configurable validation chain for LLM-backed resume/compliance paths |
| **code-agent**                   | Robust task finalization via dedicated status endpoint, PR triage through Pub/Sub push, important flag for issue groups, GitHub Agent inherits user LLM settings, task mode selector (planning/execution), self-healing failure triage, draft PR blocking                     |

## v3.5.0 Highlights (Previous)

| Component            | Key Changes                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hellscript-agent** | Categorized writing config — platform-specific style instructions and writing samples (threads, linkedin, general)                                                                                                                                                                          |
| **code-agent**       | Execution Memory Graph (alpha data collection + RAG pipeline), Remediation Agent (autonomous review fix loop), Ask Agent (interactive Claude Code sessions), code tasks pagination with issue grouping, auto-archive merged tasks, CI failure auto-handling, per-agent-type worker settings |
| **orchestrator**     | Codex runtime support (OpenAI Codex as execution backend with auth and log processing), execution memory graph (data collection pipeline, alpha), remediation agent (autonomous auto-improvement with cross-LLM checks and event-sourcing)                                                  |
| **research-agent**   | OpenRouter integration — route research tasks through OpenRouter models with pricing support                                                                                                                                                                                                |
| **linear-agent**     | AI-powered Linear issue cleanup with review UI and scheduled pruning                                                                                                                                                                                                                        |
| **web-agent**        | Cloudflare Browser Rendering replaces Crawl4AI for JS-rendered pages                                                                                                                                                                                                                        |
| **code-worker**      | Multi-runtime support (Claude + Codex in same container), live Codex output streaming, codex-xhigh worker type, rename from claude-worker, bootstrap evidence logging                                                                                                                       |
| **Platform**         | `infra-openrouter` package — OpenRouter backend infrastructure and frontend model selection                                                                                                                                                                                                 |

## v3.4.0 Highlights (Previous)

| Component             | Key Changes                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **hellscript-agent**  | New: AI-powered writing assistant with intent interpretation, thought accumulation, and versioned draft generation                          |
| **code-agent**        | Merge Queue for ordered auto-merging of PRs, merge conflict cron reconciliation, orchestrator Linear proxy, expandable event log payloads   |
| **orchestrator**      | Orchestrator Linear Proxy — removed direct Linear dependency via code-agent proxy                                                           |
| **Platform**          | Unified Task Enqueue Service (queue-first dispatch), Plan-Based Review Dispatch, Auto-Enforcement of findings                               |
| **research-agent**    | Research pipeline quality fixes T0-T6: context-aware prompts, low-quality response detection, language-aware synthesis                      |
| **linear-agent**      | Context proxy endpoint (INT-1040), decomposition sprint (INT-901-907), linearApiClient split, parentId fix                                  |

## v3.3.0 Highlights (Previous)

| Component        | Key Changes                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **code-agent**   | GitHub Agent with tool calling, unified PR automation log, structured output triage with auto-repair                                                                                            |
| **orchestrator** | Review Agent, Execution Deep Validator, Kimi worker type, Docker health gate, fatal exit codes, PR branch inheritance, mandatory /simplify, already-completed outcome, reliability improvements |
| **web**          | Code Task Detail Page V2 (issue-centric grouped view), workers status in user menu                                                                                                              |
| **Platform**     | Alibaba Cloud Model Studio integration replacing ZAI (GLM-5, Qwen, Kimi), Gemini tool-call mode                                                                                                 |

## v3.2.0 Highlights (Previous)

| Component            | Key Changes                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| **code-agent**       | Agent-based routing, implement button lifecycle, task queueing, PR comment tasks     |
| **orchestrator**     | Label-based dispatch, Qwen/Sonnet/MiniMax worker types, automatic container cleanup  |
| **whatsapp-service** | CTA buttons with deep links, task progress notifications                             |
| **transcription**    | Event-driven audio processing, user-level language preferences                       |
| **linear-agent**     | Live data hydration                                                                  |
| **calendar-agent**   | Calendar event previews with rich formatting                                         |
| **web**              | Code task view enhancements, website redesign                                        |
| **Platform**         | CI-enforced prompt versioning, prompt injection hardening, auto-archival of attempts |

## v3.0.0 Highlights (Previous)

| Component         | Key Changes                                                                         |
| ----------------- | ----------------------------------------------------------------------------------- |
| **code-agent**    | New: Autonomous code execution with worker dispatch and dedup                       |
| **orchestrator**  | New: Local worker orchestration for code-worker sessions via Docker                 |
| **code-worker**   | New: Docker container image for isolated Claude/Codex execution                     |
| **log-cleanup**   | New: Cloud Function for scheduled log retention management                          |
| **vm-lifecycle**  | New: Cloud Functions for GCE VM start/stop lifecycle control                        |
| **22 packages**   | New: All shared packages documented (common, infra, LLM stack)                      |

## v2.1.0 Highlights (Older)

| Service              | Key Changes                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| **whatsapp-service** | Interactive approval buttons, phone verification, voice transcription                                 |
| **calendar-agent**   | Preview generation before commit                                                                      |
| **research-agent**   | Natural language model selection, Zod schema validation                                               |
| **bookmarks-agent**  | WhatsApp delivery for AI summaries                                                                    |
| **web-agent**        | @intexuraos/internal-clients integration (INT-269)                                                    |
| **linear-agent**     | Multi-user webhook fan-out (INT-623), composite keys, 12 internal endpoints, dual-prompt auto-trigger |
| **user-service**     | Rate limit detection precedence fix                                                                   |

---

## AI Capabilities Overview

IntexuraOS integrates **5 core LLM providers** with **15 LLM contract models** across active app services:

```mermaid
graph TB
    subgraph "AI Providers"
        G[Google<br>Gemini 2.5 / 2.0]
        O[OpenAI<br>GPT-5.4 / GPT Image]
        A[Anthropic<br>Claude 4.6 / 4.7]
        P[Perplexity<br>Sonar Pro]
        OR[OpenRouter<br>Curated model catalog]
    end

    subgraph "Primary AI Agents"
        R[research-agent]
        X[intex-agent]
        I[image-service]
        B[bookmarks-agent]
        F[fishing-assistant-service]
    end

    R --> G
    R --> O
    R --> A
    R --> P
    R --> OR
    X --> OR
    I --> O
    I --> G
    B --> G
    F --> OR
```

---

## Services by AI Capability

### Multi-Model Orchestration

| Service                                      | AI Models              | Capability                                      |
| -------------------------------------------- | ---------------------- | ----------------------------------------------- |
| [research-agent](research-agent/features.md) | 10 static research models + OpenRouter | Parallel queries, synthesis, confidence scoring |

### Direct Tool Conversations

| Service                                | AI Models                        | Capability                                    |
| -------------------------------------- | -------------------------------- | --------------------------------------------- |
| [intex-agent](intex-agent/features.md) | OpenRouter Gemini 3 Flash Preview | WhatsApp text conversations with direct tools |

### Image Generation

| Service                                    | AI Models                       | Capability                       |
| ------------------------------------------ | ------------------------------- | -------------------------------- |
| [image-service](image-service/features.md) | GPT Image 1, Gemini Flash Image | Cover images, prompt enhancement |

### Content Intelligence

| Service                                        | AI Models          | Capability                            |
| ---------------------------------------------- | ------------------ | ------------------------------------- |
| [bookmarks-agent](bookmarks-agent/features.md) | Via web-agent      | Link summarization                    |
| [web-agent](web-agent/features.md)             | Gemini 2.5 Flash   | Content extraction, summarization     |
| [message-digest-service](message-digest-service/features.md) | OpenRouter configured model | WhatsApp group and direct-chat summaries |

### Conversational AI

| Service                              | AI Models                        | Capability                                        |
| ------------------------------------ | -------------------------------- | ------------------------------------------------- |
| [fishing-assistant-service](fishing-assistant-service/features.md) | OpenRouter Gemini 3 Flash Preview | Grounded fishing chat over knowledge, digests, and raw-message evidence |

### Autonomous Code Execution

| Service                              | AI Models                                        | Capability                                                                                    |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [code-agent](code-agent/features.md) | Claude, MiniMax, MiMo Pro 2.5, GLM-5, Qwen, Kimi, Codex, OpenRouter | GitHub Agent with tool calling, unified PR log, task queueing, PR creation via worker presets |

### Writing Assistance

| Service                                                  | AI Models        | Capability                                                                                  |
| -------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| [hellscript-agent](hellscript-agent/features.md)         | Gemini 2.5 Flash | Intent interpretation, thought accumulation, categorized writing config, draft generation   |

### Messaging & Transcription

| Service                                          | AI Models    | Capability                                                                                |
| ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- |
| [whatsapp-service](whatsapp-service/features.md) | Intex route  | WhatsApp text ingestion, outbound notifications, verification, and delivery                |
| [transcription](transcription/features.md)       | Speechmatics | Standalone audio-to-text worker retained outside the current WhatsApp text-only Intex path |

---

## All Services

### AI Agents (Primary Intelligence)

Services that directly invoke AI models for their core functionality.

| Service                                                | Purpose                            | AI                                               | Docs                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [intex-agent](intex-agent/features.md)                 | WhatsApp text direct tools         | OpenRouter Gemini 3 Flash Preview                | [features](intex-agent/features.md) / [technical](intex-agent/technical.md) / [tutorial](intex-agent/tutorial.md) / [debt](intex-agent/technical-debt.md) / [agent](intex-agent/agent.md)                                        |
| [research-agent](research-agent/features.md)           | Multi-LLM research orchestration   | Gemini, Claude, GPT, Sonar                       | [features](research-agent/features.md) / [technical](research-agent/technical.md) / [tutorial](research-agent/tutorial.md) / [debt](research-agent/technical-debt.md) / [agent](research-agent/agent.md)                          |
| [image-service](image-service/features.md)             | AI image generation                | GPT Image 1, Gemini Flash Image                  | [features](image-service/features.md) / [technical](image-service/technical.md) / [tutorial](image-service/tutorial.md) / [debt](image-service/technical-debt.md) / [agent](image-service/agent.md)                               |
| [bookmarks-agent](bookmarks-agent/features.md)         | Link management with AI summaries  | Via web-agent                                    | [features](bookmarks-agent/features.md) / [technical](bookmarks-agent/technical.md) / [tutorial](bookmarks-agent/tutorial.md) / [debt](bookmarks-agent/technical-debt.md) / [agent](bookmarks-agent/agent.md)                     |
| [web-agent](web-agent/features.md)                     | Web scraping with AI               | Gemini 2.5 Flash                                 | [features](web-agent/features.md) / [technical](web-agent/technical.md) / [tutorial](web-agent/tutorial.md) / [debt](web-agent/technical-debt.md) / [agent](web-agent/agent.md)                                                   |
| [fishing-assistant-service](fishing-assistant-service/features.md) | Grounded fishing chat and knowledge base | OpenRouter Gemini 3 Flash Preview + OpenAI embeddings | [features](fishing-assistant-service/features.md) / [technical](fishing-assistant-service/technical.md) / [tutorial](fishing-assistant-service/tutorial.md) / [debt](fishing-assistant-service/technical-debt.md) / [agent](fishing-assistant-service/agent.md) |
| [message-digest-service](message-digest-service/features.md) | Scheduled private WhatsApp summaries | Configured OpenRouter model | [features](message-digest-service/features.md) / [technical](message-digest-service/technical.md) / [tutorial](message-digest-service/tutorial.md) / [debt](message-digest-service/technical-debt.md) / [agent](message-digest-service/agent.md) |
| [code-agent](code-agent/features.md)                   | Autonomous code execution          | Claude, MiniMax, MiMo Pro 2.5, GLM-5, Qwen, Kimi, Codex, OpenRouter | [features](code-agent/features.md) / [technical](code-agent/technical.md) / [tutorial](code-agent/tutorial.md) / [debt](code-agent/technical-debt.md) / [agent](code-agent/agent.md)                                              |
| [hellscript-agent](hellscript-agent/features.md)       | Voice-to-draft writing assistant   | Gemini 2.5 Flash                                 | [features](hellscript-agent/features.md) / [technical](hellscript-agent/technical.md) / [tutorial](hellscript-agent/tutorial.md) / [debt](hellscript-agent/technical-debt.md) / [agent](hellscript-agent/agent.md)                |

### Content Management Agents

Services that manage user content with AI-enhanced features.

| Service                                      | Purpose                     | AI             | Docs                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [notes-agent](notes-agent/features.md)       | Note-taking                 | -              | [features](notes-agent/features.md) / [technical](notes-agent/technical.md) / [tutorial](notes-agent/tutorial.md) / [debt](notes-agent/technical-debt.md) / [agent](notes-agent/agent.md)                |
| [calendar-agent](calendar-agent/features.md) | Google Calendar integration | Date parsing   | [features](calendar-agent/features.md) / [technical](calendar-agent/technical.md) / [tutorial](calendar-agent/tutorial.md) / [debt](calendar-agent/technical-debt.md) / [agent](calendar-agent/agent.md) |
| [linear-agent](linear-agent/features.md)     | Linear issue management     | Gemini, GLM    | [features](linear-agent/features.md) / [technical](linear-agent/technical.md) / [tutorial](linear-agent/tutorial.md) / [debt](linear-agent/technical-debt.md) / [agent](linear-agent/agent.md)           |

### Infrastructure Services

Core platform services that support the AI agents.

| Service                                                                  | Purpose                                             | AI              | Docs                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [whatsapp-service](whatsapp-service/features.md)                         | WhatsApp messaging, private source, and delivery      | Intex route     | [features](whatsapp-service/features.md) / [technical](whatsapp-service/technical.md) / [tutorial](whatsapp-service/tutorial.md) / [debt](whatsapp-service/technical-debt.md) / [agent](whatsapp-service/agent.md)                                                             |
| [user-service](user-service/features.md)                                 | Auth, API keys, model prefs                         | LLM validation  | [features](user-service/features.md) / [technical](user-service/technical.md) / [tutorial](user-service/tutorial.md) / [debt](user-service/technical-debt.md) / [agent](user-service/agent.md)                                                                                 |
| [mobile-notifications-service](mobile-notifications-service/features.md) | Android notification capture and query               | -               | [features](mobile-notifications-service/features.md) / [technical](mobile-notifications-service/technical.md) / [tutorial](mobile-notifications-service/tutorial.md) / [debt](mobile-notifications-service/technical-debt.md) / [agent](mobile-notifications-service/agent.md) |
| [notion-service](notion-service/features.md)                             | Notion integration                                  | -               | [features](notion-service/features.md) / [technical](notion-service/technical.md) / [tutorial](notion-service/tutorial.md) / [debt](notion-service/technical-debt.md) / [agent](notion-service/agent.md)                                                                       |
| [app-settings-service](app-settings-service/features.md)                 | Platform config and health anchor                   | -               | [features](app-settings-service/features.md) / [technical](app-settings-service/technical.md) / [tutorial](app-settings-service/tutorial.md) / [debt](app-settings-service/technical-debt.md) / [agent](app-settings-service/agent.md)                                         |
| [llm-usage-service](llm-usage-service/features.md)                       | LLM usage tracking and cost                         | -               | [features](llm-usage-service/features.md) / [technical](llm-usage-service/technical.md) / [tutorial](llm-usage-service/tutorial.md) / [debt](llm-usage-service/technical-debt.md) / [agent](llm-usage-service/agent.md)                                                        |
| [api-docs-hub](api-docs-hub/features.md)                                 | OpenAPI documentation                               | -               | [features](api-docs-hub/features.md) / [technical](api-docs-hub/technical.md) / [tutorial](api-docs-hub/tutorial.md) / [debt](api-docs-hub/technical-debt.md) / [agent](api-docs-hub/agent.md)                                                                                 |

### User Interface

Progressive Web App providing the unified dashboard for IntexuraOS.

| Service                | Purpose                   | AI  | Docs                                                                                                                                              |
| ---------------------- | ------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [web](web/features.md) | Progressive Web App (PWA) | -   | [features](web/features.md) / [technical](web/technical.md) / [tutorial](web/tutorial.md) / [debt](web/technical-debt.md) / [agent](web/agent.md) |

---

## Workers

Cloud Functions and local services that run outside Cloud Run.

| Worker                                     | Type            | Purpose                                                          | Trigger                     |
| ------------------------------------------ | --------------- | ---------------------------------------------------------------- | --------------------------- |
| [orchestrator](orchestrator/features.md)   | Local service   | Spawns code-worker sessions in Docker containers                 | HTTP (HMAC-signed dispatch) |
| [code-worker](code-worker/features.md)     | Docker image    | Isolated Claude/Codex execution environment with git and tools   | Started by orchestrator     |
| log-cleanup                                | Cloud Function  | Deletes old task logs via code-agent cleanup API                 | Pub/Sub (scheduled)         |
| [vm-lifecycle](vm-lifecycle/features.md)   | Cloud Functions | Starts and stops GCE VM instances with health polling            | HTTP (internal auth)        |
| [transcription](transcription/features.md) | Cloud Function  | Converts WhatsApp voice notes to text via Speechmatics           | Pub/Sub (audio-stored)      |
| predev-lifecycle                           | Cloud Functions | Manages pre-dev VM gateway, idle-check, and ready-state webhooks | HTTP / Pub/Sub (scheduled)  |

### Worker Details

**orchestrator** — Runs on local machines (Mac or VM) behind Cloudflare Tunnel. Receives task dispatch requests from code-agent, creates isolated execution environments, spawns code-worker sessions in Docker containers via Claude or Codex runtimes, and reports results via webhooks. Supports worker type presets across Anthropic (opus, auto, sonnet), MiniMax (minimax/M3), Xiaomi MiMo Pro 2.5 (mimo-pro), Alibaba Cloud Model Studio (glm/glm-5, qwen/qwen3.5-plus), Kimi Code (kimi/kimi-for-coding), Codex (`codex`, `codex-xhigh`), and OpenRouter (`openrouter-free`). Features 6 agent types (planning, execution, pull_request, review, remediation, ask_agent), Gemini-based completion verification with agent-specific Zod schemas, Agent Compliance Validator (OpenRouter-based transcript audit), Execution Memory Graph for cross-task learning, Remediation Agent for autonomous review finding fixes, Ask Agent for interactive Q&A sessions, selective container preservation by agent type, a five-hour default task timeout, versioned system prompts via PromptBuilder, forensics mode, and mid-task messaging.

**code-worker** is a Docker container (Node.js 22 Alpine) pre-loaded with Claude CLI, Codex CLI, git, pnpm, GitHub CLI, ripgrep, terraform, and gcloud. Runs as non-root user with network restrictions. The orchestrator manages its lifecycle.

**log-cleanup** is a Pub/Sub-triggered Cloud Function that calls the code-agent's internal cleanup API to delete task logs older than the configured retention period (default 90 days).

**vm-lifecycle** has two HTTP-triggered Cloud Functions (`startVm` and `stopVm`) that manage GCE Spot VM instances. `startVm` polls for health after boot; `stopVm` gracefully drains running tasks before shutdown.

**transcription** — Pub/Sub-triggered Cloud Function that converts WhatsApp voice notes stored in GCS into text using Speechmatics Batch API. Supports auto language detection, AI-generated summaries, and 100+ custom vocabulary terms. Publishes results (success or failure) to the transcription-completed topic for whatsapp-service consumption.

---

## Packages

Shared libraries used across apps and workers.

### Core & HTTP

| Package                                                | Purpose                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| [common-core](../packages/common-core/README.md)       | Result types, Logger interface, error codes, tracing  |
| [common-http](../packages/common-http/README.md)       | Fastify plugin (reply.ok/fail), JWT auth, request IDs |
| [common-metrics](../packages/common-metrics/README.md) | Cloud Monitoring custom metrics client                |
| [common-worker](../packages/common-worker/README.md)   | Cloud Functions/Pub/Sub worker contract helpers       |
| [http-contracts](../packages/http-contracts/README.md) | OpenAPI and Fastify JSON Schema definitions           |
| [http-server](../packages/http-server/README.md)       | Health checks, env validation, error handler          |

### Infrastructure Adapters

| Package                                                  | Purpose                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [infra-firestore](../packages/infra-firestore/README.md) | Firestore singleton client and in-memory test fake                           |
| [infra-pubsub](../packages/infra-pubsub/README.md)       | Pub/Sub publishers for WhatsApp, calendar, and code-task events              |
| [infra-sentry](../packages/infra-sentry/README.md)       | Sentry error tracking, Pino log stream, logger factory                       |
| [infra-whatsapp](../packages/infra-whatsapp/README.md)   | WhatsApp Cloud API client (send, media, read receipts)                       |
| [infra-notion](../packages/infra-notion/README.md)       | Notion API client, token validation, page retrieval                          |

### LLM Provider Clients

| Package                                                    | Provider                   | Capabilities                                    |
| ---------------------------------------------------------- | -------------------------- | ----------------------------------------------- |
| [infra-claude](../packages/infra-claude/README.md)         | Anthropic                  | Text generation, web search, prompt caching     |
| [infra-gemini](../packages/infra-gemini/README.md)         | Google                     | Text generation, web search, image gen          |
| [infra-gpt](../packages/infra-gpt/README.md)               | OpenAI                     | Text generation, web search, DALL-E             |
| [infra-perplexity](../packages/infra-perplexity/README.md) | Perplexity                 | SSE-streamed research with citations            |
| [infra-openrouter](../packages/infra-openrouter/README.md) | OpenRouter                 | OpenRouter API client for dynamic model routing |

### LLM Stack

| Package                                            | Purpose                                                    |
| -------------------------------------------------- | ---------------------------------------------------------- |
| [llm-contract](../packages/llm-contract/README.md) | Model/provider types, LLMClient interface, pricing types   |
| [llm-factory](../packages/llm-factory/README.md)   | Unified factory for creating provider-specific LLM clients |
| [llm-prompts](../packages/llm-prompts/README.md)   | Centralized prompt templates and Zod response schemas      |
| [llm-pricing](../packages/llm-pricing/README.md)   | Runtime pricing lookups, usage logging to Firestore        |
| [llm-utils](../packages/llm-utils/README.md)       | Token redaction, LLM parse error handling, Zod formatting  |

### Service Clients

| Package                                                    | Purpose                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| [code-task-domain](../packages/code-task-domain/README.md) | Shared code-task worker type and plan-document primitives   |
| [internal-clients](../packages/internal-clients/README.md) | Typed HTTP clients for internal service APIs (user-service) |
| [linear-domain](../packages/linear-domain/README.md)       | Linear label normalization and detection utilities          |
| [pr-triage-pubsub-client](../packages/pr-triage-pubsub-client/README.md) | Publisher-side client for PR triage requests               |
| [service-catalog](../packages/service-catalog/README.md)   | Canonical internal service registry and URL bindings        |
| [whatsapp-pubsub-client](../packages/whatsapp-pubsub-client/README.md) | Publisher-side client for WhatsApp send requests            |

---

## AI Models Used

### Research Models (10 static + OpenRouter)

Used for deep research queries with parallel execution. **v2.0.0:** Users can specify models in natural language ("research with Claude and GPT").

| Model                 | Provider   | Specialty            |
| --------------------- | ---------- | -------------------- |
| Gemini 2.5 Pro        | Google     | Reasoning, analysis  |
| Gemini 2.5 Flash      | Google     | Fast responses       |
| GPT-5.4               | OpenAI     | Creative synthesis   |
| o4-mini-deep-research | OpenAI     | Deep research        |
| Claude Opus 4.6       | Anthropic  | Nuanced analysis     |
| Claude Sonnet 4.6     | Anthropic  | Balanced performance |
| Claude Sonnet 4.7     | Anthropic  | Balanced performance |
| Sonar                 | Perplexity | Real-time web search |
| Sonar Pro             | Perplexity | Enhanced search      |
| Sonar Deep Research   | Perplexity | Comprehensive search |
| OpenRouter model IDs  | OpenRouter | Curated dynamic model routing |

### Fast Conversation Models (1)

Used for direct WhatsApp text conversations and fast tool-call decisions.

| Model                  | Provider   | Use Case                                |
| ---------------------- | ---------- | --------------------------------------- |
| Gemini 3 Flash Preview | OpenRouter | Intex tool selection and concise replies |

### Image Models (2)

Used for image generation:

| Model                     | Provider | Capability            |
| ------------------------- | -------- | --------------------- |
| GPT-Image-1 (GPT Image 1) | OpenAI   | High-quality images   |
| Gemini 2.5 Flash Image    | Google   | Fast image generation |

### Validation Models (4)

Used for API key validation (cheap, fast):

| Model            | Provider   |
| ---------------- | ---------- |
| Claude Haiku 3.5 | Anthropic  |
| Gemini 2.0 Flash | Google     |
| GPT-4o Mini      | OpenAI     |
| Sonar            | Perplexity |

---

## Service Dependencies

```mermaid
graph TD
    subgraph "Entry Points"
        WA[whatsapp-service]
        WEB[Web Dashboard]
        GH_PR[GitHub PR Webhooks]
    end

    subgraph "Routing"
        INTEX[intex-agent]
    end

    subgraph "Execution"
        RES[research-agent]
        FISH[fishing-assistant-service]
        NOTE[notes-agent]
        BOOK[bookmarks-agent]
        CAL[calendar-agent]
        LIN[linear-agent]
        CODE[code-agent]
    end

    subgraph "Worker Layer"
        ORCH[orchestrator]
        CW[code-worker]
    end

    subgraph "Support"
        USER[user-service]
        IMG[image-service]
        WEB_A[web-agent]
        NOTIF[mobile-notifications]
        LLM_USAGE[llm-usage-service]
    end

    WA --> INTEX
    WEB --> INTEX
    WEB --> FISH

    INTEX --> RES
    INTEX --> NOTE
    INTEX --> BOOK
    INTEX --> CAL
    INTEX --> CODE

    GH_PR --> CODE
    CODE --> ORCH
    ORCH --> CW
    CODE --> LIN

    RES --> USER
    RES --> IMG
    BOOK --> WEB_A
    FISH --> NOTIF
    FISH --> USER
    FISH --> LLM_USAGE

    RES --> NOTIF
    CODE --> NOTIF
```

---

## Documentation Coverage

| Metric                 | Count    |
| ---------------------- | -------- |
| Total Apps             | Active app docs tracked in `docs/services` |
| Total Workers          | 6        |
| Total Packages         | 28       |
| Apps with features.md  | Current service doc set |
| Apps with technical.md | Current service doc set |
| Apps with tutorial.md  | Current service doc set |
| Apps with tech-debt.md | Current service doc set |
| Apps with agent.md     | Current service doc set |
| Packages with README   | 28       |
| Workers with docs      | 4        |
| **Coverage**           | **App/package docs tracked; 4 of 6 workers documented** |

---

## Quick Links

### By Use Case

**I want to...**

- **Use WhatsApp text direct tools**: [intex-agent](intex-agent/features.md)
- **Do multi-model research**: [research-agent](research-agent/features.md)
- **Ask grounded fishing questions**: [fishing-assistant-service](fishing-assistant-service/features.md)
- **Automate coding tasks**: [code-agent](code-agent/features.md)
- **Save and summarize links**: [bookmarks-agent](bookmarks-agent/features.md)
- **Generate images**: [image-service](image-service/features.md)
- **Schedule events**: [calendar-agent](calendar-agent/features.md)
- **Manage Linear issues**: [linear-agent](linear-agent/features.md)
- **Turn thoughts into polished drafts**: [hellscript-agent](hellscript-agent/features.md)

### By Integration

- **WhatsApp**: [whatsapp-service](whatsapp-service/features.md)
- **Google Calendar**: [calendar-agent](calendar-agent/features.md)
- **Notion**: [notion-service](notion-service/features.md)
- **Linear**: [linear-agent](linear-agent/features.md)
- **Auth0**: [user-service](user-service/features.md)
- **GitHub**: [code-agent](code-agent/features.md)
- **Sentry**: [infra-sentry](../packages/infra-sentry/README.md)
- **OpenRouter**: [research-agent](research-agent/features.md) / [fishing-assistant-service](fishing-assistant-service/features.md) / [llm-usage-service](llm-usage-service/features.md)

### By Package Category

- **Core types and utilities**: [common-core](../packages/common-core/README.md)
- **HTTP middleware**: [common-http](../packages/common-http/README.md) / [http-server](../packages/http-server/README.md)
- **LLM integration**: [llm-contract](../packages/llm-contract/README.md) / [llm-factory](../packages/llm-factory/README.md)
- **Error tracking**: [infra-sentry](../packages/infra-sentry/README.md)
- **Database**: [infra-firestore](../packages/infra-firestore/README.md)
- **Messaging**: [infra-pubsub](../packages/infra-pubsub/README.md) / [infra-whatsapp](../packages/infra-whatsapp/README.md)
- **Observability**: [infra-sentry](../packages/infra-sentry/README.md)

---

**Last updated:** 2026-06-24

**Components tracked:** Active app docs, 6 workers, and shared packages (log-cleanup and predev-lifecycle have no service doc directories yet)
