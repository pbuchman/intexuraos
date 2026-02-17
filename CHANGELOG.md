# Changelog

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
