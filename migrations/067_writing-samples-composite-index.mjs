/**
 * Migration 067: Composite index for writing_samples subcollection
 *
 * Required for:
 * - listSamples: category equality filter + createdAt ascending sort
 *   Path: hellscript_writing_config/{userId}/writing_samples
 */

export const metadata = {
  id: '067',
  name: 'writing-samples-composite-index',
  description: 'Composite index for writing_samples subcollection (category + createdAt)',
  createdAt: '2026-03-22',
};

export const indexes = [
  {
    collectionGroup: 'writing_samples',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'category', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['hellscript_writing_config'];

export async function up(context) {
  console.log('  Deploying writing-samples composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing writing-samples index requires manual deletion via Firebase console');
}
