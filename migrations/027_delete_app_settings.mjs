/**
 * Migration 027: Delete app_settings collection
 * Cache-bust: 2026-01-14T01:00:00Z
 *
 * Research-agent no longer reads pricing from Firestore's app_settings/llm_pricing.
 * Pricing is now fetched from app-settings-service via HTTP API.
 * This migration cleans up the orphaned collection to reduce storage costs.
 */

export const metadata = {
  id: '027',
  name: 'delete-app-settings',
  description: 'Delete app_settings collection (legacy pricing data)',
  createdAt: '2026-01-14',
};

/**
 * Delete all documents in app_settings collection
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
export async function up(context) {
  console.log('  Deleting app_settings collection...');

  const collection = context.firestore.collection('app_settings');
  const snapshot = await collection.listDocuments();

  if (snapshot.length === 0) {
    console.log('  app_settings collection already empty');
    return;
  }

  const deletePromises = snapshot.map((doc) => doc.delete());
  await Promise.all(deletePromises);

  console.log(`  Deleted ${snapshot.length} documents from app_settings`);
}

/**
 * No-op - app_settings was only used for legacy pricing
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} _context
 */
export async function down(_context) {
  // No rollback - pricing data comes from app-settings-service
}
