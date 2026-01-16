/**
 * Migration 029: Delete commands with 'unclassified' classification type
 *
 * The 'unclassified' type has been removed from the codebase.
 * Commands now fall back to 'note' type instead.
 * This migration cleans up any legacy 'unclassified' commands.
 */

export const metadata = {
  id: '029',
  name: 'delete-unclassified-commands',
  description: 'Delete commands with classification.type === unclassified',
  createdAt: '2026-01-16',
};

/**
 * Delete all commands with 'unclassified' classification type
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
export async function up(context) {
  console.log('  Querying for commands with unclassified type...');

  const collection = context.firestore.collection('commands');
  const snapshot = await collection.where('classification.type', '==', 'unclassified').get();

  if (snapshot.empty) {
    console.log('  No unclassified commands found');
    return;
  }

  const deletePromises = snapshot.docs.map((doc) => doc.ref.delete());
  await Promise.all(deletePromises);

  console.log(`  Deleted ${snapshot.size} unclassified commands`);
}

/**
 * No-op - unclassified commands should not be restored
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} _context
 */
export async function down(_context) {
  // No rollback - unclassified type no longer exists
}
