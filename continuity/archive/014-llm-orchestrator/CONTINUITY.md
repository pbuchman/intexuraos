# Continuity Ledger — LLM Orchestrator

## Goal

Build an LLM Orchestrator module for multi-LLM research with synthesis.

**Success Criteria:**

- All infra packages created (infra-gemini, infra-claude, infra-gpt, infra-whatsapp)
- llm-orchestrator-service with REST API
- user-service extended with llmApiKeys
- Web frontend pages
- WhatsApp notification
- `npm run ci` passes
- `terraform validate` passes

## Constraints / Assumptions

- Tests use in-memory fakes (no external dependencies)
- Follow existing patterns in codebase
- Protected: `vitest.config.ts` coverage thresholds require permission
- user-service already has settings domain (extend, don't recreate)

## Key Decisions

### 2024-12-29 — Planning Session

1. **LLM Models:** gemini-2.0-flash-exp, gpt-4o, claude-sonnet-4-20250514
2. **Async processing:** Fire-and-forget with polling via GET /research/:id
3. **Encryption:** AES-256-GCM in common-core for API keys
4. **Synthesis:** Gemini performs synthesis (requires Google API key)
5. **Notifications:** WhatsApp optional, uses NoOp sender if not configured

### 2024-12-29 — Initial Setup

1. **user-service vs auth-service:** user-service is correct (auth-service was renamed)
2. **API Keys Storage:** Extend existing UserSettings model with llmApiKeys field

## Reasoning Narrative

### 2024-12-29 — Task Generation Complete

Created detailed task files following `.github/prompts/continuity.prompt.md` format.

**Task Structure:**

- 9 Tiers (0-8) with 32 total subtasks
- Each task contains: Context, Problem Statement, Scope, Required Approach, Step Checklist, Definition of Done, Verification Commands, Rollback Plan

**Tier Breakdown:**
| Tier | Focus | Tasks |
|------|-------|-------|
| 0 | Setup (DONE) | 0-0 cleanup, 0-1 scaffold, 0-2 config |
| 1 | Infra Packages | 1-0 whatsapp, 1-1 gemini, 1-2 claude, 1-3 gpt |
| 2 | User Service | 2-0 encryption, 2-1 model, 2-2 routes |
| 3 | Domain | 3-0 models, 3-1 ports, 3-2 config, 3-3 usecases |
| 4 | Infrastructure | 4-0 firestore, 4-1 adapters, 4-2 notification |
| 5 | Routes/Server | 5-0 schemas, 5-1 routes, 5-2 server, 5-3 DI |
| 6 | Frontend | 6-0 to 6-6 (API clients, pages, navigation) |
| 7 | Deployment | 7-0 terraform, 7-1 cloudbuild, 7-2 api-docs |
| 8 | Verification | 8-0 route tests, 8-1 usecase tests, 8-2 coverage, 8-3 terraform |

## State

**COMPLETED** — All tasks done, `npm run ci` passes, `terraform validate` passes.

### Tier 0: Setup ✓

- 0-0: Cleanup empty placeholder directories ✓
- 0-1: Create llm-orchestrator-service scaffold ✓
- 0-2: Add to root tsconfig, ESLint config ✓

### Tier 1: Infra Packages ✓

- 1-0: Create infra-whatsapp package ✓
- 1-1: Create infra-gemini package ✓
- 1-2: Create infra-claude package ✓
- 1-3: Create infra-gpt package ✓

### Tier 2: User Service Extensions ✓

- 2-0: Add encryption utility to common-core ✓
- 2-1: Extend UserSettings model with llmApiKeys ✓
- 2-2: Add user-settings routes for API keys ✓

### Tier 3: Domain Layer ✓

- 3-0: Create domain models for Research ✓
- 3-1: Define domain ports ✓
- 3-2: Add synthesis config ✓
- 3-3: Create usecases ✓

### Tier 4: Infrastructure Adapters ✓

- 4-0: Create Firestore repository ✓
- 4-1: Create LLM adapters ✓
- 4-2: Create notification adapter ✓

### Tier 5: Routes & Server ✓

- 5-0: Create JSON schemas ✓
- 5-1: Create research routes ✓
- 5-2: Setup server ✓
- 5-3: Create DI container ✓

### Tier 6: Frontend ✓

- 6-0: Create API Keys service client (`llmKeysApi.ts`) ✓
- 6-1: Create API Keys page (`ApiKeysSettingsPage.tsx`) ✓
- 6-2: Create orchestrator types and API (`llmOrchestratorApi.ts`) ✓
- 6-3: Create New Research page (`LlmOrchestratorPage.tsx`) ✓
- 6-4: Create Research List page (`ResearchListPage.tsx`) ✓
- 6-5: Create Research Detail page (`ResearchDetailPage.tsx`) ✓
- 6-6: Update sidebar navigation (`Sidebar.tsx` with LLM Research section) ✓

### Tier 7: Deployment ✓

- 7-0: Terraform module (in `terraform/environments/dev/main.tf`) ✓
- 7-1: Dockerfile for llm-orchestrator-service ✓
- 7-2: API docs hub integration (`apps/api-docs-hub/src/config.ts`) ✓

### Tier 8: Verification ✓

- 8-0: Route tests (`routes.test.ts`) ✓
- 8-1: Usecase tests (`usecases.test.ts`) ✓
- 8-2: Coverage verification — `npm run ci` passes ✓
- 8-3: Terraform validation — `terraform validate` passes ✓

### 2024-12-29 — Final Session

Completed all remaining tasks:

- Created Dockerfile for llm-orchestrator-service
- Verified all frontend components already existed (Tier 6 was complete)
- Verified `npm run ci` passes
- Verified `terraform validate` passes
- Updated CONTINUITY.md with full history

## Resolved Questions

1. **LLM Models:** gemini-2.0-flash-exp, gpt-4o, claude-sonnet-4-20250514
2. **Service-to-service auth:** Direct Firestore access + internal auth token
3. **Encryption:** AES-256-GCM in common-core for API keys
4. **Synthesis:** Gemini performs synthesis
5. **Notifications:** WhatsApp optional with NoOp fallback

## Deliverables

### New Packages Created

- `packages/infra-whatsapp/` — WhatsApp Business API client
- `packages/infra-gemini/` — Google Gemini API client
- `packages/infra-claude/` — Anthropic Claude API client
- `packages/infra-gpt/` — OpenAI GPT API client

### New Service Created

- `apps/llm-orchestrator-service/` — Multi-LLM research orchestration service
  - Domain models: Research, LlmResponse, SynthesizedResult
  - Usecases: CreateResearch, GetResearch, ListResearches
  - Routes: POST /research, GET /research/:id, GET /research
  - Infrastructure: Firestore repository, LLM adapters, WhatsApp notification

### User Service Extensions

- `packages/common-core/src/encryption.ts` — AES-256-GCM encryption utility
- Extended UserSettings with llmApiKeys field
- New routes: GET/PUT /settings/llm-keys

### Frontend Pages

- `ApiKeysSettingsPage.tsx` — Manage LLM API keys
- `LlmOrchestratorPage.tsx` — Create new research
- `ResearchListPage.tsx` — List previous researches
- `ResearchDetailPage.tsx` — View research results
- Updated Sidebar with LLM Research navigation

### Deployment

- Terraform module for llm-orchestrator-service
- Dockerfile for container deployment
- API docs hub integration

## Verification (Final)

```bash
npm run ci                        # ✓ PASSES
terraform fmt -check -recursive   # ✓ PASSES
terraform validate                # ✓ PASSES
```

## Archive Status

**Ready for archive.** Move to `continuity/archive/014-llm-orchestrator/`
