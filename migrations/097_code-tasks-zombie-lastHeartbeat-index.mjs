/**
 * Migration 097: Composite index for findZombieTasks on lastHeartbeat
 *
 * Required by code-agent findZombieTasks query:
 *   where('status', 'in', ['dispatched', 'running'])
 *   where('lastHeartbeat', '<', staleThreshold)
 *
 * Replaces the previous updatedAt-based staleness query, which was
 * vulnerable to false refresh from unrelated writes (e.g. PR merge
 * webhooks setting prMergedAt, which bumped updatedAt).
 */

export const metadata = {
  id: '097',
  name: 'code-tasks-zombie-lastHeartbeat-index',
  description: 'Composite index for findZombieTasks(status, lastHeartbeat)',
  createdAt: '2026-04-17',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'lastHeartbeat', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks zombie-detection composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing the composite index requires manual deletion via Firebase console');
}
