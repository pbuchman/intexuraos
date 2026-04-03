export const metadata = {
  id: '073',
  name: 'create-execution-memories',
  description: 'Create execution memory collections and vector index',
  createdAt: '2026-03-25',
};

export const indexes = [
  {
    collectionGroup: 'execution_memories',
    queryScope: 'COLLECTION',
    fields: [
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
  {
    collectionGroup: 'execution_memories',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
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

export const rules = {
  collections: {
    'execution_memories/{memoryId}': {
      comment: 'Canonical execution memories for code-agent retrieval',
      read: 'false',
      write: 'false',
    },
    'execution_memory_applications/{applicationId}': {
      comment: 'Execution memory retrieval/application audit records',
      read: 'false',
      write: 'false',
    },
  },
};

export async function up(context) {
  console.log('  Deploying execution memory indexes...');
  await context.deployIndexes();

  console.log('  Deploying execution memory security rules...');
  await context.deployRules();
}
