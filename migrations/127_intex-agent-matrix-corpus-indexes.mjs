/**
 * Migration 127: Intex Agent Matrix corpus Test Runs indexes.
 *
 * These exact indexes back the committed event-watermark reader, bounded owner
 * retention query, and terminal staged-artifact deadline sweeper.
 */

export const metadata = {
  id: '127',
  name: 'intex-agent-matrix-corpus-indexes',
  description: 'Indexes for Test Runs retention, event watermarks, and artifact recovery',
  createdAt: '2026-07-20',
};

export const collections = ['intex_agent_session_events', 'intex_agent_test_runs'];

export const indexes = [
  {
    collectionGroup: 'intex_agent_session_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sessionId', order: 'ASCENDING' },
      { fieldPath: 'eventSequence', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'intex_agent_test_runs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'runtimeAudience', order: 'ASCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'intex_agent_test_runs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'artifactDelivery.status', order: 'ASCENDING' },
      { fieldPath: 'finishedAt', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Intex Agent Matrix corpus Test Runs indexes...');
  await context.deployIndexes();
}
