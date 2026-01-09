/**
 * Migration 013: Remove DALL-E 3 Pricing
 *
 * Removes dall-e-3 pricing entry from the old app_settings/llm_pricing document.
 * DALL-E 3 has been fully replaced by gpt-image-1 in all clients.
 *
 * Note: The new pricing structure (settings/llm_pricing/{provider}) in migration 012
 * already does NOT include dall-e-3, only gpt-image-1.
 */

import { FieldValue } from 'firebase-admin/firestore';

export const metadata = {
  id: '013',
  name: 'remove-dalle3-pricing',
  description: 'Remove DALL-E 3 pricing - exclusively using gpt-image-1 for OpenAI images',
  createdAt: '2026-01-06',
};

export async function up(context) {
  console.log('  Removing DALL-E 3 pricing from legacy app_settings/llm_pricing...');

  const docRef = context.firestore.collection('app_settings').doc('llm_pricing');
  const doc = await docRef.get();

  if (!doc.exists) {
    console.log('  ℹ️  Legacy llm_pricing document does not exist - skipping');
    return;
  }

  const data = doc.data();
  const dalleKey = 'openai_dall-e-3';

  if (!data.models || !data.models[dalleKey]) {
    console.log('  ℹ️  DALL-E 3 pricing entry not found - nothing to remove');
    return;
  }

  await docRef.update({
    [`models.${dalleKey}`]: FieldValue.delete(),
    updatedAt: new Date().toISOString(),
  });

  console.log('  ✅ Removed DALL-E 3 pricing entry');
  console.log('     OpenAI image model: gpt-image-1 (only supported model)');
}
