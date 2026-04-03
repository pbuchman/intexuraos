/**
 * Migration 075: Re-deploy indexes to fix missing execution_memories vector index
 *
 * Migration 073 defined composite vector indexes for execution_memories
 * (repository + status + embedding) and migration 074 added a code_tasks
 * composite index. However, firestore.indexes.json was never regenerated
 * after those migrations were added, so the indexes were never deployed.
 *
 * This migration forces a re-deployment of all aggregated indexes.
 */

export const metadata = {
  id: '075',
  name: 'redeploy-execution-memory-indexes',
  description: 'Re-deploy all indexes to fix missing execution_memories vector index and code_tasks pipeline index',
  createdAt: '2026-04-03',
};

export async function up(context) {
  console.log('  Re-deploying all Firestore indexes (including execution_memories vector index)...');
  await context.deployIndexes();
}
