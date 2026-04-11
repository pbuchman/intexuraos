/**
 * Migration 088: Copy LLM pricing from app-settings-service to llm-usage-service.
 *
 * Source: settings/llm_pricing/providers/{provider}     (owner: app-settings-service)
 * Target: llm_pricing/{provider}                         (owner: llm-usage-service)
 *
 * Providers: google, openai, anthropic, perplexity, openrouter (zai dropped)
 *
 * Idempotent: re-running this is safe. Overwrites the target doc with the
 * source doc each time.
 */

export const metadata = {
  id: '088',
  name: 'migrate_pricing_to_llm_usage_service',
  description: 'Copy LLM pricing into the new llm_pricing collection owned by llm-usage-service',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const providers = ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'];
  const batch = context.firestore.batch();
  let copied = 0;

  for (const p of providers) {
    const srcSnap = await context.firestore.doc(`settings/llm_pricing/providers/${p}`).get();

    if (!srcSnap.exists) {
      // OpenRouter may not have been in the original pricing collection.
      // Skip gracefully rather than throwing — Track 4 decision doc allows this.
      if (p === 'openrouter') {
        console.log(`  Skipping ${p} (not present in source collection)`);
        continue;
      }
      throw new Error(`Source pricing missing for provider: ${p}`);
    }

    batch.set(context.firestore.doc(`llm_pricing/${p}`), srcSnap.data());
    copied++;
  }

  await batch.commit();
  console.log(`  Copied ${String(copied)} provider pricing docs to llm_pricing/*`);
}
