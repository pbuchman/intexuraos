/**
 * Migration 027: Delete app_settings collection
 *
 * Research-agent no longer reads pricing from Firestore's app_settings/llm_pricing.
 * Pricing is now fetched from app-settings-service via HTTP API.
 * This migration cleans up the orphaned collection to reduce storage costs.
 */

export const id = '027_delete_app_settings';

/**
 * Delete all documents in app_settings collection
 * @param {import('@google-cloud/firestore').Firestore} db
 */
export async function up(db) {
  const collection = db.collection('app_settings');
  const snapshot = await collection.listDocuments();

  const deletePromises = snapshot.map((doc) => doc.delete());
  await Promise.all(deletePromises);
}

/**
 * No-op - app_settings was only used for legacy pricing
 * @param {import('@google-cloud/firestore').Firestore} db
 */
export async function down(_db) {
  // No rollback - pricing data comes from app-settings-service
}
