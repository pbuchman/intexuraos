# 027-app-settings-pricing — Instructions

## Goal

Stworzenie `app-settings-service` jako jedynego źródła prawdy dla LLM pricing.
Każdy klient infra-\* przyjmuje pricing jako wymagany parametr config.
Nowa kolekcja Firestore `settings/llm_pricing/{provider}`.

**Żaden stary kod nie jest usuwany** — cleanup w oddzielnym zadaniu.

## Success Criteria

1. `app-settings-service` działa z endpointem `GET /internal/settings/pricing/:provider`
2. Migracja 012 tworzy nową strukturę `settings/llm_pricing/*`
3. Każdy infra-\* ma `createXxxClientV2()` przyjmujący `pricing: ModelPricing`
4. `llm-usage-logger` pakiet utworzony (kopia z llm-pricing)
5. `research-agent` używa nowych klientów V2 z PricingClient cache
6. `npm run ci` passes
7. 95% test coverage maintained

## Constraints

- NO deletion of existing code (V1 clients, llm-pricing package)
- Internal auth only for pricing endpoint
- Provider cost priority for Perplexity
- Image pricing per size (1024x1024, 1536x1024, 1024x1536)

## Numbering

- Tier 0: Setup/infrastructure (0-0, 0-1)
- Tier 1: Independent deliverables (1-0 through 1-6)
- Tier 2: Integration (2-0)

## Resume Procedure

1. Read CONTINUITY.md
2. Check "Now" status
3. Continue from that task
4. Update ledger after each step
