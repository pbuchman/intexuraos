/**
 * Migration 093: Composite indexes for llm_usage_events filtered oldest-first queries
 *
 * FirestoreUsageEventRepository.list() always applies:
 *   .where('occurredAt', '>=', from).where('occurredAt', '<=', to)
 * and, when providers is the first populated array filter:
 *   .where('request.provider', 'in', [...])
 * For oldest-first sorting it then applies:
 *   .orderBy('occurredAt', 'asc').orderBy('__name__', 'asc')
 *
 * Migration 086 covers the DESC variant only. This migration adds the ASC
 * provider-filtered variant surfaced by INT-1354.
 */

export const metadata = {
  id: '093',
  name: 'llm-usage-events-filtered-asc-indexes',
  description: 'Composite indexes for llm_usage_events provider-filtered oldest-first queries',
  createdAt: '2026-04-13',
};

export const indexes = [
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.provider', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events provider-filtered ASC indexes (1 index)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing llm_usage_events provider-filtered ASC indexes requires manual deletion via Firebase console'
  );
}
