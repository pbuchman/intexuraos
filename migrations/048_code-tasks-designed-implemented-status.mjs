/**
 * Migration 048: Rename 'completed' status on code_tasks to 'designed' or 'implemented'
 *
 * 'completed' is split into two distinct terminal statuses:
 *   - 'designed'     → Phase 1 design task completed (executionPhase === 'design' or missing)
 *   - 'implemented'  → Phase 2 execution task completed (executionPhase === 'execution')
 */

export const metadata = {
  id: '048',
  name: 'code-tasks-designed-implemented-status',
  description:
    "Migrate code_tasks status 'completed' to 'designed' or 'implemented' based on executionPhase",
  createdAt: '2026-02-18',
};

export async function up(context) {
  const db = context.firestore;

  const snapshot = await db.collection('code_tasks').where('status', '==', 'completed').get();

  console.log(`  Found ${snapshot.size} completed tasks to migrate`);

  if (snapshot.size === 0) {
    console.log('  Nothing to migrate.');
    return;
  }

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let designed = 0;
  let implemented = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const newStatus = data.executionPhase === 'execution' ? 'implemented' : 'designed';

    batch.update(doc.ref, { status: newStatus });

    if (newStatus === 'implemented') {
      implemented++;
    } else {
      designed++;
    }

    count++;
    if (count % BATCH_SIZE === 0) {
      await batch.commit();
      console.log(`  Committed batch of ${BATCH_SIZE} (${count}/${snapshot.size})`);
      batch = db.batch();
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit();
  }

  console.log(`  Migration complete: ${designed} → 'designed', ${implemented} → 'implemented'`);
}
