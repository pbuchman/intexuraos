/**
 * Migration 008: Commands Security Rules & Composite Feeds Index
 *
 * - Adds Firestore security rules for 'commands' collection (enables real-time updates in Inbox)
 * - Adds composite index for 'composite_feeds' collection (userId ASC, createdAt DESC, __name__ DESC)
 */

export const metadata = {
  id: '008',
  name: 'commands-rules-composite-feeds-index',
  description: 'Add commands security rules and composite_feeds index',
  createdAt: '2026-01-05',
};

export const indexes = [
  {
    collectionGroup: 'composite_feeds',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export const rules = {
  collections: {
    'commands/{commandId}': {
      comment: 'Commands for real-time inbox updates',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 100\n                  && resource.data.userId == request.auth.uid',
      listComment: '💰 CostGuard: Query limit max 100 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only)',
    },
  },
};

export async function up(context) {
  console.log('  Deploying Firestore indexes (adds composite_feeds index)...');
  await context.deployIndexes();

  console.log('  Deploying Firestore security rules (adds commands collection)...');
  await context.deployRules();
}
