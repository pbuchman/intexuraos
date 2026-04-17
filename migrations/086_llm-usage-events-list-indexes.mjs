/**
 * Migration 086: Composite indexes for llm_usage_events list queries
 *
 * Required for GET /llm-usage/events list endpoint:
 *   .where('occurredAt', '>=', from).where('occurredAt', '<=', to)
 *   + optional .where('source.service', 'in', [...])
 *   + optional .where('source.component', 'in', [...])
 *   + optional .where('request.provider', 'in', [...])
 *   + optional .where('request.model', 'in', [...])
 *   + optional .where('owner.id', 'in', [...])
 *   .orderBy(sortField, direction).orderBy('__name__', direction)
 *
 * Indexes 1-5: single equality/in filter + occurredAt desc + __name__ desc
 * Indexes 6-7: range on occurredAt + sort by different field + __name__ desc
 *
 * INT-1340: LLM usage events list API
 */

export const metadata = {
  id: '086',
  name: 'llm-usage-events-list-indexes',
  description: 'Composite indexes for llm_usage_events list queries (filter + sort combinations)',
  createdAt: '2026-04-10',
};

export const indexes = [
  // 1. Filter by source.service + sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source.service', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // 2. Filter by source.component + sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source.component', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // 3. Filter by request.provider + sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.provider', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // 4. Filter by request.model + sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.model', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // 5. Filter by owner.id + sort by occurredAt desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'owner.id', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // 6. Range on occurredAt + sort by cost.billedUsd desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: 'cost.billedUsd', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  // 7. Range on occurredAt + sort by usage.totalTokens desc
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'occurredAt', order: 'DESCENDING' },
      { fieldPath: 'usage.totalTokens', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events list query composite indexes (7 indexes)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing llm_usage_events list indexes requires manual deletion via Firebase console'
  );
}
