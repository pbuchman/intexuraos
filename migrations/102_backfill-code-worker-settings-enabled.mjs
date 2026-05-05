/**
 * Migration 102: Backfill code worker enabled fields
 *
 * Existing code_worker_settings documents may have worker objects created
 * before the enabled flag existed. Backfill missing values to true while
 * preserving explicit false values.
 */

export const metadata = {
  id: '102',
  name: 'backfill-code-worker-settings-enabled',
  description: 'Backfill missing code worker enabled fields to true',
  createdAt: '2026-05-05',
};

const COLLECTION_NAME = 'code_worker_settings';

export async function up(context) {
  console.log('  Backfilling missing code worker enabled fields...');

  const snapshot = await context.firestore.collection(COLLECTION_NAME).get();
  let updatedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!Array.isArray(data.workers)) {
      continue;
    }

    let changed = false;
    const workers = data.workers.map((worker) => {
      if (worker.enabled !== undefined) {
        return worker;
      }
      changed = true;
      return {
        ...worker,
        enabled: true,
      };
    });

    if (!changed) {
      continue;
    }

    await context.firestore.collection(COLLECTION_NAME).doc(doc.id).update({
      workers,
      updatedAt: new Date().toISOString(),
    });
    updatedCount += 1;
  }

  console.log(`  Backfilled ${String(updatedCount)} code worker settings document(s).`);
}
