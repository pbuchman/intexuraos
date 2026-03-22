# Changelog

## 3.4.0

### Added

- Hellscript Agent with backend service, web UI, and Terraform infrastructure (INT-1032)
- Cron Agent backend service for scheduled task execution (INT-957)
- Merge Queue for automatic PR queuing and merging (INT-1020)
- Review agent plan awareness for requirements validation (INT-1038)
- Merge conflict detection via dedicated cron reconciliation job (INT-1023)
- Orchestrator Linear proxy — removed direct dependency via code-agent (INT-1040)
- Auto-enforcement of code review findings (INT-926)
- Unified task enqueue service with queue-first dispatch (INT-950)
- Plan-based review dispatch mode (INT-1039)
- GitHub Event Log expandable rows with raw webhook payloads (INT-1027)
- Automatic sub-task creation and dispatch from parent tasks (INT-962)
- Task archiving and deletion from code task view (INT-959)
- Code task title display on mobile PWA (INT-1058)
- Visual indicator for queued code tasks (INT-939)
- Start code tasks directly from list view (INT-947)
- Cloud Scheduler trigger for merge queue tick (INT-1049)
- Worker instruction sections in orchestrator system prompts (INT-972)
- Selective container preservation by agent type (INT-973)
- Horizontal scroll for code task logs (INT-948)
- Compact pipeline labels for mobile layout (INT-976)
- Filter pills and sorting on GitHub Event Log page (INT-1007)
- Fetch error cause chain logging in orchestrator (INT-1016)
- Bypass dedup Layer 3 for merge-conflict tasks (INT-1015)
- Yes/Cancel buttons replacing text confirmation prompts (INT-933)

### Improved

- Research pages with standardized UX, decomposed components, and consistent layout (INT-992)
- Research pipeline quality across stages T0 through T6 (INT-981)
- Review prompts with requirements validation emphasis (INT-1054)
- Merge queue reliability — GitHub as source of truth, Firestore as cache (INT-1048)
- Keyword detection for worker type selection in code actions (INT-217)
- Mobile Notifications list page with sorting and compact rows (INT-1001)
- Code task queue capacity increased from 10 to 50 (INT-1029)
- Code task queue TTL extended to 6 hours, execution limit to 3 hours (INT-931)
- Task group progress tracking with simplified sort options (INT-960)
- Merge queue sort order and reduced page clutter (INT-1042, INT-1046)
- Standardized Inbox, WhatsApp Notes, Notes, Visualizations, Composite Feeds, LLM Costs, and Worker Settings pages (INT-998, INT-999, INT-1002, INT-1004, INT-1005, INT-1008, INT-1003)

### Changed

- Redesigned GitHub Event Log to 6-column table layout (INT-1013, INT-1018)
- Replaced hero terminal on landing page with dashboard and WhatsApp showcase (INT-942)
- Removed legacy V1 code task view and standardized task URLs (INT-936)
- Renamed "Task History" to "Battlefield" in sidebar navigation (INT-955)
- Migrated MiniMax model from M2.5 to M2.7 (INT-1009)
- Merged duplicate queued review tasks per PR in dispatch queue (INT-1014)
- Filtered unsupported event types from GitHub Event Log (INT-1025)
- Simplified WhatsApp queued-task notification message (INT-974)

### Fixed

- GitHub events not displaying on mobile (INT-1061)
- Complex-task fan-out submission from UI (INT-975)
- Code task TIME column not updating in real time (INT-941)
- White screen on task page from missing STATUS_MAP fallback (INT-994)
- Race condition in PR automation logging causing duplicate comments (INT-925)
- Review task Linear issue linking via PR body parsing (INT-969)
- Dispatch Queue Firestore listener permissions (INT-967)
- Missing `parentId` in `mapSingleIssueWithTeam` causing false subtask rejection (INT-953)
- Queue position off-by-one and fan-out parent pollution (INT-977)
- Code task implementation failing with 400 error (INT-954)
- Merge queue missing header and menu on mobile (INT-1041)
- PWA toggle failing to enable Merge Queue (INT-1055)
- Duplicate Linear button in PWA task view (INT-1056)
- HMAC signature mismatch on task-event webhooks (INT-1010)
- Base branch fetch before worktree creation (INT-984)
- Dispatch queue UI failing to display tasks (INT-970)
- Missing approval button in Actions view modal (INT-944)
- Code task status showing 'running' when queued or dispatched (INT-961)
- Missing environment variables after ZAI removal (INT-968)
- Flexible width for desktop pipeline steps (INT-980)
- Pill container around pulsing status dot (INT-979)

## 3.3.0

### Added

- GitHub Agent with tool calling for PR evaluation and unified webhook evaluator (INT-743, INT-744)
- Unified PR automation log showing all PR actions in one place (INT-852)
- Code Task Detail Page V2 with issue-centric grouped view (INT-742)
- Structured output validation and automatic repair prompt for GitHub Agent triage (INT-839)
- Alibaba Cloud Model Studio integration for Chinese LLMs — Qwen, Kimi, GLM-5 — replacing ZAI provider (INT-832, INT-833, INT-835, INT-836)
- Gemini tool-call mode enforcement with retry on LLM failure and live pipeline progress display (INT-854)
- Mandatory `/simplify` step in orchestrator workflow with refactoring reference docs (INT-856)
- Fresh-start review dispatch with notification dedup and reliable review agent (INT-834)
- PR branch inheritance across code task retries (INT-824)
- Planning-task label gate for autonomous planning
- `already_completed` execution outcome label (INT-773)
- Dispatch retry queue for failed webhook dispatches (INT-823)
- Execution deep validator for post-completion transcript analysis (INT-746)
- GitHub event decision log for auditable triage decisions (INT-831)
- Code task logs preview modal (INT-816)
- `@review` issue comment triage with LLM-selected worker routing (INT-829)
- Periodic stale worker cleanup (INT-828)
- Queue support for review tasks (INT-921)
- Docker health gate and container creation timeout (INT-920)
- Capacity-aware task dispatch (INT-741)
- Default review worker type per-user setting
- Code review dispatch for bot-opened PRs with loop prevention
- `@worker`/`@model` directive for task dispatch
- `Started At` sorting and multi-column sort for code tasks (INT-812, INT-815)
- `reviewed` status to code tasks list filter (INT-808)
- Review tasks with linked PRs in code list (INT-819)
- Cost info in deep validation PR comments

### Changed

- Tasks created in `queued` state, transitioned to `dispatched` on confirmed dispatch (INT-807)
- Deep validation PR comments simplified to plain markdown with tabular format (INT-820)
- Removed success outcome notifications, renamed to failure-only (INT-843, INT-846)
- Removed redundant automated triage PR comments (INT-924)
- Consolidated review prompt into single `POST /reviews` call
- PR description format strengthened with mandatory model name (INT-855)
- Workers status indicator moved to user menu (INT-745)
- GitHub Agent migrated from static bot token to per-user OAuth tokens

### Fixed

- Docker exec stream leak causing successful tasks to hit 2h timeout (INT-802)
- Silent dispatch failures and nested transaction bug (INT-810, INT-811)
- Merge conflict detection for bot-authored PRs (INT-847)
- PR comment routing preserved on redispatch (INT-619)
- Review task dedup and active-task semantics (INT-825)
- PR dispatch acks made restart-safe (INT-826)
- Gemini tool calling loop and Firestore automation log path (INT-917)
- Docker cache busting for Claude CLI + added Codex CLI (INT-922)
- `getAccessToken` identity stabilized to prevent double-fetch
- Worktree git operations serialized with async mutex
- `createdAt` fallback for started-time sort (INT-850)
- `dispatchedAt` added to all dispatch paths, Qwen label recognition fixed (INT-849)
- Terraform GitHub App secrets restored after accidental removal (INT-814)

### Improved

- Orchestrator reliability: deep validation plans from Linear, fatal exit code handling, resume result preservation (INT-817, INT-818)
- Repo-manager startup with resilient sanitization and graceful fetch (INT-821)
- PR event log with noise filtering and added context (INT-918)
- GitHub Event Log redesigned with compact inline layout (INT-844)
- Code Tasks TIME column shows both created and started timestamps
- Worker Settings UI with better spacing and in-button spinner
- Firestore performance with batched reads replacing sequential queries
- Deep validation with visual severity indicators and system context (INT-841)
- Explicit PR comments for review skips, dispatch rejections, and outcomes (INT-830)
- v8 ignore enforcement hardened with tighter detectors and override mechanism

## 3.2.0

### Added

- Agent-based routing architecture with label-based dispatch — requests automatically routed to the right specialist based on issue labels (INT-718)
- Implement button and planning-to-PR lifecycle — planned tasks kicked off with one click
- Task queueing — new requests wait in line when all workers are busy instead of being dropped (INT-619, INT-624)
- PR comment to code task creation with improved webhook handling (INT-618, INT-704, INT-668)
- New AI models: Qwen, Sonnet, and MiniMax worker types for more flexibility (INT-703, INT-710, INT-706)
- WhatsApp CTA buttons and deep links — tap to navigate directly to tasks and actions (INT-730, INT-738, INT-727, INT-732)
- WhatsApp task progress notifications so users stay informed on their phone (INT-628)
- User-level transcription preferences for per-user voice message settings (INT-683)
- CI-enforced prompt versioning — all prompt changes tracked and versioned (INT-709)
- Calendar event previews and rich message formatting for more informative responses (INT-535, INT-621)
- Live Linear data hydration — task views always show latest issue information
- Code task view UI enhancements — status badges, live data, delete controls, richer detail display (INT-723, INT-729, INT-724, INT-719)
- Auto-archival of previous task attempts when retrying (INT-711)
- Automatic Docker container cleanup on a daily schedule (INT-523)
- Interactive release prioritization page for streamlined release workflows
- Formatted markdown rendering in the task detail view (INT-739)
- Debug skill for faster code task troubleshooting
- Mandatory reading of Linear issue comments so AI has full context before starting work (INT-715)
- GitHub username to Code Settings for easier identification (INT-627)
- Worker type selection when retrying or implementing tasks (INT-630)
- AI-generated rich task summaries for a quicker overview of each task
- Sample data for easier testing and onboarding (INT-536)
- Environment identification so services clearly report which environment they run in (INT-677)
- Tool recommendation hooks for smarter tool suggestions during task execution (INT-675)
- Container lifecycle documentation for operational clarity (INT-620)
- Daily scheduled worker rebuild to keep containers up to date
- Evidence-check stop hook to ensure tasks provide proof of completion
- PR title format guidance to orchestrator prompts for consistent naming (INT-666, INT-661, INT-662)
- Code-agent, linear-agent, and web-agent to the documentation hub
- Worker type requirement in PR descriptions for better task dispatch
- Base branch test coverage to the task dispatcher (INT-625)
- PWA 1024x1024 icon for home screen installs
- `og-image.png` for social media previews
- Google Analytics tracking
- Negative complexity examples to the planning prompt
- GCP project ID to internal documentation
- OpenRouter integration design document
- Compact log viewer layout for iPad

### Changed

- Migrated audio transcription to event-driven architecture — dedicated worker processes voice messages via Pub/Sub instead of inline in whatsapp-service (INT-684, INT-682, INT-685, INT-616)
- Cancelled tasks now accept messages so users can continue the conversation (INT-714)
- Reordered sidebar navigation and removed daily cost limit display
- Default AI model only uses models the user has API keys for (INT-571)
- Gemini responses log summaries instead of raw data
- Increased orchestrator message length limit to 20k characters

### Improved

- PR review quality with better instructions and formatting for code review feedback (INT-631, INT-673, INT-655)
- Prompt injection hardening across all agent prompts (INT-413)
- Website redesign with refreshed look and feel
- Message classification with higher title character limit and new code task type
- Log readability by summarizing long JSON array results (INT-687)
- Session resume log messages simplified to reduce noise (INT-712)
- Token usage by optimizing internal instruction size
- Retry analysis with adaptive logic that learns from failure patterns
- Webhook security by extracting shared secret utilities (INT-614)
- Container startup reliability by moving secret sync to the entrypoint
- Orchestrator log noise reduced by cleaning up verification messages (INT-693)
- Orchestrator observability with better monitoring and diagnostics
- Auto-retry prompts for the verifier to reduce false failures (INT-625)
- Conditions for when a code task should be triggered
- Handling of trivial planning tasks to avoid unnecessary overhead
- Prompt reliability with schema and contract fixes across multiple agents (INT-595, INT-596, INT-605, INT-606, INT-604, INT-608, INT-607, INT-609)
- PR comment routing to reuse existing tasks instead of creating duplicates (INT-668)
- `/share` skill reliability
- Rate limit and diff log formatting
- Single-comment enforcement in PR review prompts

### Fixed

- Session isolation preventing data from one task leaking into another (INT-713)
- PR task lock cleanup so stale locks no longer block new tasks (INT-705)
- Linear sync correctly handling issues across multiple users (INT-623)
- Retry logic for Cloudflare 520-530 errors to reduce failed requests (INT-736)
- Confirmation inbox link navigating to the correct page (INT-735)
- Container setup issues with repo syncing and environment file mounting (INT-690)
- Race condition in subtask normalization causing duplicate entries (INT-681)
- Create-new flow not reappearing after canceling a link-existing action (INT-707)
- Logs view losing auto-scroll after sending a message (INT-719)
- Incorrect AI model reference causing unexpected behavior (INT-716)
- Agent type preservation on task retry so PR tasks keep their correct type (INT-657, INT-654)
- Classifier incorrectly treating date mentions as calendar events (INT-622)
- Verifier confidence scoring range for more accurate results (INT-602, INT-603)
- Bot-authored PR comments being incorrectly processed as user requests (INT-702)
- Session data bleeding across resumed tasks
- Markdown link wrappers breaking webhook URLs (INT-659)
- Raw JSON appearing in user-facing log messages (INT-628)
- Delete Task button not showing when it should (INT-676)
- Security issue where hook scripts could be run directly outside their intended context
- Raw tool result data removed from log display for a cleaner experience (INT-689)
- Header logo aspect ratio on mobile
- OG meta tags domain and inspect polling behavior
- Website metatags for better search visibility
- Invalid GitHub CLI field names
- Nitpick-nuker status verdict and table formatting
- PR comments being dropped for already-dispatched tasks
- Raw rate limit JSON appearing in orchestrator logs
- Code-agent logger incorrectly discarding request logs
- Implementation phase using the wrong prompt template
- Verification transcript growing too large (added truncation)
- Orchestrator URL normalization for credentials
- Orchestrator API key validation logging
- Long branch names overflowing the status line
- Incorrect agent-type mismatch warning removed
- Repo owner resolution for bot senders
- `tool_use_error` XML tags removed from log output

## 3.1.0

- Added auto-triggering of code tasks on Linear issue assignment — newly assigned Todo issues without "Code Task" label automatically dispatch to Phase 1 design
- Added sender whitelist for webhook dispatch replacing scattered filters with single `isAllowedSender()` check for `claude[bot]`, `chatgpt-codex-connector[bot]`, and repo owner
- Added dispatch and triage of edited `claude[bot]` review comments with review triage instructions
- Added simplified PR comment auto-response — replaced Gemini classification and batching system with minimal dispatch to worker via `gh` CLI (INT-465)
- Added PR body deduplication across `pull_request` events to prevent repeated Summary sections in timeline
- Added dynamic CPU core detection via cgroup v2 `cpu.max` with formatted metrics in code task logs
- Added activity heartbeat to code task log stream during Docker silence periods
- Added retry logic with exponential backoff for GitHub token minting using `@octokit/plugin-retry`
- Added git identity configuration for Docker worker containers via `INTEXURAOS_GIT_USER_NAME`/`INTEXURAOS_GIT_USER_EMAIL` env vars
- Added active goal injection into orchestrator system prompt on resume
- Added Phase 2 enhancements with planning stage, dual code review loop, and turn summary
- Added collapsible tool output blocks in log viewer with per-block expand/collapse and `(+N lines)` badges
- Added multi-status filtering for code tasks with comma-separated status support and `limit+1` pagination fix
- Added expandable PR events timeline replacing static Summary card on code task detail page
- Added assignee name display on Linear board issue cards
- Added prompt sanitization utility stripping AWS keys, API tokens, PEM keys, and sensitive URL parameters from worker inputs (INT-612)
- Added `/tech-debt-triage` skill for scanning technical debt docs and creating consolidated Linear issues
- Changed completion verification to be lenient for user-resumed tasks
- Changed `@claude` and `@codex` PR comment mentions to skip webhook dispatch (handled by GitHub Actions)
- Improved 27 LLM prompts across all domains — fixed unsafe casts, XML delimiters, date injection, and migrated `approvalIntentPrompt` to PromptBuilder
- Improved `/code/submit` timeout from 30s to 90s with server-side 120s safety net and timeout-aware error recovery UI (INT-505)
- Improved CI pipeline from 5m to 3m43s with 3-way test sharding, parallel type/lint matrix, and artifact-based coverage reports
- Removed scheduled snapshot refresh saving ~zł50/week in LLM token costs
- Fixed worker reorder buttons not rendering in settings UI
- Fixed webhook assignment dedup using unique `actionId` with identifier+timestamp format instead of per-team `webhookId`
- Fixed dedup errors propagating as 409 instead of generic 500
- Fixed delete confirmation patterns across 9 web pages using consistent red banner with Button components
- Fixed filter panel and sidebar collapse state not persisting across page refresh
- Fixed Linear issue not transitioning to In Review on task-complete webhook
- Fixed auto-trigger prompt using Phase 2 language for Phase 1 design tasks
- Fixed browser autofill on worker secret fields with `autoComplete="new-password"` (INT-501)
- Fixed turn metrics JSONL collection reading from wrong path in shared credentials mode
- Fixed `prNumber` and `prBranch` not populated on task completion breaking PR comment lookup (INT-465)
- Fixed null assignee handling in Linear board display and issue list guards
- Fixed `linearIssueId` missing from dedup key causing false duplicate rejections
- Fixed assignee data loss during full sync in linear-agent (INT-573)
- Fixed git identity in worker containers overridden by parent repo config
- Fixed calendar approval linking to internal path instead of Google Calendar (INT-585)
- Fixed auto-created Linear issues skipping Phase 1 by removing pre-applied "Code Task" label (INT-610)
- Fixed calendar events requiring manual approval above 90% confidence threshold (INT-610)
- Fixed error logging in orchestrator token refresh and linear-agent using raw error objects for stack traces
- Fixed Docker container resource limits preventing proper execution
- Fixed Terraform startup probe failure threshold for flaky deploys

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

## 2.1.0

- Added `@intexuraos/internal-clients` package — eliminated ~4,200 lines of duplicate code across 8 services with shared user-service client (INT-269)
- Added Zod schema validation for all 8 LLM response types with field-level error messages (INT-218)
- Added structured `UsageLogger` class across all 5 LLM client packages with proper dependency injection (INT-266)
- Changed Cloud Build machine types for 63% cost reduction ($98 to $36/month) while staying under 15-minute SLA (INT-243)
- Fixed race condition causing duplicate WhatsApp approval notifications by extending direct execution pattern to all action types

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
