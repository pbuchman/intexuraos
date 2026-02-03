# Release Notes v2.2.0

**Release Date:** TBD (Prep Document)
**Previous Release:** v2.1.0 (2026-01-25)

This document consolidates all changes since v2.1.0 for the upcoming v2.2.0 release.

---

## Summary Statistics

| Metric               | Count |
| -------------------- | ----- |
| Commits              | 593   |
| Pull Requests Merged | 135+  |
| Linear Issues Closed | 100+  |
| Tests (current)      | 7760+ |

---

## Major Features

### Intex Chat MVP (INT-431)

A new RAG-powered documentation assistant integrated into the web application.

**Features:**

- ChatFAB: Floating action button toggle for quick access
- ChatPanel: Desktop conversation panel (fixed bottom-right)
- ChatBottomSheet: Mobile bottom sheet (60vh → 100vh expandable)
- Command Creation: LLM-driven action annotations with confirmation flow
- Session Persistence: localStorage-based chat history
- Embedding Pipeline: GitHub Action + script for vector search

**Technical Implementation:**

- New `apps/chat-agent` service with vector search over documentation
- OpenAI text-embedding-3-small for embeddings
- Firestore storage for doc chunks and embeddings
- Multi-turn chat with conversation history support
- Structured Actions: LLM can suggest commands for user confirmation

**PRs:** #713, #719, #726

---

### Linear Webhook Support and Sync (INT-444)

Real-time Linear integration with bidirectional sync.

**Features:**

- Webhook signature validation (HMAC-SHA256)
- Single issue sync for webhook events
- Full sync and bulk sync for all users
- Manual sync button in UI
- Firestore repository for synced issues

**PRs:** #733

---

### Pre-Dev Environment with Scale-to-Zero (INT-423)

A cost-effective development environment using Google Cloud Functions and Spot VMs.

**Features:**

- New `workers/predev-lifecycle` Cloud Functions worker
- GitHub webhook triggers VM start on push to development
- HTTP gateway with "starting" page while VM boots
- Idle check stops VM after 30min inactivity
- VM reports IP on startup for routing
- DevBar integration for environment detection

**PRs:** #698

---

### Orchestrator HTTP-Only Communication (INT-472)

Migration from Firebase/Firestore to HTTP-only communication with HMAC-SHA256 authentication.

**Features:**

- HMAC-SHA256 signature validation for all orchestrator communication
- 15-minute timestamp validation window for replay protection
- Timing-safe signature comparison
- Log forwarding via HTTP POST
- Heartbeat management with 10-minute intervals
- Consecutive failure tracking with escalation

**PRs:** #722, #723, #725

---

### Enhanced Worker Health Checks (INT-450)

Intelligent health monitoring for code-agent workers.

**Features:**

- Real health probes distinguishing tunnel vs orchestrator failures
- 4-state health model: healthy, orchestrator-unreachable, tunnel-down, unknown
- Cached health status with 60-second TTL
- Fire-and-forget async refresh
- Manual refresh button in UI
- Task dispatcher filters unhealthy workers

**PRs:** #721

---

### Per-User Worker Configuration (INT-429)

Multi-tenant worker support with user isolation.

**Features:**

- New `code_worker_settings` Firestore collection
- AES-256-GCM encrypted worker credentials at rest
- Per-request credential passing for user isolation
- API routes: GET/PATCH/DELETE /code/worker-settings/:workerType
- Test connectivity endpoint

**PRs:** #705

---

### Controlled Linear Issue Selection (INT-452)

Enhanced Linear integration for code tasks.

**Features:**

- Three modes: None, Link Existing, Create New
- Backend validation for existing issues
- LLM-powered title generation with Product Owner persona
- Issue type classification (feature/bug/refactor/research)
- LinearIssueCombobox component with search

**PRs:** #720, #724

---

### Dark Mode Support

Comprehensive dark theme across the entire web application.

**Features:**

- Theme toggle with system preference detection
- localStorage persistence
- 50+ pages and components updated
- Consistent color patterns using Tailwind `dark:` variants
- Markdown editor theme switching

**PRs:** #706, #707

---

### 100% Branch Coverage Enforcement (INT-427)

Strict code coverage requirements with v8 ignore validation.

**Features:**

- 100% branch coverage requirement in CI
- 10 valid v8 ignore categories
- Strict format validation: `/* v8 ignore <CATEGORY> -- reason */`
- Legacy format conversion (69 comments converted)
- CI fails on any unaccounted branch

**PRs:** #699, #700, #701, #702, #703, #704, #708

---

### Claude Hooks Test Framework (INT-460)

Comprehensive testing for 22 Claude Code hooks.

**Features:**

- Vitest + Node.js test infrastructure
- 96 tests covering validation, detection, logging, automatic, and ownership hooks
- Custom assertions: expectBlocked, expectAllowed, expectWarned
- Structured TSV logging library

**PRs:** #714

---

### E2E Testing Infrastructure (INT-382)

Production-quality E2E testing with mock Claude server.

**Features:**

- Mock Claude server with scenario-based responses
- 19 E2E tests covering full task lifecycle
- GitHub workflow with Firebase emulators
- HMAC signature validation for webhooks

**PRs:** #680

---

### Cloud Monitoring Metrics and Alerts (INT-381)

Operational visibility for code tasks.

**Metrics:**

- `code_tasks_submitted` - Tasks by worker type and source
- `code_tasks_completed` - Tasks by status
- `code_tasks_duration_seconds` - Task duration
- `code_tasks_active` - Active tasks gauge
- `code_tasks_cost_dollars` - Cost tracking

**Alerts:**

- High failure rate (>20% over 5 minutes)
- High daily cost (>$50)
- Capacity exhausted

**PRs:** #676

---

## UI/UX Improvements

### Web Application

- Markdown editor for code task form using `@uiw/react-md-editor` (INT-451) - PR #710
- Version info modal with build version and GitHub link - PR #683
- Auto-redirect to Auth0 Universal Login - PR #683
- Standardized date formatting with 9 utility functions - PR #681
- Share history layout improvements - PR #694
- Mobile layout fixes for research detail page (INT-406) - PR #678
- Notion export improvements with markdown-to-Notion block conversion - PR #686
- Notion page validation for research export - PR #684
- Manual Notion export trigger for completed research (INT-359) - PR #677
- Submit button loading state fix (INT-458) - PR #712
- RefreshIndicator layout shift fix - Direct commit

### Mobile

- Mobile bottom sheet for chat (60vh → 100vh expandable) - PR #726
- Mobile UI improvements across components (INT-309) - PR #622

---

## Bug Fixes

### Critical

- Fix validation error responses to return 400 instead of 500 - PR #735
- Fix duplicate /code prefix in code-agent API URLs - Direct commit
- Fix LinearIssueTitle not saved in fallback mode (INT-472) - PR #725
- Fix LinearIssueService to use per-request userId (INT-457) - PR #711
- Fix LinearIssueCombobox crash when filtering issues - Direct commit
- Fix empty error objects in log output (INT-464) - PR #717
- Fix silent hook failures when jq parsing fails - Direct commit

### Linear Integration

- Fix Linear integration for multi-user support (INT-443, INT-457) - PR #711
- Fix Linear internal issues API for code-agent integration - PR #711

### Polish Localization

- Fix Polish date parsing in calendar action extraction (INT-422) - PR #689
- Add Polish month names to extraction prompt

### Infrastructure

- Fix worker settings link route - Direct commit
- Fix gateway Starting page to use JS polling for redirect - Direct commit
- Fix binary content handling in predev gateway - Direct commit
- Fix predev-lifecycle build to generate dist/package.json - Direct commit
- Fix Cloud Functions deployment with esbuild bundling - Direct commit
- Fix silent hook failures - Direct commit
- Fix CI test timeouts and PWA build cache limit - Direct commit
- Fix flaky logging test with unique temp directories - Direct commit
- Fix Firestore rules syntax error in migration 040 - Direct commit

### Security

- Add authentication to admin endpoints (INT-424) - PR #695
- Sanitize taskId in tmux-manager (defense-in-depth) - PR #695
- Clear timeout in catch block to prevent resource leak - PR #695

---

## Developer Experience

### Environment Variables

- Mandatory env var registration enforcement across 18 services (INT-408-412) - PR #679
- `scripts/verify-env-vars.mjs` validates all three locations
- CI fails immediately on undeclared env vars

### Validation Hooks

- Early failure detection hooks catching ~90% of failures in <5 seconds - PR #709
- `rebuild-on-package-edit.sh` - Rebuilds package on edit
- `typecheck-after-edit.sh` - Runs tsc after edit
- `validate-commit-typecheck.sh` - Blocks commit with TS errors
- `detect-common-patterns.sh` - Warns about common mistakes
- `validate-vitest-flags.sh` - Blocks redundant vitest flags (INT-405) - PR #673
- `validate-gcloud-builds.sh` - Requires --region flag (INT-404) - PR #672

### Coverage Improvements

- v8-ignore script fix for wrong line numbers (INT-426) - PR #699
- Coverage exemptions across 15+ services - PRs #700, #701, #702
- handleApprovalReply coverage improved to 98.23% - PR #697
- Orchestrator coverage improvements (INT-419, INT-420) - PR #693
- Routes.ts coverage improved to 100% (INT-420) - PR #690
- Git stderr handling tests for worktree-manager (INT-418, INT-421) - PRs #691, #696
- Nonce cache cleanup extracted to testable function (INT-417) - PR #688

### Documentation

- Worker support in Claude extensions (INT-403) - PR #669
- INT-156 code action type verification plan - PR #685
- CLAUDE.md token reduction by 9.5% - Direct commits
- Linear MCP query safety documentation - Direct commit

---

## Infrastructure Changes

### Terraform

- Add pubsub.viewer role for predev VM - Direct commit
- Add chat_agent service account to IAM module - Direct commit
- Rename DISPATCH_SIGNING_SECRET to ORCHESTRATOR_SECRET (INT-473) - PR #718
- Add INTEXURAOS_CODE_AGENT_URL to orchestrator
- Configure 6-hour Pub/Sub retry window for transient errors (INT-198) - PR #675
- Add Cloud Monitoring metric descriptors and alert policies - PR #676

### Cloud Run/Functions

- Gateway concurrency set to 200 requests per instance - Direct commit
- Add cache-control headers to predev gateway - Direct commit
- Chat-agent added to cloudbuild.yaml - Direct commit
- Image-service and web-agent added to cloudbuild.yaml - Direct commit

### Pub/Sub

- Add Pub/Sub hot code reload for predev VM - Direct commit
- Pub/Sub retry logic for transient Crawl4AI errors (INT-198) - PR #675

---

## API Changes

### New Endpoints

| Service        | Method | Path                                   | Description                  |
| -------------- | ------ | -------------------------------------- | ---------------------------- |
| chat-agent     | POST   | /chat                                  | RAG-powered chat endpoint    |
| code-agent     | POST   | /code/workers/refresh-status           | Manual health refresh        |
| code-agent     | POST   | /internal/code/cancel-with-nonce       | Nonce-validated cancellation |
| code-agent     | GET    | /code/worker-settings/:workerType      | Get worker config            |
| code-agent     | PATCH  | /code/worker-settings/:workerType      | Update worker config         |
| code-agent     | DELETE | /code/worker-settings/:workerType      | Delete worker config         |
| code-agent     | POST   | /code/worker-settings/:workerType/test | Test connectivity            |
| linear-agent   | POST   | /webhooks/linear                       | Linear webhook receiver      |
| linear-agent   | POST   | /internal/issues/sync                  | Internal sync endpoint       |
| linear-agent   | POST   | /internal/issues/validate              | Issue validation             |
| linear-agent   | POST   | /internal/issues/generate-title        | LLM title generation         |
| research-agent | POST   | /research/:id/export-notion            | Manual Notion export         |
| notion-service | GET    | /notion/pages/:pageId/preview          | Page preview for validation  |

### Modified Endpoints

| Service         | Method | Path                                 | Change                                   |
| --------------- | ------ | ------------------------------------ | ---------------------------------------- |
| code-agent      | GET    | /code/workers/status                 | Returns cached health with async refresh |
| code-agent      | GET    | /code/tasks/:taskId                  | Added result/error schema properties     |
| code-agent      | POST   | /code/submit                         | Added workerLocation parameter           |
| bookmarks-agent | POST   | /internal/bookmarks/pubsub/summarize | Returns 503 for transient errors         |

---

## Dependencies

### Added

- `@uiw/react-md-editor` - Markdown editor for code task form
- `@uiw/react-markdown-preview` - Markdown preview component

### Removed

- `firebase-admin` from orchestrator (migrated to HTTP-only)

---

## Breaking Changes

None identified for this release.

---

## Migration Notes

1. **Orchestrator Secret Rename:** `INTEXURAOS_DISPATCH_SIGNING_SECRET` is now `INTEXURAOS_ORCHESTRATOR_SECRET`
2. **Multi-user Linear:** `INTEXURAOS_DEFAULT_USER_ID` removed from code-agent, userId now passed per-request

---

## Full Commit Log

593 commits between v2.1.0 and HEAD. Key commit messages:

```
9f35591a Revert codeAgentUrl change - restore /api/code prefix
dd96b74f Fix duplicate /code prefix in code-agent API URLs
00418f69 Fix worker settings link route
b55abecb Add pubsub.viewer role for predev VM
0d8d67e2 Show worker section in all states on CodeTaskNewPage
535fb176 Show worker indicator when no workers configured
d1f79468 Add v8 ignore for worker validation branches
358a8d13 Fix RefreshIndicator layout shift
ca6ab9ba feat(code-agent): add 400 response schema for worker validation errors
71e52b5b feat(code-agent): prioritize specified workerLocation in dispatch
474ea6d1 feat(code-agent): validate workerLocation exists and is healthy
70e7f20b feat(code-agent): add workerLocation to /code/submit schema
559b6e93 feat(web): add confirmation modal flow to CodeTaskNewPage
84f3a1b5 feat(web): add worker selection UI to CodeTaskNewPage
75cd3688 feat(web): add worker selection state to CodeTaskNewPage
12d1cca3 feat(web): add ConfirmSubmitModal component
81ed4fbc test(web): verify workerLocation passes through submitCodeTask
4c6d5359 feat(web): add workerLocation to SubmitCodeTaskRequest type
28edd304 Fix validation error responses to return 400 instead of 500 (#735)
0f37ed41 Refactor chat-agent to use per-request LLM client DI
43606b9d Revert unnecessary project-level plugin enablement
a04168ae Update code formatting and add predev mode flag
378792e2 Enable make-english-great-again plugin
7131734e Fix log-cleanup missing env vars
38772320 Add Pub/Sub hot code reload for predev VM
0ecb6a6a Fix LinearIssueCombobox crash when filtering issues
8e913384 Add multi-tenant webhook support to linear-agent
16e74f22 Fix gateway Starting page to use JS polling for redirect
9f61bf23 Added favicon.ico
3241f324 Update logo
528b2490 Add 1 vCPU to gateway for high concurrency support
a7290429 Set gateway concurrency to 200 requests per instance
b7718552 Revert gateway max instances to 1
c3fa0643 Increase predev gateway max instances to 10
7811b43e Add cache-control headers to predev gateway
bc89577c Reduce CLAUDE.md token usage by 9.5%
014380a0 [INT-444] Add Linear webhook support and sync functionality (#733)
8c2d29d2 Reduce CLAUDE.md token usage by 9.5%
21a78188 [INT-431] Implement Intex Chat MVP with command creation flow (#726)
1143fb96 Convert detect-common-patterns hook to soft block
1c3cc945 Add predev branch lock feature
66d8b49c Simplify changelog to Claude Code style
256bd2b6 Add Linear MCP query safety documentation
5576b0f8 Fix binary content handling in predev gateway
26a685ab Fix mobile UI and predev API routing
7b05fde1 Fix predev-lifecycle build to generate dist/package.json
... (and 540+ more commits)
```

---

## Pull Requests Merged (Since v2.1.0)

| PR   | Title                                                                         |
| ---- | ----------------------------------------------------------------------------- |
| #735 | Fix validation error responses to return 400 instead of 500                   |
| #733 | [INT-444] Add Linear webhook support and sync functionality                   |
| #726 | [INT-431] Implement Intex Chat MVP with command creation flow                 |
| #725 | [INT-472] Fix linearIssueTitle not saved in fallback mode                     |
| #724 | [INT-452] Complete Tiers 2 and 3: code-agent integration and frontend UI      |
| #723 | [INT-472] Fix error handling gaps from code review                            |
| #722 | [INT-472] Implement orchestrator HTTP-only communication                      |
| #721 | [INT-450] Implement enhanced worker health checks                             |
| #720 | [INT-452] Add controlled Linear issue selection to code-agent UI              |
| #719 | [INT-431] Implement Intex Chat MVP                                            |
| #718 | [INT-473] Rename DISPATCH_SIGNING_SECRET to ORCHESTRATOR_SECRET               |
| #717 | INT-464 Fix empty error objects in log output                                 |
| #714 | [INT-460] Implement Claude Hooks Test Framework                               |
| #713 | [INT-431,432,433,435,436,437,438,454] Implement Intex Chat MVP                |
| #712 | [INT-458] Fix submit button loading state UX regression                       |
| #711 | INT-443 INT-457 Fix Linear integration for multi-user support                 |
| #710 | [INT-451] Add markdown editor to code task form                               |
| #709 | Add early failure detection hooks                                             |
| #708 | [INT-427] 100% branch coverage enforcement                                    |
| #707 | Dark theme                                                                    |
| #706 | Add dark mode support to web application                                      |
| #705 | [INT-429] Implement per-user worker configuration                             |
| #704 | [INT-427] Enable strict 100% coverage enforcement (Phase 3)                   |
| #703 | INT-426 Fix duplicate v8 ignore comment                                       |
| #702 | INT-426 Add v8 ignore coverage exemptions                                     |
| #701 | INT-426: Cover code-agent and orchestrator branches                           |
| #700 | INT-426 Add v8 ignore exemptions for remaining services                       |
| #699 | INT-426 Phase 2: Fix v8-ignore script and begin coverage work                 |
| #698 | INT-423: Pre-Dev Environment with Scale-to-Zero Cloud Worker                  |
| #697 | Improve handleApprovalReply branch coverage to 98.23%                         |
| #696 | [INT-421] Add git stderr handling tests for worktree-manager                  |
| #695 | [INT-424] Fix code review issues from PR #616                                 |
| #694 | INT-407 Improve share history layout consistency                              |
| #693 | [INT-420][INT-419] Orchestrator coverage improvements                         |
| #692 | INT-416 Add env var fallback test for heartbeat                               |
| #691 | [INT-418] Add git stderr handling tests for worktree-manager                  |
| #690 | [INT-420] Add coverage for routes.ts optional fields and null expiry          |
| #689 | [INT-422] Fix Polish date parsing in calendar action extraction               |
| #688 | [INT-417] Extract nonce cache cleanup to testable function                    |
| #686 | Fix Notion export and declutter research detail UI                            |
| #685 | Add INT-156 code action type verification plan                                |
| #684 | Add Notion page validation for Research Export                                |
| #683 | Add version info modal and auto-redirect login                                |
| #682 | Allow type change for failed actions                                          |
| #681 | Standardize date formatting across apps/web                                   |
| #680 | [E2E] Add E2E testing infrastructure with mock Claude                         |
| #679 | [INT-408] Enforce mandatory env var registration for all services             |
| #678 | [INT-406] Fix mobile layout in research detail page                           |
| #677 | Add manual Notion export trigger for existing research                        |
| #676 | feat: Implement Cloud Monitoring metrics and alerts (INT-381)                 |
| #675 | [INT-198] Add Pub/Sub retry logic for transient Crawl4AI errors               |
| #674 | [INT-356] Handle cover image embedding in Notion export                       |
| #673 | [INT-405] Add vitest flags validation hook                                    |
| #672 | [INT-404] Add gcloud builds region hook + clean CLAUDE.md                     |
| #671 | INT-379 Add WhatsApp cancel nonce for running tasks                           |
| #670 | [INT-378] Fix WhatsApp button_reply payload structure                         |
| #669 | [INT-403] Add worker support to Claude extensions                             |
| #668 | [INT-389] Fix share history UX and sync recovery                              |
| #667 | INT-316 Fix View resource link persistence                                    |
| #666 | [INT-392] Fix release skill to bump all package versions                      |
| #665 | [INT-378] Add WhatsApp Approval Interactive Buttons with Nonces               |
| #664 | INT-371 INT-372 INT-373 Implement zombie detection, orchestrator heartbeat    |
| #663 | [INT-398] Coverage improvements for research-agent service                    |
| #662 | [INT-390] Strip markdown from notes preview                                   |
| #661 | [INT-391] Place unprioritized items between medium and low                    |
| #660 | INT-369 INT-370 Add Cloud Functions for VM lifecycle and log cleanup          |
| #659 | [INT-399] Add coverage tests for research-agent final gaps                    |
| #658 | INT-374-377 Add code task management UI                                       |
| #657 | [INT-401] Add coverage for processTodoCreated update failure branches         |
| #656 | INT-367 Fix PR review issues for rate limiting                                |
| #655 | INT-367 User rate limiting infrastructure (user_usage collection)             |
| #653 | INT-365 Add Linear issue creation integration to code-agent                   |
| #652 | [INT-366] Implement status mirroring from code tasks to actions               |
| #651 | [INT-402] Add tests for cancelled/processing status branch coverage           |
| #650 | [INT-397] Add tests for researchExportRoutes coverage                         |
| #649 | [INT-396, INT-400] Coverage improvements for internal-clients and todos-agent |
| #648 | [INT-395] Add tests for linearActionExtractionService                         |
| #647 | INT-317 Add verification routes and connect integration                       |
| #646 | [INT-311] Add test logger infrastructure and logging coverage                 |
| #645 | INT-323, INT-317, INT-394: Orchestrator coverage, phone verification          |
| #644 | INT-362 Add Auth0 JWT validation for code-agent public routes                 |
| #643 | [INT-311] Add delete and retry endpoints for failed Linear issues             |
| #642 | [INT-268] URL-encode userId in user-service client                            |
| #641 | INT-368 Add distributed tracing with X-Trace-Id header                        |
| #640 | Add test requirements quality gate and PR continuity pattern to Linear skill  |
| #639 | [INT-363][INT-364] Firestore indexes and security rules for code_tasks        |
| #632 | [INT-341] Research export settings, Notion token storage, UI configuration    |
| #631 | Fix internal-clients exports for Docker builds                                |
| #630 | INT-319 Complete PromptVault cleanup - remove all vault references            |
| #629 | [INT-312] Fix calendar date filters not filtering events correctly            |
| #628 | [INT-339] Use MarkdownContent for AI summary display                          |
| #627 | [INT-314] Sort todo checklist items by status and priority                    |
| #626 | [INT-340] Add 'code' type to classification schema                            |
| #625 | [INT-332] Code-agent coverage improvements                                    |
| #624 | [INT-319] Remove PromptVault feature, keep Notion connector                   |
| #623 | [INT-285] Add tests for branch coverage gaps in packages                      |
| #622 | INT-309 Mobile UI/UX improvements                                             |
| #621 | INT-301: Consolidate User Service Client Architecture                         |
| #620 | [INT-299] Fix CI output file collisions and enforce reuse                     |
| #619 | [INT-298] Linear skill: Add mandatory pnpm build after branch checkout        |
| #617 | [INT-297] Update release skill with version history pattern                   |
| #615 | [INT-308] Add Cloudflare secrets and orchestrator URLs                        |
| #614 | Add parent issue execution workflow to Linear skill                           |
| #613 | [INT-300] Move What's New section to bottom of README                         |
| #612 | [INT-296] Add concise README example to release skill                         |
| #608 | INT-271 Orchestrator Implementation                                           |
| #603 | [INT-246] code-agent MVP - Core Features Complete (13/16 issues)              |
| #601 | Development                                                                   |
| #600 | [INT-245] actions-agent: add code action type support                         |
| #574 | [INT-204] Design document for Amazfit Balance 2 IntexuraOS sync               |

---

## Linear Issues Closed

Key issues addressed in this release:

- INT-431: Implement Intex Chat MVP
- INT-444: Add Linear webhook support and sync functionality
- INT-423: Pre-Dev Environment with Scale-to-Zero Cloud Worker
- INT-472: Implement orchestrator HTTP-only communication
- INT-450: Implement enhanced worker health checks
- INT-429: Implement per-user worker configuration
- INT-452: Controlled Linear issue selection for code-agent UI
- INT-427: 100% branch coverage enforcement
- INT-460: Implement Claude Hooks Test Framework
- INT-382: E2E testing infrastructure
- INT-381: Cloud Monitoring metrics and alerts
- INT-451: Add markdown editor to code task form
- INT-464: Fix empty error objects in log output
- INT-473: Rename DISPATCH_SIGNING_SECRET to ORCHESTRATOR_SECRET
- INT-457: Fix LinearIssueService for multi-user
- INT-443: Add internal issues API to linear-agent
- INT-458: Fix submit button loading state
- INT-408-412: Env var registration enforcement
- INT-405: Add vitest flags validation hook
- INT-404: Add gcloud builds region hook
- INT-379: WhatsApp cancel nonce for running tasks
- INT-378: Fix WhatsApp button_reply payload
- INT-403: Add worker support to Claude extensions
- INT-389: Fix share history UX
- INT-422: Fix Polish date parsing
- INT-417-421: Various coverage improvements
- INT-406: Fix mobile layout
- INT-359: Manual Notion export
- INT-356: Cover image in Notion export
- INT-198: Pub/Sub retry for transient errors

---

_Document generated for release preparation on 2026-02-03_
