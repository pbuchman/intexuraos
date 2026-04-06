/**
 * Migration 083: Composite index for findLatestAskAgentTask query
 *
 * Required for GET /code/ask-agent/active:
 *   .where('userId', '==', userId)
 *   .where('agentType', '==', 'ask_agent')
 *   .where('status', 'in', NON_ARCHIVED_STATUSES)
 *   .orderBy('createdAt', 'desc')
 *   .limit(1)
 */

export const metadata = {
  id: '083',
  name: 'code-tasks-ask-agent-active-query-index',
  description:
    'Composite index for code_tasks ask-agent active query (userId, agentType, status, createdAt)',
  createdAt: '2026-04-05',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'agentType', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks ask-agent active query composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing code_tasks ask-agent active query index requires manual deletion via Firebase console'
  );
}
