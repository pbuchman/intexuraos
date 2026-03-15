# App Settings Service

The cost transparency layer for IntexuraOS — know exactly what every AI interaction costs before you start, and track where every dollar goes after.

## The Problem

AI services bill by the token, and every provider prices differently. Google charges one rate, OpenAI another, Anthropic a third. Some models charge for cache reads, others for web searches, others for image generation. Multiply that by four providers and dozens of models, and the true cost of any given interaction becomes nearly impossible to calculate on your own.

Without visibility, usage creeps upward unnoticed. A month passes and the bill arrives with no explanation of which models drove the cost, which workflows consumed the most tokens, or how spending shifted week over week. You are left guessing.

## Use Case: Understanding What You Spend

Built for anyone managing AI costs across multiple providers and workflows.

You open the dashboard before kicking off a batch of research tasks. The pricing page shows current rates for all four providers — Google, OpenAI, Anthropic, and Perplexity — broken down by model, with input and output token costs displayed per million tokens. Specialty costs are listed too: cache read multipliers, web search fees, grounding charges, image pricing. You compare two models side by side and pick the one that fits your budget.

A week later, you check your usage. The system shows your total spend, total calls, and total tokens consumed — input and output counted separately. The breakdown splits by month, by model, and by call type. Each segment includes its dollar cost, call count, and percentage of your total. You adjust the time window from the default ninety days down to thirty to focus on recent activity.

## How It Helps

Every model in the system has verified pricing. At startup, the service checks that every registered model has a complete pricing entry. If any model is missing, the service refuses to start. This guarantee means the costs you see are never stale and never incomplete.

Other services in the platform pull pricing data at launch so they can track costs in real time as they process your requests. The result: by the time you check your usage, the numbers are already there — aggregated, categorized, and rounded to six decimal places.

## Key Benefits

- **All providers, one view** — Five providers and every model they offer, displayed in a single pricing endpoint
- **Verified completeness** — The service will not run unless every model has pricing data, so gaps are impossible
- **Personal cost tracking** — See your own usage broken down by month, model, and call type
- **Flexible time range** — Query anywhere from the last day to the last year of usage, with a sensible ninety-day default

## Limitations

- **Read-only** — Pricing is configured by administrators; there is no self-service pricing management
- **No budgets or alerts** — The service reports costs but does not enforce spending limits
- **No forecasting** — Historical data only; no projected cost estimates
- **Monthly aggregates** — The API groups usage by month; there is no daily breakdown in the response

---

_Part of [IntexuraOS](../overview.md) — Cost transparency across every AI provider, every model, every call._
