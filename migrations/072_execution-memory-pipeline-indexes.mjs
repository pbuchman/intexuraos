export const metadata = {
  id: '072',
  name: 'execution-memory-pipeline-indexes',
  description: 'Add composite indexes for execution memory backlog processing',
  createdAt: '2026-03-25',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'agentType', order: 'ASCENDING' },
      { fieldPath: 'executionMemoryPostRun.status', order: 'ASCENDING' },
      { fieldPath: 'completedAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying execution memory backlog indexes...');
  await context.deployIndexes();
}
