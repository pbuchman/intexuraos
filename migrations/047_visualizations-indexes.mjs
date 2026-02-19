export const metadata = {
  id: '047',
  name: 'visualizations-indexes',
  description: 'Composite indexes for visualizations (userId+createdAt, feedId+createdAt)',
  createdAt: '2026-02-17',
};

export const indexes = [
  {
    collectionGroup: 'visualizations',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'visualizations',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'feedId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying visualizations indexes...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
