# @intexuraos/llm-pricing

LLM usage logging and pricing management for IntexuraOS.

## Features

- **Usage Logging**: Automatic tracking of all LLM token usage and costs to Firestore
- **Per-User Analytics**: Aggregated statistics by user, model, and time period
- **Pricing API**: Fetch current model pricing from app-settings-service

## Usage

### Logging Usage

The `UsageLogger` class requires a logger instance for structured logging:

```ts
import { UsageLogger } from '@intexuraos/llm-pricing';
import pino from 'pino';

const logger = pino({ name: 'my-service' });
const usageLogger = new UsageLogger({ logger });

await usageLogger.log({
  userId: 'user-123',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  callType: 'generate',
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    costUsd: 0.0105,
  },
  success: true,
});
```

Or use the factory function:

```ts
import { createUsageLogger } from '@intexuraos/llm-pricing';
import pino from 'pino';

const logger = pino({ name: 'my-service' });
const usageLogger = createUsageLogger({ logger });

await usageLogger.log({ ... });
```

### Fetching Pricing

```ts
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';

// Fetch all pricing from app-settings-service
const pricingContext = createPricingContext('http://app-settings-service/internal');
const allPricing = await pricingContext.fetchAllPricing();
console.log(allPricing);
// {
//   anthropic: { models: { 'claude-sonnet-4-5': { ... } }, updatedAt: '...' },
//   openai: { models: { 'gpt-4.1': { ... } }, updatedAt: '...' },
// }
```

## Firestore Structure

Usage stats are stored in `llm_usage_stats/{model}/by_call_type/{callType}/by_period/{period}/by_user/{userId}`:

```
llm_usage_stats/
  claude-sonnet-4-5/
    by_call_type/
      generate/
        by_period/
          total/          # All-time aggregate
            by_user/
              user-123
          2026-01/        # Monthly aggregate
            by_user/
              user-123
          2026-01-13/     # Daily aggregate
            by_user/
              user-123
```

Each document contains:

- `totalCalls`: Number of calls
- `successfulCalls`: Number of successful calls
- `failedCalls`: Number of failed calls
- `inputTokens`: Sum of input tokens
- `outputTokens`: Sum of output tokens
- `totalTokens`: Sum of all tokens
- `costUsd`: Sum of costs in USD
- `updatedAt`: Last update timestamp

## Configuration

| Environment Variable       | Description          | Default |
| -------------------------- | -------------------- | ------- |
| `INTEXURAOS_LOG_LLM_USAGE` | Enable usage logging | `true`  |

## Call Types

- `research`: Web search enhanced generation
- `generate`: Simple text generation
- `image_generation`: Image creation
- `visualization_insights`: Chart data analysis
- `visualization_vegalite`: Vega-Lite chart generation
