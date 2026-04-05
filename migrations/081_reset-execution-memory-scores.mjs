export const metadata = {
  id: '081',
  name: 'reset-execution-memory-scores',
  description:
    'Reset all execution memory scoring counters and reactivate suppressed memories so past rejections no longer penalize retrieval',
  createdAt: '2026-04-05',
};

export async function up(context) {
  const collection = context.firestore.collection('execution_memories');
  const snapshot = await collection.get();

  if (snapshot.empty) {
    console.log('  No execution memories found — nothing to reset.');
    return;
  }

  console.log(`  Found ${snapshot.size} execution memories. Resetting scores...`);

  const { FieldValue } = await import('firebase-admin/firestore');
  let resetCount = 0;
  let reactivatedCount = 0;
  const batchSize = 500;
  let batch = context.firestore.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const confidence =
      typeof data.distillationConfidence === 'number' ? data.distillationConfidence : 0.5;

    // Fresh qualityScore: effectiveness=0.5 (Laplace with 0 apps), recency=1.0 (never applied)
    const freshQualityScore = 0.5 * 0.5 + 0.3 * confidence + 0.2 * 1.0;

    const wasSuppressed = data.status === 'suppressed';

    batch.update(doc.ref, {
      applicationCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      qualityScore: freshQualityScore,
      status: 'active',
      lastAppliedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    resetCount++;
    if (wasSuppressed) {
      reactivatedCount++;
    }

    batchCount++;
    if (batchCount >= batchSize) {
      await batch.commit();
      batch = context.firestore.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`  Reset ${resetCount} memories (${reactivatedCount} reactivated from suppressed).`);
}
