/**
 * Migration 080: Reset errored execution memory post-run tasks
 *
 * Root cause: Three tasks hit the evaluation schema parse bug (missing `summary`
 * field with no repair logic). The bug was fixed in INT-1268 (evaluation schema
 * repair + EVALUATION_SCHEMA_BLOCK), but these tasks exhausted their 3 retry
 * attempts before the fix was deployed. This migration resets them to `pending`
 * so the fixed backlog processor can reprocess them.
 *
 * Affected tasks:
 * - task_507fff19-10e5-4abb-a038-c74639aebc7d (execution, INT-1271)
 * - task_868e1c9b-0add-418a-9afe-1f143bcba68a (execution, INT-1272)
 * - task_c9c2c6de-d666-4e68-a4dd-cf4a16c292e9 (review, INT-1272)
 */

export const metadata = {
  id: '080',
  name: 'reset-errored-execution-memory-postrun',
  description: 'Reset 3 errored execution memory post-run tasks to pending',
  createdAt: '2026-04-05',
};

export async function up(context) {
  const db = context.firestore;

  const taskIds = [
    'task_507fff19-10e5-4abb-a038-c74639aebc7d',
    'task_868e1c9b-0add-418a-9afe-1f143bcba68a',
    'task_c9c2c6de-d666-4e68-a4dd-cf4a16c292e9',
  ];

  const batch = db.batch();

  for (const taskId of taskIds) {
    const ref = db.collection('code_tasks').doc(taskId);
    batch.update(ref, {
      'executionMemoryPostRun.status': 'pending',
      'executionMemoryPostRun.attempts': 0,
      'executionMemoryPostRun.errorMessage': null,
    });
  }

  await batch.commit();

  console.log(`Reset ${taskIds.length} errored execution memory post-run tasks to pending`);
}
