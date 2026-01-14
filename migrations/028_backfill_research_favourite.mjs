/**
 * Migration 028: Backfill favourite field for researches
 *
 * The research list query filters by favourite === true and favourite === false.
 * Firestore's where('favourite', '==', false) does NOT match documents without the field.
 * This migration ensures all existing researches have favourite: false as default.
 */

export const metadata = {
  id: '028',
  name: 'backfill-research-favourite',
  description: 'Set favourite: false for researches missing the field',
  createdAt: '2026-01-14',
};

export const indexes = [];

export const rules = {};

/**
 * Backfill favourite: false for all researches without the field
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
export async function up(context) {
  console.log('  Backfilling favourite field for researches...');

  const collection = context.firestore.collection('researches');
  const snapshot = await collection.get();

  let updatedCount = 0;
  const batchSize = 100;

  for (let i = 0; i < snapshot.docs.length; i += batchSize) {
    const batch = context.firestore.batch();
    let batchCount = 0;

    for (let j = i; j < Math.min(i + batchSize, snapshot.docs.length); j++) {
      const doc = snapshot.docs[j];
      const data = doc.data();

      // Only update if favourite field is missing
      if (data.favourite === undefined) {
        batch.update(doc.ref, { favourite: false });
        batchCount++;
        updatedCount++;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
      console.log(`  Updated batch of ${batchCount} documents`);
    }
  }

  console.log(`  Backfilled favourite: false for ${updatedCount} researches`);
}

/**
 * No-op - removing the field would cause the same issue
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} _context
 */
export async function down(_context) {
  // No rollback
}
