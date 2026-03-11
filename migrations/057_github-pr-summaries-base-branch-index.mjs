/**
 * Migration 057: Composite index for open PR summaries by repository/base branch
 *
 * Required for findOpenByBaseBranch query:
 *   .where('repository', '==', repository)
 *   .where('state', '==', 'open')
 *   .where('baseBranch', '==', baseBranch)
 */

export const metadata = {
  id: '057',
  name: 'github-pr-summaries-base-branch-index',
  description: 'Composite index for github-pr-summaries open PR lookup by repository and base branch',
  createdAt: '2026-03-11',
};

export const indexes = [
  {
    collectionGroup: 'github-pr-summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'state', order: 'ASCENDING' },
      { fieldPath: 'baseBranch', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['github-pr-summaries'];

export async function up(context) {
  console.log('  Deploying github-pr-summaries repository/state/baseBranch composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing github-pr-summaries repository/state/baseBranch index requires manual deletion via Firebase console'
  );
}
