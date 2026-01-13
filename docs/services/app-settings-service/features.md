# App Settings Service

Application-wide configuration and LLM usage analytics.

## The Problem

Users need visibility into:

1. **LLM pricing** - Current costs for all providers
2. **Usage tracking** - Personal API usage and costs
3. **Configuration** - Provider pricing details

## How It Helps

App-settings-service provides:

1. **Pricing endpoint** - All LLM provider pricing
2. **Usage costs** - Per-user aggregated usage statistics
3. **Provider coverage** - Google, OpenAI, Anthropic, Perplexity

## Key Features

**Pricing (`/settings/pricing`):**
- All 4 providers
- Per-model pricing
- Input/output token costs
- Grounding costs

**Usage Costs (`/settings/usage-costs`):**
- Daily aggregation
- Monthly breakdown
- By-model breakdown
- Configurable time range (1-365 days)

## Use Cases

### Get pricing

Frontend fetches pricing to display costs before API calls.

### Track usage

Users view their spending over time, broken down by model and month.

## Key Benefits

**Transparent pricing** - Users know costs before using LLMs

**Personal analytics** - Track individual usage patterns

**Multi-provider** - All LLM providers in one endpoint

## Limitations

**Read-only** - No pricing management (admin-configured)

**90-day default** - Usage defaults to 90 days, max 365

**No predictions** - No cost forecasting

**No budgets** - No spending limits or alerts
