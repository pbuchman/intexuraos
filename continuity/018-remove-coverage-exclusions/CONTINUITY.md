# Remove Coverage Exclusions - Continuity Ledger

## Goal

Remove unjustified coverage exclusions from vitest.config.ts by writing tests for currently excluded code. User has granted explicit permission to modify vitest.config.ts.

**Success Criteria:**
- All listed exclusions investigated
- Tests written where feasible
- Exclusions removed from vitest.config.ts
- Coverage thresholds still passing (95%)

## Constraints / Assumptions

- Permission granted to modify vitest.config.ts (normally protected)
- Some exclusions may be legitimately untestable (pure SDK wrappers)
- Must maintain 95% coverage thresholds after changes

## Key Decisions

(To be filled during investigation)

## Reasoning Narrative

Starting investigation of 9 exclusion categories:
1. packages/infra-claude/**
2. packages/infra-gemini/**
3. packages/infra-gpt/**
4. packages/infra-whatsapp/**
5. packages/infra-llm-audit/**
6. apps/llm-orchestrator-service/src/infra/**
7. apps/llm-orchestrator-service/src/domain/research/config/**
8. apps/llm-orchestrator-service/src/domain/research/usecases/processResearch.ts
9. apps/llm-orchestrator-service/src/routes/**

## State

### Done
(none yet)

### Now
Investigating packages/infra-claude/** exclusion

### Next
- Investigate packages/infra-gemini/**
- Investigate packages/infra-gpt/**
- Continue through all exclusions

## Open Questions

1. Which exclusions are truly untestable vs just need mocking strategy?
2. Should SDK wrapper tests mock at fetch level or SDK level?

## Working Set

Files to investigate:
- packages/infra-claude/src/**
- packages/infra-gemini/src/**
- packages/infra-gpt/src/**
- packages/infra-whatsapp/src/**
- packages/infra-llm-audit/src/**
- apps/llm-orchestrator-service/src/infra/**
- apps/llm-orchestrator-service/src/domain/research/config/**
- apps/llm-orchestrator-service/src/domain/research/usecases/processResearch.ts
- apps/llm-orchestrator-service/src/routes/**
