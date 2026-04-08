export const metadata = {
  id: '085',
  name: 'deduplicate-execution-memories',
  description:
    'One-time deduplication pass: group active memories by memoryType + fingerprint, keep highest qualityScore, suppress duplicates',
  createdAt: '2026-04-08',
};

export async function up(context) {
  const { FieldValue } = await import('firebase-admin/firestore');
  const collection = context.firestore.collection('execution_memories');
  const snapshot = await collection
    .where('repository', '==', 'pbuchman/intexuraos')
    .where('status', '==', 'active')
    .get();

  if (snapshot.empty) {
    console.log('  No active execution memories found.');
    return;
  }

  console.log(`  Found ${snapshot.size} active memories. Running dedup pass...`);

  const byType = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const type = data.memoryType;
    if (!byType[type]) byType[type] = [];
    byType[type].push({
      id: doc.id,
      title: data.title,
      qualityScore: typeof data.qualityScore === 'number' ? data.qualityScore : 0,
      fingerprint: data.fingerprint || '',
    });
  }

  let suppressedCount = 0;
  let batch = context.firestore.batch();
  let batchCount = 0;
  const batchSize = 400;

  for (const [type, memories] of Object.entries(byType)) {
    const byFingerprint = {};
    for (const mem of memories) {
      if (mem.fingerprint === '') continue;
      if (!byFingerprint[mem.fingerprint]) byFingerprint[mem.fingerprint] = [];
      byFingerprint[mem.fingerprint].push(mem);
    }

    for (const [fingerprint, group] of Object.entries(byFingerprint)) {
      if (group.length <= 1) continue;

      group.sort((a, b) => b.qualityScore - a.qualityScore);
      const keeper = group[0];
      console.log(
        `  [${type}] Keeping "${keeper.title}" (quality=${keeper.qualityScore.toFixed(3)}), suppressing ${group.length - 1} dupes with fingerprint ${fingerprint.slice(0, 12)}...`
      );

      for (let i = 1; i < group.length; i++) {
        batch.update(collection.doc(group[i].id), {
          status: 'suppressed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        suppressedCount++;
        batchCount++;

        if (batchCount >= batchSize) {
          await batch.commit();
          batch = context.firestore.batch();
          batchCount = 0;
        }
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`  Dedup complete. Suppressed ${suppressedCount} duplicate memories.`);
}
