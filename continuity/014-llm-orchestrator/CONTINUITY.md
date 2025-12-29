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

### 2024-12-29 — Initial Setup

1. **user-service vs auth-service**: user-service is the correct target (auth-service was renamed to user-service)
2. **API Keys Storage**: Extend existing UserSettings model with llmApiKeys field
3. **Encryption**: Add AES-256-GCM utility to common-core for API key encryption

## Reasoning Narrative

### 2024-12-29 — Session Start

Initialized continuity workflow for LLM Orchestrator feature.

**Current Repository State:**

| Component                     | Status                    |
| ----------------------------- | ------------------------- |
| user-service/domain/settings  | EXISTS - needs llmApiKeys |
| packages/infra-whatsapp       | EMPTY directory           |
| packages/infra-gemini         | EMPTY directory           |
| packages/infra-claude         | EMPTY directory           |
| packages/infra-gpt            | EMPTY directory           |
| apps/llm-orchestrator-service | EMPTY directory           |

**UserSettings Model (current):**

```typescript
interface UserSettings {
  userId: string;
  notifications: NotificationSettings;
  createdAt: string;
  updatedAt: string;
  // llmApiKeys: MISSING - to be added
}
```

**Tier Breakdown:**

- Tier 0: Cleanup empty dirs, scaffold service, config updates
- Tier 1: Independent packages (can be parallel)
- Tier 2: User service extension (encryption + llmApiKeys)
- Tier 3-5: LLM Orchestrator domain, infra, routes
- Tier 6: Frontend
- Tier 7: Deployment
- Tier 8: Testing & verification

## State

**Done:**

- Continuity workflow initialization
- Repository state analysis
- INSTRUCTIONS.md created
- 0-0: Cleanup empty placeholder directories
- 0-1: Create llm-orchestrator-service scaffold

**Now:**

- 0-2: Add to root tsconfig, ESLint config

**Next:**

- 1-0 through 1-3: Create infra packages

## Open Questions

1. **LLM Models to use:**
   - Gemini: gemini-2.0-flash-exp or gemini-2.5-pro?
   - GPT: gpt-4o or o1-preview?
   - Claude: claude-3-5-sonnet or claude-opus-4?
     (Will verify during implementation)

2. **Service-to-service auth:** llm-orchestrator-service needs user's API keys
   - Option A: JWT forwarding
   - Option B: Direct Firestore access
     (Likely Option B for simplicity)

## Working Set

**Target Files (Phase 1):**

- `apps/user-service/src/domain/settings/models/UserSettings.ts`
- `packages/common-core/src/encryption.ts` (to be created)
- `apps/llm-orchestrator-service/` (to be scaffolded)
- `packages/infra-{gemini,claude,gpt,whatsapp}/` (to be created)

**Commands:**

```bash
npm run ci
npm run typecheck
terraform fmt -check -recursive
terraform validate
```
