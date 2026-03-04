// Usage: node fetch-task.cjs <taskId> [--logs] [--logs-only]
// Must run from monorepo root for firebase-admin module resolution.

const admin = require('firebase-admin');
const sa = require(process.env.HOME + '/.config/gcloud/sa-key.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const taskId = process.argv[2];
const wantLogs = process.argv.includes('--logs') || process.argv.includes('--logs-only');
const logsOnly = process.argv.includes('--logs-only');

if (!taskId) {
  console.error('Usage: node fetch-task.cjs <taskId> [--logs] [--logs-only]');
  process.exit(1);
}

async function main() {
  if (!logsOnly) {
    const snap = await db.collection('code_tasks').doc(taskId).get();
    if (!snap.exists) {
      console.error('Task not found: ' + taskId);
      process.exit(1);
    }
    console.log(JSON.stringify(snap.data(), null, 2));
  }

  if (wantLogs) {
    if (!logsOnly) console.log('\n--- LOG LINES ---\n');
    const logSnap = await db.collection('code_tasks').doc(taskId)
      .collection('log_lines').orderBy('sequence').get();
    console.log('Total log lines: ' + logSnap.size);
    logSnap.forEach(doc => {
      const d = doc.data();
      console.log('[' + d.sequence + '] ' + d.text);
    });
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
