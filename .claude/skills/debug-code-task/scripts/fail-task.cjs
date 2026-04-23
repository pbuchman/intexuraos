// Usage: node fail-task.cjs <taskId> <reason>
// Marks a stuck task as failed in Firestore. Does NOT clean up orchestrator
// in-memory state (token refresher, etc.) — restart orchestrator if needed.

const admin = require('firebase-admin');
const sa = require(process.env.HOME + '/.config/gcloud/sa-key.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const taskId = process.argv[2];
const reason = process.argv[3] || 'Manually marked failed';

if (!taskId) {
  console.error('Usage: node fail-task.cjs <taskId> <reason>');
  process.exit(1);
}

async function main() {
  const ref = db.collection('code_tasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('Task not found: ' + taskId);
    process.exit(1);
  }
  const cur = snap.data();
  if (cur.status !== 'running') {
    console.error(`Task status is '${cur.status}', not 'running'. Aborting.`);
    process.exit(1);
  }
  const now = admin.firestore.Timestamp.now();
  await ref.update({
    status: 'failed',
    completedAt: now,
    updatedAt: now,
    error: {
      code: 'TASK_STUCK_MANUAL_CLEANUP',
      message: reason,
      remediation: { action: 'retry' },
    },
  });
  console.log('Task ' + taskId + ' marked failed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
