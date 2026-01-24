# Documentation Runs

Log of all `/document-service` runs.

---

<!-- Entries are prepended below this line -->

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

**promptvault-service** (4 files)

- `docs/services/promptvault-service/features.md`
- `docs/services/promptvault-service/technical.md`
- `docs/services/promptvault-service/tutorial.md`
- `docs/services/promptvault-service/technical-debt.md`

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
| promptvault-service          | Prompt template management                       | Notion database sync for prompts                     | Version history, sharing               |

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
| promptvault-service          | 0     | 0           | 0         | 0           |

**Total:** 8 code smells identified across 17 services (all low severity)

---
