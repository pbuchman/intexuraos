/**
 * Migration 087: Delete the old pricing source docs from app-settings-service.
 *
 * Now that llm-usage-service owns pricing and all consumers have been migrated,
 * the source collection is no longer needed.
 *
 * Source (deleted): settings/llm_pricing/providers/{provider}
 * Providers: google, openai, anthropic, perplexity, openrouter
 */

export const metadata = {
  id: '087',
  name: 'delete_old_pricing_source',
  description:
    'Delete settings/llm_pricing/providers/* (app-settings-service no longer owns pricing)',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const providers = ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'];
  const batch = context.firestore.batch();

  for (const p of providers) {
    batch.delete(context.firestore.doc(`settings/llm_pricing/providers/${p}`));
  }

  await batch.commit();
  console.log(
    `  Deleted ${String(providers.length)} old pricing docs from settings/llm_pricing/providers/*`
  );
}
