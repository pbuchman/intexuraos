/**
 * Migration 024: Add GLM-4.7 Pricing for Zai AI
 * Cache-bust: 2026-01-13T14:00:00Z
 *
 * Adds Zai AI as a new LLM provider with GLM-4.7 model.
 * Pricing based on official Zai AI documentation:
 * - Input: $0.60 per million tokens
 * - Output: $2.20 per million tokens
 * - Web search: $0.005 per call
 */

export const metadata = {
  id: '024',
  name: 'glm47-pricing',
  description: 'Add GLM-4.7 pricing for Zai AI',
  createdAt: '2026-01-13',
};

export async function up(context) {
  console.log('  Creating Zai/GLM pricing in settings/llm_pricing/providers/zai...');

  const timestamp = new Date().toISOString();

  // Zai provider
  const zaiPricing = {
    provider: 'zai',
    models: {
      'glm-4.7': {
        inputPricePerMillion: 0.6,
        outputPricePerMillion: 2.2,
        webSearchCostPerCall: 0.005,
      },
    },
    updatedAt: timestamp,
  };

  // Create document at: settings/llm_pricing/providers/zai
  const batch = context.firestore.batch();
  batch.set(context.firestore.doc('settings/llm_pricing/providers/zai'), zaiPricing);
  await batch.commit();

  console.log('  Created pricing document for zai:');
  console.log(`    - zai: ${Object.keys(zaiPricing.models).length} model`);
}
