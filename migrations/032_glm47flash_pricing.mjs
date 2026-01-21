/**
 * Migration 032: Add GLM-4.7-Flash Pricing
 *
 * Adds GLM-4.7-Flash as a free model to Zai AI provider.
 * Pricing based on official Zai AI documentation:
 * - Input: $0 per million tokens (free)
 * - Output: $0 per million tokens (free)
 * - Web search: $0 per call (free)
 */

export const metadata = {
  id: '032',
  name: 'glm47flash-pricing',
  description: 'Add GLM-4.7-Flash pricing (free model)',
  createdAt: '2026-01-21',
};

export async function up(context) {
  console.log('  Adding GLM-4.7-Flash pricing to settings/llm_pricing/providers/zai...');

  const zaiDoc = context.firestore.doc('settings/llm_pricing/providers/zai');
  const zaiSnapshot = await zaiDoc.get();

  if (!zaiSnapshot.exists) {
    throw new Error('Zai provider document does not exist. Run migration 024 first.');
  }

  const existingData = zaiSnapshot.data();

  // Add glm-4.7-flash to existing models
  const updatedModels = {
    ...existingData.models,
    'glm-4.7-flash': {
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      webSearchCostPerCall: 0,
    },
  };

  await zaiDoc.update({
    models: updatedModels,
    updatedAt: new Date().toISOString(),
  });

  console.log('  Added GLM-4.7-Flash pricing (free model)');
}
