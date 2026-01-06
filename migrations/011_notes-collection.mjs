/**
 * Migration 011: Notes Collection Index and Security Rules
 *
 * - Adds composite index for 'notes' collection (userId ASC, createdAt DESC)
 * - Adds Firestore security rules for 'notes' collection
 */

export const metadata = {
  id: '011',
  name: 'notes-collection',
  description: 'Add notes collection index and security rules',
  createdAt: '2026-01-05',
};

export const indexes = [
  {
    collectionGroup: 'notes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const rules = {
  collections: {
    'notes/{noteId}': {
      comment: 'User-scoped notes',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 100\n                  && resource.data.userId == request.auth.uid',
      listComment: '💰 CostGuard: Query limit max 100 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only via API)',
    },
  },
};

export async function up(context) {
  console.log('  Deploying Firestore indexes (adds notes index)...');
  await context.deployIndexes();

  console.log('  Deploying Firestore security rules (adds notes collection)...');
  await context.deployRules();
}
