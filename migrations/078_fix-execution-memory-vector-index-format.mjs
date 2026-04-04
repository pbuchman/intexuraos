/**
 * Migration 078: Fix execution_memories vector index format and redeploy
 *
 * Root cause: Migration 073 defined vector fields with both `order: 'ASCENDING'`
 * and `vectorConfig`. Firebase CLI handles this ambiguity differently per index type:
 *   - Standalone vector (1 field): ignores `order`, creates vector index (doc_embeddings works)
 *   - Composite vector (N fields): ignores `vectorConfig`, creates regular index (execution_memories broken)
 *
 * Fix: aggregateIndexes() in migrate.mjs now normalizes vector fields by stripping
 * `order` and converting `flatIndexEnabled` to `flat: {}` (Firebase CLI format).
 *
 * This migration redeploys all indexes with the corrected format so the
 * execution_memories composite vector index is created properly.
 */

export const metadata = {
  id: '078',
  name: 'fix-execution-memory-vector-index-format',
  description:
    'Fix execution_memories composite vector index format (strip order from vector fields) and redeploy',
  createdAt: '2026-04-04',
};

export async function up(context) {
  console.log('  Re-deploying all Firestore indexes with corrected vector field format...');
  await context.deployIndexes();
}
