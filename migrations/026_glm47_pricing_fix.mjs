/**
 * Migration 026: Fix GLM-4.7 Pricing for Zai AI
 * Cache-bust: 2026-01-13T15:00:00Z
 *
 * Corrects GLM-4.7 pricing based on official Z.ai documentation:
 * https://docs.z.ai/guides/overview/pricing
 *
 * Changes from migration 024:
 * - webSearchCostPerCall: $0.005 → $0.01 (corrected to official price)
 * - cacheReadPricePerMillion: $0.11 added (was missing)
 *
 * Official pricing as of 2026-01-13:
 * - Input: $0.60 per million tokens
 * - Output: $2.20 per million tokens
 * - Cached input: $0.11 per million tokens
 * - Web search: $0.01 per call
 */

export const metadata = {
  id: '026',
  name: 'glm47-pricing-fix',
  description: 'Fix GLM-4.7 web search and add cached input pricing',
  createdAt: '2026-01-13',
};

export async function up(context) {
  console.log('  Fixing Zai/GLM pricing in settings/llm_pricing/providers/zai...');

  const timestamp = new Date().toISOString();

  // Zai provider with corrected pricing
  const zaiPricing = {
    provider: 'zai',
    models: {
      'glm-4.7': {
        inputPricePerMillion: 0.6,
        outputPricePerMillion: 2.2,
        cacheReadPricePerMillion: 0.11,
        webSearchCostPerCall: 0.01,
      },
    },
    updatedAt: timestamp,
  };

  // Use set() to replace entire provider document
  await context.firestore.doc('settings/llm_pricing/providers/zai').set(zaiPricing);

  console.log('  Fixed pricing document for zai:');
  console.log(`    - glm-4.7: webSearchCostPerCall $0.005 → $0.01`);
  console.log(`    - glm-4.7: cacheReadPricePerMillion added at $0.11`);
}

/**
 * Revert to previous pricing from migration 024
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
export async function down(context) {
  console.log('  Reverting GLM-4.7 pricing to migration 024 values...');

  const timestamp = new Date().toISOString();

  const zaiPricing = {
    provider: 'zai',
    models: {
      'glm-4.7': {
        inputPricePerMillion: 0.6,
        outputPricePerMillion: 2.2,
        cacheReadPricePerMillion: 0.11,
        webSearchCostPerCall: 0.005,
      },
    },
    updatedAt: timestamp,
  };

  await context.firestore.doc('settings/llm_pricing/providers/zai').set(zaiPricing);
}
