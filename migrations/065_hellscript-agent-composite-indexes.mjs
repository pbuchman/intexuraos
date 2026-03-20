/**
 * Migration 065: Composite indexes for hellscript-agent service
 *
 * Required for:
 * - listBuffers: userId + updatedAt desc
 * - getEvents: bufferId subcollection ordered by createdAt asc
 * - getDraftVersions: bufferId subcollection ordered by versionNumber desc
 */

export const metadata = {
  id: '065',
  name: 'hellscript-agent-composite-indexes',
  description: 'Composite indexes for hellscript_buffers collection',
  createdAt: '2026-03-20',
};

export const indexes = [
  {
    collectionGroup: 'hellscript_buffers',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['hellscript_buffers'];

export async function up(context) {
  console.log('  Deploying hellscript-agent composite indexes...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log('  Removing hellscript-agent indexes requires manual deletion via Firebase console');
}
