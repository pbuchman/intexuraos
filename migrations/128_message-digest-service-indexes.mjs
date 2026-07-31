/**
 * Migration 128: Message Digest service indexes and terminal erasure TTL.
 *
 * The generated families cover every public list/history filter combination in
 * both directions, while the remaining exact shapes back scheduler, recovery,
 * delivery reconciliation, erasure quiescence, and staged migration queries.
 * Legacy digest indexes stay untouched for the coordinated cutover and soak.
 */

export const metadata = {
  id: '128',
  name: 'message-digest-service-indexes',
  description: 'Indexes and terminal-erasure TTL for the Message Digest service',
  createdAt: '2026-07-28',
};

export const collections = [
  'message_digest_definitions',
  'message_digest_runs',
  'message_digest_states',
  'message_digest_dispatch_outbox',
  'message_digest_erasure_requests',
  'message_digest_migration_activations',
];

const ascending = (fieldPath) => ({ fieldPath, order: 'ASCENDING' });
const ordered = (fieldPath, order) => ({ fieldPath, order });

const definitionFilters = [
  [],
  [ascending('listStatus')],
  [ascending('source.chatType')],
  [ascending('listStatus'), ascending('source.chatType')],
];

const definitionIndexes = ['updatedAt', 'nameSortKey', 'nextRunAt'].flatMap((sortField) =>
  ['ASCENDING', 'DESCENDING'].flatMap((direction) =>
    definitionFilters.map((filters) => ({
      collectionGroup: 'message_digest_definitions',
      queryScope: 'COLLECTION',
      fields: [
        ascending('userId'),
        ascending('status'),
        ...filters,
        ordered(sortField, direction),
        ordered('__name__', direction),
      ],
    }))
  )
);

const runFilters = [
  [],
  [ascending('generationStatus')],
  [ascending('delivery.status')],
  [ascending('generationStatus'), ascending('delivery.status')],
];

const runHistoryIndexes = ['ASCENDING', 'DESCENDING'].flatMap((direction) =>
  runFilters.map((filters) => ({
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('recordRole'),
      ascending('visibilityMigrationId'),
      ...filters,
      ordered('windowStart', direction),
      ordered('__name__', direction),
    ],
  }))
);

export const indexes = [
  ...definitionIndexes,
  {
    collectionGroup: 'message_digest_definitions',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('nextRunAt'), ascending('__name__')],
  },
  ...runHistoryIndexes,
  {
    collectionGroup: 'message_digest_dispatch_outbox',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('nextAttemptAt'), ascending('__name__')],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('recordRole'),
      ascending('visibilityMigrationId'),
      ascending('generationStatus'),
      ascending('delivery.status'),
      ascending('delivery.nextCheckAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('lease.expiresAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_dispatch_outbox',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('claim.expiresAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('deliveryAuthorization.expiresAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_migration_activations',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('createdAt'), ascending('__name__')],
  },
  {
    collectionGroup: 'message_digest_definitions',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('legacyAlias.groupKey'),
      ascending('status'),
    ],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('recordRole'),
      ascending('visibilityMigrationId'),
      ascending('trigger'),
      ascending('generationStatus'),
      ordered('scheduledBoundary', 'DESCENDING'),
      ordered('__name__', 'DESCENDING'),
    ],
  },
];

export const fieldOverrides = [
  {
    collectionGroup: 'message_digest_erasure_requests',
    fieldPath: 'expiresAt',
    ttl: true,
    indexes: [],
  },
];

export async function up(context) {
  console.log('  Deploying Message Digest service indexes and terminal erasure TTL...');
  await context.deployIndexes();
}
