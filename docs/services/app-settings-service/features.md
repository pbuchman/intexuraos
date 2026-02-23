# App Settings Service

Centralized LLM pricing configuration and per-user usage cost analytics for the entire IntexuraOS platform.

## The Problem

IntexuraOS orchestrates 16 LLM models across 5 providers (Google, OpenAI, Anthropic, Perplexity, Zai). Every service that calls an LLM needs accurate, up-to-date pricing to calculate costs. Without a single source of truth, pricing data would be scattered across services, drift out of sync, and leave users unable to understand what they are spending.

## How It Helps

### Single Source of Truth for LLM Pricing

All 16 model prices live in one place. Every service fetches pricing from app-settings-service at startup, guaranteeing consistent cost calculations across the platform.

**Example:** research-agent starts up, calls `/internal/settings/pricing`, and loads per-token costs for all models into its PricingContext. Every subsequent research query is costed accurately.

### Startup Integrity Validation

The service refuses to start if any model in the platform lacks pricing data. This fail-fast behavior prevents services from running with stale or missing pricing.

**Example:** A new model is added to `@intexuraos/llm-contract` but the Firestore migration has not run yet. app-settings-service logs the missing model and exits, blocking any downstream service from booting with incomplete pricing.

### Personal Usage Analytics

Authenticated users see their own LLM spending broken down by month, model, and call type with configurable time windows.

**Example:** A user opens the settings page and sees that 65% of their spend last month went to Gemini 2.5 Pro research queries. They switch some workflows to Gemini 2.5 Flash and cut costs by 40%.

## Use Case

A developer adds a new LLM model to the platform. They run the Firestore pricing migration to populate the new model's per-token rates. When app-settings-service restarts, it validates that all 16 models have pricing, boots successfully, and begins serving the updated pricing to every downstream service. Users immediately see the new model's costs reflected in their usage dashboards.

## Key Benefits

- Consistent pricing across all 20 microservices through a single internal API
- Fail-fast startup validation prevents services from running with missing pricing
- Per-user cost visibility with monthly, by-model, and by-call-type breakdowns
- Parallel provider fetching keeps response times low despite 5 providers
- Both internal (service-to-service) and public (user-facing) endpoints from one service

## Limitations

- **Read-only** -- Pricing is configured via Firestore migrations, not through an admin API
- **90-day default window** -- Usage costs default to 90 days of history, maximum 365
- **No cost forecasting** -- Reports historical usage only, no predictive spending
- **No budget alerts** -- No spending limits or threshold notifications
- **Monthly granularity** -- Usage aggregates by month, not by individual day

---

_Part of [IntexuraOS](../overview.md) -- Know what your AI costs before you ask._
