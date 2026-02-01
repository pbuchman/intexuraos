/**
 * Migration 040: Create doc_embeddings collection with vector index
 *
 * - Creates doc_embeddings collection for storing documentation chunks with embeddings
 * - Adds vector index for KNN similarity search (1536 dimensions for OpenAI text-embedding-3-small)
 * - Adds Firestore security rules for doc_embeddings collection
 *
 * Schema:
 *   content: string           - chunk text content
 *   embedding: vector<1536>   - embedding vector for similarity search
 *   filePath: string          - source file path (e.g., "docs/services/todos-agent/API.md")
 *   section: string           - section identifier (e.g., "POST /todos")
 *   docType: string           - 'markdown' | 'openapi'
 *   createdAt: timestamp      - creation timestamp
 */

export const metadata = {
  id: '040',
  name: 'create-doc-embeddings',
  description: 'Create doc_embeddings collection with vector index',
  createdAt: '2026-01-31',
};

export const indexes = [
  {
    collectionGroup: 'doc_embeddings',
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
];

export const rules = {
  functions: {
    isDocsContent: 'request.auth != null',
  },
  collections: {
    'doc_embeddings/{chunkId}': {
      comment: 'Documentation chunks with vector embeddings for RAG',
      read: 'isAuthenticated()',
      readComment: 'Authenticated users can search documentation',
      write: 'false',
      writeComment: 'Client cannot write (backend-only via embedding script)',
    },
  },
};

export async function up(context) {
  console.log('  Deploying Firestore vector index for doc_embeddings...');
  await context.deployIndexes();

  console.log('  Deploying Firestore security rules for doc_embeddings...');
  await context.deployRules();
}
