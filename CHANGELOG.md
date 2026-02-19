# Changelog

## 3.0.0

- Added Code Agent service for autonomous code task execution — receives tasks from WhatsApp, web UI, and GitHub webhooks, dispatches to workers with HMAC-signed requests via Cloudflare Access (INT-246)
- Added Orchestrator worker for Docker-isolated Claude Code execution — spawns containers with git worktree isolation, Anthropic OAuth credential management, state persistence across restarts, and GitHub App token rotation (INT-272)
- Added two-phase execution model: Phase 1 design agent enriches Linear issues and creates subissues, Phase 2 strict execution agent implements code, runs CI, creates PR, and updates Linear (INT-486)
- Added LLM-based completion verifier (Gemini) that checks each worker attempt against a completion contract with automatic resume via `--continue` for incomplete tasks
- Added Intex Chat with real-time conversational AI — full `chat-agent` service with WebSocket support, conversation history, and guest sessions (INT-431)
- Added dark mode across web application with `ThemeContext` provider and Tailwind `dark:` classes
- Added task retry mechanism with context preservation, `retriedFrom` linking, and 1-minute cool-off period (INT-524)
- Added task messaging for running and completed tasks — messages queue during execution and trigger `--continue` resume on terminal tasks
- Added Dash0 OpenTelemetry integration with `infra-otel` package and pino transport for distributed tracing
- Added guest chat sessions with rate limiting for unauthenticated access
- Added markdown editor with `@uiw/react-md-editor` for rich code task authoring (INT-451)
- Added default model selector supporting 5 AI providers — Opus, Sonnet, Gemini, GPT, GLM
- Added Linear issue selection with LLM-generated titles in combobox modal (INT-452)
- Added Linear webhook sync with HMAC-validated real-time Firestore persistence replacing polling (INT-444)
- Added Linear subissue display in `LinearIssuesPage` with `SubIssuesList` component
- Added worker configuration UI for managing worker URLs, Cloudflare Access credentials, and signing secrets
- Added prompt versioning with semver — 26+ prompts with `version` field and CI-enforced version bumps on content changes
- Added interactive WhatsApp approval buttons with cryptographic nonce validation and 15-minute TTL
- Added GitHub PR event tracking with Firestore persistence and `PREventsPage` in web UI
- Added 100% branch coverage enforcement across all services with `v8 ignore` category validation (INT-427)
- Changed orchestrator communication from Firestore-based to HTTP-only with HMAC-signed webhooks (INT-472)
- Changed worker authentication from static API keys to Anthropic OAuth with Max subscription and automatic token refresh
- Changed secret naming from `DISPATCH_SIGNING_SECRET` to `INTEXURAOS_ORCHESTRATOR_SECRET`
- Changed API key secret names to `*_APP_API_KEY` convention (`ZAI_APP_API_KEY`, `OPENAI_APP_API_KEY`, `GEMINI_APP_API_KEY`)
- Changed worker execution from interactive TTY to `--print --output-format stream-json` mode
- Changed local development to PM2 with DevBar and hot-reload via `watch: true`
- Changed unified Linear issue templates with structured sections for test requirements, scope, and acceptance criteria (INT-486)
- Improved LLM prompt quality across 27 prompts with audit, semver versioning, and domain-specific refinements
- Improved log transcript visibility with `[prompt]`, `[instructions]`, and `[queued]` tags for task messaging
- Fixed orchestrator silently dropping logs by removing `MAX_CHUNKS_PER_TASK` limit
- Fixed ANSI escape codes leaking into container log output
- Fixed orchestrator using host worktree path instead of `/repo` in system prompt
- Fixed log mixing on task resume by clearing old log lines before appending new ones
- Fixed GitHub token mint errors being silently swallowed instead of propagated
- Fixed queued messages tracked in orchestrator memory instead of Firestore, causing loss on restart
- Fixed worker health status showing false positives for offline workers
- Fixed secrets directory inode corruption during worker container preservation

## 2.0.0

- Added WhatsApp text reply support for approval requests with LLM-based intent classification (INT-161, INT-203)
- Added WhatsApp reactions (👍/👎) for approving/rejecting approval messages
- Added calendar event preview generation showing title, time, duration before approval (INT-189)
- Added GLM-4.7-Flash as Zai AI model with 200K context window (INT-187)
- Added LLM model selection in WhatsApp research messages (e.g., "research AI using gemini and claude") (INT-178)
- Added AI-generated bookmark summaries delivered via WhatsApp (INT-210)
- Added `/linear` skill with auto-splitting for complex multi-step tasks (INT-209)
- Added `/sentry` skill for error triage, investigation, and cross-linking
- Added `/document-service` skill for unified service documentation (INT-214)
- Added Linear board 3-column layout with Todo, To Test categories (INT-208)
- Added Zod schema migration for context inference guards with field-level validation (INT-86)
- Changed Linear random selection to pick from Todo state only (INT-206)
- Changed issues to transition to QA state after PR approval instead of Done (INT-207)
- Changed WhatsApp transcription UI to typing indicator with "Transcribing..." text (INT-205)
- Changed command classification to isolate URL keywords and prioritize explicit intent (INT-177)
- Changed AI summaries to use user's own LLM with language preservation (INT-213)
- Changed Z.ai GitHub trigger from `@zai-claude` to `@zaiclaude` (INT-179)
- Fixed race condition in concurrent WhatsApp approval replies using Firestore transactions (INT-211)
- Fixed duplicate actions created from approval replies (INT-201)
- Fixed calendar preview documents not deleted after event creation (INT-200)
- Fixed OpenGraph link preview errors with browser-like headers (INT-191)
- Fixed misleading "API key invalid" error for rate limit responses (INT-199)
- Fixed approval event publishing when actionId found (INT-202, INT-212)
- Removed `packages/llm-common/` — migrated to `llm-factory`, `llm-prompts`, `llm-utils` (INT-228, INT-229, INT-241, INT-242)

## 1.5.0

- Added page summarization via Crawl4AI Cloud API for bookmarks
- Added Auth0 Lock widget on login page replacing redirect-based flow
- Added user info and branding in research report headers
- Added idempotency checks preventing duplicate Linear issues and calendar actions
- Added Force Refresh option in user dropdown clearing all PWA caches
- Added Terraform module for `claude-code-dev` service account
- Changed `ActionFeedback` to `ServiceFeedback` with standardized error codes
- Changed Speechmatics transcription with 30+ project-specific vocabulary terms
- Changed `llm-common` package reorganized into domain directories
- Changed `ActionItem` component with manual dismissal and retry mechanism
- Fixed calendar week navigation starting on Monday instead of Sunday
- Fixed calendar notification links redirecting to inbox
- Fixed action execute endpoint schema missing message field
- Fixed iPad actions views layout
- Fixed user-friendly message for Anthropic billing errors

## 1.4.0

- Added Todos Agent for task management with Pub/Sub processing
- Added Notes Agent for note-taking with tags and sources
- Added App Settings Service for centralized LLM pricing
- Added Image Service for prompt generation and image generation via multiple providers
- Added Data Insights Agent for composite feeds and visualizations
- Added Web Agent for internal link preview generation
- Added Bookmarks Agent with conflict resolution and Pub/Sub processing
- Added `llm-pricing` package for centralized cost calculation
- Added `llm-audit` package for usage tracking and validation
- Added DataInsightsPage, BookmarksListPage, NotesListPage, TodosListPage to web UI
- Added CalendarPage and GoogleCalendarConnectionPage
- Added LlmCostsPage and LlmPricingPage for cost tracking
- Added ModelSelector component for LLM model selection
- Added VegaChart component for Vega-lite chart rendering
- Added two-phase context inference for research prompts
- Added Gemini-generated collapsible input context labels
- Added GPT-5.2 and GLM-4 (Zai provider) pricing support
- Added image generation via Gemini native (`nano-banana-pro`/`gemini-2.5-flash-image`)
- Changed `llm-orchestrator` → `research-agent` for descriptive naming
- Changed `commands-router` → `commands-agent` for consistent naming
- Changed `data-insights-service` → `data-insights-agent`
- Changed `whatsapp-service` domain from `inbox` to `whatsapp`
- Changed model selection UI with improved UX
- Changed mobile-optimized components and header navigation
- Fixed `Crypto.randomUUID` type conflicts with explicit imports
- Fixed GPT-image-1 handling both `b64_json` and `url` response formats
- Fixed environment variable inconsistencies across services
- Improved PWA Share Target redirect for HashRouter compatibility

## 1.0.0

Initial release with core platform functionality.

- Added Actions Agent for action management with status workflow (pending → completed/failed)
- Added User Service with Auth0 integration and OAuth Device Authorization Flow
- Added WhatsApp Service for message handling with media support
- Added Mobile Notifications Service for notification aggregation
- Added Notion Service for prompt storage integration
- Added PromptVault Service for prompt template management
- Added Research Agent for multi-LLM research orchestration
- Added Commands Agent for natural language command processing
- Added Data Insights Agent for user data analysis
- Added React web application with PWA support
- Added WhatsApp Business Cloud API integration
- Added Google Gemini, OpenAI GPT, Anthropic Claude integrations
- Added Speechmatics transcription for voice messages
- Added Firebase Authentication and Firestore integration
- Added public research sharing with HTML generation
- Added LLM token usage and cost tracking
- Added hexagonal architecture with domain-driven design
- Added 95% test coverage requirement with Vitest
- Added Terraform infrastructure as code for GCP
- Added pnpm monorepo with 21 shared packages
