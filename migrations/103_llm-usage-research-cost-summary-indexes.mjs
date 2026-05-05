/**
 * Migration 103: Composite indexes for llm_usage_events research-cost summary queries
 *
 * Supports POST /internal/usage/research-cost-summary:
 *   .where('correlation.researchId', '==', researchId)
 *   + optional owner guard
 *   + optional occurredAt range
 *   .orderBy('occurredAt', 'asc').orderBy('__name__', 'asc')
 *
 * INT-1592: LLM usage research-cost summary
 */

export const metadata = {
  id: '103',
  name: 'llm-usage-research-cost-summary-indexes',
  description: 'Composite indexes for llm_usage_events research-cost summary queries',
  createdAt: '2026-05-05',
};

export const indexes = [
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'correlation.researchId', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'correlation.researchId', order: 'ASCENDING' },
      { fieldPath: 'owner.type', order: 'ASCENDING' },
      { fieldPath: 'owner.id', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events research-cost summary indexes (2 indexes)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing llm_usage_events research-cost summary indexes requires manual deletion via Firebase console'
  );
}
