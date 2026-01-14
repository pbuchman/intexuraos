# App Settings Service

Application-wide configuration and LLM usage analytics.

## The Problem

Users need visibility into:

1. **LLM pricing** - Current costs for all providers
2. **Usage tracking** - Personal API usage and costs
3. **Configuration** - Provider pricing details

## How It Helps

App-settings-service provides:

1. **Pricing endpoint** - All LLM provider pricing (internal and public)
2. **Usage costs** - Per-user aggregated usage statistics
3. **Provider coverage** - Google, OpenAI, Anthropic, Perplexity, Zai

## Key Features

**Pricing (`/settings/pricing`):**

- All 5 providers (Google, OpenAI, Anthropic, Perplexity, Zai)
- Per-model pricing
- Input/output token costs
- Grounding costs (Google Gemini feature: adds fixed per-request cost when using Google Search or dynamic retrieval to enhance factual accuracy)
- Internal endpoint for service startup

**Usage Costs (`/settings/usage-costs`):**

- Daily aggregation
- Monthly breakdown
- By-model breakdown
- By-call-type breakdown
- Configurable time range (1-365 days, default 90)

## Use Cases

### Get pricing (internal)

Services fetch pricing on startup to populate PricingContext for cost tracking.

### Get pricing (public)

Frontend fetches pricing to display costs before API calls.

### Track usage

Users view their spending over time, broken down by model and month.

## Key Benefits

**Transparent pricing** - Users know costs before using LLMs

**Personal analytics** - Track individual usage patterns

**Multi-provider** - All LLM providers in one endpoint

**Internal/Public separation** - Services need auth, users get their own data

## Limitations

**Read-only** - No pricing management (admin-configured)

**90-day default** - Usage defaults to 90 days, max 365

**No predictions** - No cost forecasting

**No budgets** - No spending limits or alerts
