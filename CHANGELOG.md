# IntexuraOS Changelog

**Current Version:** 2.0.0

This changelog provides a comprehensive record of IntexuraOS development.

**Version Coverage:**

- This changelog includes all changes from initial commit (December 28, 2025) through version 2.0.0 (January 24, 2026)
- Total commits analyzed: 1,309
- Total files: 8,500+
- Services/Apps: 18
- Shared packages: 21
- Test files: 1,000+

---

## 2026-01-24

### Breaking Changes

**LLM Package Restructuring (INT-228, INT-229, INT-241, INT-242)**

- Deleted `packages/llm-common/` package entirely (130+ files removed)
- Migrated to three specialized packages with clear separation of concerns:
  - `packages/llm-factory/` - Provider creation and configuration
  - `packages/llm-prompts/` - All prompt templates and builders
  - `packages/llm-utils/` - Shared utilities (validation, redaction, context guards)
- Updated all 18 consuming services with new import paths
- Fixed package exports to use source files for proper TypeScript type resolution
- **Migration impact:** Any external code importing from `@intexuraos/llm-common` must update imports to the new packages

### Added

**WhatsApp Approval Enhancements (INT-161, INT-203)**

- Users can now respond to approval requests via WhatsApp text replies with LLM-based intent classification (approve/reject/unclear)
- WhatsApp reactions support: 👍 for approve, 👎 for reject on approval notification messages
- OutboundMessage tracking to correlate replies with original approval messages

**Calendar Preview Generation (INT-189)**

- Preview generation for calendar events before approval
- Users can see exactly what will be created (title, time, duration, all-day detection)
- New `/internal/calendar/generate-preview` and `/internal/calendar/preview/:actionId` endpoints

**GLM-4.7-Flash Support (INT-187)**

- Added GLM-4.7-Flash as a free Zai AI model for cost savings and fallback
- 200K context window, 128K max output tokens
- Available for research, synthesis, and validation tasks

**LLM Model Selection in Research (INT-178)**

- Users can specify LLM models in WhatsApp messages (e.g., "research AI using gemini and claude")
- LLM-based model extraction replacing keyword-based approach
- Support for exclusions ("all models except perplexity") and synthesis model selection

**WhatsApp Bookmark Summary Delivery (INT-210)**

- AI-generated bookmark summaries automatically delivered via WhatsApp
- Decoupled architecture using existing `SendMessageEvent` pattern
- Summaries written in the same language as the source content

**Claude Code Skills**

- `/linear` skill with auto-splitting for complex multi-step tasks (INT-209)
- `/sentry` skill for error triage, investigation, and cross-linking
- `/document-service` skill unifying service documentation (INT-214)
- Parent-child issue structure with tier-based dependencies

**Linear Board Redesign (INT-208)**

- New 3-column layout: Planning (Todo + Backlog) → In Progress (In Progress → In Review → To Test) → Recently Closed
- Added Todo and To Test categories with color-coded sections
- Mobile view enhanced with 7 granular tabs

**Zod Schema Migration (INT-86)**

- Migrated context inference guards from manual type guards to Zod schemas
- Field-level validation errors for LLM response debugging
- Parser + repair pattern for automatic response correction

### Changed

**Linear Command Adjustments (INT-206, INT-207)**

- Random selection now picks from Todo state only (not Backlog)
- After PR approval, issues transition to Q&A QA state instead of Done
- Issues only move to Done when explicitly requested

**WhatsApp Voice Transcription UI (INT-205)**

- Replaced spinner with WhatsApp-style typing indicator (three bouncing dots)
- Simplified status text from "Transcription in progress..." to "Transcribing..."

**Command Classification Accuracy (INT-177)**

- URL keywords are now isolated and ignored for classification
- Explicit intent detection takes priority (e.g., "save bookmark" overrides URL keywords)
- Added Polish language support for command phrases

**AI Summary Fix (INT-213)**

- Separated Crawl4AI crawling from LLM summarization
- Uses user's own LLM for prose summaries instead of Crawl4AI's extraction
- Language preservation in summaries

**@zaiclaude Trigger (INT-179)**

- Changed Z.ai GitHub workflow trigger from `@zai-claude` to `@zaiclaude`

### Fixed

**Race Condition in Approval Replies (INT-211)**

- Fixed concurrent approval replies both passing status check before update
- Implemented atomic check-and-update using Firestore transactions

**Duplicate Actions from Approval Replies (INT-201)**

- Approval replies no longer create duplicate actions via commands-agent
- Skip command.ingest when actionId is extracted from approval correlationId

**Calendar Preview Cleanup (INT-200)**

- Calendar preview documents now deleted after successful event creation
- Non-blocking cleanup with warning logs on failure

**OpenGraph Link Preview Errors (INT-191)**

- Added browser-like headers to improve website compatibility
- New `ACCESS_DENIED` error code for HTTP 403 responses
- Clearer error messages for blocked requests

**Rate Limit Error Messages (INT-199)**

- Fixed misleading "API key invalid/expired" error for 429 rate limit responses
- Rate limit detection now takes precedence over API key pattern matching

**Approval Event Publishing (INT-202, INT-212)**

- Publish `action.created` event after WhatsApp approval
- Only publish approval reply events when actionId is found

### Technical

- Migrated from `@zai-claude` to `@zaiclaude` trigger in GitHub workflows
- Added `--cpu-throttling` option to prevent billing drift (INT-194)
- Applied E2_MEDIUM machine type project-wide for Cloud Build (INT-243)
- Test coverage improvements across 12 services (INT-153, INT-155, INT-166, INT-167, INT-168, INT-169, INT-170, INT-171, INT-172, INT-173)
- Mobile-only icons for research view buttons
- Processing status added to default inbox filters
- Redirect to home page after logout (INT-176)
- Strip markdown headers from transcription summaries

---

## 2026-01-19

### Added

**Page Summarization via Crawl4AI**

- Automatic bookmark summarization using Crawl4AI Cloud API
- New `/internal/page-summaries` endpoint in web-agent
- Pub/Sub workflow for async bookmark summarization
- Terraform secret management for CRAWL4AI_API_KEY

**Auth0 Lock Widget Integration**

- Embedded Auth0 Lock widget on login page replacing redirect-based flow
- IntexuraOS branding with cyan primary color
- Increased PWA cache limit for Auth0 Lock assets

**Enhanced Research Reports**

- User info and branding in report headers ("Generated by {name} with IntexuraOS")
- Improved prompt display showing enhanced version instead of original
- Intelligent prompt builder for classification context

**Idempotency & Reliability**

- ProcessedActionRepository to prevent duplicate Linear issues on retries
- Idempotency check for calendar-agent actions
- Duplicate notification prevention for linear actions

**PWA Improvements**

- Force Refresh option in user dropdown menu (clears all caches)
- Cache headers for PWA critical files

**Infrastructure**

- Terraform module for claude-code-dev service account (15 admin roles)
- Service account documentation for Terraform operations

### Changed

**ServiceFeedback Contract**

- Renamed ActionFeedback to ServiceFeedback across all agents
- Standardized error codes as ServiceErrorCodes in common-core
- Unified response schemas across service agents

**Speechmatics Transcription**

- Added 30+ project-specific vocabulary terms (AI providers, cloud services, architecture)
- Reduced punctuation sensitivity (0.35) and enabled disfluency removal
- Added Linear pronunciation variants

**LLM Package Restructure**

- Reorganized llm-common into domain directories (shared/, research/, synthesis/)
- Migrated tests to co-located **tests** directories

**ActionItem UX**

- Extracted to separate component with manual dismissal
- Added retry mechanism for failed actions
- Unified error handling across action types

### Fixed

**Calendar**

- Week navigation now starts on Monday (not Sunday)
- Week range display shows Mon-Sun without overlap
- Missing timezone in calendar events
- Calendar notification links redirecting to inbox
- Calendar settings link destination
- Added calendar.readonly scope for timezone access

**UI/UX**

- Action execute endpoint schema includes message field
- iPad actions views layout
- Chart configuration errors now displayed to user
- Action menu with dot dropdown visible on all screen sizes

**Error Handling**

- User-friendly message for Anthropic billing errors
- LLM schema parse failures lowered to debug level
- Frontend error handling for action execution
- Typed error codes for bookmarks client

**Validation**

- Relaxed LLM response sentence count validation
- Validate inherited synthesis model API key
- Accept number and boolean values in DefaultApplied

### Technical

- 95%+ test coverage maintained across all services
- Comprehensive tests for linear-agent
- llm-common restructured into domain-specific directories
- Documentation for expected Sentry warnings on LLM partial failures

---

## 2026-01-14

### Added

**New Services**

- Todos Agent - Task management with Pub/Sub processing and user CRUD operations
- Notes Agent - Note-taking with tags, sources, and full CRUD operations
- App Settings Service - Centralized LLM pricing configuration serving
- Image Service - Image prompt generation and image generation via multiple LLM providers
- Data Insights Agent - Composite feeds, visualizations, and custom data source management
- Web Agent - Internal link preview generation service
- Bookmarks Agent - Bookmark management with conflict resolution and Pub/Sub processing

**New Web UI Pages**

- DataInsightsPage - Composite feeds and data insights visualization
- CompositeFeedVisualizationsPage - Vega-based chart visualizations
- BookmarksListPage - Bookmark management interface
- NotesListPage - Notes management interface
- TodosListPage - Tasks/todos management interface
- CalendarPage - Calendar integration interface
- GoogleCalendarConnectionPage - Google Calendar OAuth connection flow
- LlmCostsPage - LLM usage cost tracking and visualization
- LlmPricingPage - LLM pricing configuration display
- ShareHistoryPage - Share history tracking

**New Web UI Components**

- ModelSelector - Configurable LLM model selection component
- VegaChart - Vega-lite chart rendering component
- VisualizationCard - Data visualization display card
- DataInsightCard - Data insight summary card
- ChartPreview - Chart definition preview component
- BookmarkConflictModal - Bookmark conflict resolution modal

**Research & Synthesis Enhancements**

- Two-phase context inference for research and synthesis prompts
- Gemini-generated collapsible input context labels
- Real-time input context display during research processing
- Synthesis model name display in report headers
- Research favorite field and sorting indexes
- Synthesis link text using descriptive names instead of model identifiers
- Extended research response fields with input contexts

**LLM Features**

- Centralized LLM pricing package (llm-pricing) for cost calculation
- LLM audit package (llm-audit) for usage tracking and validation
- LLM usage tracking with callType categorization
- Extended pricing fields for image generation models
- Support for GLM-4 (zai provider) pricing
- GPT-5.2 pricing support
- Perplexity pricing updates
- Image generation via Gemini native (nano-banana-pro/gemini-2.5-flash-image)
- User-friendly LLM error message formatting
- Model priority logic for image generation providers

**API Endpoints - Image Service**

- POST /internal/images/prompts/generate - Generate image prompts from text
- POST /internal/images/generate - Generate images via LLM providers
- DELETE /internal/images/:id - Delete stored images

**API Endpoints - App Settings Service**

- GET /settings/pricing - Get LLM pricing for all providers
- GET /settings/usage-costs - Get LLM usage costs over time

**API Endpoints - Notes Agent**

- POST /notes - Create new note
- GET /notes - List user notes
- GET /notes/:id - Get specific note
- PATCH /notes/:id - Update note
- DELETE /notes/:id - Delete note

**API Endpoints - Todos Agent**

- POST /internal/todos/pubsub/todos-processing - Process todo events from PubSub

**API Endpoints - Data Insights Agent**

- GET /data-insights - List data insights
- GET /data-insights/:id - Get specific insight
- POST /data-insights - Create new insight
- PATCH /data-insights/:id - Update insight
- DELETE /data-insights/:id - Delete insight
- GET /internal/data-insights/filters - Get available filters
- GET /visualizations - List visualizations
- GET /visualizations/:id - Get specific visualization
- POST /visualizations - Create visualization
- PATCH /visualizations/:id - Update visualization
- DELETE /visualizations/:id - Delete visualization
- GET /composite-feeds - List composite feeds
- GET /composite-feeds/:id - Get specific composite feed
- POST /composite-feeds - Create composite feed
- PATCH /composite-feeds/:id - Update composite feed
- DELETE /composite-feeds/:id - Delete composite feed
- GET /data-sources - List custom data sources
- POST /data-sources - Create custom data source
- PATCH /data-sources/:id - Update data source
- DELETE /data-sources/:id - Delete data source

**API Endpoints - Bookmarks Agent**

- GET /bookmarks - List user bookmarks
- POST /bookmarks - Create bookmark
- PATCH /bookmarks/:id - Update bookmark
- DELETE /bookmarks/:id - Delete bookmark
- GET /internal/bookmarks/filters - Get available filters
- POST /internal/bookmarks/pubsub/bookmarks-processing - Process bookmark events

**API Endpoints - Web Agent**

- POST /internal/link-previews/generate - Generate link previews (internal)

**API Endpoints - Research Agent (Enhanced)**

- GET /internal/research/filters - Get available research filters
- Internal image deletion endpoint for research media cleanup

**API Endpoints - User Service (Enhanced)**

- Success notification configuration for actions

**API Endpoints - Actions Agent (Enhanced)**

- Action transition logging with type change use case
- GET /internal/actions/filters - Get available action filters

**Other Features**

- PWA Share Target redirect for HashRouter compatibility
- Auto-generated notification filter IDs
- API key validation success notifications
- Custom public base URL support for image uploads
- CDN cache invalidation for index.html
- Web app URL rewrite for SPA fallback

### Changed

**Service Renames**

- llm-orchestrator → research-agent (more descriptive naming)
- commands-router → commands-agent (consistent agent naming)
- data-insights-service → data-insights-agent (consistent agent naming)

**Domain Structure**

- whatsapp-service domain reorganized from inbox to whatsapp for consistency
- Import path refactoring for note and todo repositories

**Research Flow**

- Research/synthesis prompts updated with improved context handling
- Research settings removed from user service client
- LLM synthesis results now include usage metrics
- Token and cost data omitted from copied LLM results

**UI/UX Improvements**

- Model selection UI refactored for better UX
- Mobile-optimized components (CommandItem, ActionItem, Filter button)
- Mobile-optimized header and tab navigation
- Inbox page component structure improvements
- Sidebar navigation updates

**Terraform**

- Web app backend buckets URL rewrite configuration
- SSL certificate resource name prefix updated
- Generated images bucket module added

### Fixed

- Crypto.randomUUID type conflicts resolved with explicit imports
- Package-lock.json sync issues for infra-perplexity
- GPT-image-1 now handles both b64_json and url response formats
- Nano-banana-pro uses Gemini native image generation
- Environment variable inconsistencies across services
- Test failures and improved coverage

### Technical

**Package Management**

- Migrated from npm to pnpm for improved dependency management
- Workspace configuration updated for pnpm compatibility

**New Packages**

- llm-pricing - Centralized LLM pricing data and cost calculation
- llm-audit - LLM usage auditing and validation

**Migrations**

- 003_perplexity-pricing.mjs - Perplexity provider pricing
- 004_llm-pricing-extended-fields.mjs - Extended pricing fields
- 005_llm-pricing-update-jan-2026.mjs - January 2026 pricing updates
- 006_image-generation-pricing.mjs - Image generation model pricing
- 007_gpt-5.2-pricing-fix.mjs - GPT-5.2 pricing correction
- 008_commands-rules-composite-feeds-index.mjs - Composite index
- 009_llm-pricing-sync-jan-2026.mjs - Pricing synchronization

**CI/CD**

- Cloud Build deployment workflow optimization with batch mode
- Smart dispatch script for affected service detection
- Per-service deployment triggers
- GitHub workflows for Claude Code integration
- CI scripts enhanced (verify-connections.sh, verify-no-console.mjs)

**Development Tools**

- LLM pricing update automation script
- Release notes generation script
- Connection verification script

**Documentation**

- Research flow architecture documentation
- LLM usage and pricing documentation
- Claude Code cloud development setup guide
- WhatsApp service domain documentation

**Infrastructure**

- Firestore composite indexes for multiple collections
- Service account updates for pricing providers
- Cloud Build module refactoring
- Web app Terraform module enhancements

---

### Added

- Automated changelog generation system
- Comprehensive project history analysis
- Release notes automation script

---

## [0.0.3] - 2025-12-28 to 2026-01-03

This release includes comprehensive development across the platform with 187 functional changes and 174 technical improvements.

## Functional Changes (User-Facing Features & API)

### API Endpoints - Actions Agent

1. `GET /actions` - List user actions with status filtering
2. `PATCH /actions/:id` - Update action details
3. `DELETE /actions/:id` - Delete action
4. `POST /actions/:id/approve` - Approve pending action
5. `POST /actions/:id/reject` - Reject pending action
6. `POST /actions/:id/execute` - Execute approved action
7. `GET /internal/actions/filters` - Get available filter options
8. `POST /internal/whatsapp/pubsub/process-command` - Process WhatsApp commands via Pub/Sub

### API Endpoints - User Service

9. `POST /device/code` - Initiate OAuth Device Authorization Flow
10. `POST /device/token` - Poll for device authorization token
11. `GET /oauth/chatgpt-actions/authorize` - ChatGPT Actions OAuth authorization
12. `POST /oauth/chatgpt-actions/token` - ChatGPT Actions OAuth token exchange
13. `POST /oauth/chatgpt-actions/refresh` - Refresh ChatGPT Actions OAuth token
14. `GET /config/chatgpt-actions` - Get ChatGPT Actions configuration
15. `POST /api-keys` - Create or update API keys
16. `GET /api-keys` - List user's API keys
17. `PUT /api-keys/:provider` - Update specific provider API key
18. `DELETE /api-keys/:provider` - Delete API key for provider
19. `POST /internal/user/api-keys` - Internal endpoint to get user API keys
20. `POST /firebase-token` - Exchange Auth0 token for Firebase custom token

### API Endpoints - WhatsApp Service

21. `GET /webhook` - WhatsApp webhook verification
22. `POST /webhook` - Receive WhatsApp messages
23. `GET /messages/:id/media/:mediaId` - Get signed URL for media file
24. `DELETE /messages/:id` - Delete WhatsApp message
25. `POST /internal/whatsapp/send-message` - Send WhatsApp message (internal)
26. `GET /mapping-config` - Get contact mapping configuration
27. `PUT /mapping-config` - Update contact mapping configuration

### API Endpoints - Mobile Notifications Service

28. `POST /connect` - Create signature connection for device
29. `GET /connect/:signature` - Get connection status
30. `POST /webhook` - Receive mobile notifications
31. `GET /notifications` - List notifications with filtering
32. `DELETE /notifications/:id` - Delete notification
33. `GET /notifications/filters` - Get available filter options

### API Endpoints - Notion Service

34. `GET /integration/oauth/authorize` - Notion OAuth authorization
35. `POST /integration/oauth/callback` - Notion OAuth callback
36. `GET /integration/status` - Check Notion integration status
37. `POST /webhook` - Notion webhook receiver

### API Endpoints - PromptVault Service

38. `POST /prompts` - Create new prompt template
39. `GET /prompts` - List prompt templates
40. `GET /prompts/:id` - Get specific prompt
41. `PUT /prompts/:id` - Update prompt template
42. `DELETE /prompts/:id` - Delete prompt

### API Endpoints - Research Agent

43. `POST /research` - Create research request
44. `POST /research/draft` - Create draft research
45. `GET /research` - List user's research
46. `GET /research/:id` - Get specific research
47. `PATCH /research/:id` - Update research
48. `DELETE /research/:id` - Delete research
49. `POST /research/:id/approve` - Approve research
50. `POST /research/:id/confirm` - Confirm research with action (proceed/retry)
51. `POST /research/:id/retry` - Retry failed research
52. `DELETE /research/:id/share` - Unshare research
53. `POST /internal/research/draft` - Create draft research (internal)
54. `POST /internal/llm/pubsub/process-research` - Process research via Pub/Sub
55. `POST /internal/llm/pubsub/process-llm-call` - Process LLM API call
56. `POST /internal/llm/pubsub/report-analytics` - Report LLM analytics

### API Endpoints - Commands Agent

57. `POST /commands` - Process natural language command
58. `GET /commands/:id` - Get command processing status
59. `POST /internal/commands/process` - Process command (internal)

### API Endpoints - Data Insights Agent

60. `GET /insights` - Get data insights for user
61. `POST /insights/custom-sources` - Add custom data source
62. `GET /insights/custom-sources` - List custom data sources
63. `DELETE /insights/custom-sources/:id` - Delete custom data source

### Domain Models - Actions Agent

64. Action model with status workflow (pending → awaiting_approval → processing → completed/failed/rejected)
65. ActionFilter model for filtering actions
66. Command model representing user commands
67. Contact model for WhatsApp contact mapping

### Domain Models - User Service

68. User identity model with Auth0 integration
69. AuthToken model with refresh token encryption
70. ApiKey model for LLM provider keys

### Domain Models - WhatsApp Service

71. WhatsAppMessage model with media support
72. MediaFile model for images and audio
73. LinkPreview model with OpenGraph metadata
74. ContactMapping model

### Domain Models - Mobile Notifications

75. MobileNotification model
76. SignatureConnection model for device pairing

### Domain Models - Research Agent

77. Research model with multi-LLM support
78. LlmResult model for individual provider results
79. ResearchShare model for public sharing
80. Pricing model for cost tracking

### Domain Models - PromptVault

81. Prompt template model
82. PromptVersion model

### Use Cases - Actions Agent

83. CreateActionUseCase - Create action from command
84. ListActionsUseCase - List actions with filtering
85. UpdateActionUseCase - Update action details
86. DeleteActionUseCase - Delete action
87. ApproveActionUseCase - Approve pending action
88. RejectActionUseCase - Reject action
89. ExecuteActionUseCase - Execute approved action
90. ProcessCommandUseCase - Process WhatsApp command

### Use Cases - User Service

91. InitiateDeviceAuthUseCase - Start OAuth device flow
92. PollDeviceTokenUseCase - Poll for authorization
93. ExchangeChatGPTTokenUseCase - ChatGPT OAuth exchange
94. CreateApiKeyUseCase - Store API keys
95. GetApiKeysUseCase - Retrieve API keys
96. ExchangeFirebaseTokenUseCase - Get Firebase custom token

### Use Cases - WhatsApp Service

97. ProcessTextMessageUseCase - Handle text messages
98. ProcessImageMessageUseCase - Handle image messages
99. ProcessAudioMessageUseCase - Handle audio messages
100.  GenerateThumbnailUseCase - Create image thumbnails
101.  GetMediaSignedUrlUseCase - Generate signed URLs
102.  DeleteMessageUseCase - Delete message with media cleanup

### Use Cases - Mobile Notifications

103. CreateConnectionUseCase - Pair device
104. ProcessNotificationUseCase - Store notification
105. ListNotificationsUseCase - Filter and list
106. DeleteNotificationUseCase - Remove notification

### Use Cases - Research Agent

107. CreateResearchUseCase - Initialize research
108. ProcessResearchUseCase - Orchestrate multi-LLM execution
109. ProcessLlmCallUseCase - Execute single LLM provider
110. RunSynthesisUseCase - Synthesize results
111. ShareResearchUseCase - Generate shareable HTML
112. UnshareResearchUseCase - Remove public share
113. RetryResearchUseCase - Intelligent retry for failed research
114. CheckLlmCompletionUseCase - Monitor LLM progress
115. RetryFailedLlmsUseCase - Retry specific failed providers

### Use Cases - Commands Agent

116. ProcessCommandUseCase - Parse natural language
117. CreateActionsFromCommandUseCase - Generate actions

### Use Cases - Data Insights Agent

118. GenerateInsightsUseCase - Analyze user data
119. AddCustomSourceUseCase - Add custom data
120. GenerateTitleUseCase - Generate insight titles

### Web UI Components

121. Header - App header with navigation
122. Sidebar - Main navigation sidebar
123. Layout - Page layout wrapper
124. Button - Reusable button component
125. Card - Card container component
126. Input - Form input component
127. ImageModal - Full-screen image viewer
128. ImageThumbnail - Image thumbnail with preview
129. AudioPlayer - Audio playback component
130. LinkPreview - Link preview card with metadata
131. LinkPreviewList - List of link previews
132. StatusWidget - Real-time status indicator
133. PWABanners - Progressive Web App install prompts
134. ProcessingStatus - Research processing status display
135. ActionsPanel - Actions list and management
136. FiltersPanel - Filter options panel
137. NotificationsPanel - Mobile notifications view
138. ResearchViewer - Research results display

### Web UI Pages/Views

139. Home page - Landing page
140. Login page - Authentication
141. Dashboard - Main user dashboard
142. Inbox - Actions inbox
143. Research - Research management
144. ResearchView - Individual research results
145. Settings - User settings
146. ApiKeys - API key management
147. Notifications - Mobile notifications
148. PromptVault - Prompt templates
149. DataInsights - Data insights dashboard
150. WhatsAppHistory - WhatsApp message history
151. Account - Account settings
152. OAuth callback handlers (Notion, ChatGPT)

### Integration Features

153. WhatsApp Business Cloud API integration
154. Notion API integration for prompt storage
155. Auth0 OAuth integration
156. ChatGPT Actions OAuth proxy
157. Google Gemini LLM integration
158. OpenAI GPT integration
159. Anthropic Claude integration
160. Speechmatics transcription integration
161. Firebase Authentication integration
162. Firebase Firestore database integration

### Search and Filtering

163. Action status filtering (pending, completed, failed, etc.)
164. Mobile notification filtering by app package
165. Multi-select filters for notifications
166. Research status filtering
167. Date range filtering for notifications

### Media Handling

168. WhatsApp image download and storage
169. WhatsApp audio download and storage
170. Image thumbnail generation (256px max edge)
171. Signed URL generation for private media
172. Media cleanup on message deletion
173. OpenGraph link preview extraction
174. Audio transcription via Speechmatics

### Sharing and Collaboration

175. Public research sharing with HTML generation
176. Shareable research links
177. Research HTML with embedded results
178. PWA share target support

### Cost and Analytics

179. LLM token usage tracking
180. Cost calculation per research
181. Provider cost breakdown
182. Analytics event publishing

### Progressive Web App (PWA) Features

183. PWA manifest configuration
184. Service worker registration
185. Install prompts for iOS/Android
186. Share target for incoming shares
187. Offline support planning

---

## Technical Changes (Architecture & Infrastructure)

### Services/Applications Created

1. **user-service** - User management and OAuth
2. **whatsapp-service** - WhatsApp message handling
3. **mobile-notifications-service** - Mobile notification aggregation
4. **notion-service** - Notion integration service
5. **promptvault-service** - Prompt template management
6. **research-agent** - Multi-LLM research orchestration
7. **actions-agent** - Action management and execution
8. **commands-agent** - Natural language command processing
9. **data-insights-agent** - Data analysis and insights
10. **api-docs-hub** - Unified API documentation
11. **web** - React frontend application
12. **auth-service** - Authentication service (later merged into user-service)
13. **research-agent** - Research service (later merged into research-agent)
14. **srt-service** - Speech-to-text service (planned)

### Shared Packages Created

15. **@intexuraos/common-core** - Result types, error handling
16. **@intexuraos/common-http** - HTTP utilities, JWT validation
17. **@intexuraos/http-contracts** - OpenAPI schema types
18. **@intexuraos/http-server** - Fastify server setup
19. **@intexuraos/infra-firestore** - Firestore adapter
20. **@intexuraos/infra-auth0** - Auth0 SDK wrapper
21. **@intexuraos/infra-notion** - Notion API client
22. **@intexuraos/infra-whatsapp** - WhatsApp Business API client
23. **@intexuraos/infra-pubsub** - Google Pub/Sub publisher base
24. **@intexuraos/infra-gpt** - OpenAI GPT client
25. **@intexuraos/infra-gemini** - Google Gemini client
26. **@intexuraos/infra-claude** - Anthropic Claude client
27. **@intexuraos/llm-audit** - LLM audit logging
28. **@intexuraos/llm-contract** - LLM provider interface

### Architecture Patterns

29. Hexagonal architecture (ports & adapters)
30. Domain-driven design (DDD) structure
31. Repository pattern for data access
32. Use case pattern for business logic
33. Dependency injection pattern
34. Result type pattern (no exceptions in domain)
35. Fake implementations for testing

### Testing Infrastructure

36. Vitest test runner configuration
37. Coverage thresholds at 95%
38. Fake Firestore implementation
39. Fake repository implementations
40. Integration test patterns with Fastify.inject()
41. Mock Firebase configuration
42. Test isolation with beforeEach/afterEach
43. Coverage reporting workflow
44. 914 test files created

### Build System

45. TypeScript monorepo configuration
46. pnpm workspaces setup
47. Shared tsconfig.base.json
48. Per-service tsconfig.json
49. ESLint configuration with TypeScript
50. Prettier code formatting
51. Type checking for tests (tsconfig.tests-check.json)
52. Build scripts in package.json
53. pnpm scripts for testing, linting, type-checking

### CI/CD Pipeline

54. GitHub Actions CI workflow
55. Affected service detection
56. Cloud Build integration
57. Docker image building per service
58. Automated testing on PR
59. Coverage reporting on PR
60. Vitest coverage workflow
61. Copilot refactoring workflow
62. Issue import automation

### Infrastructure as Code (Terraform)

63. Cloud Run service modules
64. Firestore database configuration
65. Google Cloud Storage buckets
66. Pub/Sub topics and subscriptions
67. Secret Manager secrets
68. Service accounts and IAM bindings
69. VPC connector for Cloud Run
70. Environment variable management
71. Cloud Run max_scale=1 cost optimization
72. Firebase web app configuration
73. Media storage bucket (private)
74. Terraform state management

### Docker Configuration

75. Multi-stage Dockerfile per service
76. Node.js Alpine base images
77. Production-optimized builds
78. Health check endpoints
79. PORT environment variable support
80. Non-root user execution

### Database Design

81. Firestore collection ownership registry (firestore-collections.json)
82. Firestore composite indexes (firestore.indexes.json)
83. Firestore security rules
84. Collection-per-service isolation
85. Migration system for Firestore
86. Optimized query patterns

### Pub/Sub Architecture

87. Base publisher class pattern
88. Event-driven LLM processing
89. WhatsApp command processing events
90. Audio transcription events
91. Analytics reporting events
92. Dead letter queue for failed messages
93. Push subscriptions (no pull)
94. Message deduplication with messageId

### Security Implementations

95. Refresh token encryption (AES-256-GCM)
96. Token redaction in logs
97. JWKS-based JWT validation
98. Internal auth token validation
99. Signed URLs for private media
100.  Secret Manager for credentials
101.  Service-to-service authentication
102.  CORS configuration

### Environment Management

103. INTEXURAOS\_\* prefix standardization
104. .env.example files per service
105. Environment variable validation
106. Local development configuration
107. Firebase emulator support
108. Local development script

### Code Quality

109. ESLint rules enforcement
110. TypeScript strict mode
111. noUncheckedIndexedAccess
112. exactOptionalPropertyTypes
113. strictBooleanExpressions
114. Import cycle detection
115. Code smell documentation (CLAUDE.md)
116. Architecture Decision Records (ADRs)
117. Comment standards

### Documentation

118. Comprehensive README.md
119. Architecture documentation (docs/)
120. Service-to-service communication guide
121. Firestore ownership documentation
122. Use case logging patterns
123. Pub/Sub standards documentation
124. API documentation via OpenAPI
125. Copilot instructions
126. Git commit conventions
127. Continuity workflow documentation

### Development Tools

128. VS Code integration (.idea/)
129. EditorConfig for consistency
130. Prettier configuration
131. NPM version pinning
132. Node version specification (.nvmrc)
133. GitHub Copilot instructions
134. Refactoring prompts
135. Session start prompts

### Monitoring and Logging

136. Structured logging with Pino
137. Request ID tracking
138. LLM audit logging
139. Error context logging
140. Performance metrics
141. logIncomingRequest utility

### Verification Scripts

142. firestore-collections.json verification
143. Pub/Sub publisher verification
144. Firestore connection check script
145. Collection listing scripts
146. Notification fetch scripts
147. Fake data generation scripts

### Migration System

148. Firestore migrations directory
149. Migration versioning
150. Migration execution tracking

### Cost Optimization

151. Cloud Run max_scale=1
152. Efficient query patterns
153. Media cleanup jobs
154. Composite index optimization

### Package Management

155. Workspace dependency resolution
156. Shared dependency versions
157. Package.json scripts standardization

### Error Handling

158. Result type pattern
159. Error code enumerations
160. Custom error types per domain
161. HTTP error mapping
162. Graceful degradation patterns

### API Standards

163. OpenAPI 3.0 specifications
164. Consistent response format
165. Error response format
166. Pagination patterns
167. Filter parameter conventions

### Development Workflows

168. Continuity system for complex tasks
169. Step-by-step planning
170. Progress tracking

### Performance Optimizations

171. Firestore batch operations
172. Parallel LLM execution
173. Async media processing
174. Efficient thumbnail generation

---

**Summary for v0.0.3:**

- Total Functional Changes: 187
- Total Technical Changes: 174
- Total commits: 444
- Total files: 7,209

---

_Note: This changelog analyzes actual code changes (files, routes, components, use cases) from git history, not just commit messages._
