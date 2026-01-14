/**
 * Migration 026: Fix GLM-4.7 Pricing for Zhipu AI
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
  console.log('  Fixing Zhipu/GLM pricing in settings/llm_pricing/providers/zhipu...');

  const timestamp = new Date().toISOString();

  // Zhipu provider with corrected pricing
  const zhipuPricing = {
    provider: 'zhipu',
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
  await context.firestore.doc('settings/llm_pricing/providers/zhipu').set(zhipuPricing);

  console.log('  Fixed pricing document for zhipu:');
  console.log(`    - glm-4.7: webSearchCostPerCall $0.005 → $0.01`);
  console.log(`    - glm-4.7: cacheReadPricePerMillion added at $0.11`);
}
