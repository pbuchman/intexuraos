/**
 * Migration 001: Initial Firestore Indexes and Rules
 *
 * Deploys the baseline Firestore indexes and security rules.
 */

export const metadata = {
  id: '001',
  name: 'initial-indexes-rules',
  description: 'Deploy initial Firestore indexes and security rules',
  createdAt: '2026-01-02',
};

export const indexes = [
  {
    collectionGroup: 'actions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'actions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'actions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'commands',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'commands',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'app', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'source', order: 'ASCENDING' },
      { fieldPath: 'app', order: 'ASCENDING' },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'researches',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'researches',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'custom_data_sources',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const rules = {
  functions: {
    isAuthenticated: 'return request.auth != null;',
    isOwner: 'return isAuthenticated() && request.auth.uid == userId;',
  },
  collections: {
    'actions/{actionId}': {
      comment: '💰 CostGuard: Prevent unlimited queries, enforce userId filtering',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 100\n                  && resource.data.userId == request.auth.uid',
      listComment: '💰 CostGuard: Query limit max 100 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only)',
    },
    'researches/{researchId}': {
      comment: 'Research documents for real-time status updates',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 100\n                  && resource.data.userId == request.auth.uid',
      listComment: '💰 CostGuard: Query limit max 100 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only)',
    },
    '{document=**}': {
      comment: 'All other collections blocked from client',
      read: 'false',
      write: 'false',
    },
  },
};

export async function up(context) {
  console.log('  Deploying Firestore indexes...');
  await context.deployIndexes();

  console.log('  Deploying Firestore security rules...');
  await context.deployRules();
}
