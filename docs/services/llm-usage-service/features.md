# LLM Usage Service

Track every LLM API call across IntexuraOS — know what you spend, where tokens go, and which models deliver.

## The Problem

Running AI-powered agents across multiple providers (Anthropic, OpenAI, Google, Perplexity, OpenRouter) generates hundreds of API calls daily. Without centralized tracking, costs are invisible, token usage is unauditable, and there is no way to compare model efficiency or detect runaway spending. Each provider reports costs differently — some report USD directly, others only report token counts — making consolidated billing impossible without a unified calculation layer.

## How It Helps

### Unified Event Ingestion

Collect usage data from every LLM call through two ingestion channels — internal service calls and orchestrator webhooks with HMAC signature validation.

**Example:** The orchestrator completes a code task using Claude 4.6, then fires a webhook with token counts and correlation IDs. The service calculates the cost using cached pricing data and stores the event with full traceability back to the originating task.

### Centralized Cost Calculation

Normalize costs across five providers using a consolidated pricing engine. When a provider reports cost directly, that value is used. When cost is pending, the service calculates it from token counts and cached per-model pricing — handling cache read/write multipliers, web search fees, grounding costs, and image generation charges.

**Example:** An Anthropic call uses prompt caching (5,000 cache-read tokens at 0.1x input price, 200 cache-write tokens at 1.25x). The cost calculator applies the correct multipliers and produces a single `billedUsd` figure, regardless of whether the provider reported a cost.

### Flexible Aggregation and Querying

Query usage data grouped by day, owner, service, provider, model, operation, prompt type, or any combination. Pre-computed daily aggregates enable fast dashboard queries without scanning raw events.

**Example:** A dashboard query groups usage by `request.provider` and `day` for the last 30 days, sorted by `costUsd` descending. The response returns rows with totals for calls, tokens, and cost — ready to render as a chart.

### Prompt Type Tracking

Tag each LLM call with a prompt type identifier to understand which prompt categories drive the most usage and cost.

**Example:** Research agent calls are tagged with `promptType: "research-synthesis"`, allowing filtering and grouping to see how much research prompts cost compared to code generation prompts.

### Research Cost Summaries

Summarize the LLM cost of a single research run by `correlation.researchId`, with optional owner and time-range guards. The response includes per-event rows, aggregate totals, and missing-attribution diagnostics when both owner and time range are supplied.

**Example:** Research agent requests `POST /internal/usage/research-cost-summary` after synthesis so it can report total research cost, model mix, prompt types, token counts, image counts, and missing-attribution diagnostics for that research.

### Image and OpenRouter Model Visibility

Usage events preserve image generation metadata through `usage.imageCount` and optional `usage.imageSize`, and the pricing engine applies configured per-size image prices for Google and OpenAI image-capable models. OpenRouter calls, including MiMo Pro 2.5 model strings such as `xiaomi/mimo-v2.5-pro`, are stored and aggregated through the same provider/model/client dimensions as other LLM calls.

## Use Case

A developer opens the LLM Usage dashboard to understand last week's spending. They query aggregated usage grouped by provider and model, filtered to user-owned events. The response shows that Claude 4.6 accounts for 60% of cost but only 30% of calls, while GPT-5.4 handles high-volume low-cost tasks. They drill into individual events for the most expensive model, seeing full correlation data (task IDs, research IDs, session IDs) that links each call back to a specific code task or research run.

## Key Benefits

- Single source of truth for LLM costs across all five providers
- Automatic cost calculation when providers only report token counts
- Pre-computed daily aggregates for fast dashboard queries
- Prompt-type, image-count, and model-level breakdowns in usage dashboards
- Full correlation chain from LLM call back to originating task
- Research-run cost summaries by `researchId`
- Cursor-based pagination for browsing large event sets
- Duplicate detection prevents double-counting on event replay

## Limitations

- Aggregate queries fetch all daily aggregates for the time range and filter in-memory — very large date ranges may be slow
- Firestore's 30-disjunction limit means only the first array filter in event list queries goes to Firestore; additional array filters are applied in-memory, which can produce pages shorter than the requested limit
- Pricing data must be seeded via the internal pricing endpoint before cost calculation works for a given provider/model

---

_Part of [IntexuraOS](../overview.md) — Know what your AI costs._
