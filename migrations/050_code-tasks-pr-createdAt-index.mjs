/**
 * Migration 050: Composite index for code_tasks findByPR query ordering
 *
 * The findByPR query needs to return the latest task for a given PR,
 * which requires ordering by createdAt descending after filtering by
 * repository and prNumber.
 *
 * Query: where('repository', '==', repo).where('prNumber', '==', pr).orderBy('createdAt', 'desc').limit(1)
 */

export const metadata = {
  id: '050',
  name: 'code-tasks-pr-createdAt-index',
  description: 'Composite index for code_tasks findByPR with createdAt ordering',
  createdAt: '2026-02-20',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'prNumber', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks PR+createdAt composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing code_tasks PR+createdAt index requires manual deletion via Firebase console'
  );
}
