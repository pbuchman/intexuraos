/**
 * Migration 094: Migrate model identifiers and fix Anthropic web-search fee
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
  id: '094',
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
    throw new Error('Migration 094: llm_pricing/openai document missing');
  }
  if (!anthropicSnap.exists) {
    throw new Error('Migration 094: llm_pricing/anthropic document missing');
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
