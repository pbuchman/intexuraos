# 027-app-settings-pricing — Continuity Ledger

## Goal

Centralizacja LLM pricing w `app-settings-service`. Eliminacja hardcoded cen z klientów infra-*.

## Success Criteria

- [x] app-settings-service created (structure, Dockerfile, Terraform, CloudBuild)
- [x] Migration 011 created (new pricing structure)
- [x] 4x infra-* clientsV2 implemented
- [x] packages/llm-contract pricing types created
- [x] llm-orchestrator PricingClient created (HTTP client to app-settings-service)
- [x] npm run ci passes

## Constraints / Assumptions

- Stary kod pozostaje (V1 clients, llm-pricing)
- 14 modeli: 4 google, 4 openai, 3 anthropic, 3 perplexity
- Image pricing per size
- Perplexity: useProviderCost=true
- **Migrations are IMMUTABLE** - never modify existing, only create new

## Key Decisions

- [2026-01-05] Opcja A: pricing w config klienta (statyczny), cache na poziomie callera
- [2026-01-05] Nowa kolekcja `settings/llm_pricing/{provider}` zamiast rozszerzania `app_settings`
- [2026-01-05] V2 suffix dla nowych klientów, brak usuwania V1
- [2026-01-05] Added CLAUDE.md rule about migration immutability
- [2026-01-06] PricingClient with 5-minute TTL cache in llm-orchestrator

## State

- Done:
  - 0-0: app-settings-service structure created
  - 0-1: migration 011 created (firestore-collections.json updated)
  - 1-0: pricing types added to llm-contract
  - 1-1: endpoint pricing provider (already existed)
  - 1-3: infra-gemini V2 client + costCalculator
  - 1-4: infra-gpt V2 client + costCalculator
  - 1-5: infra-claude V2 client + costCalculator
  - 1-6: infra-perplexity V2 client + costCalculator
  - 2-0: PricingClient created in llm-orchestrator (partial - HTTP client ready)
- Now: CI passes ✅
- Next: Full integration of V2 clients with PricingClient in llm-orchestrator (future work)

## Notes

- V2 clients are created and exported, but llm-orchestrator still uses V1 clients
- Full integration requires updating LlmAdapterFactory to use V2 clients + PricingClient
- This is optional follow-up work - core infrastructure is complete

## Working Set

- apps/app-settings-service/ (new)
- migrations/011_new-pricing-structure.mjs (new)
- packages/llm-contract/src/pricing.ts (new)
- packages/infra-gemini/src/costCalculator.ts, clientV2.ts (new)
- packages/infra-gpt/src/costCalculator.ts, clientV2.ts (new)
- packages/infra-claude/src/costCalculator.ts, clientV2.ts (new)
- packages/infra-perplexity/src/costCalculator.ts, clientV2.ts (new)
- apps/llm-orchestrator/src/infra/pricing/PricingClient.ts (new)
