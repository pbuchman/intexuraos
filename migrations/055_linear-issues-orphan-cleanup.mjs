/**
 * Migration 055: Clean up orphaned linear_issues documents
 *
 * Before INT-623, linear_issues documents used `{issueId}` as the document key.
 * After INT-623, documents use composite keys `{userId}_{issueId}`.
 *
 * After fullSyncAllUsers repopulates with composite-keyed documents, the old
 * `{issueId}`-keyed documents persist and appear in field queries (where userId == ...)
 * alongside new docs — causing duplicate entries.
 *
 * This migration identifies orphaned documents where doc.id === doc.data().id
 * (old format) and deletes them. Composite-keyed documents have
 * doc.id === `${userId}_${issueId}`, so doc.id !== doc.data().id.
 *
 * IMPORTANT: Run fullSyncAllUsers BEFORE this migration to ensure all issues
 * are re-synced with composite keys. Otherwise, deletion removes the only copy.
 */

export const metadata = {
  id: '055',
  name: 'linear-issues-orphan-cleanup',
  description:
    'Delete old-format linear_issues documents keyed by issueId alone (without userId prefix)',
  createdAt: '2026-03-03',
};

/**
 * Delete orphaned linear_issues documents with old key format
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
export async function up(context) {
  const BATCH_SIZE = 500;
  const collection = context.firestore.collection('linear_issues');

  console.log('  Scanning linear_issues for orphaned documents (old key format)...');

  const snapshot = await collection.get();

  if (snapshot.empty) {
    console.log('  No documents found in linear_issues');
    return;
  }

  // Identify orphaned docs: doc.id === doc.data().id means old format
  // Composite-keyed docs have doc.id === `${userId}_${issueId}` !== doc.data().id
  const orphanedDocs = snapshot.docs.filter((doc) => {
    const data = doc.data();
    return doc.id === data.id;
  });

  if (orphanedDocs.length === 0) {
    console.log(
      `  No orphaned documents found (${snapshot.size} total documents all use composite keys)`
    );
    return;
  }

  console.log(`  Found ${orphanedDocs.length} orphaned documents out of ${snapshot.size} total`);

  // Delete in batches to avoid Firestore write limits
  for (let i = 0; i < orphanedDocs.length; i += BATCH_SIZE) {
    const batch = context.firestore.batch();
    const batchDocs = orphanedDocs.slice(i, i + BATCH_SIZE);

    for (const doc of batchDocs) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchDocs.length} documents`);
  }

  console.log(`  Cleanup complete: deleted ${orphanedDocs.length} orphaned documents`);
}

/**
 * No-op - orphaned documents should not be restored
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} _context
 */
export async function down(_context) {
  // No rollback - orphaned documents are duplicates of composite-keyed versions
}
