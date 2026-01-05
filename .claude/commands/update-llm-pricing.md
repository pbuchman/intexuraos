# Update LLM Pricing

You are an **LLM Pricing Updater** for IntexuraOS. Your role is to synchronize LLM pricing across Firestore (source of truth) and hardcoded client values with official provider rates.

---

## Usage

```
/update-llm-pricing
```

---

## Phase 0: Confirm Current Date

**MANDATORY:** Before proceeding, confirm the current date.

If you are uncertain about the current year, month, or day, **ASK THE USER**:

```
What is today's date? (format: YYYY-MM-DD)
```

Use this date for:

- Migration file naming
- Web searches for current pricing
- Documentation in migration comments

---

## Phase 1: Fetch Current Official Pricing

Search for official pricing from each provider:

### Google Gemini

```
Search: "Google Gemini API pricing [YEAR]" site:ai.google.dev
```

Key models to verify:

- gemini-2.5-pro
- gemini-2.5-flash
- gemini-2.0-flash
- gemini-2.5-flash-image (image generation)

### OpenAI

```
Search: "OpenAI API pricing [YEAR]" site:openai.com
```

Key models to verify:

- gpt-5.x (latest)
- gpt-4o, gpt-4o-mini
- gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
- o1, o1-mini, o3-mini, o4-mini
- dall-e-3, gpt-image-1

### Anthropic Claude

```
Search: "Claude API pricing [YEAR]" site:anthropic.com OR site:claude.ai
```

Key models to verify:

- claude-opus-4.5-\* (latest)
- claude-sonnet-4.5-\*
- claude-haiku-4.5-\*
- claude-sonnet-4-_, claude-opus-4-_
- claude-3-5-sonnet-_, claude-3-5-haiku-_
- claude-3-opus-_, claude-3-sonnet-_, claude-3-haiku-\*

### Perplexity

```
Search: "Perplexity API pricing [YEAR]" site:docs.perplexity.ai
```

Key models to verify:

- sonar
- sonar-pro
- sonar-deep-research

---

## Phase 2: Compare with Current State

### Read existing migrations

```bash
ls -la migrations/
```

Read the latest migration to understand current Firestore state.

### Read client hardcoded values

| File                                      | Pricing constant     |
| ----------------------------------------- | -------------------- |
| `packages/infra-gemini/src/client.ts`     | `GEMINI_PRICING`     |
| `packages/infra-gpt/src/client.ts`        | `GPT_PRICING`        |
| `packages/infra-claude/src/client.ts`     | `CLAUDE_PRICING`     |
| `packages/infra-perplexity/src/client.ts` | `PERPLEXITY_PRICING` |

### Present discrepancies

**MANDATORY:** Show a comparison table:

```markdown
## Pricing Comparison

| Provider | Model            | Current (Firestore) | Current (Client) | Official     | Status   |
| -------- | ---------------- | ------------------- | ---------------- | ------------ | -------- |
| Google   | gemini-2.5-flash | $0.50/$3.00         | $0.075/$0.30     | $0.30/$2.50  | MISMATCH |
| OpenAI   | gpt-5.2          | $1.25/$10.00        | $0.40/$2.00      | $1.75/$14.00 | MISMATCH |
| ...      | ...              | ...                 | ...              | ...          | ...      |
```

---

## Phase 3: Create Migration

Create a new migration file in `migrations/` directory:

**File naming:** `migrations/XXX_llm-pricing-sync-[month]-[year].mjs`

Where XXX is the next sequential number.

### Migration template:

```javascript
/**
 * Migration XXX: LLM Pricing Sync ([Month] [Year])
 *
 * Synchronizes Firestore pricing with official rates as of [YYYY-MM-DD].
 * This migration aligns database (source of truth) with official provider pricing.
 *
 * Key corrections:
 * - [model]: $X.XX/$X.XX -> $X.XX/$X.XX (corrected from migration YYY)
 * - Added missing models: [list]
 *
 * Sources verified [YYYY-MM-DD]:
 * - https://ai.google.dev/gemini-api/docs/pricing
 * - https://openai.com/api/pricing/
 * - https://docs.anthropic.com/en/docs/about-claude/models
 * - https://docs.perplexity.ai/getting-started/pricing
 */

export const metadata = {
  id: 'XXX',
  name: 'llm-pricing-sync-[month]-[year]',
  description: 'Sync all LLM pricing with official rates ([Month] [Year])',
  createdAt: '[YYYY-MM-DD]',
};

function createPricingEntry(provider, model, inputPrice, outputPrice, extras = {}) {
  return {
    provider,
    model,
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    ...extras,
  };
}

function createImagePricingEntry(provider, model, pricePerImage) {
  return {
    provider,
    model,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    imagePricePerUnit: pricePerImage,
  };
}

export async function up(context) {
  console.log('  Syncing LLM pricing with official rates...');

  const pricingUpdate = {
    // GOOGLE GEMINI
    'models.google_gemini-2.5-pro': createPricingEntry('google', 'gemini-2.5-pro', X.XX, X.XX, {
      groundingCostPerCall: 0.035,
    }),
    // ... all models

    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  const modelCount = Object.keys(pricingUpdate).filter((k) => k.startsWith('models.')).length;
  console.log(`  LLM pricing synced for ${modelCount} models`);
}
```

### Pricing extras by provider:

| Provider   | Extra fields                                                                           |
| ---------- | -------------------------------------------------------------------------------------- |
| Google     | `groundingCostPerCall: 0.035`                                                          |
| OpenAI     | `cacheReadMultiplier: 0.5`, `webSearchCostPerCall: 0.025`                              |
| Anthropic  | `cacheReadMultiplier: 0.1`, `cacheWriteMultiplier: 1.25`, `webSearchCostPerCall: 0.03` |
| Perplexity | (none - cost included in token pricing)                                                |

---

## Phase 4: Update Client Hardcoded Values

Update the `*_PRICING` constants in each client file to match official rates.

**Files to modify:**

1. `packages/infra-gemini/src/client.ts` - `GEMINI_PRICING`
2. `packages/infra-gpt/src/client.ts` - `GPT_PRICING`
3. `packages/infra-claude/src/client.ts` - `CLAUDE_PRICING`
4. `packages/infra-perplexity/src/client.ts` - `PERPLEXITY_PRICING`

**Format:**

```typescript
const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  'model-name': { input: X.XX, output: X.XX },
  // ... all models
};
```

---

## Phase 5: Verify

Run full CI:

```bash
npm run ci
```

**MUST PASS** before claiming completion.

---

## Phase 6: Summary

Present a summary of changes:

```markdown
## LLM Pricing Update Summary

**Date:** [YYYY-MM-DD]

### Migration Created

- `migrations/XXX_llm-pricing-sync-[month]-[year].mjs`

### Prices Updated

| Provider | Model            | Old          | New         |
| -------- | ---------------- | ------------ | ----------- |
| Google   | gemini-2.5-flash | $0.075/$0.30 | $0.30/$2.50 |
| ...      | ...              | ...          | ...         |

### Files Modified

- `migrations/XXX_llm-pricing-sync-[month]-[year].mjs` (new)
- `packages/infra-gemini/src/client.ts`
- `packages/infra-gpt/src/client.ts`
- `packages/infra-claude/src/client.ts`
- `packages/infra-perplexity/src/client.ts`

### Verification

- CI: PASSED
```

---

## Architecture Notes

### Dual-Source Pricing (Temporary)

Currently, pricing exists in two places:

1. **Firestore** (`app_settings/llm_pricing`) - Source of truth for `calculateAccurateCost()` in llm-orchestrator
2. **Client hardcoded** - Used for `llm_usage_stats` logging in real-time

Both must be synchronized until the architecture is unified.

### Where pricing is used:

| Location                                                            | Purpose                                          |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/llm-orchestrator/src/domain/research/utils/costCalculator.ts` | Research cost calculation (reads from Firestore) |
| `packages/infra-*/src/client.ts`                                    | Usage logging to `llm_usage_stats` (hardcoded)   |
| `packages/llm-pricing/src/usageLogger.ts`                           | Logs to Firestore + Cloud Logging                |

---

## Rules

- **Always confirm the date first** - pricing changes frequently
- **Search official sources** - never guess prices
- **Update BOTH sources** - migration AND client files
- **Include extras** - grounding, caching, web search costs vary by provider
- **Run CI** - must pass before completion
- **Document sources** - include URLs in migration comments
