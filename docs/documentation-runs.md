## 2026-03-07 — todos-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/todos-agent/features.md` — Typographic refresh (ASCII double-dashes to em-dashes throughout)
- `docs/services/todos-agent/technical.md` — Added v3.2.0 release commit to Recent Changes, typographic refresh
- `docs/services/todos-agent/tutorial.md` — Typographic refresh (em-dashes, en-dash in time range)
- `docs/services/todos-agent/technical-debt.md` — Added v3.2.0 release to Recent Improvements and Resolved Issues, typographic refresh
- `docs/services/todos-agent/agent.md` — Typographic refresh (em-dashes in constraints table)
- `docs/documentation-runs.md` — This entry

**Inferred Insights:**

- Why: Most task management tools demand productivity to maintain — you end up managing your task manager instead of managing your work. Todos-agent eliminates capture friction by letting users describe tasks in natural language, with AI decomposing descriptions into structured, prioritized items automatically.
- Killer feature: AI-powered item extraction — describe work in plain language and the LLM parses it into discrete actionable items with priorities and due dates, validated by Zod schemas, with graceful fallbacks when extraction fails.
- Future plans: Todo templates, recurring todos, task dependencies, bulk operations, full-text search, collaboration features, reminders, and subtask nesting.
- Limitations: No recurring tasks, no task dependencies, no reminders, no collaboration, one level of depth (items cannot contain sub-items).

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- Code duplicates: 1 (parseDate function in two route files)

**Changes Since Last Run (2026-03-07):**

- Release v3.2.0 commit added to Recent Changes table
- Typographic consistency: All ASCII double-dashes (`--`) replaced with em-dashes (`—`) across all five files
- No functional code changes to todos-agent since previous documentation run

---

## 2026-03-07 — transcription (typographic refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/transcription/features.md` — Replaced ASCII double-dashes with em-dashes throughout
- `docs/services/transcription/technical.md` — Replaced ASCII double-dashes with em-dashes; added v3.2.0 release commit to Recent Changes table
- `docs/services/transcription/tutorial.md` — Replaced ASCII double-dashes with em-dashes throughout
- `docs/services/transcription/technical-debt.md` — Replaced ASCII double-dashes with em-dashes; replaced hyphens with en-dashes in line ranges
- `docs/services/transcription/agent.md` — Replaced ASCII double-dashes with em-dashes throughout
- `docs/services/index.md` — Fixed transcription description em-dash
- `docs/documentation-runs.md` — This entry

**Inferred Insights:**

- Why: Audio content from WhatsApp voice notes is opaque and unsearchable. The transcription worker converts audio files to structured text so downstream services can extract tasks, generate summaries, and enable full-text search.
- Killer feature: 7-step orchestration pipeline with guaranteed event delivery (always publishes TranscriptionCompletedEvent regardless of success or failure), 100+ custom vocabulary terms for domain-specific accuracy, and automatic language detection with AI-generated summaries.
- Future plans: Add alternative transcription providers (Google Speech-to-Text, OpenAI Whisper), streaming transcription support, per-user vocabulary customization.
- Limitations: WhatsApp-only trigger, Speechmatics-only provider, batch processing with polling (no streaming), ~5 minute max polling window.

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (v8 ignore blocks for error extraction utilities in adapter.ts)
- Test gaps: 0 (6 test files covering all modules)
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (2026-03-07 initial -> 2026-03-07 refresh):**

- Typographic consistency: Replaced all ASCII double-dashes (`--`) with em-dashes (`—`) in prose text across all 5 documentation files
- En-dash ranges: Replaced hyphens with en-dashes (`–`) in line number ranges in technical-debt.md
- Recent changes: Added v3.2.0 release commit (`44ea683a`) to technical.md

---

## 2026-03-07 — api-docs-hub (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/api-docs-hub/features.md` — Replaced all ASCII double-dashes with em-dashes for typographic consistency
- `docs/services/api-docs-hub/technical.md` — Updated package version from 3.1.0 to 3.2.0, added v3.2.0 release commit to Recent Changes, replaced all ASCII double-dashes with em-dashes, removed specific line counts from File Structure section
- `docs/services/api-docs-hub/tutorial.md` — Replaced all ASCII double-dashes with em-dashes, fixed troubleshooting table pipe escaping
- `docs/services/api-docs-hub/technical-debt.md` — Replaced all ASCII double-dashes with em-dashes, added v3.2.0 package version bump to Resolved Issues
- `docs/services/api-docs-hub/agent.md` — Updated package version from 3.1.0 to 3.2.0, replaced all ASCII double-dashes with em-dashes
- `docs/site-index.json` — Removed version reference from api-docs-hub summary (no valid tag for 3.2.0 yet)

**Inferred Insights:**

- Why: API documentation scattered across 18 microservices; developers need a single entry point to discover and test all endpoints
- Killer feature: Multi-spec Swagger UI aggregation with live client-side spec fetching — documentation always reflects the currently deployed API
- Future plans: Dynamic config reload, spec caching, authentication helper, API version selector, cross-spec search, ecosystem.config.cjs integration
- Limitations: Service must be running for spec to load, no version history, no built-in auth, static configuration requires redeployment

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (raw reply.send() in health endpoint — intentional)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (2026-03-07 previous -> 2026-03-07 current):**

- Package version bumped from 3.1.0 to 3.2.0 (release commit 44ea683a)
- No source code changes — only version bump in package.json
- Typographic consistency: all ASCII double-dashes replaced with em-dashes across all 5 doc files

---

## 2026-03-07 -- orchestrator (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/orchestrator/features.md` -- Updated multi-model support (6 worker types), container adoption, forensics mode, Gemini-only verification with Zod schemas, planning PR branch merging, updated key benefits and limitations
- `docs/services/orchestrator/technical.md` -- Added new Recent Changes sections (PromptBuilder, multi-model, forensics, container adoption, send-message, planning PR merge), updated WorkerType to 6-member union, updated TaskVerificationRecord to simplified schema, added CredentialMonitor/CredentialRefresher/ApiKeyValidator docs, added new env vars
- `docs/services/orchestrator/tutorial.md` -- Added agent type task submission examples (planning and execution with planningPrBranch), added sendMessage step, updated workerType documentation to 6 types, added troubleshooting rows for MiniMax/Alibaba Cloud API keys and container adoption
- `docs/services/orchestrator/technical-debt.md` -- Updated date and analysis run version to v3.1.0; all 11 debt items unchanged (none resolved since last run)
- `docs/services/orchestrator/agent.md` -- Updated WorkerType from 3 to 6 types, updated TaskVerificationRecord to simplified schema, added planningPrBranch/planningPrUrl/resumedAfterSuccess to Task, updated message limit from 10000 to 20000 chars, updated TaskResult fields, updated startup recovery to include container adoption, added new env vars, updated constraints
- `docs/services/index.md` -- Updated orchestrator worker description with multi-model support and new features
- `docs/site-index.json` -- Updated orchestrator features list and endpoint count; updated claude-worker worker types to 6
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Every AI coding agent asks for your code on their servers. For companies with compliance requirements, proprietary algorithms, or customer data in the repo, that is a non-starter. The orchestrator eliminates this by running autonomous coding agents on your own hardware behind an outbound-only tunnel, keeping source code on your network while sending only task status, logs, and metrics to the platform.
- Killer feature: Container adoption on restart -- the orchestrator discovers running Docker containers on startup and re-attaches to them (monitoring, log forwarding, token refresh) instead of marking tasks as interrupted, making the system resilient to process crashes and reboots without losing in-flight work.
- Future plans: Multi-machine orchestration via Pub/Sub task queue, container image versioning with rolling updates, task priority queue with preemption, operational metrics and alerting dashboard. Two TODO comments remain (default repository hardcoded, admin shutdown endpoint not wired to shutdown logic).
- Limitations: Single machine per orchestrator, Docker required, Cloudflare tunnel required, 2-hour attempt ceiling, 4MB log cap, Gemini verifier dependency (tasks fail rather than complete unverified)

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 2 (default repository hardcoded, admin shutdown not wired)
- Architectural gaps: 4 (duplicate JWT libraries, no horizontal scaling, no verifier circuit-breaker, no graceful container cancel)
- Missing features: 4 (no orchestrator-side retry, no worktree cleanup on completion, no resource monitoring, no local log persistence)

**Changes Since Last Run (2026-02-19 -> 2026-03-07):**

- Multi-model support: Added sonnet, minimax, qwen3.5-plus worker types with MINIMAX_APP_API_KEY and DASHSCOPE_APP_API_KEY env vars
- Container adoption: Startup recovery discovers running containers and re-attaches instead of interrupting
- Forensics mode: Core dumps, exec stream persistence, crash snapshots for failed containers
- PromptBuilder versioning: All system prompts use PromptBuilder interface with semver versions
- Planning PR branch merging: WorktreeManager.mergePlanningBranch() merges planning context into execution worktrees
- Send-message/task-resume: POST /tasks/:id/message with 20000 char limit, supports queuing and resume
- Simplified TaskVerificationRecord: Removed confidence, reasons, missingCriteria, resumeInstruction, usedLlm; replaced with passed, missingFields, verifierFailure
- Credential management: CredentialMonitor (read-only OAuth watcher), CredentialRefresher (Docker-based token refresh), ApiKeyValidator (5-minute cache)
- PR review overlay prompt: New prReviewOverlayPrompt PromptBuilder for execution tasks following planning phase

---

## 2026-03-07 -- linear-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/linear-agent/features.md` -- Updated multi-user fan-out mention, code-task label prompt selection, expanded auto-trigger description, updated key benefits
- `docs/services/linear-agent/technical.md` -- Added 12 recent commits to changes table, 5 new internal endpoints documented, multi-user fan-out webhook flow, composite key documentation, updated gotchas and file structure
- `docs/services/linear-agent/tutorial.md` -- Added Part 5 steps for comments/metadata/tree/display-batch, updated auto-trigger to show dual-prompt and backlog+unstarted, added Exercise 12 for multi-user fan-out testing
- `docs/services/linear-agent/technical-debt.md` -- Updated date; added 8 resolved issues (INT-623 fan-out, composite keys, comment routing, prompt selection, auto-trigger conditions); added SRP note for internalIssuesRoutes.ts growth to 933 lines; added v8 ignore density observation; added 5 new positive patterns
- `docs/services/linear-agent/agent.md` -- Added 5 new internal endpoints (comments, metadata, display-batch, get-issue, tree); added Pattern 8 (issue tree inspection); updated auto-trigger pattern for dual-prompt and backlog+unstarted; added 3 new constraints; updated internal endpoints summary to 12 entries
- `docs/services/index.md` -- Updated linear-agent highlights and AI column; updated date
- `docs/site-index.json` -- Updated linear-agent summary, features (8 items), and endpoint count (26); updated lastUpdated
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Capturing ideas during meetings means choosing between staying present and writing detailed issues. Linear Agent eliminates this tradeoff by turning voice notes and quick messages into structured, prioritized Linear issues through AI extraction, while keeping a local board copy that loads instantly without waiting for Linear's servers.
- Killer feature: Multi-user webhook fan-out (INT-623) with composite Firestore document keys -- the most architecturally significant recent change, enabling real-time board sync across all team members without cross-user data overwrite
- Future plans: Label passthrough in internal API, completedAt field for accurate archive cutoff, comment full sync for initial setup, consider splitting linearRoutes.ts (993 lines) and internalIssuesRoutes.ts (933 lines)
- Limitations: Linear only, voice input through WhatsApp only, AI extraction imperfect, 7-day closed window, one team per connection

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (module-level client cache, fire-and-forget async)
- Test gaps: 0 (100% branch coverage with v8 ignore exemptions)
- Type issues: 0
- TODOs: 0
- SRP violations: 1 (internalIssuesRoutes.ts at 933 lines approaching threshold)

---

## 2026-03-07 -- code-agent

**Action:** Updated (v3.1.0 -> v3.2.0)
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/code-agent/features.md` -- Added createTaskForPR flow, CTA URL buttons (INT-738), queue TTL limitation, multi-model benefit, archived status on retry (INT-711), injection sanitization detail, live Linear hydration
- `docs/services/code-agent/technical.md` -- Updated to v3.2.0; added GitHub PR Comment Dispatch diagram; 13 recent changes; 4 new use cases (createTaskForPR, backLinkPlanningTask, retryTask updates, sendTaskMessage); 3 new domain services (gitHubDispatchService, gitHubWebhookRules, createTaskForPR); new utilities; user-service dependency; new env vars; 6 new gotchas; updated CodeTask model; updated file structure
- `docs/services/code-agent/tutorial.md` -- Added injection rejection note, queued status explanation, archived status for retried tasks, model selection section with all WorkerType values, new troubleshooting entries (queue expiry, injection errors), corrected endpoint paths
- `docs/services/code-agent/technical-debt.md` -- Updated to 2026-03-07; ~3900 line count for codeRoutes.ts; added drain guard code smell; 9 new resolved issues (INT-711, INT-725, INT-738, Cloudflare retries, live Linear hydration, PR task creation, Linear labels, bot review triage, CPU core detection)
- `docs/services/code-agent/agent.md` -- Updated to v3.2.0; all WorkerType values (opus, auto, sonnet, minimax, glm, qwen3.5-plus); queued/archived statuses; planning result fields (planningTaskId, implementationTaskId); injection layer 2 detail; webhook rules engine; drain-queue pattern; user-service calls

**Inferred Insights:**

- Why: Developers need a way to dispatch AI coding tasks to dedicated worker machines without managing infrastructure directly. Code Agent bridges the gap between a user prompt and a fully managed coding session -- handling dispatch, security, lifecycle, and notifications.
- Killer feature: Four-layer task deduplication (approvalEventId, actionId, dedupKey, linearIssueId) combined with two-layer prompt sanitization (secret redaction + injection prevention) -- no other service in the monorepo has this depth of input safety.
- Future plans: Actual system prompt versioning (replace static hash placeholders with computed SHA-256), route splitting for codeRoutes.ts (continue extracting domain-specific route files).
- Limitations: Queue TTL is 30 minutes (tasks expire if no worker becomes available), single-instance drain guard (module-level boolean would break with horizontal scaling), ESLint disabled on largest route files.

**Documentation Coverage:** 100%

**Technical Debt Found:**

- TODOs: 2 (system prompt hash placeholders in processCodeAction.ts and codeRoutes.ts)
- Code smells: 4 (codeRoutes.ts ~3900 lines SRP violation, ESLint disabled on route files, module-level Map for health probe dedup, module-level boolean drain guard)
- Future plans: 2 (system prompt versioning, route splitting)
- TS strictness: 1 (Firestore Timestamp handling requires `as` casts)
- SRP violations: 1 (codeRoutes.ts -- high severity)
- Total: 10

**Changes Since Last Run (2026-02-22 -> 2026-03-07):**

- INT-413: Prompt injection sanitization (system keyword, base64, control char rejection)
- INT-711: Retried tasks archived to `archived` status, original linked via `retriedFrom`
- INT-725: Back-linking planning tasks to execution tasks via `implementationTaskId`
- INT-738: WhatsApp CTA URL buttons with deep links to PR and task dashboard
- Cloudflare 520-530 status codes treated as retryable infrastructure errors
- `linearIssueLabels` field added to CodeTask model
- Live hydration of Linear issue data via linearAgentClient
- `createTaskForPR` use case with lock guard and user lookup for PR comment task creation
- GitHub webhook rules engine (ActionableEventRule, SenderWhitelistRule, SkipPrefixRule)
- New WorkerType values: minimax, glm, qwen3.5-plus
- PR task locks via Firestore transactions for concurrent dispatch prevention
- Linear issue label-driven worker type selection
- CPU cores dynamic detection from cgroup (replaces hardcoded value)

---

## 2026-03-07 -- research-agent

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/research-agent/features.md` -- Updated "Refine Your Question" section to document semantic validation (multi-option detection, language preservation); added "Input quality guardrails" to Key Benefits
- `docs/services/research-agent/technical.md` -- Added 5 recent commits (99febe66 through 8fb90669); added "Input Validation (Semantic Checks)" subsection under Zod Schema Validation; added gotcha for semantic checks; updated file structure notes for InputValidationAdapter.ts
- `docs/services/research-agent/tutorial.md` -- Added new "Part 2: Validate and Improve Your Prompt" section with curl examples for validate-input and improve-input endpoints; added troubleshooting rows for language drift and multiple options; renumbered subsequent parts (3-8)
- `docs/services/research-agent/technical-debt.md` -- Updated date to 2026-03-07; added semantic check test coverage entry; added resolved issues for INT-609 (semantic checks) and INT-605 (thumbnail contract); added "Semantic guardrails" to Architecture Quality strengths
- `docs/services/research-agent/agent.md` -- Added `retrying` to ResearchStatus; added `originalPrompt`, `attributionStatus`, cost fields to Research interface; added InputContext, ShareInfo interfaces; added "Validate-Then-Create Flow" usage pattern; added "Input Validation Errors" section; fixed state machine diagram; added Max 5 Contexts and Max 6 Models constraints

**Inferred Insights:**

- Why: Users need answers they can trust, not single-model opinions. Querying multiple LLMs in parallel and synthesizing with conflict analysis provides consensus-based research that no single provider can deliver alone.
- Killer feature: Multi-model synthesis with per-topic conflict analysis, severity ratings, and full attribution -- the only service in the monorepo that orchestrates 5 LLM providers simultaneously and cross-references their conclusions.
- Future plans: Streaming responses (WebSocket/SSE), custom synthesis strategies, research collections/tags, learning from user model preferences, cost-aware model suggestion, provider fallback substitution.
- Limitations: No streaming (bulk delivery only), no re-export to Notion after initial export, no schema versioning for LLM response formats, repair telemetry not aggregated.

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (researchRoutes.ts 1662 lines, internalRoutes.ts 1035 lines -- both logically cohesive)
- Test gaps: 0 (100% branch coverage enforced)
- Type issues: 0
- TODOs: 1 (NotionServiceClient port interface needed in runSynthesis.ts)
- SRP violations: 1 (researchRoutes.ts -- acceptable given domain cohesion)
- Deprecations: 2 (getResearchPageId/saveResearchPageId in researchExportSettingsRepository.ts)

**Changes Since Last Run (2026-02-22 -> 2026-03-07):**

- INT-609: Semantic checks for input improvement -- multi-option detection and language drift heuristics in InputValidationAdapter (8fb90669)
- INT-605: Thumbnail output contract alignment with consumed parser fields (0e9d14e8)
- GitHub OAuth integration wiring and cross-service mock updates (99febe66)

---

## 2026-03-07 -- actions-agent

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/actions-agent/features.md` -- Added rich WhatsApp notifications capability, multi-phase code task control capability, calendar rich previews in approval messages, calendar CTA button in completion messages, proceed-implementation button flow
- `docs/services/actions-agent/technical.md` -- Updated to v4.1.0; added 15 recent commits; added calendar action flow diagram with synchronous preview; added proceed-implementation button to Button ID Formats table; updated handleApprovalReply to document proceed-implementation; updated handleCalendarAction for synchronous preview; updated executeCalendarAction for rich completion messages and preview fetch ordering; added formatCalendarApprovalMessage, formatCalendarCompletionMessage, calendarMessageFormatting to file structure; updated CodeActionPayload workerType to include sonnet and minimax; removed INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC from config; added 6 new gotchas
- `docs/services/actions-agent/tutorial.md` -- Added calendar rich preview approval/completion examples; added two-phase code task section with proceed-implementation button; added proceed-implementation troubleshooting entry; updated calendar preview note about synchronous generation; updated Next Steps link anchor
- `docs/services/actions-agent/technical-debt.md` -- Updated date to 2026-03-07; added 5 new resolved issues (rich calendar completion messages INT-535, synchronous calendar preview INT-535, proceed-implementation button INT-628, additional worker types, calendar preview fetch ordering fix); added proceed-implementation to test coverage; added calendar utils to coverage areas
- `docs/services/actions-agent/agent.md` -- Updated to 2026-03-07; updated CodeActionPayload workerType to include sonnet and minimax; added proceed-implementation button to ApprovalReplyEvent buttonId formats; added proceed-implementation error codes table; updated calendar preview endpoint note about synchronous generation; updated code-agent dependency to include phase 2

**Inferred Insights:**

- Why: The gap between understanding a command and executing it reliably requires a dispatcher that reads classification confidence, routes to the right specialist, decides whether to act or ask, and recovers from edge cases automatically.
- Killer feature: handleApprovalReply use case with deterministic button-based approval, atomic status transitions via Firestore transactions, seven action type executors, cancel-task nonce security, and proceed-implementation two-phase control -- the most complex approval orchestration in the monorepo
- Future plans: Reminder handler implementation, Linear auto-execute support, bulk action execution, additional notification channels, configurable per-user confidence thresholds
- Limitations: No reminder execution, no per-user confidence threshold, WhatsApp-only approval, no bulk approval, button-only approval (no text interpretation)

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (OpenAPI description mismatch in server.ts)
- Test gaps: 0 (100% branch coverage enforced)
- Type issues: 4 (as any in test files for unsupported action types)
- TODOs: 0
- SRP violations: 2 (publicRoutes.ts ~806 lines, internalRoutes.ts ~897 lines)
- Code duplicates: 1 (executeActionByType switch branches)

**Changes Since Last Run (2026-02-22 -> 2026-03-07):**

- INT-535: Rich WhatsApp completion messages for calendar events with CTA button (59872227, a8592532)
- INT-535: Synchronous calendar preview in approval messages via HTTP call to calendar-agent (aca56231, 9f80098e)
- INT-628: Proceed-implementation button for two-phase code task control from WhatsApp (d366d33f, 4d1ba07b, 820d9802)
- Sonnet and minimax worker types for code action payload (77b3ec79)
- Full user prompt passed to calendar-agent instead of title only (14a4085d)
- GitHub OAuth integration wiring and cross-service mock updates (99febe66)

---

## 2026-03-07 -- whatsapp-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/whatsapp-service/features.md` -- Updated voice transcription to reference srt-service event-driven processing; added "Deep Links with CTA Buttons" section; updated key benefits list
- `docs/services/whatsapp-service/technical.md` -- Updated architecture diagram with srt-service bidirectional flow; replaced `/internal/whatsapp/pubsub/transcribe-audio` with `/internal/whatsapp/pubsub/transcription-completed`; replaced TRANSCRIPTION_TOPIC with AUDIO_STORED_TOPIC; updated Pub/Sub events (audio.stored replaces audio.transcribe, added srt.transcription.completed); removed Speechmatics from external APIs; added srt-service to internal services; updated recent changes table with 15 commits; added gotchas for event-driven transcription and CTA URL messages
- `docs/services/whatsapp-service/tutorial.md` -- Added Step 2.3 for CTA URL messages; added ctaUrl to SendMessageEvent interface; added Scenario D for audio message processing; added proceed-implementation to response types; updated event types reference; added CTA troubleshooting entry
- `docs/services/whatsapp-service/technical-debt.md` -- Bumped to v5.0.0; updated test coverage areas with INT-684 features; updated test file list (handleTranscriptionCompleted.test.ts, sendCtaUrlMessage); added Speechmatics migration and CTA URL support to resolved issues
- `docs/services/whatsapp-service/agent.md` -- Bumped to v5.0.0; updated identity role/goal; added CTA URL capability with example; added proceed-implementation button format; added AudioStoredEvent and TranscriptionCompletedEvent types; replaced whatsapp.audio.transcribe with whatsapp.audio.stored in events published; added srt.transcription.completed to events consumed; added srt-service and web-agent to dependencies
- `docs/services/index.md` -- Updated whatsapp-service AI column from "Speechmatics" to "Via srt-service" in Voice & Transcription and Infrastructure Services tables
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: The best ideas arrive when you are away from a screen. WhatsApp-service bridges the gap between mobile context and a system of AI agents, letting users capture thoughts, approve actions, and receive notifications without leaving the app already in their pocket.
- Killer feature: The approval workflow with interactive buttons -- combining outbound message tracking, correlationId-based reply correlation, 7 intent types (approve, cancel, reject, convert, cancel-task, view-task, proceed-implementation), and automatic deduplication that prevents both approval-reply and command-ingest from firing on the same message
- Future plans: Telegram support, SMS fallback, message threading, video support, multi-phone per user; retry mechanism for failed deliveries; button nonce re-evaluation for security; refactor processWebhookEvent to accept plain payload instead of FastifyRequest; extract handleTextMessage and handleButtonMessage into domain usecases
- Limitations: WhatsApp Business API required, 24-hour messaging window, no video support, one phone per user, platform rate limits, 7-day OutboundMessage TTL, 15-minute signed URL expiry, CTA and buttons mutually exclusive

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (processWebhookEvent accepts FastifyRequest instead of plain payload)
- Test gaps: 0 (>95% coverage threshold maintained)
- Type issues: 0 (no @ts-ignore or @ts-expect-error)
- TODOs: 1 (webhookRoutes.ts line 309)
- SRP violations: 1 (webhookRoutes.ts at 1152 lines)

**Changes Since Last Run (v4.0.0 -> v5.0.0):**

- INT-684: Migrated from direct Speechmatics API calls to event-driven transcription via srt-service (whatsapp.audio.stored published, srt.transcription.completed consumed)
- INT-684: Added CTA URL message support for deep links (sendCtaUrlMessage on message sender port)
- INT-684: Added handleTranscriptionCompleted use case replacing transcribeAudio
- Removed Speechmatics as direct dependency; transcription now handled by srt-service worker
- Added proceed-implementation intent to button response handling

---

## 2026-03-07 -- user-service

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/user-service/features.md` -- Added GitHub OAuth use case, transcription preferences, cascading cleanup benefit, updated limitations
- `docs/services/user-service/technical.md` -- Added GitHub OAuth endpoints (4 public + 2 internal), transcription endpoint, 14 recent commits, TranscriptionPreferences model, GitHub-specific gotchas, 2 new env vars
- `docs/services/user-service/tutorial.md` -- Added Part 7 (transcription), Part 9 (GitHub OAuth), updated Part 10 (6 internal endpoints), new error cases and troubleshooting entries
- `docs/services/user-service/technical-debt.md` -- Updated to 2026-03-07; added OAuth use case duplication pattern; moved GitHub OAuth from future plans to resolved; added transcription expansion future plan
- `docs/services/user-service/agent.md` -- Added GitHub OAuth capabilities (initiate, status, disconnect, token retrieval, user lookup), TranscriptionProvider type, GitHubOAuthConnectionStatus, 6 internal endpoints, new constraints (GitHub tokens never expire, OAuth state TTL)
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Every service in the platform needs authenticated users and access to third-party APIs. Without a centralized identity and credential service, each service would independently manage tokens, encrypt keys, and handle OAuth flows -- duplicating security-critical logic.
- Killer feature: Encrypted API key vault with live validation -- keys are tested against each provider's API before storage, encrypted with AES-256-GCM at rest, and served decrypted only through authenticated internal endpoints.
- Future plans: Microsoft and Notion OAuth providers, API key usage analytics and budget alerts, key rotation with expiration warnings, Perplexity and Zai-specific error parsing, additional transcription providers beyond Speechmatics
- Limitations: Self-access only (no admin/team views), 5 LLM providers hardcoded, single transcription provider, no multi-factor authentication, no session management UI

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (LlmValidatorImpl provider duplication, OAuth use case pairs)
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- SRP violations: 1 (llmKeysRoutes.ts at 585 lines -- acceptable, cohesive by resource)

---

## 2026-03-07 -- claude-worker

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/claude-worker/features.md` -- Added crash forensics capability, plugin pre-installation, daily rebuild schedule, secret sync/direnv, updated use case and key benefits
- `docs/services/claude-worker/technical.md` -- Added crash forensics section, plugin pre-installation table, secret sync and direnv entrypoint steps, multi-arch build details, Cloud Build/daily rebuild section, direnv gotcha, forensics env vars, recent changes table updated
- `docs/services/claude-worker/tutorial.md` -- Added Part 6 for crash forensics, updated expected output for plugins and secret sync, added troubleshooting rows for secret sync and plugins, updated exercises
- `docs/services/claude-worker/technical-debt.md` -- Updated date; added 4 resolved issues (plugin pre-install, multi-arch build, crash forensics, secret sync to container); added entrypoint SRP violation
- `docs/services/claude-worker/agent.md` -- Added constraints 11-12 (secret sync, forensics); added error handling table with exit codes; added events published section; added dependencies table
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Running AI coding agents on host machines exposes credentials and infrastructure. Managed platforms surrender control. Teams need contained, self-hosted environments powerful enough for real engineering work.
- Killer feature: Managed execution mode with session continuity across attempts -- the container stays warm, dependencies persist, and the agent resumes with full context of what it tried and why it failed.
- Future plans: Read-only root filesystem, image size optimization via multi-stage build, custom seccomp profile, automated image versioning with git SHA, plugin auto-update mechanism
- Limitations: One task per environment, no private network access, 2-hour attempt cap, no persistent storage, credentials accessible during execution

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0 (no TypeScript -- shell scripts and Dockerfiles only)
- TODOs: 0
- SRP violations: 1 (entrypoint.sh at 396 lines)
- Security hardening: 3 (writable rootfs, manual iptables, NET_RAW capability)
- Operational gaps: 1 (no heartbeat mechanism)
- Architecture debt: 2 (historical toolchain selection, no image versioning)

---

## 2026-03-07 -- data-insights-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/data-insights-agent/features.md` -- No content changes; service source code unchanged since last run
- `docs/services/data-insights-agent/technical.md` -- Added 2 recent commits to changes table (99febe66 GitHub OAuth mocks, 3608e1d6 INT-595 empty-array contract); added "Empty transform results" gotcha for INT-595; fixed CompositeFeed and Visualization table column formatting for pipe-in-type fields
- `docs/services/data-insights-agent/tutorial.md` -- Added "Empty chartData array" row to troubleshooting table
- `docs/services/data-insights-agent/technical-debt.md` -- Updated date to 2026-03-07; added 2 resolved issues (GitHub OAuth mock wiring, INT-595 TransformedDataSchema fix)
- `docs/services/data-insights-agent/agent.md` -- Added empty-array note to PreviewOutput schema; updated date to 2026-03-07
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Data accumulates across CSV exports, text files, and mobile notifications faster than anyone can analyze it. This service unifies scattered sources into composite feeds, applies AI analysis to surface measurable insights, and generates persistent Vega-Lite visualizations -- eliminating manual spreadsheet work.
- Killer feature: The analyzeData use case with LLM-driven insight extraction, repair-on-parse-failure, six chart type recommendations, and automatic Vega-Lite spec generation -- the most complex AI pipeline in the service
- Future plans: Clean up stale scheduler references in 3 code comments; evaluate removing dead `refreshFeedVisualizations` use case and `CompositeFeedRepository.listAll()` port; consider splitting compositeFeedRoutes.ts (583 lines)
- Limitations: Text-only data sources, max 5 sources/3 filters per feed, max 10 visualizations per feed, manual refresh only, no chart export

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (3 stale scheduler references in comments)
- Test gaps: 0 (100% branch coverage with v8 ignore exemptions)
- Type issues: 0
- TODOs: 0
- SRP violations: 1 (compositeFeedRoutes.ts at 583 lines)
- Dead code: 2 (refreshFeedVisualizations use case, listAll() port -- both unreachable after scheduler removal)

**Changes Since Last Run (2026-02-22 -> 2026-03-07):**

- GitHub OAuth: Added resolveGitHubUsername to UserServiceClient mocks in 5 test files (99febe66, test-only)
- INT-595: Aligned TransformedDataSchema with prompt empty-array contract in dataTransformService test (3608e1d6, test-only)

---

## 2026-03-07 -- commands-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/commands-agent/features.md` -- No content changes; preserved existing user-authored copy
- `docs/services/commands-agent/technical.md` -- Added 2 recent commits to Recent Changes table (title limit increase, GitHub OAuth mock); added title length limit gotcha; updated last-updated date
- `docs/services/commands-agent/tutorial.md` -- Added troubleshooting entry for title exceeding 200 chars; updated last-updated date
- `docs/services/commands-agent/technical-debt.md` -- Added resolved issue for classification title limit (50->200 chars); removed "code handler implementation" from Future Plans (now implemented); updated title max reference from 50 to 200 in code smell #2; updated last-updated date
- `docs/services/commands-agent/agent.md` -- Added Title Limit constraint row (200 chars); updated last-updated date

**Inferred Insights:**

- Why: Capturing a thought and organizing it are two separate acts; most tools force you to do both at once. Commands-agent eliminates the organizing step by classifying natural language input into action types automatically.
- Killer feature: 5-step LLM classification pipeline with explicit intent override, URL keyword isolation, bilingual (English/Polish) support, and PWA-shared confidence boosting
- Future plans: Reminder handler, additional languages (German/Spanish), confidence threshold tuning with user confirmation, structured output mode, circuit breaker for actions-agent, graceful startup pricing degradation
- Limitations: Two languages, no reclassification, no multi-message context, share menu bias

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (regex JSON extraction, magic number log preview length)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-03-07 -- calendar-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/calendar-agent/features.md` -- No changes (existing content accurate for user-facing features)
- `docs/services/calendar-agent/technical.md` -- Added synchronous preview endpoint (POST /internal/calendar/preview); added full prompt text field to process-action; updated recent changes table with 4 new commits; added gotchas for sync vs async preview, full prompt text, and 502 error codes; updated internal endpoints table
- `docs/services/calendar-agent/tutorial.md` -- Added synchronous preview generation section (Step 3.1); updated process-action example with text field; added auto-execute troubleshooting entry; updated best practices for sync preview and full prompt text
- `docs/services/calendar-agent/technical-debt.md` -- Added INT-535 (synchronous preview) and INT-621 (full prompt text) to recent improvements; added 4 new resolved issues; updated test coverage areas; updated last updated date
- `docs/services/calendar-agent/agent.md` -- Added generatePreviewDirect capability; updated processAction to include text field; added sync preview usage pattern (Pattern 1); demoted async pattern to Pattern 2; added full prompt constraint; updated internal endpoints table; fixed preview state machine diagram

**Inferred Insights:**

- Why: The seven-step form between a thought and a calendar event causes appointments to be forgotten. Calendar Agent reduces scheduling to speaking the words aloud via WhatsApp.
- Killer feature: processCalendarAction use case with preview-based event creation -- LLM extraction, timezone-aware date parsing, idempotency tracking, failed event recovery, and preview-to-event pipeline with htmlLink resource URLs
- Future plans: Recurring events, event colors, reminders, attachments, Google Meet conference creation, batch operations, preview TTL cleanup
- Limitations: Google Calendar only, no recurring events, no reminders, no colors, no attachments, Google quota limits

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (redundant filterUndefined function -- low priority)
- Test gaps: 0 (strict 100% branch coverage enforced)
- Type issues: 0 (no any types, no ts-ignore)
- TODOs: 0

**Changes Since Last Run (v3.1.0 -> post v3.1.0):**

- INT-535: Synchronous calendar preview via direct HTTP for approval messages (aca56231, 9f80098e)
- INT-621: Pass full user prompt text instead of short title for event extraction (14a4085d)
- GitHub OAuth mock update: Added resolveGitHubUsername to FakeUserServiceClient (99febe66)
- Error schema fix: Changed internal endpoint error responses from 500 to 502 Bad Gateway (9f80098e)

---

## 2026-03-07 -- image-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/image-service/features.md` -- No content changes; preserved existing user insights
- `docs/services/image-service/technical.md` -- Updated ThumbnailPromptParameters to 3 fields (removed stale aspectRatio, textOnImage, logosTrademarks per INT-605); added 3 recent commits to changes table; added INT-605 migration note; added gotcha about trimmed parameters
- `docs/services/image-service/tutorial.md` -- Updated prompt response examples to remove stale parameter fields; updated Exercise 1 solution description to match current 3-field parameters
- `docs/services/image-service/technical-debt.md` -- Updated date to 2026-03-07; added INT-605 contract alignment to resolved issues; updated parseResponse line count; added parser test coverage note
- `docs/services/image-service/agent.md` -- Updated ThumbnailPrompt output schema to 3 parameters (framing, realism, people); updated example response; updated date to 2026-03-07

**Inferred Insights:**

- Why: AI-generated content needs visual identity, but writing effective image generation prompts is a specialized skill users should not need. The service translates text content into optimized prompts and generates professional images with automatic thumbnailing.
- Killer feature: Two-step generation pipeline -- LLM-powered prompt enhancement followed by multi-provider image generation with automatic GCS storage and thumbnail creation
- Future plans: Additional providers (Midjourney, Stable Diffusion, Ideogram), image editing capabilities, style presets, batch generation, per-user cost budgets
- Limitations: Internal-only (no public endpoints), no image editing, no style selection, no variations, no deduplication

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (pricing model mismatch between REQUIRED_MODELS and actual prompt adapter models)
- Test gaps: 0 (comprehensive coverage including INT-605 contract alignment tests)
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (2026-02-22 -> 2026-03-07):**

- INT-605: ThumbnailPromptParameters trimmed from 6 to 3 fields (8fb90669)
- Stale test fixture fields removed per code review (7fbf7668)
- GitHub OAuth cross-service mock wiring (99febe66, test-only for image-service)

---

## 2026-03-07 -- todos-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/todos-agent/features.md` -- Added "Automatic Status Tracking" capability section; added "Smart status" key benefit; minor prose polish
- `docs/services/todos-agent/technical.md` -- Added commit `99febe66` (GitHub OAuth mocks) to Recent Changes; added second data flow diagram for public CRUD; expanded Gotchas with tag filtering OR logic, adding items to completed todos, and processing vs public status differences; added "No description" fallback to AI extraction section
- `docs/services/todos-agent/tutorial.md` -- Added "Access denied" row to troubleshooting; improved exercise descriptions with verification steps; added link to agent.md in Next Steps
- `docs/services/todos-agent/technical-debt.md` -- Added resolved issue for GitHub OAuth mock update (99febe66); updated Last Updated date
- `docs/services/todos-agent/agent.md` -- Added "Reopening" and "Tag Filtering" constraints; added "No description" fallback to AI extraction; updated Last Updated date
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Eliminates friction between thinking of tasks and organizing them -- natural language in, structured items out, embedded in the platform where work already happens
- Killer feature: AI-powered item extraction from natural language descriptions via LLM, with Zod-validated structured output and graceful fallback behavior
- Future plans: Recurring todos, todo dependencies, templates, bulk operations, full-text search, collaboration, reminders, subtask nesting
- Limitations: No recurring tasks, no dependencies, no reminders, no collaboration, single-level depth (items cannot contain sub-items)

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- Code duplicates: 1 (parseDate function in todoRoutes.ts and internalRoutes.ts)

---

## 2026-03-07 -- vm-lifecycle (refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/vm-lifecycle/features.md` -- Minor prose polish (typo fix, consistency)
- `docs/services/vm-lifecycle/technical.md` -- Added 3 new commits to Recent Changes table (6ba7ba00, b3f34d85, c8a42105); added scheduler retry config to Infrastructure table; added "State poll vs health poll" gotcha; added line counts to File Structure
- `docs/services/vm-lifecycle/tutorial.md` -- Added time estimates per section; expanded exercises with solutions; improved checkpoint guidance
- `docs/services/vm-lifecycle/technical-debt.md` -- Split hardcoded timing into 2 distinct items (config.ts + waitForState); added resolved issue for test type errors (6ba7ba00); updated date
- `docs/services/vm-lifecycle/agent.md` -- Expanded Goal description; updated date
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Automated cost control -- manages GCE VM uptime to weekday business hours without operator intervention
- Killer feature: Graceful shutdown with 10-minute task-draining grace period -- prevents data loss on scheduled nightly stops
- Future plans: Weekend override API, startup notifications, cost reporting, multi-VM support, status endpoint
- Limitations: Single VM instance; fixed schedule requires Terraform apply to change; health check dependency; 120s function timeout shorter than 3-minute health poll

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (hardcoded timing constants in config.ts; hardcoded 5s poll in waitForState)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-03-07 -- api-docs-hub (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/api-docs-hub/features.md` -- Updated service count from 15 to 18, refreshed all references to reflect code-agent, linear-agent, and web-agent additions
- `docs/services/api-docs-hub/technical.md` -- Updated OpenAPI spec version to 0.0.5, updated service count to 18, added 3 new env vars to Aggregated Services and Configuration tables, added ed9cdc25 commit to Recent Changes, updated file line counts
- `docs/services/api-docs-hub/tutorial.md` -- Updated service count references from 15 to 18, updated health check expected response to version 0.0.5 and sourceCount 18, added code-agent/linear-agent/web-agent to dropdown list, fixed troubleshooting table formatting
- `docs/services/api-docs-hub/technical-debt.md` -- Updated date to 2026-03-07, added resolved issue for missing code-agent/linear-agent/web-agent specs, updated line count reference
- `docs/services/api-docs-hub/agent.md` -- Updated version to 0.0.5, updated service count to 18, added 3 new service entries to Available Service Specs table, replaced ASCII architecture diagram with numbered flow description
- `docs/site-index.json` -- Updated api-docs-hub summary to include 18 services and v3.1.0, updated feature descriptions

**Inferred Insights:**

- Why: API documentation scattered across 18 microservices; developers need a single entry point to discover and test all endpoints
- Killer feature: Multi-spec Swagger UI aggregation with live client-side spec fetching -- documentation always reflects the currently deployed API
- Future plans: Dynamic config reload, spec caching, cross-spec search, authentication helper, ecosystem.config.cjs integration
- Limitations: Static config requires redeployment, no version history, no built-in auth, services must be running

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (raw reply.send() in health endpoint -- intentional)
- Test gaps: 0 (no tests, but only 243 lines of config-driven code)
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (15 services -> 18 services):**

- Added code-agent, linear-agent, web-agent OpenAPI URLs (ed9cdc25)
- OpenAPI spec version bumped from 0.0.4 to 0.0.5

---

## 2026-03-07 -- transcription

**Action:** Created
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/transcription/features.md`
- `docs/services/transcription/technical.md`
- `docs/services/transcription/tutorial.md`
- `docs/services/transcription/technical-debt.md`
- `docs/services/transcription/agent.md`
- `docs/services/index.md` -- Added transcription to Workers table, Worker Details, Voice & Transcription section, updated worker count to 5
- `docs/documentation-runs.md` -- This entry

**Inferred Insights:**

- Why: Audio content from WhatsApp voice notes is opaque and unsearchable. The transcription worker converts audio files to structured text so downstream services can extract tasks, generate summaries, and enable full-text search.
- Killer feature: 7-step orchestration pipeline with guaranteed event delivery (always publishes TranscriptionCompletedEvent regardless of success or failure), 100+ custom vocabulary terms for domain-specific accuracy, and automatic language detection with AI-generated summaries.
- Future plans: Add alternative transcription providers (Google Speech-to-Text, OpenAI Whisper), streaming transcription support, per-user vocabulary customization.
- Limitations: WhatsApp-only trigger, Speechmatics-only provider, batch processing with polling (no streaming), ~5 minute max polling window.

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (v8 ignore blocks for error extraction utilities in adapter.ts)
- Test gaps: 0 (6 test files covering all modules)
- Type issues: 0
- TODOs: 0

---

## 2026-03-07 -- chat-agent (minor refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/chat-agent/features.md` -- No changes needed; content accurate
- `docs/services/chat-agent/technical.md` -- Added `99febe66` to Recent Changes table (cross-service mock update)
- `docs/services/chat-agent/tutorial.md` -- No changes needed; content accurate
- `docs/services/chat-agent/technical-debt.md` -- Updated Last Updated date; added resolved issue for FakeUserServiceClient conformance
- `docs/services/chat-agent/agent.md` -- No changes needed; content accurate

**Inferred Insights:**

- Why: Platform users need instant, grounded answers about documentation and APIs without navigating scattered docs -- and the ability to act on what they learn without leaving the conversation
- Killer feature: RAG-powered documentation Q&A with source citations and conversational command creation (propose, confirm, execute)
- Future plans: Conversation persistence in Firestore, multi-action support beyond create_command, documentation indexing pipeline, streaming responses via SSE
- Limitations: Command creation only (no edit/delete), bounded by indexed documentation, no user data access, in-memory guest rate limiting

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (duplicate Firestore data extraction, large v8 ignore blocks in chatClient.ts)
- Test gaps: 1 (chatClient.ts real integration)
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (v3.1.0 -> current):**

- `99febe66`: Cross-service mock update (added resolveGitHubUsername to FakeUserServiceClient) -- test-only change, no behavioral impact

---

## 2026-02-22 -- code-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/code-agent/features.md` -- Added prompt sanitization capability, updated dedup to four layers, added turn-level metrics section, updated limitations (removed stale sanitization gap), added sender whitelist and bot review triage details
- `docs/services/code-agent/technical.md` -- Updated to v3.1.0; added turn-metrics webhook endpoint; updated recent changes table with 13 commits; added submitToPhase2 use case; added domain utilities table (sanitizePrompt, labelUtils, metricsLogFormatter); added gotchas 8-11 (sanitization ordering, sender whitelist, bot review triage, turn metrics HMAC); updated file structure
- `docs/services/code-agent/tutorial.md` -- Added prompt sanitization note in Part 3; added multi-status comma-separated filtering example; added Phase 2 implementation section; added WORKER_NOT_CONFIGURED troubleshooting entry; added Exercise 4 for PR event deduplication
- `docs/services/code-agent/technical-debt.md` -- Updated date to 2026-02-22; added 6 new resolved issues (INT-612 prompt sanitization, webhook dedup, sender whitelist, bot review edit triage, Linear transition on completion, dynamic CPU cores); updated DRY violation to reference 4 files
- `docs/services/code-agent/agent.md` -- Updated to v3.1.0; added log_lines subcollection to identity; added prompt sanitization capability with full pattern list; added Phase 2 implementation capability with constraints; added sender whitelist section; added turn-metrics webhook usage pattern; updated list tasks to show comma-separated multi-status filtering; added Worker message endpoint to outgoing HTTP calls
- `docs/site-index.json` -- Updated code-agent summary to v3.1.0; added prompt sanitization, two-phase execution, sender whitelist, and turn metrics features; updated endpoint count to 28
- `docs/overview.md` -- Updated code-agent references from v3.0.0 to v3.1.0 in capabilities table, action routing table, and quick links

**Inferred Insights:**

- Why: Software teams spend significant time on repetitive coding tasks that are well-specified but still require manual context-switching, environment setup, and execution. Code Agent automates the entire lifecycle from task description to PR creation.
- Killer feature: processCodeAction use case with four-layer deduplication, prompt sanitization, HMAC-signed dispatch, and automatic worker fallback -- the most complex pipeline in the monorepo
- Future plans: System prompt hash computation for audit compliance (replace static placeholders), route splitting for codeRoutes.ts (~3600 lines)
- Limitations: Max 2 workers per user, max 3 concurrent tasks, static system prompt hash, Cloudflare Access required, sender whitelist limited to Claude/Codex bots and repo owner

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 4 (codeRoutes.ts SRP at ~3600 lines, duplicated secret generation in 4 files, ESLint disabled in 2 files, module-level Map for health probes)
- Test gaps: 0 (45+ test files)
- Type issues: 1 (Firestore Timestamp handling requires `as` casts)
- TODOs: 2 (system prompt hash placeholder in 2 files)
- Future plans: 2 (system prompt versioning, route splitting)

**Changes Since Last Run (v2.1.0 -> v3.1.0):**

- INT-612: Prompt sanitization stripping 9 secret pattern categories (878c08b9)
- Sender whitelist replacing scattered webhook filters with ALLOWED_BOTS Set (483c476a)
- Bot review edit triage with in-progress detection instructions (95161acb)
- Unique actionId for webhook dedup with propagated error codes (d5810213)
- Linear state transition to In Review on task-complete webhook (1db69f2a)
- Multi-status filtering with comma-separated query parameter (bcbd5075)
- Turn-end metrics collection with formatted log blocks (be0eaa8b, 9be25162)
- Dynamic CPU cores from cgroup instead of hardcoded value (9be25162)
- PR comment auto-response simplification via sendTaskMessage (2e7039c3)
- PR body deduplication across synchronize events (e5637ce5)
- Phase 2 implementation (submitToPhase2 use case, POST /code/tasks/:id/implement)
- Mid-task messaging (sendTaskMessage use case, POST /code/tasks/:id/messages)

---

## 2026-02-22 -- research-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/research-agent/features.md` -- Updated to v3.1.0; added prompt audit section and version bump notes
- `docs/services/research-agent/technical.md` -- Updated to v3.1.0; refreshed recent changes table with latest commits; updated configuration table to match actual REQUIRED_ENV from index.ts; updated overview version
- `docs/services/research-agent/tutorial.md` -- Added v3.1.0 note about ContextInferenceAdapter simplification in Part 4
- `docs/services/research-agent/technical-debt.md` -- Updated to v3.1.0; added prompt audit and version alignment to resolved issues; renamed architecture quality section to v3.1.0; added prompt versioning to strengths
- `docs/services/research-agent/agent.md` -- Updated dependencies section header and last-updated to v3.1.0
- `docs/site-index.json` -- Updated research-agent summary to v3.1.0; added distributed tracing and prompt audit features

**Inferred Insights:**

- Why: Parallel multi-LLM research orchestration with synthesis, attribution, and sharing
- Killer feature: Zod-validated parser + repair pattern -- automatically fixes malformed LLM JSON and retries with targeted error messages
- Future plans: Streaming responses, custom synthesis prompts, research collections/folders, model keyword maintenance
- Limitations: Max 6 models, max 5 input contexts at 60k chars each, no streaming, single Notion export per research

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (researchRoutes.ts at 1662 lines -- acceptable domain cohesion)
- Test gaps: 0
- Type issues: 0
- TODOs: 1 (NotionServiceClient port interface missing in domain layer)
- Deprecations: 2 (getResearchPageId/saveResearchPageId -- low priority)

**Changes Since Last Run (v2.4.0 -> v3.1.0):**

- v3.0.0 and v3.1.0 release version bumps (no research-agent-specific code changes)
- Adversarial prompt audit simplified ContextInferenceAdapter with safer fallbacks (f451d51a)

---

## 2026-02-22 -- actions-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/actions-agent/features.md` -- Updated auto-execution section to cover all action types (v4.1.0); added Google Calendar integration feature; added graceful deletion handling; restructured key benefits
- `docs/services/actions-agent/technical.md` -- Added PATCH /internal/actions/:actionId/status endpoint; updated ActionType table (calendar now auto-executes); added v3.1.0 commits to Recent Changes; documented calendar absolute URL handling; added OpenAPI description mismatch gotcha
- `docs/services/actions-agent/tutorial.md` -- Restructured into 7 parts with progressive complexity; added auto-execution explanation; added code action cancellation section; expanded troubleshooting table
- `docs/services/actions-agent/technical-debt.md` -- Added v3.1.0 and v4.1.0 resolved issues (calendar auto-execute, Google Calendar linking, userId fix, generalized auto-execute); identified OpenAPI description mismatch code smell; added Linear auto-execute as future enhancement
- `docs/services/actions-agent/agent.md` -- Updated constraints table (type change now includes 'failed' status); updated auto-execution note to exclude only linear/reminder; added PATCH status endpoint to internal endpoints; added cancel-task error codes
- `docs/site-index.json` -- Updated actions-agent summary, features list, and endpoint count (8 -> 13)
- `docs/services/index.md` -- Updated actions-agent entry in v2.1.0 Highlights table
- `docs/overview.md` -- Updated actions-agent description in Infrastructure Services table

**Inferred Insights:**

- Why: Central coordinator bridging command classification and specialized execution agents, providing lifecycle management, approval workflows, and failure recovery for all user-initiated actions
- Killer feature: WhatsApp interactive button approval with deterministic intent resolution (no LLM calls), combined with atomic Firestore transactions preventing race conditions across concurrent Pub/Sub messages
- Future plans: Reminder handler implementation, Linear auto-execute support, bulk action execution, additional notification channels, configurable per-user auto-execution thresholds
- Limitations: No reminder handler, WhatsApp-only notifications, no bulk execution, interactive buttons required for approval

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (OpenAPI description still references "Research Agent")
- Test gaps: 0
- Type issues: 4 (as any in test files -- intentional for edge case testing)
- TODOs: 0
- SRP violations: 2 (publicRoutes.ts ~806 lines, internalRoutes.ts ~897 lines)
- Code duplicates: 1 (executeActionByType switch branches -- intentional for type narrowing)

---

## 2026-02-22 -- web (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/web/features.md` -- Updated with collapsible tool output, multi-status filtering, persistent user preferences, standardized delete confirmations, assignee badges on Linear board, worker autofill prevention
- `docs/services/web/technical.md` -- Added 16 commits to Recent Changes (2026-02-19 to 2026-02-22); added collapsible tool output section; added multi-status filtering section; added standardized delete confirmations; added null assignee handling and worker autofill gotchas; updated 5MB max file size
- `docs/services/web/tutorial.md` -- Added Task 4 (persist UI state with localStorage pattern); added direnv recommendation; added HMR disabled note; updated troubleshooting table; added CodeTasksPage to Next Steps; improved Exercise 3 with proper Firebase imports
- `docs/services/web/technical-debt.md` -- Added ResearchDetailPage (1818 lines) as largest SRP violation; updated CodeTaskViewPage to 1021 lines; added Sidebar.tsx as SRP violation (690 lines); added 7 new resolved issues (2026-02-20 to 2026-02-22); added filter dropdown, delete confirmation, and status badge duplicate patterns
- `docs/services/web/agent.md` -- Added collapsible tool output pattern; added multi-status filtering pattern; added persistent user preferences section with localStorage key table; added standardized delete constraint; added declarative error display; added Pattern 6 (multi-status filtering) and Pattern 7 (collapsible tool output); updated two-phase flow banners
- `docs/services/index.md` -- Updated last-updated date to 2026-02-22

**Inferred Insights:**

- Why: Managing digital life across multiple services creates constant friction; the web app unifies all IntexuraOS capabilities into a single, fast interface
- Killer feature: Real-time Firestore-backed inbox with configurable action buttons, two-phase code task management with collapsible tool output and live log streaming
- Future plans: Refactoring for improved coverage, PWA enhancements, mobile optimization, code task UX refinement, component extraction for large page files
- Limitations: Requires network for most operations, some features best on desktop, Auth0 required (chat available as guest with rate limits)

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 6 (medium/low -- large page files exceeding SRP)
- Test gaps: 7 modules missing tests (medium/low priority)
- Type issues: 1 (@ts-expect-error in test -- valid infrastructure need)
- TODOs: 0
- SRP violations: 8 (ResearchDetailPage 1818, TodosListPage 1149, BookmarksListPage 1134, CodeTaskViewPage 1021, InboxPage 871, LinearIssuesPage 810, Sidebar 690, WorkerSettingsPage 637)
- Code duplicates: 7 patterns (API error handling, filter dropdowns, delete confirmations, modal close, loading spinner, dark mode classes, status badges)

**Changes Since Last Run (v3.0.0 docs -> v3.1.0):**

- Added collapsible tool output blocks in code task log viewer (27f15cfc, ef2724df, 1ee7e8c6)
- Added multi-status filtering for code tasks with localStorage persistence (bcbd5075)
- Added standardized delete confirmations across all pages (c9acdce3)
- Added persistent filter/sidebar state via localStorage (2e3ae30c)
- Fixed worker reorder buttons in settings UI (fbe7c944)
- Added null assignee handling for Linear board (19442f43, d36c76dd)
- Added assignee display with emerald badges on Linear board (6df58b52, c221efd5)
- Added worker secret autofill prevention (3b081686)
- Added PR synchronize compare URL (27ef6a7b)
- Added two-phase flow banner on design tasks (0e07e938)
- Added GitHub PR summaries with lazy event loading (e8bbacd7)

---

## 2026-02-22 -- user-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/user-service/features.md` -- Refreshed to v3.1.0; no functional changes, content verified against codebase
- `docs/services/user-service/technical.md` -- Added v3.1.0 and v3.0.0 release entries to Recent Changes; added AuthTokens and LlmPreferences domain models; added pricing context startup gotcha; expanded file structure with all route files and infra subdirectories
- `docs/services/user-service/tutorial.md` -- Fixed part numbering (was skipping Part 7); added pricing fetch failure to troubleshooting; added default model exercise; added collapsible solutions section
- `docs/services/user-service/technical-debt.md` -- Updated Last Updated date; added SRP and code duplicates to summary (1 each, Low); added v3.1.0 and v3.0.0 entries; added comprehensive test file inventory table
- `docs/services/user-service/agent.md` -- Added getCurrentUser capability; added UserProfile type; added Set Default Model usage pattern; added OAuth2 Raw Responses constraint; added Error Handling table with all error codes; added Dependencies table with failure behaviors

**Inferred Insights:**

- Why: Unified authentication and secure API key management for a multi-provider AI platform requiring zero-knowledge key distribution
- Killer feature: AES-256-GCM encrypted key storage with real-time provider validation and intelligent multi-provider error formatting
- Future plans: Microsoft/GitHub/Notion OAuth, usage analytics, budget alerts, key rotation, Perplexity/Zai-specific error parsing
- Limitations: Auth0 dependency, Google-only OAuth, validation costs money, no per-key rate limits

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- SRP violations: 1 (llmKeysRoutes.ts at 569 lines -- acceptable resource cohesion)
- Code duplicates: 1 (LlmValidatorImpl per-provider pattern -- intentional)

---

## 2026-02-22 -- commands-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/commands-agent/features.md`
- `docs/services/commands-agent/technical.md`
- `docs/services/commands-agent/tutorial.md`
- `docs/services/commands-agent/technical-debt.md`
- `docs/services/commands-agent/agent.md`

**Inferred Insights:**

- Why: Translates ambiguous natural language from WhatsApp, voice, and PWA into structured action types -- resolving classification challenges across languages, URL keywords, and conflicting signals
- Killer feature: 5-step structured classification pipeline with URL keyword isolation, explicit intent priority, and multi-language support (English + Polish)
- Future plans: Reminder and code handler implementations, additional language support, structured output mode, circuit breaker for actions-agent, graceful startup degradation
- Limitations: Requires Gemini 2.5 Flash/GLM API access; reminder and code handlers not yet implemented; English and Polish only; no reclassification

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2
- Test gaps: 0
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (v3.0.0 docs -> v3.1.0):**

- Updated version references to v3.1.0
- Added Gemini 2.5 Flash as default model (switched from GLM-4.7-Flash)
- Added Dash0 OpenTelemetry integration to dependencies and gotchas
- Added dev-mode log formatting via createLogStream()
- Added API key naming standardization (INTEXURAOS_ZAI_APP_API_KEY)
- Added platform Gemini API key as primary fallback
- Added complete environment variable table to technical.md (including auth vars)
- Added resolved issue: GLM-4.7-Flash latency
- Updated Recent Changes tables with commit hashes from git history

---

## 2026-02-22 -- calendar-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/calendar-agent/features.md` -- Added "Direct Google Calendar Links" capability; updated Use Case flow with step 9 (resourceUrl)
- `docs/services/calendar-agent/technical.md` -- Added INT-585 to Recent Changes; updated Data Flow diagram (htmlLink); added "Resource URL" gotcha
- `docs/services/calendar-agent/tutorial.md` -- Updated process-action response example to show resourceUrl with Google Calendar link; added resourceUrl best practice
- `docs/services/calendar-agent/technical-debt.md` -- Added v3.1.0 section (INT-585 htmlLink as resourceUrl); added resolved issue entry
- `docs/services/calendar-agent/agent.md` -- Updated ServiceFeedback type; added htmlLink Priority constraint; corrected CalendarEvent optional fields

**Inferred Insights:**

- Why: Google Calendar integration enabling natural language scheduling with preview-before-commit and multi-calendar support
- Killer feature: Preview-based event creation with LLM extraction, async preview, and approval workflow
- Future plans: Recurring events, event colors, reminders, attachments, conference data, batch operations, preview TTL
- Limitations: Google Calendar only, OAuth required, no recurring events, no reminders/colors/attachments

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 -- web-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/web-agent/features.md` -- Refreshed to v3.1.0; minor formatting consistency
- `docs/services/web-agent/technical.md` -- Added v3.1.0 and v3.0.0 release entries to Recent Changes; added app-settings-service to dependencies; added system endpoints table; added No Firestore and Pricing at startup gotchas; noted port 8127 in overview
- `docs/services/web-agent/tutorial.md` -- Updated curl URLs to use localhost:8127 for local/dev consistency
- `docs/services/web-agent/technical-debt.md` -- Updated Last Updated to 2026-02-22; added v3.1.0 resolved issue entry
- `docs/services/web-agent/agent.md` -- Added Version 3.1.0 and Port to Identity table; added app-settings-service to Dependencies; updated last-updated date

**Inferred Insights:**

- Why: Centralized web content extraction and AI summarization for the IntexuraOS ecosystem
- Killer feature: Self-healing LLM response parser with automatic JSON-to-prose repair and language preservation
- Future plans: Caching layer, batch summarization, rate limiting, retry logic, PDF support, token-based summary length control
- Limitations: HTTP/HTTPS only, no caching, no auth-walled content, 2MB size cap, no built-in rate limits

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (both low: Uint8Array concatenation, ESLint disable for while-true)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 -- data-insights-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/data-insights-agent/features.md` -- Updated to reflect removal of scheduled snapshot refresh; clarified visualization refresh as on-demand; removed 15-minute cache window limitation
- `docs/services/data-insights-agent/technical.md` -- Updated recent changes table with v3.1.0 release and scheduled refresh removal; added app-settings-service dependency; added LLM Models table; expanded gotchas with orphaned visualizations, feed deletion cascade, snapshot ?refresh=true, visualization refresh idempotency, and pricing at startup; updated file structure with line counts and details
- `docs/services/data-insights-agent/tutorial.md` -- Replaced Cloud Run URLs with localhost:8119 for local dev; added Part 6.3 for manual refresh workflow; updated troubleshooting for snapshot refresh; updated exercises
- `docs/services/data-insights-agent/technical-debt.md` -- Added stale scheduler code comments as low-priority debt; identified dead code (refreshFeedVisualizations use case, CompositeFeedRepository.listAll()); flagged compositeFeedRoutes.ts SRP violation (583 lines); added scheduled refresh removal to resolved issues
- `docs/services/data-insights-agent/agent.md` -- Updated all patterns to reflect on-demand refresh; added snapshot ?refresh=true to workflow patterns; updated constraints with pre-conditions; updated dependencies with app-settings-service

**Inferred Insights:**

- Why: Data sits in silos across mobile notifications, custom datasets, and disconnected sources; manual analysis requires spreadsheet expertise and repetitive work
- Killer feature: AI-powered composite feed analysis that combines static data with live notifications and generates Vega-Lite chart definitions with 6 chart types
- Future plans: Clean up dead code from scheduler removal (listAll(), refreshFeedVisualizations); consider splitting compositeFeedRoutes.ts
- Limitations: Text-based data only; requires LLM API key; max 5 insights, 5 sources, 3 filters, 10 visualizations per feed; no scheduled refresh (on-demand only since v3.1.0)

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (stale scheduler comments)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 -- image-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/image-service/features.md` -- Restructured with concrete examples per capability, expanded problem statement, added lifecycle management capability section
- `docs/services/image-service/technical.md` -- Added separate prompt generation data flow diagram, documented pricing model mismatch gotcha, updated recent changes with v3.0.0 and v3.1.0 releases, expanded file structure annotations
- `docs/services/image-service/tutorial.md` -- Restructured with proper time estimates and checkpoints, expanded error handling section with all error codes and HTTP statuses, added detailed exercises with solutions
- `docs/services/image-service/technical-debt.md` -- Identified pricing model mismatch code smell (Medium), identified mapError/mapLlmError duplication pattern (Low), preserved all resolved issues
- `docs/services/image-service/agent.md` -- Added "When to use" guidance per capability, added Pattern 3 (direct image generation), expanded error handling table with HTTP status codes, added constraints section with specific limits

**Inferred Insights:**

- Why: AI-generated content (research, notes) needs visual elements for sharing. Manual image creation is slow and requires design skills. Raw text produces poor results when fed directly to image generation models.
- Killer feature: Two-step pipeline -- LLM-powered prompt enhancement followed by multi-provider image generation with automatic thumbnailing and GCS storage.
- Future plans: Additional image providers (Midjourney, Stable Diffusion, Ideogram), image editing/inpainting, style presets, batch generation, per-user budgets, cost estimation.
- Limitations: No image editing, no batch generation, internal-only access, fixed thumbnail size (256px), no deduplication.

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (pricing model mismatch between REQUIRED_MODELS and actual prompt models)
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- Code duplicates: 1 (mapError/mapLlmError duplicated across adapters)

---

## 2026-02-22 -- bookmarks-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/bookmarks-agent/features.md`
- `docs/services/bookmarks-agent/technical.md`
- `docs/services/bookmarks-agent/tutorial.md`
- `docs/services/bookmarks-agent/technical-debt.md`
- `docs/services/bookmarks-agent/agent.md`

**Inferred Insights:**

- Why: Web bookmarking lacks context, requires manual metadata entry, and has no mobile-first capture flow
- Killer feature: Three-stage async pipeline (create -> enrich -> summarize) with Pub/Sub decoupling and WhatsApp delivery of AI summaries
- Future plans: Full-text search, link validation, folder hierarchy, bookmark sharing, import/export, summary regeneration
- Limitations: No full-text search, no link validation, flat tags only, private-only, metadata depends on site cooperation

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- SRP violations: 1 (bookmarkRoutes.ts at 662 lines includes image proxy)
- Code duplicates: 1 (formatBookmark() duplicated across route files)

**Changes Since Last Run (v3.0.0 -> v3.1.0):**

- Release v3.0.0 and v3.1.0 version bumps
- No functional code changes to bookmarks-agent since last documentation run

---

## 2026-02-22 -- chat-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/chat-agent/features.md` -- Updated guest access section to list all three supported models (Gemini 2.5 Flash, GLM-4.7, GLM-4.7-Flash) for authenticated users
- `docs/services/chat-agent/technical.md` -- Added v3.1.0 and v3.0.0 releases to recent changes table, added "Supported Chat Models" subsection under Configuration, fixed domain model table formatting (pipe-escaped union types)
- `docs/services/chat-agent/tutorial.md` -- Minor formatting consistency fixes in troubleshooting table
- `docs/services/chat-agent/technical-debt.md` -- Updated last-updated date to 2026-02-22, updated total count in summary table
- `docs/services/chat-agent/agent.md` -- No substantive changes; confirmed accuracy of all schemas, examples, and constraints

**Inferred Insights:**

- Why: Users need contextual help inside IntexuraOS without switching to external documentation; the chat agent provides instant answers with source citations through natural conversation
- Killer feature: RAG-powered documentation Q&A that combines Firestore vector search with LLM generation, producing answers with traceable source citations and the ability to create commands through conversational confirmation flow
- Future plans: Conversation persistence in Firestore, multi-action support (edit/delete), automated documentation indexing pipeline, streaming responses via SSE
- Limitations: Create-only commands, no user data access, manual doc indexing required, in-memory rate limiter (per-instance), 100 msg/hr guest limit

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2 (duplicate Firestore data extraction, large v8 ignore blocks)
- Test gaps: 1 (chatClient.ts integration coverage via v8 ignore)
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 -- notes-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/notes-agent/features.md` -- Expanded problem statement, added draft-to-active workflow capability, added pagination limitation
- `docs/services/notes-agent/technical.md` -- Added architecture and data flow diagrams, expanded recent changes with v3.0.0 and v3.1.0 releases, added system endpoints table, added package dependencies table, documented double-read gotcha and no-pagination gotcha
- `docs/services/notes-agent/tutorial.md` -- Restructured with proper time estimates, added Part 5 (internal endpoint) and Part 6 (tag organization), added exercises with solutions, expanded troubleshooting table
- `docs/services/notes-agent/technical-debt.md` -- Added pagination feature gap, identified ownership check code duplication pattern, added double-read code smell, updated resolved issues table
- `docs/services/notes-agent/agent.md` -- Complete restructure to template format: full input/output schemas per capability, request/response examples, constraints table, usage patterns, error handling table

**Inferred Insights:**

- Why: Unified note storage for capturing information from multiple IntexuraOS sources with provenance tracking
- Killer feature: Source tracking with internal service endpoint -- enables any service to create notes on behalf of users with full provenance
- Future plans: Tag filtering (server-side), full-text search, pagination
- Limitations: No pagination, no tag filtering, status hidden from public API, no status transitions

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (double-read on mutation)
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- Feature gaps: 3 (tag filtering, status visibility, pagination)
- Code duplicates: 1 (ownership check pattern)

---

## 2026-02-22 -- linear-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/linear-agent/features.md`
- `docs/services/linear-agent/technical.md`
- `docs/services/linear-agent/tutorial.md`
- `docs/services/linear-agent/technical-debt.md`
- `docs/services/linear-agent/agent.md`

**Inferred Insights:**

- Why: Bridge between natural language and Linear project management, with bidirectional sync and programmatic access for AI agents
- Killer feature: Auto-trigger code tasks on Linear issue assignment -- assigning an issue triggers automatic enrichment
- Future plans: Label passthrough in internal API, completedAt in SyncedLinearIssue, comment full sync
- Limitations: Fire-and-forget auto-trigger means failures only logged; labels accepted but not forwarded to Linear

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 2
- Test gaps: 0
- Type issues: 0
- TODOs: 0

**Changes Since Last Run (v3.0.0 -> v3.1.0):**

- Auto-trigger code tasks on Linear issue assignment (a88db80f)
- Assignee data preserved during full sync (99e05f19, INT-573)
- Assignee included in list issues response mapper (b846dcc5)
- Unique actionId for webhook dedup (d5810213)
- Auto-trigger prompt aligned with Phase 1 design behavior (dc45d1ea)
- Raw errors passed to pino logger (6f35c16a)

---

## 2026-02-22 -- mobile-notifications-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/mobile-notifications-service/features.md` -- Rewritten with active voice, expanded problem statement, added data aggregation use case, concrete examples for each capability
- `docs/services/mobile-notifications-service/technical.md` -- Added mermaid architecture and data flow diagrams, added v3.1.0 release to recent changes, added Firestore collections table, expanded gotchas with title filter implementation detail and cursor encoding
- `docs/services/mobile-notifications-service/tutorial.md` -- Complete rewrite as progressive 6-part tutorial with exercises and solutions, added idempotency test step, added error handling section
- `docs/services/mobile-notifications-service/technical-debt.md` -- Updated to 2026-02-22, confirmed zero debt items, preserved resolved issues history
- `docs/services/mobile-notifications-service/agent.md` -- Restructured with per-capability "When to use" guidance, explicit input/output TypeScript schemas, request/response examples, usage patterns for composite feeds

**Inferred Insights:**

- Why: Centralized notification capture pipeline that pairs Android devices via cryptographic signature tokens and persists all mobile notifications in Firestore for browsing, filtering, and cross-service data aggregation
- Killer feature: Signature-based device authentication with SHA-256 hash storage -- plaintext shown once, zero-knowledge security model
- Future plans: FCM/APNs push-back integration, iOS support, rich notifications, scheduled delivery, batch operations
- Limitations: Android only, single signature per user, no push-back, text-only capture

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 -- todos-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/todos-agent/features.md` -- Updated LLM model references (Gemini 2.5 Flash / GLM-4.7), added automatic status tracking capability, added description limit to limitations
- `docs/services/todos-agent/technical.md` -- Added v3.1.0 and v3.0.0 releases to recent changes, added app-settings-service dependency, added system endpoints table, added automatic status transitions section, added Pub/Sub auth gotcha, added max items cap and markdown stripping gotchas, updated model chain documentation
- `docs/services/todos-agent/tutorial.md` -- Changed URLs from production to localhost:8123 for local dev, added archived filter step, corrected AI extraction to use internal endpoint, improved exercise solutions with cancel-then-archive flow
- `docs/services/todos-agent/technical-debt.md` -- Updated to 2026-02-22, added v3.1.0 and v3.0.0 release entries, identified parseDate duplication as low-priority code duplicate, updated dependency versions
- `docs/services/todos-agent/agent.md` -- Added auto-status constraint, added max items constraint, added default priority constraint, added internal API usage pattern, updated model chain, updated last updated date

**Inferred Insights:**

- Why: Centralized task management with AI-powered item extraction that turns natural language descriptions into structured, prioritized todo items with due dates
- Killer feature: AI item extraction via Pub/Sub pipeline that parses free-form descriptions into structured TodoItems with Zod-validated schemas and graceful fallback behaviors
- Future plans: Todo templates, recurring todos, task dependencies, bulk operations, full-text search, collaboration, reminders, subtask nesting
- Limitations: No recurring tasks, no dependencies, no reminders, no collaboration, single-level sub-items, 10K char description limit, 50 item extraction cap

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0
- Code duplicates: 1 (parseDate function -- low severity)

---

## 2026-02-22 -- app-settings-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/app-settings-service/features.md` -- Rewrote with active voice, expanded capabilities with concrete examples, added startup integrity validation section
- `docs/services/app-settings-service/technical.md` -- Updated Recent Changes table through v3.1.0, added system endpoints (health, openapi.json, docs), expanded configuration with INTEXURAOS_ENVIRONMENT/PORT/HOST/LOG_LEVEL, added package dependencies table, added boot order gotcha, updated model count to 16
- `docs/services/app-settings-service/tutorial.md` -- Expanded to 4-part progressive tutorial with health check, pricing, usage costs, and cost estimation sections; added exercises with solutions
- `docs/services/app-settings-service/technical-debt.md` -- Updated date, kept 3 active code smells, added SRP violation for server.ts (407 lines), confirmed 0 TODOs/type issues/test gaps
- `docs/services/app-settings-service/agent.md` -- Updated provider coverage to full 16 models from llm-contract, restructured capabilities with explicit input/output schemas and examples, added 3 usage patterns

**Inferred Insights:**

- Why: IntexuraOS orchestrates 16 LLM models across 5 providers; without centralized pricing, cost data would drift out of sync across 20 microservices
- Killer feature: Startup integrity validation -- service refuses to boot if any model lacks pricing, preventing all downstream services from running with incomplete data
- Future plans: Budget management, cost alerts, forecasting, admin API, daily breakdown
- Limitations: Read-only pricing, 90-day default window, no forecasting, no budgets, monthly granularity only

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 3 (duplicated provider fetch logic, hardcoded collection paths, client-side date filtering)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 -- whatsapp-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/whatsapp-service/technical.md` -- Added v3.0.0 and v3.1.0 release commits to Recent Changes table
- `docs/services/whatsapp-service/technical-debt.md` -- Updated date, corrected webhookRoutes.ts line count from ~1300 to ~1160, removed stale "handleReactionMessage" from extraction suggestion
- `docs/services/whatsapp-service/agent.md` -- Updated last updated date
- `docs/site-index.json` -- Replaced outdated emoji reaction references with interactive button features (v4.0.0), added phone verification (v3.0.0), added link preview extraction
- `docs/services/index.md` -- Updated whatsapp-service descriptions to reflect v4.0.0 capabilities (buttons and text replies, not reactions)

**Inferred Insights:**

- Why: WhatsApp Business API integration layer for frictionless mobile input and approval workflows
- Killer feature: Async webhook processing with interactive button approval correlation and Speechmatics audio transcription pipeline
- Future plans: Telegram/SMS channels, message threading, video support, multi-phone per user
- Limitations: WhatsApp 24-hour messaging window, single phone per user, no video, no emoji reaction approvals

**Documentation Coverage:** 100%

**Technical Debt Found:**

- TODOs: 1 (refactor processWebhookEvent to accept raw payload, not FastifyRequest)
- SRP violations: 1 (webhookRoutes.ts at 1160 lines)
- Stale comments: 1 (line 763 references old nonce format)
- Test gaps: 0
- Type issues: 0

**Changes Since Last Run (2026-02-19):** Only 2 release version bump commits (v3.0.0, v3.1.0). No source code changes. Primary update was correcting stale site-index.json and index.md entries that still referenced emoji reactions (removed in v4.0.0).

---

## 2026-02-22 -- notion-service (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/notion-service/features.md` -- Rewritten with active voice, concrete examples, expanded use case, clearer limitations
- `docs/services/notion-service/technical.md` -- Added v3.1.0 release to recent changes, added mermaid architecture and data flow diagrams, expanded request/response schemas for all endpoints, added use case summaries, added Firestore collection table, added line counts to file structure
- `docs/services/notion-service/tutorial.md` -- Complete rewrite with progressive 5-part tutorial, added page preview scenario, added exercises with solutions, expanded troubleshooting table
- `docs/services/notion-service/technical-debt.md` -- Updated to 2026-02-22, added v3.1.0 release entry, added detailed v8 ignore annotation inventory, preserved resolved issues
- `docs/services/notion-service/agent.md` -- Restructured to template format with "When to use" per capability, explicit input/output schemas, request/response examples, added "Used By" table, added usage patterns

**Inferred Insights:**

- Why: Centralized Notion integration gateway that validates tokens before storage, tracks connection lifecycle, and exposes internal APIs for downstream services to verify page access
- Killer feature: Internal page preview endpoint that validates Notion page accessibility before research-agent export attempts, preventing silent export failures
- Future plans: Multiple workspaces per user, webhook event processing, scoped page access, sync status tracking
- Limitations: Single workspace per user, manual token generation, webhook stub (no processing), no auto-retry

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (webhook stub -- low severity)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-22 — api-docs-hub (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/api-docs-hub/features.md` -- Refreshed with active voice, added Recent Changes section, updated limitations
- `docs/services/api-docs-hub/technical.md` -- Updated package version to 3.1.0, added architecture note about client-side fetching, added Terraform config section, added ecosystem.config.cjs gap to Gotchas, updated Recent Changes table with v3.1.0 and v3.0.0 releases
- `docs/services/api-docs-hub/tutorial.md` -- Expanded to 4-part progressive tutorial with exercises, added troubleshooting table
- `docs/services/api-docs-hub/technical-debt.md` -- Updated date, added ecosystem.config.cjs integration to Future Plans, added Resolved Issues for v3.0.0/v3.1.0 changes
- `docs/services/api-docs-hub/agent.md` -- Updated version to 3.1.0, restructured to template format with explicit schemas and examples, added Pattern 2 for direct spec access

**Inferred Insights:**

- Why: API documentation scattered across 15 microservices; developers need a single entry point to discover and test all endpoints
- Killer feature: Multi-spec Swagger UI aggregation with live client-side spec fetching -- documentation always reflects the currently deployed API
- Future plans: Dynamic config reload, spec caching, auth helper, version selector, cross-spec search
- Limitations: Read-only, no auth helper, static config, service availability dependency

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (health endpoint raw reply.send -- low, intentional)
- Test gaps: 0 (no tests exist, but service is 229 lines with no domain logic)
- Type issues: 0
- TODOs: 0

---

## 2026-02-19 — v3.0.0 Release Documentation Update

**Action:** Updated
**Agent:** Interactive (Claude Opus 4.6)
**Method:** Manual high-level docs update during release finalization

**Scope:**

- `docs/overview.md` — Consolidated "Since v3.0.0" section into v3.0.0; added "Self-Building System" narrative; folded platform intelligence improvements (Notion export, API fallbacks, model selector, OTel, prompt versioning, coverage enforcement)
- `CHANGELOG.md` — Added v3.0.0 entry with 20 Added, 7 Changed, 1 Improved, 8 Fixed entries
- Removed PR comment auto-response from v3.0.0 features (not correctly implemented → INT-593)
- Removed pre-dev environment, xterm.js terminal, saved visualizations from changelog after validation

**Emphasis:** Code Agent and Orchestrator as the self-building autonomous system; accurate feature validation against codebase

---

## 2026-02-19 — Full Monorepo Refresh (v3)

**Action:** Updated
**Agent:** team (monorepo-docs-v3)
**Method:** Parallel agent orchestration with enhanced cross-validation
**Model:** Claude Sonnet 4.6

**Scope:**

- 20 apps documented (5 files each)
- 4 workers documented (5 files each)
- 22 packages documented (3 files each)
- Total: 186 documentation files refreshed
- 6 standard cross-validation reports
- 4 extended validation reports (NEW: auth, service URLs, error contracts, terraform-code sync)
- 1 meta-validation report

**Emphasis:** Double cross-verification and validation pass

**Documentation Coverage:** 100%

---

## 2026-02-19 — vm-lifecycle (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/vm-lifecycle/technical.md` — Added "Recent Changes" section from git history (5 commits)
- `docs/services/vm-lifecycle/agent.md` — Restructured to template format: added "When to use" guidance per capability, explicit input/output schemas, request/response examples, expanded error handling table

**Inferred Insights:**

- Why: Automated cost control — manages GCE VM uptime to weekday business hours without operator intervention
- Killer feature: Graceful shutdown with 10-minute task-draining grace period — prevents data loss on scheduled nightly stops
- Future plans: Weekend override API, startup notifications, cost reporting, multi-VM support
- Limitations: Single VM instance; fixed schedule requires Terraform apply to change; health check dependency

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (hardcoded timing constants in config.ts)
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-19 — web (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/web/features.md` — Updated Code Task Management: replaced xterm.js/ANSI references with LogStream; updated Use Case and Key Benefits
- `docs/services/web/technical.md` — Removed TerminalLogViewer.tsx from component tree; replaced xterm.js with LogStream in tech stack; added Log Stream section with tag color table; updated Firebase section and Gotchas; added `5fa51f75` to recent changes
- `docs/services/web/tutorial.md` — Updated troubleshooting and Next Steps for LogStream
- `docs/services/web/technical-debt.md` — Added resolved issue entry for xterm.js removal
- `docs/services/web/agent.md` — Updated Manage Code Tasks: replaced xterm.js terminal with LogStream, added full tag list, clarified banner names

**Inferred Insights:**

- Why: Single-page PWA providing unified access to all IntexuraOS services with real-time Firestore updates
- Killer feature: Two-phase code task execution with live LogStream, queued messaging, and design/implementation navigation banners
- Future plans: Web app coverage refactoring, mobile UX improvements, PWA enhancements
- Limitations: Hash routing required for GCS hosting; most features need network connection

**Key Change:** xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) removed in commit `5fa51f75`. Replaced with custom `LogStream` component using CSS color classes per log tag.

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 5 (InboxPage 866L, LinearIssuesPage 804L, CodeTaskViewPage 862L, WorkerSettingsPage 601L, CalendarPage 536L)
- Test gaps: 3 missing hooks tests (medium priority)
- Type issues: 0
- TODOs: 0

---

## 2026-02-19 — research-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/research-agent/features.md` — Added v2.4.0 section (Dash0 OpenTelemetry, dev-mode log formatting)
- `docs/services/research-agent/technical.md` — Added v2.4.0 recent changes; added `packages/infra-otel` to shared packages; added `INTEXURAOS_DASH0_OTLP_ENDPOINT` env var; updated overview to v2.4.0
- `docs/services/research-agent/technical-debt.md` — Added v2.4.0 resolved issues; updated architecture quality section; added distributed tracing to strengths
- `docs/services/research-agent/agent.md` — Added `packages/infra-otel` to dependencies; bumped to v2.4.0

**Inferred Insights:**

- Why: Parallel multi-LLM research orchestration with synthesis, attribution, and sharing
- Killer feature: Zod-validated parser + repair pattern — automatically fixes malformed LLM JSON and retries with targeted error messages
- Future plans: Streaming responses, custom synthesis prompts, research collections/folders, model keyword maintenance
- Limitations: Max 6 models, max 5 input contexts at 60k chars each, no streaming, single Notion export per research

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 1 (researchRoutes.ts at 1662 lines — acceptable domain cohesion)
- Test gaps: 0
- Type issues: 0
- TODOs: 1 (NotionServiceClient port interface missing in domain layer)

---

## 2026-02-19 — todos-agent (targeted refresh)

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/todos-agent/technical.md` — Fixed broken Domain Model table rendering; added missing `INTEXURAOS_APP_SETTINGS_SERVICE_URL` env var to Configuration table

**Inferred Insights:**

- Why: Task management service that bridges natural language capture (WhatsApp/web) with structured, AI-organized task lists
- Killer feature: Async AI item extraction via Pub/Sub — descriptions become structured todo items automatically via Gemini 2.5 Flash
- Future plans: Todo templates, recurring todos, bulk operations (from technical-debt.md)
- Limitations: No recurring tasks, no task dependencies, one level of sub-items only

**Documentation Coverage:** 100%

**Technical Debt Found:**

- Code smells: 0
- Test gaps: 0
- Type issues: 0
- TODOs: 0

---

## 2026-02-19 — Full Monorepo Refresh (v2)

**Action:** Updated
**Agent:** team (monorepo-docs)
**Method:** Parallel agent orchestration (service-scribe agents)
**Model:** Claude Sonnet 4.6

**Scope:**

- 20 apps documented (5 files each)
- 4 workers documented (5 files each)
- 22 packages documented (3 files each)
- Total: 186 documentation files refreshed

**Services Updated:**
actions-agent, api-docs-hub, app-settings-service, bookmarks-agent, calendar-agent, chat-agent, code-agent, commands-agent, data-insights-agent, image-service, linear-agent, mobile-notifications-service, notes-agent, notion-service, research-agent, todos-agent, user-service, web, web-agent, whatsapp-service

**Workers Updated:**
claude-worker, log-cleanup, orchestrator, vm-lifecycle

**Packages Updated:**
common-core, common-http, http-contracts, http-server, infra-claude, infra-firestore, infra-gemini, infra-glm, infra-gpt, infra-notion, infra-otel (NEW), infra-perplexity, infra-pubsub, infra-sentry, infra-whatsapp, internal-clients, llm-audit, llm-contract, llm-factory, llm-pricing, llm-prompts, llm-utils

**Documentation Coverage:** 100%

---

## 2026-02-19 — code-agent

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/code-agent/features.md`
- `docs/services/code-agent/technical.md`
- `docs/services/code-agent/tutorial.md`
- `docs/services/code-agent/technical-debt.md`
- `docs/services/code-agent/agent.md`

**Inferred Insights:**

- Why: Automate repetitive coding tasks by bridging task specification (Linear issues, WhatsApp) with Claude-powered workers running on user-owned infrastructure
- Killer feature: Three-layer deduplication + HMAC-signed worker dispatch with automatic fallback between up to 2 configured machines
- Future plans: PR comment auto-dispatch (Phase 4), actual system prompt hashing for audit trails
- Limitations: Max 2 workers per user; PR comment auto-dispatch detected but not yet wired to worker

**Documentation Coverage:** ~85% (ESLint disabled in main route files limits JSDoc)

**Technical Debt Found:**

- Code smells: 4 (codeRoutes.ts SRP violation, duplicated secret generation, blanket ESLint disable, module-level health probe Map)
- Test gaps: 0
- Type issues: 1 (Firestore Timestamp narrowing)
- TODOs: 3 (prompt sanitization, system prompt hash, Phase 4 dispatch)

---

## 2026-01-25 - web Documentation Update

**Action:** Created
**Agent:** service-scribe (autonomous)
**Trigger:** Release 2.1.0 (INT-269/INT-270 context)

**Files Created:**

- `docs/services/web/features.md` - User-facing features documentation for the PWA dashboard
- `docs/services/web/technical.md` - Developer reference with architecture, routes, and configuration
- `docs/services/web/tutorial.md` - Getting-started guide for running and developing the web app
- `docs/services/web/technical-debt.md` - Technical debt tracking and code quality analysis
- `docs/services/web/agent.md` - Machine-readable interface specification for AI agents

**Files Updated:**

- `docs/services/index.md` - Added web to User Interface section
- `docs/site-index.json` - Added web service entry with ui category, updated stats to 19 total services

**Inferred Insights:**

- **Why exists:** Provide a unified Progressive Web App dashboard for accessing all IntexuraOS services from a single interface
- **Killer feature:** Real-time action inbox with Firestore listeners for instant updates without page refresh
- **Future plans:** PWA enhancements, improved mobile responsiveness, offline capabilities expansion
- **Limitations:** Coverage threshold not enforced (planned refactoring), hash routing required for GCS hosting

**Technical Debt Found:**

- Code Smells: 3 (InboxPage.tsx at 879 lines exceeds SRP guideline)
- Test Gaps: Several services/hooks lack tests (coverage exempt for UI components)
- TODOs: 1 (documentation clarity issue in config.ts)

**Documentation Coverage:** 100% (5/5 files created)

---

## 2025-01-25 - commands-agent v2.1.0 Documentation Update

**Action:** Updated
**Agent:** service-scribe (autonomous)
**Trigger:** INT-269 (internal-clients migration), INT-218 (Zod schema validation)

**Files Updated:**

- `docs/services/commands-agent/SERVICE.md` - Created comprehensive features documentation with v2.0.0 classification pipeline details
- `docs/services/commands-agent/ARCHITECTURE.md` - Created technical reference with architecture diagrams, recent changes (INT-269, INT-218)
- `docs/services/commands-agent/API.md` - Created complete API reference for public and internal endpoints
- `docs/services/commands-agent/TESTING.md` - Created testing guide with patterns and coverage info
- `docs/services/commands-agent/DEPLOYMENT.md` - Created deployment guide with Terraform configuration
- `docs/services/commands-agent/technical-debt.md` - Updated with INT-269, INT-218 resolved issues, future plans

**Key Changes Documented:**

| Change                         | Section                            | Documentation Impact                                  |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------- |
| INT-269 internal-clients       | ARCHITECTURE.md                    | Added package to dependencies, updated file structure |
| INT-218 Zod validation         | ARCHITECTURE.md, technical-debt.md | Documented schema validation, added resolved issue    |
| Recent commits (88cec45, etc.) | ARCHITECTURE.md                    | Updated "Recent Changes" table                        |
| LLM UsageLogger (INT-266)      | ARCHITECTURE.md                    | Added to dependencies list                            |
| Classifier directory rename    | ARCHITECTURE.md                    | Updated file structure (gemini/ -> llm/)              |

**Inferred Insights:**

- **Why exists:** Classify natural language input from WhatsApp and PWA into actionable types (todo, research, note, link, calendar, linear, reminder) using a 5-step LLM decision tree
- **Killer feature:** Structured 5-step classification pipeline with URL keyword isolation, explicit intent detection, and multi-language support (English + Polish)
- **Future plans:** Reminder handler implementation, additional language support (German, Spanish), structured output mode (Gemini function calling)
- **Limitations:** No reclassification of failed commands, reminder handler not implemented, language coverage limited to English/Polish

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| Code Smells         | 2     | Low      |
| **Total**           | **2** | Low      |

**Documentation Quality:**

- All 5 documentation files generated/updated
- SERVICE.md includes v2.0.0 classification pipeline details with examples
- ARCHITECTURE.md includes mermaid diagrams for architecture and data flow
- API.md documents all public and internal endpoints with request/response schemas
- TESTING.md includes test patterns and coverage information
- DEPLOYMENT.md includes Terraform configuration and environment variables
- technical-debt.md includes resolved issues for INT-177, INT-218, INT-269

---

## 2026-01-25 - todos-agent v2.1.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.1.0 release with INT-269 (internal-clients migration), INT-218 (Zod schema migration)

**Files Updated:**

- `docs/services/todos-agent/features.md` - Rewritten with active voice, concrete examples, clear value propositions
- `docs/services/todos-agent/technical.md` - Added architecture diagrams, data flow sequence, recent changes table (INT-269, INT-218)
- `docs/services/todos-agent/tutorial.md` - Complete rewrite with progressive exercises, AI extraction scenario
- `docs/services/todos-agent/technical-debt.md` - Updated with INT-269/INT-218 resolved issues, recent improvements
- `docs/services/todos-agent/agent.md` - Updated with constraint clarifications, AI extraction section

**Key Changes Documented:**

| Change                                   | Section           | Documentation Impact                                     |
| ---------------------------------------- | ----------------- | -------------------------------------------------------- |
| Migrate to @intexuraos/internal-clients  | technical.md      | Updated dependencies, added services.ts diagram          |
| Zod schema migration for item extraction | technical.md      | Added AI Item Extraction section with Zod validation     |
| todoItemExtractionService refactoring    | technical-debt.md | Added INT-218 before/after comparison                    |
| User service client consolidation        | technical-debt.md | Added INT-269 resolved issue documenting DRY improvement |

**Inferred Insights:**

- **Why exists:** Task management service that handles todos with sub-items, AI-powered item extraction from natural language, and comprehensive status workflows
- **Killer feature:** AI-powered todo item extraction using LLM (Gemini/GLM) - parses natural language descriptions into actionable items with priorities, due dates, and Zod-validated responses
- **Future plans:** Todo templates, recurring todos, todo dependencies, bulk operations, full-text search, collaboration features, reminders, subtask nesting

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Active voice throughout features.md (e.g., "Send a message, get items" vs "Messages are sent")
- Mermaid diagrams for architecture and data flow
- Tutorial includes AI extraction scenario with polling pattern
- Agent interface includes constraint clarifications and fallback behaviors
- Recent changes table tracks INT-269 and INT-218 commits

---

# Documentation Runs

Log of all `/document-service` runs.

---

## 2026-02-08 - v3.0.0 Full Documentation Run

**Version:** 3.0.0
**Date:** 2026-02-08
**Type:** Full Documentation Run (Phase 1-4)
**Scope:** 25 apps (18 updated, 2 new, 1 removed), 5 workers (all new), 21 packages (all new)

**New Services:**

- chat-agent - AI-powered conversational interface for natural language interactions
- code-agent - AI-assisted coding with context-aware suggestions and completions

**Removed Services:**

- promptvault-service - Legacy service deprecated in favor of centralized configuration

**New Workers:**

- orchestrator - Coordinates multi-agent workflows and resource management
- claude-worker - Handles Claude API interactions with retry logic and rate limiting
- log-cleanup - Automated log rotation and archival system
- vm-lifecycle - Virtual machine provisioning and lifecycle management

**New Packages:**

- All 21 infrastructure and common packages documented for the first time
- Includes packages for auth, database, messaging, utilities, and AI integration

**Method:** Autonomous multi-agent documentation with Opus for greenfield components, Sonnet for updates

**Quality Assurance:** Cross-validation phase verified contracts between services, ensuring API consistency and integration compatibility

**Documentation Files:**

- Apps: All 5 standard files per service (features.md, technical.md, tutorial.md, technical-debt.md, agent.md)
- Workers: All 5 standard files per worker
- Packages: 3 files per package (README.md, API.md, USAGE.md)

**Total Documented:** 51 components (25 apps + 5 workers + 21 packages)

---

<!-- Entries are prepended below this line -->

## 2026-01-25 - todos-agent v2.1.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.1.0 release with INT-269 (internal-clients migration), INT-218 (Zod schema migration)

**Files Updated:**

- `docs/services/todos-agent/features.md` - Rewritten with active voice, concrete examples, clear value propositions
- `docs/services/todos-agent/technical.md` - Added architecture diagrams, data flow sequence, recent changes table (INT-269, INT-218)
- `docs/services/todos-agent/tutorial.md` - Complete rewrite with progressive exercises, AI extraction scenario
- `docs/services/todos-agent/technical-debt.md` - Updated with INT-269/INT-218 resolved issues, recent improvements
- `docs/services/todos-agent/agent.md` - Updated with constraint clarifications, AI extraction section

**Key Changes Documented:**

| Change                                   | Section           | Documentation Impact                                     |
| ---------------------------------------- | ----------------- | -------------------------------------------------------- |
| Migrate to @intexuraos/internal-clients  | technical.md      | Updated dependencies, added services.ts diagram          |
| Zod schema migration for item extraction | technical.md      | Added AI Item Extraction section with Zod validation     |
| todoItemExtractionService refactoring    | technical-debt.md | Added INT-218 before/after comparison                    |
| User service client consolidation        | technical-debt.md | Added INT-269 resolved issue documenting DRY improvement |

**Inferred Insights:**

- **Why exists:** Task management service that handles todos with sub-items, AI-powered item extraction from natural language, and comprehensive status workflows
- **Killer feature:** AI-powered todo item extraction using LLM (Gemini/GLM) - parses natural language descriptions into actionable items with priorities, due dates, and Zod-validated responses
- **Future plans:** Todo templates, recurring todos, todo dependencies, bulk operations, full-text search, collaboration features, reminders, subtask nesting

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Active voice throughout features.md (e.g., "Send a message, get items" vs "Messages are sent")
- Mermaid diagrams for architecture and data flow
- Tutorial includes AI extraction scenario with polling pattern
- Agent interface includes constraint clarifications and fallback behaviors
- Recent changes table tracks INT-269 and INT-218 commits

---

## 2025-01-25 - data-insights-agent v2.1.0 Documentation Update

**Action:** Updated
**Agent:** service-scribe (autonomous)
**Trigger:** v2.1.0 release with INT-269 (internal-clients migration), INT-218 (Zod schema migration for LLM response validation)

**Files Updated:**

- `docs/services/data-insights-agent/features.md` - Complete rewrite with active voice, clear use cases, concrete examples
- `docs/services/data-insights-agent/technical.md` - Added architecture diagram, data flow sequence, recent changes table, Firestore collections
- `docs/services/data-insights-agent/tutorial.md` - Expanded to 5-part progressive tutorial with exercises
- `docs/services/data-insights-agent/technical-debt.md` - Added INT-218/INT-269 resolved issues, Zod migration notes
- `docs/services/data-insights-agent/agent.md` - Complete rewrite with proper TypeScript interfaces, examples

**Key Changes Documented:**

| Change                                  | Section               | Documentation Impact                                     |
| --------------------------------------- | --------------------- | -------------------------------------------------------- |
| @intexuraos/internal-clients migration  | technical.md, debt.md | Added INT-269 resolved issue documenting DRY improvement |
| Zod schema migration for LLM validation | technical-debt.md     | Added INT-218 resolved issue with 3 services migrated    |
| LLM response repair pattern             | technical.md, debt.md | Added INT-79 resolved issue documenting auto-retry logic |
| Empty insights handling improvement     | technical.md, debt.md | Added INT-77 resolved issue documenting success response |

**Inferred Insights:**

- **Why exists:** Turn scattered data (CSV/JSON + mobile notifications) into actionable insights with AI-powered analysis and automatic chart generation
- **Killer feature:** Composite feeds that unify static data sources with live mobile notifications, analyzed by AI to extract up to 5 measurable insights with chart recommendations
- **Future plans:** Zod schema validation complete (INT-218), internal-clients migration complete (INT-269), placeholder visualization fields remain unused

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| Code Smells         | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| **Total**           | **0** | —        |

**Documentation Quality:**

- All 5 documentation files regenerated with current v2.1.0 state
- Architecture diagrams added showing service interactions
- Data flow sequence diagram included
- Chart types reference table (C1-C6) documented
- Recent changes table tracking last 10 commits
- Tutorial includes progressive exercises with solutions

---

## 2025-01-25 - image-service v2.1.0 Documentation Update

**Action:** Updated
**Agent:** service-scribe (autonomous)
**Trigger:** INT-269 internal-clients migration

**Files Updated:**

- `docs/services/image-service/features.md` - No changes needed (content still accurate)
- `docs/services/image-service/technical.md` - Added INT-269 migration notes, recent commits, GCS path patterns
- `docs/services/image-service/tutorial.md` - Added v2.1.0 updates section
- `docs/services/image-service/technical-debt.md` - Added resolved issues for INT-269, INT-266
- `docs/services/image-service/agent.md` - Complete refresh with accurate schemas and endpoints
- `docs/site-index.json` - Updated image-service summary and features for v2.1.0

**Key Changes Documented (INT-269):**

| Change                        | Section      | Documentation Impact                  |
| ----------------------------- | ------------ | ------------------------------------- |
| UserServiceClient migration   | technical.md | Added INT-269 migration notes         |
| internal-clients package      | agent.md     | Updated dependency information        |
| GCS path patterns with slug   | technical.md | Documented path variants              |
| DELETE endpoint documentation | agent.md     | Added delete capability documentation |

**Inferred Insights:**

- **Why exists:** Generate AI cover images for research with automatic thumbnail generation
- **Killer feature:** LLM-powered prompt enhancement + multi-provider image generation (OpenAI GPT Image 1, Google Gemini Flash Image)
- **Future plans:** Additional image providers (Midjourney, Stable Diffusion, Ideogram), image editing features, cost management
- **Limitations:** No image editing, fixed 16:9 aspect ratio, no image variations

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Mermaid diagrams for architecture and data flow
- Complete API schemas for all three endpoints
- Tutorial includes v2.1.0 migration notes
- Agent interface includes usage patterns and error handling

---

## 2026-01-25 - web-agent v2.1.0 Documentation Update

**Action:** Updated
**Agent:** service-scribe (autonomous)
**Trigger:** v2.1.0 release with INT-269 (internal-clients migration)

**Files Updated:**

- `docs/services/web-agent/technical.md` - Added INT-269 migration, internal-clients integration notes, updated file structure
- `docs/services/web-agent/technical-debt.md` - Added INT-269 resolved issue
- `docs/services/web-agent/agent.md` - Updated last updated date
- `docs/site-index.json` - Updated web-agent summary and features, bumped version to 2.1.0

**Key Changes Documented (INT-269):**

| Change                           | Section      | Documentation Impact                                |
| -------------------------------- | ------------ | --------------------------------------------------- |
| @intexuraos/internal-clients     | technical.md | Added integration note, factory pattern docs        |
| createUserServiceClient()        | technical.md | Documented factory function and interface           |
| UserServiceClient.getLlmClient() | technical.md | Documented method for getting user's LLM client     |
| infra/user/index.ts re-exports   | technical.md | Updated file structure to show internal-clients use |

**Inferred Insights:**

- **Why exists:** Extract web content and generate AI summaries while preserving source language
- **Killer feature:** Self-healing LLM response parser with automatic JSON-to-prose repair
- **Future plans:** Caching layer, batch summarization, rate limiting, retry logic, PDF support

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| Code Smells         | 2     | Low      |
| **Total**           | **2** | Low      |

**Documentation Quality:**

- All 5 documentation files maintained and updated
- Technical documentation includes architecture diagrams and data flow sequences
- Agent interface provides machine-readable schemas for AI integration
- Tutorial covers both link preview and page summarization workflows

---

## 2025-01-25 - calendar-agent v2.1.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.1.0 release with INT-269 (internal-clients migration), INT-222 (Zod schema migration)

**Files Updated:**

- `docs/services/calendar-agent/technical.md` - Added recent changes table for INT-269/INT-222, updated dependencies section
- `docs/services/calendar-agent/technical-debt.md` - Added INT-269 and INT-222 resolved issue entries
- `docs/services/calendar-agent/agent.md` - Updated last updated date
- `docs/services/calendar-agent/tutorial.md` - Updated last updated date
- `docs/services/calendar-agent/features.md` - Updated version reference to v2.1.0

**Key Changes Documented:**

| Change                                    | Section           | Documentation Impact                                     |
| ----------------------------------------- | ----------------- | -------------------------------------------------------- |
| Migrate to @intexuraos/internal-clients   | technical.md      | Updated dependencies to reflect centralized package      |
| Zod schema migration for event validation | technical-debt.md | Added INT-222 resolved issue with benefits               |
| User service client consolidation         | technical-debt.md | Added INT-269 resolved issue documenting DRY improvement |

**Inferred Insights:**

- **Why exists:** Google Calendar integration with AI-powered natural language event extraction and preview-before-commit workflow
- **Killer feature:** Async preview generation with Pub/Sub, LLM reasoning, and automatic cleanup after event creation
- **Future plans:** Recurring events support, event colors, reminders, attachments, conference data, batch operations, preview TTL

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| Code Smells         | 1     | Low      |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

**Documentation Quality:**

- Documentation already comprehensive from v2.0.0
- Minor updates for INT-269 and INT-222 architectural improvements
- Recent changes table added for tracking commit history
- No breaking changes to API surface

---

## 2026-01-25 - actions-agent v2.1.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.1.0 release with INT-269 (internal-clients migration)

**Files Updated:**

- `docs/services/actions-agent/technical.md` - Added INT-269 migration note, updated dependencies section, added recent changes table
- `docs/services/actions-agent/technical-debt.md` - Added INT-269 resolved issue entry
- `docs/site-index.json` - Updated actions-agent summary and features for v2.1.0

**Key Changes Documented (INT-269):**

| Change                                  | Section           | Documentation Impact                                |
| --------------------------------------- | ----------------- | --------------------------------------------------- |
| Migrate to @intexuraos/internal-clients | technical.md      | Updated dependencies to reflect centralized package |
| User service client consolidation       | technical-debt.md | Added resolved issue documenting DRY improvement    |
| Package version bump to 2.1.0           | site-index.json   | Updated summary and feature list                    |

**Inferred Insights:**

- **Why exists:** Central action lifecycle manager coordinating all user-initiated commands across specialized services
- **Killer feature:** WhatsApp approval reply handling with LLM intent classification and atomic status transitions
- **Future plans:** Reminder handler implementation, bulk action execution, configurable auto-execution thresholds

**Technical Debt Summary:**

| Category            | Count | Severity   |
| ------------------- | ----- | ---------- |
| TODO/FIXME Comments | 0     | -          |
| Test Coverage Gaps  | 0     | -          |
| TypeScript Issues   | 4     | Low (test) |
| SRP Violations      | 2     | Medium     |
| Code Duplicates     | 0     | -          |
| Deprecations        | 0     | -          |

**Documentation Quality:**

- Documentation already comprehensive from v2.0.0
- Minor updates for INT-269 architectural improvement
- Recent changes table added for tracking commit history
- No breaking changes to API surface

---

## 2026-01-24 - research-agent v2.0.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.0.0 release with INT-178 (LLM model selection), INT-86 (Zod migration), INT-167 (test coverage)

**Files Updated:**

- `docs/services/research-agent/features.md` - Added natural language model selection, Zod validation, v2.0.0 changes section
- `docs/services/research-agent/technical.md` - Added Model Extraction Flow diagram, Zod Schema Validation section, parser+repair pattern
- `docs/services/research-agent/tutorial.md` - Added Part 2 (Natural Language Model Selection), Part 4 (Zod Schema Validation)
- `docs/services/research-agent/technical-debt.md` - Added v2.0.0 resolved issues, architecture quality analysis
- `docs/services/research-agent/agent.md` - Added Model Selection section, createDraftResearch endpoint, Zod-validated types

**Key Changes Documented:**

| Change                            | Source  | Documentation Impact                                       |
| --------------------------------- | ------- | ---------------------------------------------------------- |
| extractModelPreferences use case  | INT-178 | Natural language model extraction from user messages       |
| One model per provider constraint | INT-178 | validateSelectedModels function documented                 |
| API key filtering                 | INT-178 | buildAvailableModels with providerToKeyField mapping       |
| ResearchContextSchema             | INT-86  | Zod schema with nested TimeScopeSchema, ResearchPlanSchema |
| SynthesisContextSchema            | INT-86  | Conflict detection with DetectedConflictSchema             |
| Parser + repair pattern           | INT-86  | ContextInferenceAdapter with Zod validation and LLM repair |
| extractModelPreferences tests     | INT-167 | 100% coverage documented in technical-debt.md              |
| ContextInferenceAdapter tests     | INT-167 | Repair scenario coverage documented                        |

**Inferred Insights:**

- **Why exists:** Multi-model AI research with synthesis and attribution
- **Killer feature:** Natural language model selection + Zod-validated context inference with self-healing repair
- **Future plans:** Streaming responses, custom synthesis prompts, model selection learning, provider fallback

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 1     | Low      |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Mermaid diagrams for model extraction flow and parser+repair pattern
- Zod schema documentation with type inference examples
- Tutorial includes natural language model selection and Zod validation sections
- Agent interface includes new v2.0.0 types (ResearchContext, SynthesisContext)
- Model keyword table with provider mapping

---

## 2026-01-24 - bookmarks-agent v2.0.0 Documentation Refresh

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.0.0 release with INT-210 (WhatsApp delivery) and INT-172 (test coverage)

**Files Updated:**

- `docs/services/bookmarks-agent/features.md` - Added WhatsApp delivery feature, AI summaries with notification
- `docs/services/bookmarks-agent/technical.md` - Added architecture diagrams, Pub/Sub events, WhatsApp integration
- `docs/services/bookmarks-agent/tutorial.md` - Added event flow explanation, WhatsApp notification section
- `docs/services/bookmarks-agent/technical-debt.md` - Added INT-210/INT-172 resolved issues, architecture decisions
- `docs/services/bookmarks-agent/agent.md` - Added WhatsApp delivery patterns, event flow diagram
- `docs/site-index.json` - Updated bookmarks-agent features to include WhatsApp delivery

**Key Changes Documented (INT-210):**

| Change                    | Section           | Documentation Impact                                |
| ------------------------- | ----------------- | --------------------------------------------------- |
| WhatsAppSendPublisher     | technical.md      | Decoupled publisher from @intexuraos/infra-pubsub   |
| SendMessageEvent pattern  | agent.md          | Event interface with userId, message, correlationId |
| summarizeBookmark changes | technical.md      | WhatsApp publish after AI summarization             |
| Fire-and-forget pattern   | technical-debt.md | Architectural tradeoff documented                   |
| Three-stage pipeline      | tutorial.md       | Create -> Enrich -> Summarize -> WhatsApp flow      |

**Inferred Insights:**

- **Why exists:** Save and organize links with automatic metadata extraction and AI summaries
- **Killer feature:** Event-driven enrichment pipeline with WhatsApp delivery for zero-friction mobile access
- **Future plans:** Full-text search, link validation, folder hierarchy, bookmark sharing, import/export

**Technical Debt Summary:**

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Mermaid sequence diagram for bookmark creation and enrichment flow
- WhatsApp delivery architecture documented with tradeoff analysis
- Event flow clearly explained in tutorial with step-by-step breakdown
- Agent interface includes WhatsApp notification usage patterns

---

## 2026-01-24 - calendar-agent v2.0.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.0.0 release with preview generation (INT-189, INT-200, INT-171)

**Files Updated:**

- `docs/services/calendar-agent/features.md` - Complete rewrite highlighting preview-before-commit capability
- `docs/services/calendar-agent/technical.md` - Added Pub/Sub integration, preview flow diagrams, new endpoints
- `docs/services/calendar-agent/tutorial.md` - Added Part 3: Using Preview Generation with polling patterns
- `docs/services/calendar-agent/technical-debt.md` - Added v2.0.0 changes analysis, resolved issues section
- `docs/services/calendar-agent/agent.md` - Added CalendarPreview type, preview state machine, usage patterns
- `docs/site-index.json` - Updated summary, features, endpoint count (6 → 10)

**Key Changes Documented:**

| Change                         | Source  | Documentation Impact                              |
| ------------------------------ | ------- | ------------------------------------------------- |
| Calendar preview generation    | INT-189 | New generatePreview use case, Pub/Sub integration |
| Preview cleanup after creation | INT-200 | Non-blocking deletion pattern documented          |
| Duration/isAllDay computation  | INT-189 | Preview model fields documented                   |
| Test coverage improvements     | INT-171 | Coverage status updated in technical-debt.md      |

**Inferred Insights:**

- **Why exists:** Google Calendar integration with intelligent date parsing and preview support
- **Killer feature:** Preview-before-commit with duration/isAllDay auto-detection
- **Future plans:** Recurring events, event colors, reminders, conference data, batch operations

**Technical Debt Summary:**

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Low      |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Mermaid diagrams for architecture, preview flow, event creation flow
- Preview status state machine (ASCII) in agent.md
- Tutorial includes polling patterns and error handling
- Agent interface includes 4 usage patterns with preview integration

---

## 2026-01-24 - user-service v2.0.0 Documentation Refresh

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.0.0 release with INT-199 (rate limit fix) and INT-170 (coverage)

**Files Updated:**

- `docs/services/user-service/features.md` - Added rate limit awareness, error formatting details
- `docs/services/user-service/technical.md` - Added LLM error formatting section with precedence rules
- `docs/services/user-service/tutorial.md` - Added rate limit error examples, v2.0.0 troubleshooting
- `docs/services/user-service/technical-debt.md` - Added v2.0.0 resolved issues section
- `docs/services/user-service/agent.md` - Added error formatting rules, common error messages table

**Key Changes Documented:**

| Change                         | Source   | Documentation Impact                           |
| ------------------------------ | -------- | ---------------------------------------------- |
| Rate limit precedence fix      | INT-199  | Error parsing order documented in technical.md |
| parseGenericError() reordering | INT-199  | Precedence rules added to agent.md             |
| formatLlmError test coverage   | INT-170  | Coverage status updated in technical-debt.md   |
| 5 LLM providers (incl. Zai)    | Codebase | All docs updated to reflect 5 providers        |

**Inferred Insights:**

- **Why exists:** Unified auth and API key management with zero-knowledge key distribution
- **Killer feature:** AES-256-GCM encryption + real-time key validation + intelligent error formatting
- **Future plans:** Microsoft OAuth, GitHub OAuth, usage analytics, budget alerts

**Technical Debt Summary:**

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 0     | -        |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |

**Documentation Quality:**

- Rate limit vs API key error precedence clearly documented
- Error formatting rules with examples for all 5 providers
- v2.0.0 fixes highlighted in tutorial troubleshooting section
- Agent interface includes error message lookup table

---

## 2026-01-24 - commands-agent v2.0.0 Documentation Update

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.0.0 release with classification improvements (INT-177)

**Files Updated:**

- `docs/services/commands-agent/features.md` - Complete rewrite highlighting v2.0.0 classification pipeline
- `docs/services/commands-agent/technical.md` - Added detailed 5-step prompt structure, Polish language support
- `docs/services/commands-agent/tutorial.md` - Added v2.0.0 feature demonstrations (URL isolation, Polish)
- `docs/services/commands-agent/technical-debt.md` - Added resolved issues section for INT-177
- `docs/services/commands-agent/agent.md` - Added classification pipeline flowchart, supported languages table

**Key Changes Documented (INT-177):**

| Change                    | Section          | Documentation Impact                        |
| ------------------------- | ---------------- | ------------------------------------------- |
| URL keyword isolation     | Steps 2, 4       | Keywords in URLs ignored for classification |
| Explicit intent detection | Step 2           | Command phrases override URL presence       |
| Polish language support   | Steps 1, 2       | Native phrases for all categories           |
| 5-step decision tree      | Prompt structure | Strict execution order eliminates ambiguity |

**Inferred Insights:**

- Why: Central routing for natural language commands from multiple channels
- Killer feature: 5-step structured classification with URL keyword isolation
- Future plans: Reminder handler, additional languages (German, Spanish)

**Technical Debt:**

- Code smells: 2 (Low - regex JSON extraction, magic numbers)
- Resolved in v2.0.0: URL keyword misclassification, English-only commands

---

## 2026-01-24 - web-agent v2.0.0 Documentation Refresh

**Action:** Updated (HIGH CARE)
**Agent:** service-scribe (autonomous)
**Trigger:** v2.0.0 release with major changes (INT-213, INT-191)

**Files Updated:**

- `docs/services/web-agent/features.md` - Complete rewrite for v2.0.0 capabilities
- `docs/services/web-agent/technical.md` - Added new architecture diagram, components, data flow
- `docs/services/web-agent/tutorial.md` - Added page summarization tutorial, updated error handling
- `docs/services/web-agent/technical-debt.md` - Added resolved issues, architecture decisions
- `docs/services/web-agent/agent.md` - Added summarize page capability, updated schemas
- `docs/site-index.json` - Updated web-agent summary and features

**Key Changes Documented:**

| Change                           | Source  | Documentation Impact                   |
| -------------------------------- | ------- | -------------------------------------- |
| Separated crawling from LLM      | INT-213 | New PageContentFetcher + LlmSummarizer |
| AI summaries use user's LLM keys | INT-213 | Added user-service dependency          |
| Parser + repair mechanism        | INT-213 | New parseSummaryResponse component     |
| Language preservation in prompt  | INT-213 | Added to features and tutorial         |
| Browser-like headers             | INT-191 | Added ACCESS_DENIED error code         |
| 403 error handling               | INT-191 | Added to error code tables             |

**Inferred Insights:**

- **Why exists:** Centralized web content extraction and AI summarization
- **Killer feature:** User-controlled LLM costs with automatic JSON-to-prose repair
- **Future plans:** Batch summarization, caching layer, PDF support

**Technical Debt Summary:**

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low      |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |

**Documentation Quality:**

- HIGH CARE applied to all dimensions
- Mermaid diagrams for architecture and data flow
- Error code tables updated with ACCESS_DENIED
- Tutorial includes language preservation examples
- Agent interface includes both endpoints with full schemas

---

## 2026-01-14 — Comprehensive Service Documentation Update

**Action:** Updated
**Agent:** service-scribe (autonomous)

**Files Updated:**

- `docs/services/actions-agent/features.md` — Refreshed content
- `docs/services/actions-agent/technical.md` — Refreshed content
- `docs/services/actions-agent/technical-debt.md` — Updated date, added auto-execution TODO
- `docs/services/research-agent/features.md` — Added Zai provider limitations
- `docs/services/research-agent/technical.md` — Added Zai provider models
- `docs/services/app-settings-service/features.md` — Updated to 5 providers, added internal/public endpoint distinction
- `docs/services/app-settings-service/technical.md` — Comprehensive update with architecture diagram
- `docs/services/whatsapp-service/technical-debt.md` — Updated date
- `docs/site-index.json` — Updated research-agent to 5 providers, app-settings-service to 5 providers, updated date

**Inferred Insights:**

- Why: Services had evolved since last documentation (Zai provider added, app-settings-service now has internal endpoints)
- Killer feature: Multi-provider LLM support with cost transparency
- Future plans:
  - actions-agent: Auto-execution based on confidence (stub exists)
  - whatsapp-service: Refactor processWebhookEvent to accept raw payload
  - actions-agent: calendar/reminder handler implementations

**Documentation Coverage:** 100% (17/17 services)

**Technical Debt Found:**

- TODO comments: 1 (whatsapp-service: refactor processWebhookEvent)
- Code smells: 0
- Test gaps: 0
- Type issues: 0

**Changes Summary:**

- Added Zai (glm-4.7) to research-agent LLM providers
- Updated app-settings-service to reflect 5 LLM providers (was 4)
- Added internal endpoint documentation for app-settings-service
- Updated all documentation dates to 2026-01-14

---

## 2026-01-13 — Top-Level Documentation Update

**Action:** Updated index files following tutorial completion
**Agent:** service-scribe

**Files Updated:**

- `docs/services/index.md` — Added tutorial links for bookmarks-agent, notes-agent, todos-agent
- Updated documentation count to "17 / 17 (100%) — All with tutorials"

**Context:**

Previous session completed missing tutorial.md and technical-debt.md files for three services. This update synchronizes the services catalog index to reflect that all services now have complete documentation (features, technical, tutorial, debt).

**Changes from previous:**

- bookmarks-agent: Added `[tutorial](bookmarks-agent/tutorial.md)` link
- notes-agent: Added `[tutorial](notes-agent/tutorial.md)` link
- todos-agent: Added `[tutorial](todos-agent/tutorial.md)` link

---

## 2026-01-13 — Complete Service Documentation Run

**Action:** Created / Updated
**Agent:** service-scribe (autonomous)

**Files Created:**

### Service Documentation Files (68 files)

**actions-agent** (4 files)

- `docs/services/actions-agent/features.md`
- `docs/services/actions-agent/technical.md`
- `docs/services/actions-agent/tutorial.md`
- `docs/services/actions-agent/technical-debt.md`

**research-agent** (4 files)

- `docs/services/research-agent/features.md`
- `docs/services/research-agent/technical.md`
- `docs/services/research-agent/tutorial.md`
- `docs/services/research-agent/technical-debt.md`

**user-service** (4 files)

- `docs/services/user-service/features.md`
- `docs/services/user-service/technical.md`
- `docs/services/user-service/tutorial.md`
- `docs/services/user-service/technical-debt.md`

**image-service** (4 files)

- `docs/services/image-service/features.md`
- `docs/services/image-service/technical.md`
- `docs/services/image-service/tutorial.md`
- `docs/services/image-service/technical-debt.md`

**bookmarks-agent** (4 files)

- `docs/services/bookmarks-agent/features.md`
- `docs/services/bookmarks-agent/technical.md`
- `docs/services/bookmarks-agent/tutorial.md`
- `docs/services/bookmarks-agent/technical-debt.md`

**notes-agent** (4 files)

- `docs/services/notes-agent/features.md`
- `docs/services/notes-agent/technical.md`
- `docs/services/notes-agent/tutorial.md`
- `docs/services/notes-agent/technical-debt.md`

**todos-agent** (4 files)

- `docs/services/todos-agent/features.md`
- `docs/services/todos-agent/technical.md`
- `docs/services/todos-agent/tutorial.md`
- `docs/services/todos-agent/technical-debt.md`

**whatsapp-service** (4 files)

- `docs/services/whatsapp-service/features.md`
- `docs/services/whatsapp-service/technical.md`
- `docs/services/whatsapp-service/tutorial.md`
- `docs/services/whatsapp-service/technical-debt.md`

**commands-agent** (4 files)

- `docs/services/commands-agent/features.md`
- `docs/services/commands-agent/technical.md`
- `docs/services/commands-agent/tutorial.md`
- `docs/services/commands-agent/technical-debt.md`

**web-agent** (4 files)

- `docs/services/web-agent/features.md`
- `docs/services/web-agent/technical.md`
- `docs/services/web-agent/tutorial.md`
- `docs/services/web-agent/technical-debt.md`

**calendar-agent** (4 files)

- `docs/services/calendar-agent/features.md`
- `docs/services/calendar-agent/technical.md`
- `docs/services/calendar-agent/tutorial.md`
- `docs/services/calendar-agent/technical-debt.md`

**data-insights-agent** (4 files)

- `docs/services/data-insights-agent/features.md`
- `docs/services/data-insights-agent/technical.md`
- `docs/services/data-insights-agent/tutorial.md`
- `docs/services/data-insights-agent/technical-debt.md`

**mobile-notifications-service** (4 files)

- `docs/services/mobile-notifications-service/features.md`
- `docs/services/mobile-notifications-service/technical.md`
- `docs/services/mobile-notifications-service/tutorial.md`
- `docs/services/mobile-notifications-service/technical-debt.md`

**api-docs-hub** (4 files)

- `docs/services/api-docs-hub/features.md`
- `docs/services/api-docs-hub/technical.md`
- `docs/services/api-docs-hub/tutorial.md`
- `docs/services/api-docs-hub/technical-debt.md`

**app-settings-service** (4 files)

- `docs/services/app-settings-service/features.md`
- `docs/services/app-settings-service/technical.md`
- `docs/services/app-settings-service/tutorial.md`
- `docs/services/app-settings-service/technical-debt.md`

**notion-service** (4 files)

- `docs/services/notion-service/features.md`
- `docs/services/notion-service/technical.md`
- `docs/services/notion-service/tutorial.md`
- `docs/services/notion-service/technical-debt.md`

### Aggregated Content (3 files)

- `docs/services/index.md`
- `docs/site-index.json`
- `docs/overview.md`

**Inferred Insights:**

| Service                      | Why Exists                                       | Killer Feature                                       | Future Plans                           |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------- |
| actions-agent                | Central orchestration point for all user actions | Pub/Sub distribution to specialized agents           | Action type registry expansion         |
| research-agent               | Multi-LLM synthesis for comprehensive research   | Parallel queries across 4 providers with aggregation | More LLM providers, custom prompts     |
| user-service                 | Unified auth and API key management              | AES-256-GCM encryption for API keys                  | More OAuth providers                   |
| image-service                | AI image generation for research covers          | GPT Image 1 and Gemini Flash Image support           | More image models                      |
| bookmarks-agent              | Save links with metadata extraction              | OpenGraph metadata via web-agent                     | Full-text search                       |
| notes-agent                  | Quick note capture                               | Simple CRUD with tag support                         | Rich text, versioning                  |
| todos-agent                  | Task management with AI extraction               | AI-powered item extraction from natural language     | Recurring tasks, sub-task dependencies |
| whatsapp-service             | WhatsApp Business integration                    | Media download to GCS with async transcription       | More message types                     |
| commands-agent               | Classify user intent into action types           | Model preference detection from natural language     | More action types                      |
| web-agent                    | OpenGraph metadata extraction                    | Streaming with 2MB limit enforcement                 | Twitter card expansion                 |
| calendar-agent               | Google Calendar integration                      | Free/busy queries across multiple calendars          | Recurring event support                |
| data-insights-agent          | AI-powered data analysis                         | Composite feeds combining multiple sources           | More chart types                       |
| mobile-notifications-service | Push notification gateway                        | Signature-based device authentication                | More platforms (iOS)                   |
| api-docs-hub                 | Unified API documentation                        | Multi-spec aggregation with service selector         | Live API testing                       |
| app-settings-service         | LLM pricing and usage tracking                   | Per-model cost analytics                             | More providers, budget alerts          |
| notion-service               | Notion integration management                    | Connection lifecycle with workspace detection        | Two-way sync                           |

**Documentation Coverage:** 100%

**Technical Debt Summary:**

| Service                      | TODOs | Code Smells | Test Gaps | Type Issues |
| ---------------------------- | ----- | ----------- | --------- | ----------- |
| actions-agent                | 0     | 2           | 0         | 0           |
| research-agent               | 0     | 1           | 0         | 0           |
| user-service                 | 0     | 0           | 0         | 0           |
| image-service                | 0     | 1           | 0         | 0           |
| bookmarks-agent              | 0     | 1           | 0         | 0           |
| notes-agent                  | 0     | 1           | 0         | 0           |
| todos-agent                  | 0     | 0           | 0         | 0           |
| whatsapp-service             | 0     | 2           | 0         | 0           |
| commands-agent               | 0     | 0           | 0         | 0           |
| web-agent                    | 0     | 0           | 0         | 0           |
| calendar-agent               | 0     | 0           | 0         | 0           |
| data-insights-agent          | 0     | 0           | 0         | 0           |
| mobile-notifications-service | 0     | 0           | 0         | 0           |
| api-docs-hub                 | 0     | 0           | 0         | 0           |
| app-settings-service         | 0     | 0           | 0         | 0           |
| notion-service               | 0     | 0           | 0         | 0           |

**Total:** 8 code smells identified across 16 services (all low severity)

---
