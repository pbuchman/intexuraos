export const metadata = {
  id: '044',
  name: 'linear-comments-index',
  description: 'Composite index for linear_issue_comments (issueId + createdAt)',
  createdAt: '2026-02-08',
};

export const indexes = [
  {
    collectionGroup: 'linear_issue_comments',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'issueId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying linear_issue_comments index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing index requires manual deletion via Firebase console');
}
