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

**Done:**

- Continuity workflow initialization
- Repository state analysis
- INSTRUCTIONS.md created
- 0-0: Cleanup empty placeholder directories
- 0-1: Create llm-orchestrator-service scaffold
- 0-2: Add to root tsconfig, ESLint config
- **All task files created (Tier 1-8)**

**Now:**

- 1-0: Create infra-whatsapp package

**Next:**

- 1-1 through 1-3: Create remaining infra packages
- 2-0: Add encryption utility to common-core

## Open Questions

1. **LLM Models:** Confirmed:
   - Gemini: gemini-2.0-flash-exp
   - GPT: gpt-4o
   - Claude: claude-sonnet-4-20250514

2. **Service-to-service auth:** Using Option B (Direct Firestore access + internal auth token)

## Working Set

**Created Task Files:**

```
continuity/014-llm-orchestrator/
├── INSTRUCTIONS.md
├── CONTINUITY.md
├── 0-0-cleanup-empty-dirs.md (DONE)
├── 0-1-service-scaffold.md (DONE)
├── 0-2-eslint-tsconfig.md (DONE)
├── 1-0-infra-whatsapp.md
├── 1-1-infra-gemini.md
├── 1-2-infra-claude.md
├── 1-3-infra-gpt.md
├── 2-0-encryption-util.md
├── 2-1-user-settings-model.md
├── 2-2-user-settings-routes.md
├── 3-0-domain-models.md
├── 3-1-domain-ports.md
├── 3-2-synthesis-config.md
├── 3-3-usecases.md
├── 4-0-firestore-repo.md
├── 4-1-llm-adapters.md
├── 4-2-whatsapp-notification.md
├── 5-0-json-schemas.md
├── 5-1-research-routes.md
├── 5-2-server-setup.md
├── 5-3-di-container.md
├── 6-0-api-keys-service.md
├── 6-1-api-keys-page.md
├── 6-2-orchestrator-types-api.md
├── 6-3-new-research-page.md
├── 6-4-research-list-page.md
├── 6-5-research-detail-page.md
├── 6-6-sidebar-nav.md
├── 7-0-terraform-module.md
├── 7-1-cloudbuild-config.md
├── 7-2-api-docs-hub.md
├── 8-0-route-tests.md
├── 8-1-usecase-tests.md
├── 8-2-coverage-verification.md
└── 8-3-terraform-validation.md
```

**Verification Commands:**

```bash
npm run ci
npm run typecheck
terraform fmt -check -recursive
terraform validate
```
