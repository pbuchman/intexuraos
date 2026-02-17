/**
 * Migration 043: Re-deploy vector index for doc_embeddings
 *
 * Bug fix: Migration 040 created the doc_embeddings collection but the vector
 * index was not deployed because migrate.mjs incorrectly skipped single-field
 * indexes (including vector indexes). The bug has been fixed in migrate.mjs.
 *
 * This migration forces a re-deployment of all indexes to ensure the vector
 * index is properly created in Firestore.
 */

export const metadata = {
  id: '043',
  name: 'redeploy-vector-index',
  description: 'Re-deploy all indexes to fix missing vector index for doc_embeddings',
  createdAt: '2026-02-06',
};

export async function up(context) {
  console.log('  Re-deploying all Firestore indexes (including vector index)...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  No rollback needed - indexes are idempotent');
}
