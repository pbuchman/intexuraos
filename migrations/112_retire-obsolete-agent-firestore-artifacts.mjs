/**
 * Migration 112: Retire Firestore artifacts for removed agent services
 *
 * The service code, active collection registry, and active rules/index artifacts
 * no longer use these collection groups. Historical migrations remain immutable,
 * so this cleanup migration tells the artifact aggregator to filter them out of
 * generated firestore.indexes.json and firestore.rules.
 */

export const metadata = {
  id: '112',
  name: 'retire-obsolete-agent-firestore-artifacts',
  description: 'Remove generated Firestore indexes and rules for retired agent services',
  createdAt: '2026-06-23',
};

export const indexes = [];

export const removedCollectionGroups = [
  'todos',
  'doc_embeddings',
  'cron_schedules',
  'cron_executions',
];

export const removedRulePaths = ['doc_embeddings/{chunkId}'];

export async function up(context) {
  console.log('  Cleanup migration 112: deploying regenerated Firestore indexes and rules');
  await context.deployIndexes();
  await context.deployRules();
}
