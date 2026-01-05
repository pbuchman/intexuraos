# Update LLM Pricing

You are an **LLM Pricing Updater** for IntexuraOS. Your role is to synchronize LLM pricing across Firestore (source of truth) and hardcoded client values with official provider rates.

---

## Usage

```
/update-llm-pricing
```

---

## CRITICAL WARNING: Firestore Dot Notation

**NEVER use `update()` with dot-notation keys for model names containing dots!**

Firestore interprets dots as path separators:

```javascript
// BAD - creates nested objects!
await doc.update({ 'models.openai_gpt-5.2': { ... } });
// Result: models → openai_gpt-5 → 2 (nested object)

// GOOD - use set() with merge or replace entire document
await doc.set({ models: { 'openai_gpt-5.2': { ... } } }, { merge: true });
```

Model names like `gpt-5.2`, `gpt-4.1`, `gemini-2.5-pro` contain dots that break Firestore `update()`.

**Always use `set()` to replace the entire `models` object.**

---

## CRITICAL: Only Project-Used Models

**ONLY include models that are actually used in the codebase.**

Current registry of used models (14 total):

| Provider       | Model                        | Usage                     | Source File                                                    |
| -------------- | ---------------------------- | ------------------------- | -------------------------------------------------------------- |
| **Google**     |                              |                           |                                                                |
|                | `gemini-2.5-pro`             | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `gemini-2.5-flash`           | Research, context, titles | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `gemini-2.0-flash`           | API key validation        | `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`          |
|                | `gemini-2.5-flash-image`     | Image generation          | `apps/image-service/src/domain/models/ImageGenerationModel.ts` |
| **OpenAI**     |                              |                           |                                                                |
|                | `o4-mini-deep-research`      | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `gpt-5.2`                    | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `gpt-4o-mini`                | API key validation        | `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`          |
|                | `gpt-image-1`                | Image generation          | `apps/image-service/src/domain/models/ImageGenerationModel.ts` |
| **Anthropic**  |                              |                           |                                                                |
|                | `claude-opus-4-5-20251101`   | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `claude-sonnet-4-5-20250929` | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `claude-3-5-haiku-20241022`  | API key validation        | `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`          |
| **Perplexity** |                              |                           |                                                                |
|                | `sonar`                      | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `sonar-pro`                  | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |
|                | `sonar-deep-research`        | Research                  | `packages/llm-contract/src/supportedModels.ts`                 |

**Before adding a new model to pricing, verify it's actually used in the codebase!**

---

## CRITICAL: No Model Removal

**NEVER remove models from pricing migrations.**

- Only **ADD** new models
- Only **MODIFY** prices of existing models
- **NEVER DELETE** models (they may be referenced in historical data)

If a model is deprecated, leave it in pricing but note it in comments.

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

## Phase 1: Verify Used Models

**MANDATORY:** Before fetching prices, verify which models are actually used.

```bash
# Check research models
cat packages/llm-contract/src/supportedModels.ts

# Check validation models
grep -n "google:\|openai:\|anthropic:" apps/user-service/src/infra/llm/LlmValidatorImpl.ts

# Check image models
cat apps/image-service/src/domain/models/ImageGenerationModel.ts
```

Only fetch pricing for models found in these files.

---

## Phase 2: Fetch Current Official Pricing

Search for official pricing **only for models in the registry above**:

### Google Gemini

```
Search: "Google Gemini API pricing [YEAR]" site:ai.google.dev
```

Models to verify: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash-image`

### OpenAI

```
Search: "OpenAI API pricing [YEAR]" site:openai.com
```

Models to verify: `o4-mini-deep-research`, `gpt-5.2`, `gpt-4o-mini`, `gpt-image-1`

### Anthropic Claude

```
Search: "Claude API pricing [YEAR]" site:anthropic.com OR site:claude.ai
```

Models to verify: `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `claude-3-5-haiku-20241022`

### Perplexity

```
Search: "Perplexity API pricing [YEAR]" site:docs.perplexity.ai
```

Models to verify: `sonar`, `sonar-pro`, `sonar-deep-research`

---

## Phase 3: Compare with Current State

### Read existing migrations

```bash
ls -la migrations/
```

Read the latest pricing migration to understand current Firestore state.

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
| Google   | gemini-2.5-flash | $0.50/$3.00         | $0.30/$2.50      | $0.30/$2.50  | MISMATCH |
| OpenAI   | gpt-5.2          | $1.25/$10.00        | $1.75/$14.00     | $1.75/$14.00 | MISMATCH |
| ...      | ...              | ...                 | ...              | ...          | ...      |
```

---

## Phase 4: Create Migration

Create a new migration file in `migrations/` directory.

**File naming:** `migrations/XXX_llm-pricing-sync-[month]-[year].mjs`

### Migration template (using set() - NOT update()!):

```javascript
/**
 * Migration XXX: LLM Pricing Sync ([Month] [Year])
 *
 * Synchronizes Firestore pricing with official rates as of [YYYY-MM-DD].
 *
 * IMPORTANT: Uses set() to avoid Firestore dot-notation issues with model names
 * containing dots (e.g., gpt-5.2, gemini-2.5-pro).
 *
 * Changes:
 * - [model]: $X.XX/$X.XX -> $X.XX/$X.XX
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
  description: 'Sync LLM pricing with official rates ([Month] [Year])',
  createdAt: '[YYYY-MM-DD]',
};

export async function up(context) {
  console.log('  Syncing LLM pricing with official rates...');

  const models = {
    // ========================================
    // GOOGLE (4 models)
    // ========================================
    'google_gemini-2.5-pro': {
      provider: 'google',
      model: 'gemini-2.5-pro',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      groundingCostPerCall: 0.035,
    },
    'google_gemini-2.5-flash': {
      provider: 'google',
      model: 'gemini-2.5-flash',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      groundingCostPerCall: 0.035,
    },
    'google_gemini-2.0-flash': {
      provider: 'google',
      model: 'gemini-2.0-flash',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      groundingCostPerCall: 0.035,
    },
    'google_gemini-2.5-flash-image': {
      provider: 'google',
      model: 'gemini-2.5-flash-image',
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      imagePricePerUnit: X.XX,
    },

    // ========================================
    // OPENAI (4 models)
    // ========================================
    'openai_o4-mini-deep-research': {
      provider: 'openai',
      model: 'o4-mini-deep-research',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      cacheReadMultiplier: 0.25,
      webSearchCostPerCall: 0.01,
    },
    'openai_gpt-5.2': {
      provider: 'openai',
      model: 'gpt-5.2',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      cacheReadMultiplier: 0.1,
    },
    'openai_gpt-4o-mini': {
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      cacheReadMultiplier: 0.5,
    },
    'openai_gpt-image-1': {
      provider: 'openai',
      model: 'gpt-image-1',
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      imagePricePerUnit: X.XX,
    },

    // ========================================
    // ANTHROPIC (3 models)
    // ========================================
    'anthropic_claude-opus-4-5-20251101': {
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.03,
    },
    'anthropic_claude-sonnet-4-5-20250929': {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.03,
    },
    'anthropic_claude-3-5-haiku-20241022': {
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    },

    // ========================================
    // PERPLEXITY (3 models)
    // ========================================
    perplexity_sonar: {
      provider: 'perplexity',
      model: 'sonar',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
    },
    'perplexity_sonar-pro': {
      provider: 'perplexity',
      model: 'sonar-pro',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
    },
    'perplexity_sonar-deep-research': {
      provider: 'perplexity',
      model: 'sonar-deep-research',
      inputPricePerMillion: X.XX,
      outputPricePerMillion: X.XX,
    },
  };

  // CRITICAL: Use set() to replace entire document - NOT update()!
  // update() interprets dots in keys as path separators, breaking model names like gpt-5.2
  await context.firestore.doc('app_settings/llm_pricing').set({
    models,
    updatedAt: new Date().toISOString(),
  });

  console.log(`  LLM pricing synced for ${Object.keys(models).length} models`);
}
```

### Pricing extras by provider:

| Provider   | Extra fields                                                                           |
| ---------- | -------------------------------------------------------------------------------------- |
| Google     | `groundingCostPerCall: 0.035`                                                          |
| OpenAI     | `cacheReadMultiplier: 0.5`, `webSearchCostPerCall: 0.01` (for deep-research)           |
| Anthropic  | `cacheReadMultiplier: 0.1`, `cacheWriteMultiplier: 1.25`, `webSearchCostPerCall: 0.03` |
| Perplexity | (none - cost included in token pricing)                                                |

---

## Phase 5: Update Client Hardcoded Values

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

## Phase 6: Verify

Run full CI:

```bash
npm run ci
```

**MUST PASS** before claiming completion.

---

## Phase 7: Summary

Present a summary of changes:

```markdown
## LLM Pricing Update Summary

**Date:** [YYYY-MM-DD]

### Migration Created

- `migrations/XXX_llm-pricing-sync-[month]-[year].mjs`

### Prices Updated

| Provider | Model            | Old         | New         |
| -------- | ---------------- | ----------- | ----------- |
| Google   | gemini-2.5-flash | $0.50/$3.00 | $0.30/$2.50 |
| ...      | ...              | ...         | ...         |

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

## Rules Summary

1. **Confirm date first** - pricing changes frequently
2. **Only project-used models** - verify in source files before adding
3. **NEVER remove models** - only add or modify
4. **Use set() not update()** - dots in model names break Firestore update()
5. **Search official sources** - never guess prices
6. **Update BOTH sources** - migration AND client files
7. **Include extras** - grounding, caching, web search costs vary by provider
8. **Run CI** - must pass before completion
9. **Document sources** - include URLs in migration comments
