# Research Agent — Process Manual

## Goal

Build an Research Agent module allowing users to run research prompts across multiple LLMs (Gemini, GPT, Claude) with web browsing, then synthesize results via Gemini.

## Success Criteria

- New packages: infra-gemini, infra-claude, infra-gpt, infra-whatsapp
- New app: research-agent-service with REST API
- user-service extended with llmApiKeys in UserSettings
- Web frontend with New Research, Previous Researches pages
- API Keys settings page in web app
- WhatsApp notification on completion
- `npm run ci` passes
- `terraform validate` passes

## Current Repository State

**Existing:**

- `apps/user-service/src/domain/settings/` — UserSettings model WITHOUT llmApiKeys
- `packages/infra-firestore/` — Firestore utilities
- `packages/common-core/` — Result types, error handling

**To be created:**

- `packages/infra-whatsapp/`
- `packages/infra-gemini/`
- `packages/infra-claude/`
- `packages/infra-gpt/`
- `apps/research-agent-service/`

## Subtask Numbering

```
Tier 0: Setup & Infrastructure
  0-0-cleanup-empty-dirs.md      — Remove empty placeholder directories
  0-1-service-scaffold.md        — Create research-agent-service scaffold
  0-2-eslint-tsconfig.md         — Add to root tsconfig, ESLint config

Tier 1: Shared Packages (Independent)
  1-0-infra-whatsapp.md          — WhatsApp sender package
  1-1-infra-gemini.md            — Gemini API adapter with search grounding
  1-2-infra-claude.md            — Claude API adapter with web search
  1-3-infra-gpt.md               — OpenAI GPT adapter

Tier 2: User Service Extension
  2-0-encryption-util.md         — AES-256-GCM encryption in common-core
  2-1-user-settings-model.md     — Add llmApiKeys to UserSettings
  2-2-user-settings-routes.md    — GET/PATCH routes for API keys

Tier 3: Research Agent Domain
  3-0-domain-models.md           — Research, LlmResult models
  3-1-domain-ports.md            — Ports definition
  3-2-synthesis-config.md        — Synthesis prompt configuration
  3-3-usecases.md                — submitResearch, processResearch usecases

Tier 4: Research Agent Infrastructure
  4-0-firestore-repo.md          — Firestore research repository
  4-1-llm-adapters.md            — Wire LLM adapters
  4-2-whatsapp-notification.md   — WhatsApp notification sender

Tier 5: Research Agent Routes & Server
  5-0-json-schemas.md            — JSON schemas for routes
  5-1-research-routes.md         — POST/GET/DELETE /research endpoints
  5-2-server-setup.md            — Server with health, OpenAPI, Swagger
  5-3-di-container.md            — Services DI container

Tier 6: Frontend - Settings & ResearchAgent
  6-0-api-keys-service.md        — API functions for settings
  6-1-api-keys-page.md           — ApiKeysSettingsPage component
  6-2-researchAgent-types-api.md  — Research types + ResearchAgentApi
  6-3-new-research-page.md       — ResearchAgentPage
  6-4-research-list-page.md      — ResearchListPage
  6-5-research-detail-page.md    — ResearchDetailPage
  6-6-sidebar-nav.md             — Add nav sections

Tier 7: Deployment & Integration
  7-0-terraform-module.md        — Cloud Run, service account, secrets
  7-1-cloudbuild-config.md       — Deploy script + cloudbuild.yaml
  7-2-api-docs-hub.md            — Add to api-docs-hub config

Tier 8: Testing & Verification
  8-0-route-tests.md             — Route tests for research-agent-service
  8-1-usecase-tests.md           — Usecase tests
  8-2-coverage-verification.md   — npm run ci, verify thresholds
  8-3-terraform-validation.md    — terraform fmt && terraform validate
```

## Idempotent Execution

1. Read `CONTINUITY.md` to determine current state
2. Resume from `Now` task
3. After each subtask:
   - Run verification (typecheck, lint, test as applicable)
   - Update `Done` → `Now` → `Next`
   - Commit changes
4. Never overwrite ledger; append deltas

## Verification Commands

```bash
npm run ci                        # Full verification
npm run typecheck                 # TypeScript only
npm run lint                      # ESLint only
terraform fmt -check -recursive   # Terraform formatting
terraform validate                # Terraform syntax
```

## Resume Procedure

1. Read `CONTINUITY.md`
2. Check `Now` field for current task
3. Continue execution from that point
4. Commit after each completed subtask
