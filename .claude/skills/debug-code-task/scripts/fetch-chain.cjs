// Fetch all tasks for a given linearIssueId, sorted by createdAt asc.
const admin = require('firebase-admin');
const sa = require(process.env.HOME + '/.config/gcloud/sa-key.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const linearIssueId = process.argv[2];

async function main() {
  const snap = await db.collection('code_tasks').where('linearIssueId', '==', linearIssueId).get();

  const tasks = [];
  snap.forEach((doc) => {
    const d = doc.data();
    tasks.push({
      id: d.id,
      agentType: d.agentType,
      status: d.status,
      createdAt: d.createdAt?._seconds,
      completedAt: d.completedAt?._seconds,
      prNumber: d.prNumber,
      linearIssueId: d.linearIssueId,
      traceId: d.traceId,
      prBranch: d.prBranch,
      needs_remediation: d.result?.needs_remediation,
      requires_re_review: d.result?.requires_re_review,
      requiresReReview: d.requiresReReview,
      execution_outcome_label: d.result?.execution_outcome_label,
      resultSummary: d.result?.summary
        ? d.result.summary.slice(0, 80) + (d.result.summary.length > 80 ? '...' : '')
        : undefined,
    });
  });
  tasks.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const t of tasks) {
    console.log(JSON.stringify(t));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
