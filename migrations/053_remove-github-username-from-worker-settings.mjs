/**
 * Migration 053: Remove githubUsername field from worker_settings documents
 *
 * This field is replaced by GitHub OAuth connections in oauth_connections collection.
 * Stream E: GitHub OAuth feature requires removing legacy username storage.
 */

import { FieldValue } from 'firebase-admin/firestore';

export const metadata = {
  id: '053',
  name: 'remove-github-username-from-worker-settings',
  description: 'Remove githubUsername field from all worker_settings documents',
  createdAt: '2026-03-02',
};

export async function up(context) {
  const db = context.firestore;

  const snapshot = await db.collection('worker_settings').get();

  console.log(`  Found ${snapshot.size} worker_settings documents`);

  if (snapshot.size === 0) {
    console.log('  No documents to process.');
    return;
  }

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let docsProcessed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.githubUsername !== undefined) {
      // Use FieldValue.delete() to remove the field
      batch.update(doc.ref, { githubUsername: FieldValue.delete() });
      count++;

      if (count % BATCH_SIZE === 0) {
        await batch.commit();
        console.log(`  Committed batch of ${BATCH_SIZE} (${count} documents modified)`);
        batch = db.batch();
      }
    }

    docsProcessed++;
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit();
  }

  console.log(`  Migration complete: ${count} documents modified out of ${docsProcessed} checked`);

  return { documentsModified: count };
}

export async function down() {
  console.log(
    '  Reverting githubUsername removal requires manual restoration via Firebase console or backup'
  );
}
