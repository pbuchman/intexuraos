/**
 * Migration 006: Image Generation Pricing
 *
 * Adds pricing for image generation models:
 * - openai_gpt-image-1: $0.04 per 1024x1024 image
 * - google_gemini-2.5-flash-image: $0.03 per image
 *
 * Note: Image models use imagePricePerUnit instead of token-based pricing.
 *
 * Sources:
 * - https://openai.com/api/pricing
 * - https://ai.google.dev/gemini-api/docs/pricing
 */

export const metadata = {
  id: '006',
  name: 'image-generation-pricing',
  description: 'Add image generation model pricing',
  createdAt: '2026-01-04',
};

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
  console.log('  Adding image generation pricing...');

  const pricingUpdate = {
    'models.openai_gpt-image-1': createImagePricingEntry('openai', 'gpt-image-1', 0.04),
    'models.google_gemini-2.5-flash-image': createImagePricingEntry(
      'google',
      'gemini-2.5-flash-image',
      0.03
    ),
    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  console.log('  Image generation pricing added for 2 models');
}
