/**
 * Migration 024: Add GLM-4.7 Pricing for Zhipu AI
 * Cache-bust: 2026-01-13T14:00:00Z
 *
 * Adds Zhipu AI as a new LLM provider with GLM-4.7 model.
 * Pricing based on official Zhipu AI documentation:
 * - Input: $0.60 per million tokens
 * - Output: $2.20 per million tokens
 * - Web search: $0.005 per call
 */

export const metadata = {
  id: '024',
  name: 'glm47-pricing',
  description: 'Add GLM-4.7 pricing for Zhipu AI',
  createdAt: '2026-01-13',
};

export async function up(context) {
  console.log('  Creating Zhipu/GLM pricing in settings/llm_pricing/providers/zhipu...');

  const timestamp = new Date().toISOString();

  // Zhipu provider
  const zhipuPricing = {
    provider: 'zhipu',
    models: {
      'glm-4.7': {
        inputPricePerMillion: 0.6,
        outputPricePerMillion: 2.2,
        webSearchCostPerCall: 0.005,
      },
    },
    updatedAt: timestamp,
  };

  // Create document at: settings/llm_pricing/providers/zhipu
  const batch = context.firestore.batch();
  batch.set(context.firestore.doc('settings/llm_pricing/providers/zhipu'), zhipuPricing);
  await batch.commit();

  console.log('  Created pricing document for zhipu:');
  console.log(`    - zhipu: ${Object.keys(zhipuPricing.models).length} model`);
}
