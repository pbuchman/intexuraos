# LLM Orchestrator - Continuity Ledger

## Goal

Build LLM Orchestrator module with:
- Multi-LLM research with web browsing (Gemini, GPT, Claude)
- Synthesis via Gemini
- Async processing with WhatsApp notification
- New backend service + user-service extension + frontend

**Success Criteria:**
- `npm run ci` passes
- `terraform fmt -check -recursive` and `terraform validate` pass
- All routes tested with coverage thresholds met
- Service deployed and accessible

## Constraints / Assumptions

- Encryption infrastructure must be added (user-service has none)
- WhatsApp notification is optional (skip if not connected)
- LLM model IDs will be verified during implementation
- Service-to-service communication: likely direct Firestore access

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API Keys Storage | Extend user-service | Keep all user settings together |
| LLM Models | Real models | gemini-2.0-flash-exp, gpt-4o, claude-3-5-sonnet |
| WhatsApp Fallback | Skip silently | Don't block research if WhatsApp not connected |
| Encryption | AES-256-GCM in common-core | Reusable across services |

## Reasoning Narrative

### 2025-12-29 - Initial Planning

1. User requested LLM Orchestrator with detailed UX spec
2. Explored codebase to understand existing patterns (user-service, whatsapp-service)
3. Discovered user-service has no encryption - critical gap for API key storage
4. User confirmed: extend user-service, use real models, skip WhatsApp if not connected
5. Plan created with 9 tiers, 30+ subtasks following continuity workflow

## State

### Done
- [x] Plan created and approved
- [x] Continuity directory created
- [x] INSTRUCTIONS.md created
- [x] CONTINUITY.md created
- [x] All 34 subtask files created (0-0 to 8-4)

### Now
- [ ] Awaiting user approval for execution

### Next
- [ ] Execute Tier 0: Infrastructure Setup (0-0, 0-1, 0-2, 0-3)
- [ ] Execute Tier 1: Shared Packages (1-0, 1-1, 1-2, 1-3)
- [ ] Execute Tier 2-8: Remaining implementation

## Open Questions

None at this time - all major decisions made.

## Working Set

### Files to Create
- `apps/llm-orchestrator-service/` (new service)
- `packages/infra-whatsapp/` (new package)
- `packages/infra-gemini/` (new package)
- `packages/infra-claude/` (new package)
- `packages/infra-gpt/` (new package)
- `cloudbuild/scripts/deploy-llm-orchestrator-service.sh`

### Files to Modify
- `apps/user-service/src/domain/settings/models/UserSettings.ts`
- `apps/user-service/src/routes/settingsRoutes.ts`
- `apps/api-docs-hub/src/config.ts`
- `apps/web/src/components/Sidebar.tsx`
- `cloudbuild/cloudbuild.yaml`
- `terraform/environments/dev/main.tf`
- `eslint.config.js`
- `tsconfig.json`
