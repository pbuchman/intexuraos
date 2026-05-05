/**
 * Migration 101: Fishing Assistant knowledge base indexes
 *
 * Adds the composite and vector indexes required by the new Fishing Assistant
 * Firestore repository query surface.
 */

export const metadata = {
  id: '101',
  name: 'fishing-assistant-knowledge-indexes',
  description: 'Composite and vector indexes for Fishing Assistant knowledge base queries',
  createdAt: '2026-05-05',
};

export const indexes = [
  {
    collectionGroup: 'fishing_knowledge_folders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'sortOrder', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'folderId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'folderId', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'pageId', order: 'ASCENDING' },
      { fieldPath: 'index', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'pageId', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      {
        fieldPath: 'embedding',
        order: 'ASCENDING',
        vectorConfig: {
          dimension: 1536,
          flatIndexEnabled: true,
        },
      },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Fishing Assistant knowledge base indexes...');
  await context.deployIndexes();
}
