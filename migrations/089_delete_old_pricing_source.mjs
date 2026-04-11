/**
 * Migration 087: Mark old pricing source docs as deprecated.
 *
 * Now that llm-usage-service owns pricing and all consumers have been migrated,
 * the source collection is no longer authoritative. We add a deprecation marker
 * instead of deleting, so that a rollback of the endpoint code still has backing
 * data available. Deletion deferred to a follow-up track once the UI move (Track 5)
 * has landed cleanly.
 *
 * Source (deprecated): settings/llm_pricing/providers/{provider}
 * Providers: google, openai, anthropic, perplexity, openrouter
 */

export const metadata = {
  id: '089',
  name: 'deprecate_old_pricing_source',
  description: 'Mark settings/llm_pricing/providers/* as deprecated (data preserved for rollback)',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const providers = ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'];
  const batch = context.firestore.batch();
  const now = new Date().toISOString();

  for (const p of providers) {
    const ref = context.firestore.doc(`settings/llm_pricing/providers/${p}`);
    const snap = await ref.get();
    if (snap.exists) {
      batch.update(ref, {
        _deprecated: true,
        _deprecatedAt: now,
        _deprecationNote: 'Pricing ownership moved to llm-usage-service (INT-1339)',
      });
    }
  }

  await batch.commit();
  console.log(
    `  Marked ${String(providers.length)} old pricing docs as deprecated in settings/llm_pricing/providers/*`
  );
}
