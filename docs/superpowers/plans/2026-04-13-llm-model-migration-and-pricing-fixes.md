# LLM Model Migration and Pricing Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate three production model identifiers (`gpt-5.2` → `gpt-5.4`, `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6`, `claude-opus-4-5-20251101` → `claude-opus-4-6`) and fix the Anthropic web-search per-call fee from the incorrect `$0.03` to the official `$0.01` — all without modifying any existing migration file. `gpt-4o-mini` stays untouched.

**Architecture:** Additive-first migration. We introduce the new model identifiers alongside the old ones so the codebase stays compilable between every commit, migrate all call sites, then remove the old identifiers. Pricing changes ship as a single new migration (`093`) that adds new-model rows, removes old-model rows, and fixes the Anthropic web-search fee in one atomic Firestore batch.

**Tech Stack:** TypeScript strict mode, Fastify apps, Firestore (pricing persistence), Vitest, pnpm workspaces. Migration runner is `.mjs` files in `migrations/` executed via the in-house runner — no external migration tool.

**Endpoint Changes:**
- Modified: none
- Created: none
- Removed: none
- Unchanged: all HTTP endpoints. This plan is pricing + model-identifier metadata only.

---

## Prerequisites (read before starting)

- `.claude/reference/coverage-exemptions.md` — if you need a `v8 ignore` on generated test noise. You shouldn't.
- `packages/llm-contract/src/supportedModels.ts` — the single source of truth for model IDs. Read this file end-to-end before touching anything.
- `migrations/012_new-pricing-structure.mjs` — read as the reference pattern for per-provider pricing document shape. (Historical note: 012 wrote to the nested `settings/llm_pricing/providers/{provider}` path; migration 088 one-shot-copied that data to the flat `llm_pricing/{provider}` collection; migration 089 marked the nested path `_deprecated: true`. Today `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts:5-18` reads ONLY the flat path — migration 093 writes ONLY there.)
- `migrations/088_migrate_pricing_to_llm_usage_service.mjs` and `migrations/089_delete_old_pricing_source.mjs` — read the deprecation ledger to understand why 093 doesn't touch the nested path.
- `migrations/092_execution-memories-stale-pruning-index.mjs` — read for the current metadata shape.
- **Do NOT modify any file under `migrations/` with a number ≤ `092`**. Every pricing migration in history (002, 004, 005, 007, 009, 010, 012) is immutable. Fix-forward via new migrations only.

---

## Pre-Flight: gpt-5.4 Pricing (VERIFIED 2026-04-13)

The OpenAI pricing page (https://platform.openai.com/docs/pricing) lists `gpt-5.4` under "Flagship models → Latest: GPT-5.4". Verified values captured manually from a logged-in session:

| Field                                                  | Value      | Source                                                   |
| ------------------------------------------------------ | ---------- | -------------------------------------------------------- |
| `inputPricePerMillion` (short context ≤ threshold)     | **$2.50**  | gpt-5.4 row, Standard column, Input                      |
| `outputPricePerMillion` (short context ≤ threshold)    | **$15.00** | gpt-5.4 row, Standard column, Output                     |
| Cached input per MTok                                  | $0.25      | → `cacheReadMultiplier: 0.1` (0.25 / 2.50)               |
| Web search per 1k calls (reasoning models incl. gpt-5) | $10.00     | `webSearchCostPerCall: 0.01` — APPLIED in this plan      |

**Cost impact vs gpt-5.2:** input +43% ($1.75 → $2.50), output +7% ($14.00 → $15.00). Long-context calls (> threshold) are billed at $5.00/$22.50 by OpenAI but our Firestore schema holds a single rate per model, so long-context calls will be under-billed. Tier-aware pricing is out of scope for this plan (same gap as Gemini 2.5 Pro >200K tier).

- [ ] **Step 1: Paste the pricing-page snapshot URL into the PR description when opened**

When Task 12's PR is drafted, include the URL and the three verified values above so the reviewer can re-verify. No other pre-flight action required.

---

## File Structure

**Files created (exactly one):**
- `migrations/093_model-id-migration-and-anthropic-websearch-fix.mjs` — adds `gpt-5.4` (with `webSearchCostPerCall: 0.01`), `claude-sonnet-4-6` and `claude-opus-4-6` (with corrected `webSearchCostPerCall: 0.01`) pricing rows; removes `gpt-5.2`, `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101` rows. Writes ONLY to the flat `llm_pricing/{provider}` collection — the nested `settings/llm_pricing/providers/*` path was marked `_deprecated: true` by migration 089 and has no runtime readers.

**Files modified (production code):**
- `packages/llm-contract/src/supportedModels.ts` — add new branded types, const entries, union members, runtime array entries, provider-map entries; remove the old ones at the end.
- `packages/llm-contract/src/__tests__/fixtures/pricing.ts` — replace `gpt-5.2` / `claude-sonnet-4-5-20250929` / `claude-opus-4-5-20251101` rows with the new IDs and prices (mirror migration 093 exactly — the file comment already claims it does).
- `packages/llm-pricing/src/testFixtures.ts` — **shipped source** (NOT under `__tests__/`); re-exported from the package index for downstream test harnesses. Lines 73, 76, 77 reference old enum IDs and must be updated in Task 12 Step 6, or `pnpm run ci:tracked` fails to compile `llm-pricing`.
- `apps/research-agent/src/index.ts` — `REQUIRED_MODELS` list.
- `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts` — lines 44, 45, 47, 59, 60, 62.
- `apps/actions-agent/src/services.ts:193,194`.
- `apps/web/src/pages/ResearchAgentPage.tsx:36` — `SYNTHESIS_CAPABLE_MODELS`.
- `apps/web/src/components/research/EnhanceModal.tsx:19`.
- `apps/web/src/components/ModelSelector.tsx:35,36,43`.
- `apps/web/src/services/researchAgentApi.types.ts:16,17,19`.
- `packages/llm-prompts/src/research/modelExtractionPrompt.ts:222,223,225,237,238,245` — string literals inside the prompt (these are user-facing model names; the prompt tells the model which IDs to emit) and OpenAI-specific wiring in `MODEL_KEYWORDS`, `PROVIDER_DEFAULT_MODELS`, and `SYNTHESIS_MODELS`.

**Files modified (tests):**
- `packages/llm-contract/src/__tests__/supportedModels.test.ts` — 15+ assertion updates.
- `packages/llm-pricing/src/__tests__/pricingClient.test.ts` — 6+ updates.
- `packages/llm-pricing/src/__tests__/testFixtures.test.ts` — 5+ updates.
- `packages/llm-pricing/src/__tests__/httpWebhookUsageSink.test.ts:88,153,158` — bare-form literals (added per 2026-04-13 review).
- `packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts` — 21 references (added per 2026-04-13 review — missing this would break CI at Phase 4).
- `packages/internal-clients/src/user-service/__tests__/client.test.ts:522,559,638,665`.
- `packages/internal-clients/src/usage-service/__tests__/client.test.ts:275,285`.
- `apps/llm-usage-service/src/__tests__/routes/pricingRoutes.test.ts:75,183` — includes numeric `0.03` → `0.01` update (handled manually in Task 9 Step 2).
- `packages/llm-factory/src/__tests__/llmClientFactory.test.ts:146`.
- `apps/research-agent/src/__tests__/**` — 100+ references across multiple test files. All are mechanical search-and-replace — the migration must be done in a single commit or tests will not compile between commits.
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts:4559,4574,4586` — date-suffixed literals (added per 2026-04-13 review).

**Files modified (docs — non-historical only):**
- `docs/packages/llm-contract/README.md` lines 29, 33, 34, 49, 50, 52, 71, 72, 74, 75.
- `docs/packages/llm-contract/agent.md` lines 45, 46, 47, 52.
- `docs/packages/infra-claude/README.md:22,66`.
- `docs/packages/infra-claude/agent.md:60`.
- `docs/packages/llm-pricing/README.md:50,82`.
- `docs/services/research-agent/agent.md:60,71,74`.
- `docs/services/research-agent/tutorial.md:49,64,68,161`.
- `docs/services/research-agent/technical.md:340`.
- `docs/services/research-agent/features.md:15,71` — user-facing feature doc (added per 2026-04-13 review).
- `docs/services/app-settings-service/agent.md:170,171`.
- `docs/architecture/ai-architecture.md:413`.
- `docs/architecture/llm-packages.md:95,96,336,338,339` — architecture doc (added per 2026-04-13 review).
- `docs/validation/ai-models-validation.md:20,23,24,75,76,113,135`.
- `.claude/agents/llm-manager.md:140,371,372`.
- `scripts/verify-llm-architecture.ts:33`.

**Files explicitly NOT modified:**
- All `migrations/*.mjs` files numbered ≤ `092` — immutable, including their comments.
- Historical plan documents: any file under `docs/superpowers/plans/` or `docs/plans/` with a date-stamped or `INT-*` filename. These are point-in-time artifacts.
- `docs/validation/v3.0.0-documentation-run-report.md` — historical audit log.
- `docs/services/user-service/*.md` and `docs/services/image-service/*.md` — these reference `gpt-4o-mini`, which stays.
- `docs/services/user-service/technical.md:308`, `docs/services/user-service/agent.md:383`, `docs/services/image-service/technical.md:242,246,293`, `docs/services/image-service/technical-debt.md:51`, `docs/packages/infra-gpt/README.md:75`, `docs/plans/INT-1011-openrouter-backend.md:347`.
- `scripts/test-llm-clients.ts` — unrelated staleness flagged in audit; fixing is scope creep.
- `.claude/skills/linear/templates/pr-description.md` — personal user template with `Co-Authored-By: Claude Opus 4.5`. Excluded per 2026-04-13 review (scope: user-facing + compile-critical only).
- JSDoc inside `packages/llm-pricing/src/pricingClient.ts`, `packages/llm-pricing/src/usageLogger.ts`, `packages/infra-claude/src/client.ts`, `packages/infra-claude/src/types.ts` — bare-form `claude-sonnet-4-5` / `claude-opus-4-5` in example blocks. Stale-looking but not compile-breakers. Excluded per 2026-04-13 review.

---

## Phase 1: Introduce New Model Identifiers (Coexistence)

The goal of Phase 1 is that after it merges, the codebase compiles with BOTH the old and the new model IDs present. No call site changes yet.

### Task 0: Create feature branch

`development` and `main` are BOTH protected branches per `.claude/CLAUDE.md`. Direct commits are rejected by branch protection. Every commit step in this plan assumes you are on a feature branch whose name contains `INT-1355` (so Linear and GitHub auto-attach the PR).

**Files:** none

- [ ] **Step 1: Verify you are on `development` and up to date**

```bash
gh repo sync --source pbuchman/intexuraos-1 --branch development 2>/dev/null || git fetch origin development
git checkout development
git pull --ff-only origin development
```

Expected: working tree clean, `HEAD` matches `origin/development`.

- [ ] **Step 2: Create and switch to the feature branch**

```bash
git checkout -b pbuchman/INT-1355/llm-model-migration-and-pricing-fixes
```

Expected: `Switched to a new branch 'pbuchman/INT-1355/llm-model-migration-and-pricing-fixes'`. The prefix matches the repo's recent convention (e.g. `pbuchman/INT-1352/execution-memory-fixes` from recent `git log`).

- [ ] **Step 3: Confirm the branch tracks nothing yet**

```bash
git status -sb
```

Expected: `## pbuchman/INT-1355/llm-model-migration-and-pricing-fixes` with no upstream. The first push will use `git push -u origin HEAD`.

### Task 1: Add new branded types and const entries

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`

- [ ] **Step 1: Write failing test for new-model presence**

Open `packages/llm-contract/src/__tests__/supportedModels.test.ts` and add this test inside the existing top-level `describe('supportedModels', ...)` block:

```typescript
describe('new model identifiers (2026-04 migration)', () => {
  it('exposes GPT54 with id "gpt-5.4"', () => {
    expect(LlmModels.GPT54).toBe('gpt-5.4');
  });

  it('exposes ClaudeSonnet46 with id "claude-sonnet-4-6"', () => {
    expect(LlmModels.ClaudeSonnet46).toBe('claude-sonnet-4-6');
  });

  it('exposes ClaudeOpus46 with id "claude-opus-4-6"', () => {
    expect(LlmModels.ClaudeOpus46).toBe('claude-opus-4-6');
  });

  it('includes the three new models in ALL_LLM_MODELS', () => {
    expect(ALL_LLM_MODELS).toContain(LlmModels.GPT54);
    expect(ALL_LLM_MODELS).toContain(LlmModels.ClaudeSonnet46);
    expect(ALL_LLM_MODELS).toContain(LlmModels.ClaudeOpus46);
  });

  it('maps each new model to the correct provider', () => {
    expect(MODEL_PROVIDER_MAP[LlmModels.GPT54]).toBe(LlmProviders.OpenAI);
    expect(MODEL_PROVIDER_MAP[LlmModels.ClaudeSonnet46]).toBe(LlmProviders.Anthropic);
    expect(MODEL_PROVIDER_MAP[LlmModels.ClaudeOpus46]).toBe(LlmProviders.Anthropic);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @intexuraos/llm-contract test -- --run supportedModels
```

Expected output: 5 failing tests with `TypeError: Cannot read property 'GPT54' of undefined` (or similar — TS compile error counts as a fail).

- [ ] **Step 3: Add the three new branded types**

In `packages/llm-contract/src/supportedModels.ts` after line 36 (after `export type GPT52 = 'gpt-5.2';`), add:

```typescript
export type GPT54 = 'gpt-5.4';
```

After line 45 (after `export type ClaudeSonnet45 = 'claude-sonnet-4-5-20250929';`), add:

```typescript
export type ClaudeSonnet46 = 'claude-sonnet-4-6';
```

After line 44 (after `export type ClaudeOpus45 = 'claude-opus-4-5-20251101';`), add:

```typescript
export type ClaudeOpus46 = 'claude-opus-4-6';
```

- [ ] **Step 4: Add new entries to the LlmModels const**

In the `LlmModels` const object (lines 149-168), add after `GPT52: 'gpt-5.2' as GPT52,`:

```typescript
  GPT54: 'gpt-5.4' as GPT54,
```

After `ClaudeOpus45: 'claude-opus-4-5-20251101' as ClaudeOpus45,`:

```typescript
  ClaudeOpus46: 'claude-opus-4-6' as ClaudeOpus46,
```

After `ClaudeSonnet45: 'claude-sonnet-4-5-20250929' as ClaudeSonnet45,`:

```typescript
  ClaudeSonnet46: 'claude-sonnet-4-6' as ClaudeSonnet46,
```

- [ ] **Step 5: Add new models to the LLMModel union type**

In the `LLMModel` union (lines 105-123), add `| GPT54` in the OpenAI block after `| GPT52`, and `| ClaudeOpus46 | ClaudeSonnet46` in the Anthropic block after `| ClaudeOpus45` and `| ClaudeSonnet45`. Final Anthropic block:

```typescript
  // Anthropic (5 models)
  | ClaudeOpus45
  | ClaudeOpus46
  | ClaudeSonnet45
  | ClaudeSonnet46
  | ClaudeHaiku35
```

Update the comment counts (e.g., `OpenAI (5 models)`, `Anthropic (5 models)`).

- [ ] **Step 6: Add new models to ResearchModel and GenericModel unions**

In `ResearchModel` (lines 68-78), add `| GPT54` after `| GPT52` and `| ClaudeOpus46 | ClaudeSonnet46` after the existing 4.5 entries. In `GenericModel` (line 99), change `Gemini25Pro | GPT52` to `Gemini25Pro | GPT52 | GPT54`.

- [ ] **Step 7: Add new models to ALL_LLM_MODELS array**

In `ALL_LLM_MODELS` (lines 178-197), add:
- `LlmModels.GPT54,` after `LlmModels.GPT52,`
- `LlmModels.ClaudeOpus46,` after `LlmModels.ClaudeOpus45,`
- `LlmModels.ClaudeSonnet46,` after `LlmModels.ClaudeSonnet45,`

- [ ] **Step 8: Add new models to MODEL_PROVIDER_MAP**

In the `MODEL_PROVIDER_MAP` record (lines 216-235), add these lines alongside the matching 4.5/5.2 entries:

```typescript
  [LlmModels.GPT54]: LlmProviders.OpenAI,
  [LlmModels.ClaudeOpus46]: LlmProviders.Anthropic,
  [LlmModels.ClaudeSonnet46]: LlmProviders.Anthropic,
```

- [ ] **Step 9: Run the test and confirm it passes**

```bash
pnpm --filter @intexuraos/llm-contract test -- --run supportedModels
```

Expected: all 5 new tests pass. No existing tests regress.

- [ ] **Step 10: Verify the package typechecks**

```bash
pnpm --filter @intexuraos/llm-contract run build
```

Expected: clean build. If you see "not assignable to Record<LLMModel, ...>", you forgot an entry in `MODEL_PROVIDER_MAP` — the whole point of that Record type is to force exhaustiveness.

- [ ] **Step 11: Commit**

```bash
git add packages/llm-contract/src/supportedModels.ts packages/llm-contract/src/__tests__/supportedModels.test.ts
git commit -m "feat(llm-contract): add gpt-5.4, claude-sonnet-4-6, claude-opus-4-6 identifiers"
```

---

## Phase 2: Introduce New Pricing (Firestore + Fixture)

### Task 2: Add new-model entries to the test pricing fixture

**Files:**
- Modify: `packages/llm-contract/src/__tests__/fixtures/pricing.ts`

- [ ] **Step 1: Write failing test — new models are priced**

Add to `packages/llm-pricing/src/__tests__/testFixtures.test.ts` (or the equivalent file that validates fixture contents):

```typescript
it('fixture includes pricing for gpt-5.4', () => {
  expect(TEST_OPENAI_PRICING.models[LlmModels.GPT54]?.inputPricePerMillion).toBe(2.5);
  expect(TEST_OPENAI_PRICING.models[LlmModels.GPT54]?.outputPricePerMillion).toBe(15.0);
  expect(TEST_OPENAI_PRICING.models[LlmModels.GPT54]?.cacheReadMultiplier).toBe(0.1);
  expect(TEST_OPENAI_PRICING.models[LlmModels.GPT54]?.webSearchCostPerCall).toBe(0.01);
});

it('fixture includes pricing for claude-opus-4-6', () => {
  expect(TEST_ANTHROPIC_PRICING.models[LlmModels.ClaudeOpus46]?.inputPricePerMillion).toBe(5.0);
  expect(TEST_ANTHROPIC_PRICING.models[LlmModels.ClaudeOpus46]?.outputPricePerMillion).toBe(25.0);
  expect(TEST_ANTHROPIC_PRICING.models[LlmModels.ClaudeOpus46]?.webSearchCostPerCall).toBe(0.01);
});

it('fixture includes pricing for claude-sonnet-4-6', () => {
  expect(TEST_ANTHROPIC_PRICING.models[LlmModels.ClaudeSonnet46]?.inputPricePerMillion).toBe(3.0);
  expect(TEST_ANTHROPIC_PRICING.models[LlmModels.ClaudeSonnet46]?.outputPricePerMillion).toBe(15.0);
  expect(TEST_ANTHROPIC_PRICING.models[LlmModels.ClaudeSonnet46]?.webSearchCostPerCall).toBe(0.01);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @intexuraos/llm-pricing test -- --run testFixtures
```

Expected: 3 failures, all `expect(undefined).toBeDefined()` or similar.

- [ ] **Step 3: Add new-model entries to the test fixture**

In `packages/llm-contract/src/__tests__/fixtures/pricing.ts`, inside `TEST_OPENAI_PRICING.models`, after the `'gpt-5.2'` entry, add:

```typescript
    'gpt-5.4': {
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 15.0,
      cacheReadMultiplier: 0.1,
      webSearchCostPerCall: 0.01,
    },
```

Inside `TEST_ANTHROPIC_PRICING.models`, after the `'claude-opus-4-5-20251101'` entry, add:

```typescript
    'claude-opus-4-6': {
      inputPricePerMillion: 5.0,
      outputPricePerMillion: 25.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.01,
    },
```

After the `'claude-sonnet-4-5-20250929'` entry:

```typescript
    'claude-sonnet-4-6': {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.01,
    },
```

Note: the two old Anthropic entries keep `webSearchCostPerCall: 0.03` for now. We intentionally do NOT fix them in the fixture — they'll be removed entirely in Phase 4. Only new rows get the correct `0.01`.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @intexuraos/llm-pricing test -- --run testFixtures
```

Expected: 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-contract/src/__tests__/fixtures/pricing.ts packages/llm-pricing/src/__tests__/testFixtures.test.ts
git commit -m "feat(llm-pricing): add test fixture pricing for gpt-5.4 and claude 4.6 models"
```

### Task 3: Create migration 093

**Files:**
- Create: `migrations/093_model-id-migration-and-anthropic-websearch-fix.mjs`

- [ ] **Step 1: Create the migration file**

Verified (2026-04-13): production reads pricing only from the flat `llm_pricing/{provider}` collection via `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts:5-18`. The legacy nested path `settings/llm_pricing/providers/*` was marked `_deprecated: true` by `migrations/089_delete_old_pricing_source.mjs` and has no runtime readers. Migration 093 writes ONLY to `llm_pricing/{provider}` — touching the deprecated path would silently overwrite the `_deprecated` marker and reactivate the deprecated ledger.

Create the file with this exact content:

```javascript
/**
 * Migration 093: Migrate model identifiers and fix Anthropic web-search fee
 *
 * Model migrations:
 *   - Add:    gpt-5.4              (successor to gpt-5.2)
 *   - Add:    claude-opus-4-6      (successor to claude-opus-4-5-20251101)
 *   - Add:    claude-sonnet-4-6    (successor to claude-sonnet-4-5-20250929)
 *   - Remove: gpt-5.2
 *   - Remove: claude-opus-4-5-20251101
 *   - Remove: claude-sonnet-4-5-20250929
 *
 * Pricing corrections:
 *   - Anthropic webSearchCostPerCall was $0.03 on the removed rows. The new
 *     claude-opus-4-6 / claude-sonnet-4-6 rows use the official $0.01
 *     (Anthropic bills web search at $10 / 1,000 searches per platform.claude.com).
 *   - gpt-5.4 gains webSearchCostPerCall: $0.01 (OpenAI bills web search at
 *     $10 / 1,000 calls for reasoning models incl. gpt-5 family per
 *     platform.openai.com/docs/pricing). gpt-5.2 never had this field set.
 *
 * Writes ONLY to llm_pricing/{provider}. The legacy nested path
 * settings/llm_pricing/providers/* was deprecated by migration 089 and has no
 * runtime readers — updating it would overwrite the _deprecated marker.
 */

export const metadata = {
  id: '093',
  name: 'model-id-migration-and-anthropic-websearch-fix',
  description:
    'Migrate gpt-5.2→gpt-5.4, claude-sonnet-4-5→4-6, claude-opus-4-5→4-6; fix Anthropic web-search fee to $0.01/call; add gpt-5.4 web-search fee',
  createdAt: '2026-04-13',
};

export async function up(context) {
  console.log('  Migrating model identifiers and fixing web-search fees...');

  const timestamp = new Date().toISOString();

  const [openaiSnap, anthropicSnap] = await Promise.all([
    context.firestore.doc('llm_pricing/openai').get(),
    context.firestore.doc('llm_pricing/anthropic').get(),
  ]);

  if (!openaiSnap.exists) {
    throw new Error('Migration 093: llm_pricing/openai document missing');
  }
  if (!anthropicSnap.exists) {
    throw new Error('Migration 093: llm_pricing/anthropic document missing');
  }

  const openaiData = openaiSnap.data();
  const anthropicData = anthropicSnap.data();

  // --- OpenAI: add gpt-5.4, remove gpt-5.2 ---
  // Prices verified 2026-04-13 from https://platform.openai.com/docs/pricing
  // (gpt-5.4 standard short-context row + reasoning-models web-search row).
  const newOpenaiModels = { ...openaiData.models };
  newOpenaiModels['gpt-5.4'] = {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    webSearchCostPerCall: 0.01,
  };
  delete newOpenaiModels['gpt-5.2'];

  // --- Anthropic: add 4.6 models with corrected web-search fee, remove 4.5 models ---
  // Prices verified 2026-04-13 from https://platform.claude.com/docs/en/about-claude/pricing
  // (Sonnet 4.6 and Opus 4.6 model rows; web search $10 per 1,000 calls).
  const newAnthropicModels = { ...anthropicData.models };
  newAnthropicModels['claude-opus-4-6'] = {
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.01,
  };
  newAnthropicModels['claude-sonnet-4-6'] = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.01,
  };
  delete newAnthropicModels['claude-opus-4-5-20251101'];
  delete newAnthropicModels['claude-sonnet-4-5-20250929'];

  const newOpenai = { ...openaiData, models: newOpenaiModels, updatedAt: timestamp };
  const newAnthropic = { ...anthropicData, models: newAnthropicModels, updatedAt: timestamp };

  const batch = context.firestore.batch();
  batch.set(context.firestore.doc('llm_pricing/openai'), newOpenai);
  batch.set(context.firestore.doc('llm_pricing/anthropic'), newAnthropic);
  await batch.commit();

  console.log('  Done. OpenAI models:', Object.keys(newOpenaiModels).sort().join(', '));
  console.log('  Done. Anthropic models:', Object.keys(newAnthropicModels).sort().join(', '));
}
```

- [ ] **Step 2: Run the migration against the dev Firestore**

```bash
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev-pbuchman pnpm run migrate
```

Expected stdout lines:
```
  Done. OpenAI models: gpt-4o-mini, gpt-5.4, gpt-image-1, o4-mini-deep-research
  Done. Anthropic models: claude-3-5-haiku-20241022, claude-opus-4-6, claude-sonnet-4-6
```

- [ ] **Step 3: Verify Firestore state directly**

```bash
gcloud firestore documents describe llm_pricing/openai --project=intexuraos-dev-pbuchman --format=json | jq '.fields.models.mapValue.fields | keys'
gcloud firestore documents describe llm_pricing/anthropic --project=intexuraos-dev-pbuchman --format=json | jq '.fields.models.mapValue.fields | keys'
```

Expected:
- openai models: `["gpt-4o-mini", "gpt-5.4", "gpt-image-1", "o4-mini-deep-research"]`
- anthropic models: `["claude-3-5-haiku-20241022", "claude-opus-4-6", "claude-sonnet-4-6"]`

Spot-check: `claude-opus-4-6.webSearchCostPerCall` is `0.01`, not `0.03`.

- [ ] **Step 4: Commit the migration file**

```bash
git add migrations/093_model-id-migration-and-anthropic-websearch-fix.mjs
git commit -m "feat(migrations): add migration 093 for 4.6 model IDs and Anthropic web-search fee fix"
```

---

## Phase 3: Migrate Call Sites

All call-site migrations happen in a single commit per area. Do not split within an area — the tests reference the same enum values.

### Task 4: Migrate research-agent production code

**Files:**
- Modify: `apps/research-agent/src/index.ts`
- Modify: `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts`

- [ ] **Step 1: Update REQUIRED_MODELS in research-agent's index.ts**

In `apps/research-agent/src/index.ts:52-55`, change:
```typescript
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  ...
  LlmModels.GPT52,
```
to:
```typescript
  LlmModels.ClaudeOpus46,
  LlmModels.ClaudeSonnet46,
  ...
  LlmModels.GPT54,
```

- [ ] **Step 2: Update extractModelPreferences.ts**

In `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts:44,45,47,59,60,62`, replace every occurrence of `LlmModels.ClaudeOpus45` → `LlmModels.ClaudeOpus46`, `LlmModels.ClaudeSonnet45` → `LlmModels.ClaudeSonnet46`, `LlmModels.GPT52` → `LlmModels.GPT54`.

- [ ] **Step 3: Run research-agent tests**

```bash
pnpm --filter @intexuraos/research-agent test
```

Expected: many tests fail because test files still reference the old IDs. That's Task 5. For now we only need the production code to compile:

```bash
pnpm --filter @intexuraos/research-agent run build
```

Expected: clean build.

- [ ] **Step 4: Do NOT commit yet**

Tests are broken. Proceed to Task 5 in the same working tree.

### Task 5: Migrate research-agent tests

**Files:**
- Modify: all `apps/research-agent/src/__tests__/**/*.test.ts` that reference the old IDs (use `grep -rl` to find them — previously audited as 40+ references).

- [ ] **Step 1: Run the migration**

Because every occurrence of `LlmModels.GPT52`, `LlmModels.ClaudeSonnet45`, `LlmModels.ClaudeOpus45` in the research-agent tests is a direct enum reference, a single workspace-scoped search-and-replace is safe.

```bash
# Verify scope first
grep -rn "LlmModels.GPT52\|LlmModels.ClaudeSonnet45\|LlmModels.ClaudeOpus45" apps/research-agent/src/__tests__/ | wc -l

# Perform replacement. Review the diff before committing.
find apps/research-agent/src/__tests__ -name "*.ts" -exec sed -i.bak \
  -e 's/LlmModels\.GPT52/LlmModels.GPT54/g' \
  -e 's/LlmModels\.ClaudeSonnet45/LlmModels.ClaudeSonnet46/g' \
  -e 's/LlmModels\.ClaudeOpus45/LlmModels.ClaudeOpus46/g' \
  {} +

# Also handle raw string literals (they appear in test-data fixtures):
find apps/research-agent/src/__tests__ -name "*.ts" -exec sed -i.bak \
  -e "s/'gpt-5\\.2'/'gpt-5.4'/g" \
  -e "s/'claude-sonnet-4-5-20250929'/'claude-sonnet-4-6'/g" \
  -e "s/'claude-opus-4-5-20251101'/'claude-opus-4-6'/g" \
  {} +

# Handle short-form strings (no date suffix) used in display/assertion contexts:
find apps/research-agent/src/__tests__ -name "*.ts" -exec sed -i.bak \
  -e "s/'claude-opus-4-5'/'claude-opus-4-6'/g" \
  -e "s/'claude-sonnet-4-5'/'claude-sonnet-4-6'/g" \
  -e "s/Claude Sonnet 4\.5/Claude Sonnet 4.6/g" \
  -e "s/Claude Opus 4\.5/Claude Opus 4.6/g" \
  {} +

# Remove sed backup files
find apps/research-agent/src/__tests__ -name "*.bak" -delete
```

- [ ] **Step 2: Run research-agent tests**

```bash
pnpm --filter @intexuraos/research-agent test
```

Expected: all tests pass.

- [ ] **Step 3: Commit research-agent migration atomically**

```bash
git add apps/research-agent/
git commit -m "refactor(research-agent): migrate call sites to gpt-5.4 and claude 4.6 models"
```

### Task 6: Migrate actions-agent

**Files:**
- Modify: `apps/actions-agent/src/services.ts:193,194`

- [ ] **Step 1: Replace model references**

In `apps/actions-agent/src/services.ts:193-194`, change `LlmModels.ClaudeSonnet45` → `LlmModels.ClaudeSonnet46` and `LlmModels.GPT52` → `LlmModels.GPT54`.

- [ ] **Step 2: Run actions-agent tests and build**

```bash
pnpm --filter @intexuraos/actions-agent test
pnpm --filter @intexuraos/actions-agent run build
```

Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add apps/actions-agent/
git commit -m "refactor(actions-agent): migrate to claude-sonnet-4-6 and gpt-5.4"
```

### Task 7: Migrate web app

**Files:**
- Modify: `apps/web/src/pages/ResearchAgentPage.tsx:36`
- Modify: `apps/web/src/components/research/EnhanceModal.tsx:19`
- Modify: `apps/web/src/components/ModelSelector.tsx:35,36,43`
- Modify: `apps/web/src/services/researchAgentApi.types.ts:16,17`

- [ ] **Step 1: Update each file**

`ResearchAgentPage.tsx:36`:
```typescript
const SYNTHESIS_CAPABLE_MODELS: LLMModel[] = [LlmModels.Gemini25Pro, LlmModels.GPT54];
```

`EnhanceModal.tsx:19`: same substitution — `GPT52` → `GPT54`.

`ModelSelector.tsx`: the Selector's options array has three entries to swap. Keep the display labels human-readable:

```typescript
{ value: LlmModels.ClaudeOpus46, label: 'Claude Opus 4.6' },
{ value: LlmModels.ClaudeSonnet46, label: 'Claude Sonnet 4.6' },
// ... and further down:
{ value: LlmModels.GPT54, label: 'GPT-5.4' },
```

`researchAgentApi.types.ts:16,17,19`: swap `'claude-opus-4-5-20251101'` → `'claude-opus-4-6'`, `'claude-sonnet-4-5-20250929'` → `'claude-sonnet-4-6'`, and swap the `LlmModels.GPT52` → `LlmModels.GPT54` provider-map entry at line 19 so `getProviderForModel(LlmModels.GPT54)` resolves to `openai`.

- [ ] **Step 2: Run web tests and build**

```bash
pnpm --filter @intexuraos/web run lint
pnpm --filter @intexuraos/web run build
```

Expected: both green. The web app has no coverage requirement (per CLAUDE.md) but typecheck must pass.

- [ ] **Step 3 (optional): Smoke-test the model selector on the dev environment**

After deploying to the dev environment (`dev.intexuraos.cloud` via PM2), navigate to the Research Agent page, open the model dropdown, and confirm you see "Claude Opus 4.6", "Claude Sonnet 4.6", "GPT-5.4". Pick each and confirm the page doesn't throw in the browser console. This step is a manual verification on the dev environment, not a CI gate.

- [ ] **Step 4: Commit**

```bash
git add apps/web/
git commit -m "refactor(web): migrate model selectors to 4.6 and gpt-5.4"
```

### Task 8: Migrate prompt text in llm-prompts

**Files:**
- Modify: `packages/llm-prompts/src/research/modelExtractionPrompt.ts:222,223,225,237,238,245`

- [ ] **Step 1: Read the surrounding context**

These lines are inside a prompt string sent to an LLM. The prompt tells the model which model IDs are valid to emit. If we leave old IDs in the prompt, the extraction step will still emit `claude-opus-4-5-20251101` and the app will blow up at pricing lookup.

- [ ] **Step 2: Replace string occurrences**

Change `'claude-opus-4-5-20251101'` → `'claude-opus-4-6'`, `'claude-sonnet-4-5-20250929'` → `'claude-sonnet-4-6'`, any human-readable labels (`"Claude Opus 4.5"` → `"Claude Opus 4.6"`). Also update the OpenAI-specific `GPT52` wiring: `MODEL_KEYWORDS` (line 225), `PROVIDER_DEFAULT_MODELS` (line 238), and `SYNTHESIS_MODELS` (line 245) — swap `gpt-5.2` → `gpt-5.4` and `GPT52` → `GPT54` references.

- [ ] **Step 3: Run package tests**

```bash
pnpm --filter @intexuraos/llm-prompts test
```

Expected: green. If a snapshot test fails, verify the new snapshot is correct (new model IDs are present) and update with `-u`.

- [ ] **Step 4: Commit**

```bash
git add packages/llm-prompts/
git commit -m "refactor(llm-prompts): update model extraction prompt to reference 4.6 and gpt-5.4 IDs"
```

### Task 9: Migrate remaining test fixtures

**Files:**
- Modify: `packages/llm-pricing/src/__tests__/pricingClient.test.ts:49,71,78,255,291,292,302`
- Modify: `packages/llm-pricing/src/__tests__/testFixtures.test.ts:58,64,76,77,80,124`
- Modify: `packages/llm-pricing/src/__tests__/httpWebhookUsageSink.test.ts:88,153,158` — bare-form `'claude-sonnet-4-5'` literals (no date suffix). Sed pattern for bare form included below.
- Modify: `packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts` — 21 enum + string-literal references across lines 34, 60, 125, 197, 198, 205, 212, 254, 261, 466, 467, 469, 485, 486, 494, 498, 522, 531, 537. Sed handles all.
- Modify: `packages/internal-clients/src/user-service/__tests__/client.test.ts:522,559,638,665`
- Modify: `packages/internal-clients/src/usage-service/__tests__/client.test.ts:275,285`
- Modify: `apps/llm-usage-service/src/__tests__/routes/pricingRoutes.test.ts:75,183` — also asserts `webSearchCostPerCall: 0.03`; sed does not touch numeric literals, so verify manually after the loop and change the two assertions to `0.01` (see Step 2 note below).
- Modify: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts:146`
- Modify: `apps/research-agent/src/infra/notion/__tests__/exportResearchToNotionUseCase.test.ts:258,272` (if still present after Task 5 sed)
- Modify: `packages/llm-contract/src/__tests__/supportedModels.test.ts:33,97,98,133,134,150,158,215,216`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts:4559,4574,4586` — date-suffixed `'claude-sonnet-4-5-20250929'` literals.

- [ ] **Step 1: Mechanical replacement**

Apply the same three substitutions used in Task 5 across these files:

```bash
files=(
  packages/llm-pricing/src/__tests__/pricingClient.test.ts
  packages/llm-pricing/src/__tests__/testFixtures.test.ts
  packages/llm-pricing/src/__tests__/httpWebhookUsageSink.test.ts
  packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts
  packages/internal-clients/src/user-service/__tests__/client.test.ts
  packages/internal-clients/src/usage-service/__tests__/client.test.ts
  apps/llm-usage-service/src/__tests__/routes/pricingRoutes.test.ts
  packages/llm-factory/src/__tests__/llmClientFactory.test.ts
  apps/research-agent/src/infra/notion/__tests__/exportResearchToNotionUseCase.test.ts
  packages/llm-contract/src/__tests__/supportedModels.test.ts
  workers/orchestrator/src/__tests__/task-dispatcher.test.ts
)
for f in "${files[@]}"; do
  sed -i.bak \
    -e 's/LlmModels\.GPT52/LlmModels.GPT54/g' \
    -e 's/LlmModels\.ClaudeSonnet45/LlmModels.ClaudeSonnet46/g' \
    -e 's/LlmModels\.ClaudeOpus45/LlmModels.ClaudeOpus46/g' \
    -e "s/'gpt-5\\.2'/'gpt-5.4'/g" \
    -e "s/'claude-sonnet-4-5-20250929'/'claude-sonnet-4-6'/g" \
    -e "s/'claude-opus-4-5-20251101'/'claude-opus-4-6'/g" \
    -e "s/'claude-sonnet-4-5'/'claude-sonnet-4-6'/g" \
    -e "s/'claude-opus-4-5'/'claude-opus-4-6'/g" \
    "$f"
  rm -f "${f}.bak"
done
```

The two extra patterns at the end handle bare-form literals (no date suffix) found in `httpWebhookUsageSink.test.ts` and various JSDoc examples. Sed runs the longest-match patterns first (they appear first in the list), so `'claude-sonnet-4-5-20250929'` is already handled and only the bare form reaches the bare pattern.

- [ ] **Step 2: Manually fix Anthropic web-search assertion values**

Sed only replaces identifiers; it does NOT touch numeric literals. Update any test that hard-codes `0.03` for Anthropic web-search cost:

```bash
grep -rn "webSearchCostPerCall.*0\.03" apps/llm-usage-service/src/__tests__/ packages/llm-pricing/src/__tests__/ packages/llm-contract/src/__tests__/
```

For each hit, replace `0.03` with `0.01`. Expected locations: `apps/llm-usage-service/src/__tests__/routes/pricingRoutes.test.ts:75,183`. If any hit is NOT for an Anthropic-model assertion, leave it alone and flag in the PR body.

- [ ] **Step 3: Run affected package tests**

```bash
pnpm --filter @intexuraos/llm-pricing test
pnpm --filter @intexuraos/llm-prompts test
pnpm --filter @intexuraos/internal-clients test
pnpm --filter @intexuraos/llm-usage-service test
pnpm --filter @intexuraos/llm-factory test
pnpm --filter @intexuraos/llm-contract test
pnpm --filter @intexuraos/orchestrator test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/ apps/llm-usage-service/ workers/orchestrator/
git commit -m "test: migrate remaining fixtures to 4.6 and gpt-5.4 model IDs"
```

### Task 10: Update scripts

**Files:**
- Modify: `scripts/verify-llm-architecture.ts:33`

- [ ] **Step 1: Swap the enum constant**

Change `LlmModels.GPT52` → `LlmModels.GPT54`, `LlmModels.ClaudeSonnet45` → `LlmModels.ClaudeSonnet46`, `LlmModels.ClaudeOpus45` → `LlmModels.ClaudeOpus46`.

- [ ] **Step 2: Dry-run the script**

```bash
pnpm tsx scripts/verify-llm-architecture.ts
```

Expected: no stderr, exit code 0. If the script asserts all models in the enum have pricing, the assertion passes because Phase 2's migration already added the new rows.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-llm-architecture.ts
git commit -m "chore(scripts): update verify-llm-architecture for 4.6 and gpt-5.4"
```

### Task 11: Update documentation (user-facing + compile-critical only)

**Scope:** User-facing docs (what developers read when onboarding) + agent-facing docs (what Claude reads to operate). Exclude JSDoc inside source files and per-user templates — those don't affect the runtime or documentation build.

**Files to update:**
- `docs/packages/llm-contract/README.md` — lines 29, 33, 34, 49, 50, 52, 71, 72, 74, 75
- `docs/packages/llm-contract/agent.md` — lines 45, 46, 47, 52
- `docs/packages/infra-claude/README.md` — lines 22, 66
- `docs/packages/infra-claude/agent.md` — line 60
- `docs/packages/llm-pricing/README.md` — lines 50, 82
- `docs/services/research-agent/agent.md` — lines 60, 71, 74
- `docs/services/research-agent/tutorial.md` — lines 49, 64, 68, 161
- `docs/services/research-agent/technical.md` — line 340
- `docs/services/research-agent/features.md` — lines 15, 71 (user-facing feature doc; added per 2026-04-13 review)
- `docs/services/app-settings-service/agent.md` — lines 170, 171
- `docs/architecture/ai-architecture.md` — line 413
- `docs/architecture/llm-packages.md` — lines 95, 96, 336, 338, 339 (added per 2026-04-13 review)
- `docs/validation/ai-models-validation.md` — lines 20, 23, 24, 75, 76, 113, 135
- `.claude/agents/llm-manager.md` — lines 140, 371, 372

**Files explicitly EXCLUDED from the sweep (do NOT update):**
- Historical plans under `docs/superpowers/plans/` and `docs/plans/` with date-stamped or `INT-*` filenames.
- `docs/validation/v3.0.0-documentation-run-report.md` and any other `v*.*.*-*` audit logs.
- JSDoc inside `packages/llm-pricing/src/pricingClient.ts`, `packages/llm-pricing/src/usageLogger.ts`, `packages/infra-claude/src/client.ts`, `packages/infra-claude/src/types.ts` — these contain stale-looking bare-form `claude-sonnet-4-5` / `claude-opus-4-5` in example blocks but are not compile-breakers. Scope call per 2026-04-13 review: skip.
- `.claude/skills/linear/templates/pr-description.md` — personal user template containing `Co-Authored-By: Claude Opus 4.5`. Scope call per 2026-04-13 review: skip.
- `docs/services/user-service/**` and `docs/services/image-service/**` — reference `gpt-4o-mini`, which stays.

- [ ] **Step 1: Replace model IDs and human names**

For each doc file in the list above, replace:
- `claude-opus-4-5-20251101` → `claude-opus-4-6`
- `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6`
- `gpt-5.2` → `gpt-5.4`
- `Claude Opus 4.5` (human name) → `Claude Opus 4.6`
- `Claude Sonnet 4.5` (human name) → `Claude Sonnet 4.6`
- `GPT-5.2` → `GPT-5.4`

Leave `gpt-4o-mini` and `GPT-4o Mini` alone throughout.

- [ ] **Step 2: Review the diff for semantic correctness**

```bash
git diff --stat
git diff docs/packages/infra-claude/README.md
git diff .claude/agents/llm-manager.md
```

Spot-check: make sure you haven't corrupted model-count statements like "14 models" — adding then removing three doesn't change the count, but inline prose like "the 3 Anthropic models" may need to stay if we still have 3 Anthropic models (Haiku + Sonnet 4.6 + Opus 4.6 = still 3).

- [ ] **Step 3: Commit**

```bash
git add docs/ .claude/agents/llm-manager.md
git commit -m "docs: update model references to 4.6 and gpt-5.4"
```

---

## Phase 4: Remove Old Identifiers

With every call site migrated and all tests green, we can now delete the old identifiers. The Firestore old-model rows were already removed by migration 093, so there's no DB work left.

### Task 12: Remove old branded types and const entries

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/__tests__/fixtures/pricing.ts`
- Modify: `packages/llm-pricing/src/testFixtures.ts` — NOT in `__tests__/`; this is a shipped source file re-exported from the package (used by test harnesses in downstream packages). Must strip old enum references at lines 73, 76, 77 or `pnpm run ci:tracked` fails to compile `llm-pricing`.

- [ ] **Step 1: Verify no remaining references**

```bash
grep -rn "LlmModels.GPT52\|LlmModels.ClaudeSonnet45\|LlmModels.ClaudeOpus45\|'gpt-5\.2'\|'claude-sonnet-4-5-20250929'\|'claude-opus-4-5-20251101'" \
  --include="*.ts" --include="*.tsx" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir="docs/plans" --exclude-dir="docs/superpowers/plans" \
  --exclude-dir="docs/validation"
```

Expected output: zero hits. If any hits come back outside the historical-plan exclusions, address them before proceeding. Pay special attention to `packages/llm-pricing/src/testFixtures.ts` — Phase 3 did not touch it; Step 6 below handles it.

- [ ] **Step 2: Remove type aliases**

In `packages/llm-contract/src/supportedModels.ts` delete:
- Line 36: `export type GPT52 = 'gpt-5.2';`
- Line 44: `export type ClaudeOpus45 = 'claude-opus-4-5-20251101';`
- Line 45: `export type ClaudeSonnet45 = 'claude-sonnet-4-5-20250929';`

- [ ] **Step 3: Remove const entries**

Delete these lines from `LlmModels`:
- `GPT52: 'gpt-5.2' as GPT52,`
- `ClaudeOpus45: 'claude-opus-4-5-20251101' as ClaudeOpus45,`
- `ClaudeSonnet45: 'claude-sonnet-4-5-20250929' as ClaudeSonnet45,`

- [ ] **Step 4: Remove from unions**

Remove `| GPT52` from `ResearchModel` and `GenericModel` and `LLMModel`. Remove `| ClaudeOpus45` and `| ClaudeSonnet45` from `ResearchModel` and `LLMModel`. Update the `// Anthropic (N models)` comment back to `(3 models)`.

- [ ] **Step 5: Remove from runtime arrays and map**

Delete the three old entries from `ALL_LLM_MODELS` (lines previously at 186, 190, 191) and from `MODEL_PROVIDER_MAP` (lines previously at 224, 228, 229).

- [ ] **Step 6: Remove from test fixtures (both files)**

In `packages/llm-contract/src/__tests__/fixtures/pricing.ts`, delete the three old-model entries: `'gpt-5.2': { ... }`, `'claude-opus-4-5-20251101': { ... }`, `'claude-sonnet-4-5-20250929': { ... }`.

In `packages/llm-pricing/src/testFixtures.ts` (shipped source — NOT under `__tests__/`), replace `LlmModels.GPT52` → `LlmModels.GPT54`, `LlmModels.ClaudeOpus45` → `LlmModels.ClaudeOpus46`, `LlmModels.ClaudeSonnet45` → `LlmModels.ClaudeSonnet46` at lines 73, 76, 77. This file is re-exported from the package index so downstream test harnesses can import it; its content must stay valid TypeScript against the post-migration enum.

- [ ] **Step 7: Run the full workspace verification**

```bash
pnpm run ci:tracked
```

Expected: PASSED. Any failure means something wasn't migrated in Phase 3. Do not suppress — fix the root cause.

- [ ] **Step 8: Commit**

```bash
git add packages/llm-contract/ packages/llm-pricing/
git commit -m "refactor(llm-contract): remove gpt-5.2, claude-sonnet-4-5, claude-opus-4-5 identifiers"
```

---

## Final Verification

- [ ] **Step 1: Run full CI locally**

```bash
pnpm run ci:tracked | tee /tmp/ci-output-$(date +%s).txt
```

Every workspace must pass. Any red is a blocker.

- [ ] **Step 2: Confirm Firestore state matches code**

```bash
gcloud firestore documents describe llm_pricing/openai --project=intexuraos-dev-pbuchman --format=json | jq '.fields.models.mapValue.fields | keys'
gcloud firestore documents describe llm_pricing/anthropic --project=intexuraos-dev-pbuchman --format=json | jq '.fields.models.mapValue.fields | keys'
```

Expected: matches the `ALL_LLM_MODELS` list in `supportedModels.ts` (for OpenAI and Anthropic providers respectively).

- [ ] **Step 3: Smoke-test dev environment**

Open `https://dev.intexuraos.cloud`, pick the Research Agent, run one research task with each new model, confirm the cost is logged in the LLM Usage page. Cost per research should be non-zero and roughly match a hand calculation from the published prices.

- [ ] **Step 4: Open PR**

PR title: `[INT-1355] Migrate LLM model IDs to 4.6/5.4 and fix Anthropic web-search fee`. PR body includes:
- `Fixes INT-1355` (issue created 2026-04-13 at https://linear.app/pbuchman/issue/INT-1355).
- Link to the OpenAI pricing snapshot captured in Pre-Flight Step 3.
- Explicit callout: "Anthropic web-search fee corrected from $0.03 to $0.01 per call — ~3× overcharge on all Claude web-search operations since migration 002. Back-billing not part of this PR."
- Target branch: `development`.

---

## Out of Scope (tracked separately)

- OpenRouter billing fix (critical audit finding: `useProviderCost: true` but client never extracts cost — every request bills $0). Requires client code changes; separate issue.
- `text-embedding-3-small` usage tracking (no `usageSink`, no pricing). Requires new feature wiring; separate issue.
- Gemini image pricing correction ($0.030 → $0.039). Pure Firestore change; bundle with next pricing migration.
- Anthropic 1-hour cache-write tier coverage (code reads `cache_creation_input_tokens` as 5m only). Requires infra-claude client change; separate issue.
- Gemini cache-read pricing extraction (`cachedContentTokenCount` never read). Requires infra-gemini client change; separate issue.
- Pricing-source-of-truth deduplication (5 places hold Gemini Flash price). Big blast radius; separate plan.

---

## Self-Review

**Spec coverage.** The user's scope as given: (a) fix "more simplified" critical issues — covered by the Anthropic web-search fee fix ($0.03 → $0.01) and the gpt-5.4 web-search fee addition baked into migration 093; (b) migrate gpt-5.2 → gpt-5.4 — covered in Phases 1-4; (c) migrate sonnet/opus 4.5 → 4.6 — covered in Phases 1-4. Explicit exclusion: gpt-4o-mini removal — honored, every mention of gpt-4o-mini is in the "NOT modified" list. Linear ticket INT-1355 created 2026-04-13 and referenced in Task 0 (branch) and Task 12 Step 4 (PR).

**Placeholder scan.** No TODOs remain. `gpt-5.4` pricing (input $2.50, output $15.00, cacheReadMultiplier 0.1, webSearchCostPerCall $0.01) was verified against the OpenAI pricing page on 2026-04-13 and hard-coded into Task 2 Step 3 and Task 3 Step 1. Long-context tiered pricing ($5.00/$22.50) is explicitly out of scope — see Out of Scope.

**Type consistency.** `GPT54` / `ClaudeOpus46` / `ClaudeSonnet46` naming is consistent from Task 1 Step 3 through Task 12 Step 2. The `.toBe('gpt-5.4')` / `.toBe('claude-opus-4-6')` / `.toBe('claude-sonnet-4-6')` assertions match the const definitions. `MODEL_PROVIDER_MAP` additions in Task 1 Step 8 match the union additions in Step 5. The migration in Task 3 writes to the same model-ID strings the fixture uses in Task 2.

**Post-review fixes applied (2026-04-13).** Code-reviewer subagent audit flagged 4 Critical and 5 Important issues. All resolved in-plan:
- **Critical #1 (dual-write).** Task 3 Step 1 rewritten to write ONLY to `llm_pricing/{provider}`. Verified against `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts:5-18` (reads only the flat path) and `migrations/089_delete_old_pricing_source.mjs` (marks the nested path `_deprecated: true`).
- **Critical #2 (missing test file).** `packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts` added to Task 9's sed loop.
- **Critical #3 (missing source file).** `packages/llm-pricing/src/testFixtures.ts` added to Task 12 Step 6.
- **Critical #4 (protected branch).** Task 0 added at the start of Phase 1 to create `pbuchman/INT-1355/llm-model-migration-and-pricing-fixes` off `development`.
- **Important #6–7.** `httpWebhookUsageSink.test.ts`, `task-dispatcher.test.ts`, `docs/architecture/llm-packages.md`, `docs/services/research-agent/features.md` added. JSDoc bare-form refs and the personal linear template explicitly excluded per user scope decision.
- **Important #9 (compound steps).** Kept as-is where each task maps to a single subagent dispatch unit (sed loops, doc sweeps). Per user coordination model: plan is the dispatch contract, implementer subagents own intra-task sequencing.
