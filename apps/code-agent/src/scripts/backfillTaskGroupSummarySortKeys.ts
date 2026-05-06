/**
 * Idempotent backfill for task_group_summaries Linear issue sort-key fields.
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/backfillTaskGroupSummarySortKeys.ts
 *   npx tsx apps/code-agent/src/scripts/backfillTaskGroupSummarySortKeys.ts --dry-run
 *
 * Default mode applies updates. Use --dry-run to inspect without writing.
 */

import { Firestore } from '@google-cloud/firestore';
import { getLinearIssueSortFields } from '../infra/firestore/taskGroupSummary/serializer.js';
/* v8 ignore start -- module-init: standalone backfill script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

const SUMMARIES_COLLECTION = 'task_group_summaries';
const BATCH_SIZE = 500;

interface PendingUpdate {
  docId: string;
  linearIssueId: string | null;
  before: {
    linearIssueNumber: unknown;
    linearIssueSortKey: unknown;
  };
  after: {
    linearIssueNumber: number | null;
    linearIssueSortKey: number;
  };
}

function parseDryRun(argv: string[]): boolean {
  return argv.includes('--dry-run');
}

function normalizeLinearIssueId(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function needsUpdate(data: Record<string, unknown>, expected: PendingUpdate['after']): boolean {
  return data['linearIssueNumber'] !== expected.linearIssueNumber ||
    data['linearIssueSortKey'] !== expected.linearIssueSortKey;
}

async function main(): Promise<void> {
  const dryRun = parseDryRun(process.argv.slice(2));
  const db = new Firestore();
  const snapshot = await db.collection(SUMMARIES_COLLECTION).get();
  const updates: PendingUpdate[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const linearIssueId = normalizeLinearIssueId(data['linearIssueId']);
    const expected = getLinearIssueSortFields(linearIssueId);

    if (!needsUpdate(data, expected)) {
      continue;
    }

    updates.push({
      docId: doc.id,
      linearIssueId,
      before: {
        linearIssueNumber: data['linearIssueNumber'],
        linearIssueSortKey: data['linearIssueSortKey'],
      },
      after: expected,
    });
  }

  if (!dryRun) {
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const update of updates.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection(SUMMARIES_COLLECTION).doc(update.docId), update.after, { merge: true });
      }
      await batch.commit();
    }
  }

  process.stdout.write(`${JSON.stringify({
    dryRun,
    scanned: snapshot.size,
    updated: updates.length,
    updates,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

/* v8 ignore stop @preserve */
