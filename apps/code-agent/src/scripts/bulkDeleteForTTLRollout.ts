/**
 * One-shot script: bulk-deletes all documents that already exceed the new
 * Firestore TTL retention windows.
 *
 * Run once on TTL rollout. New writes carry an `expireAt` field that the
 * `google_firestore_field` TTL policy uses going forward; existing docs lack
 * that field and would otherwise sit forever.
 *
 * Cutoffs:
 *   github-webhook-audit-events  receivedAt   < now - 24h
 *   github-pr-events             processedAt  < now - 24h
 *   github-event-log-entries     authPassedAt < now - 24h
 *   (group) logs                 timestamp    < now - 7d
 *   (group) log_lines            timestamp    < now - 7d
 *   turn_metrics                 deleted via parent code_tasks.createdAt < now - 7d
 *   log_entries                  empty in production — skipped
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/bulkDeleteForTTLRollout.ts        # dry-run
 *   npx tsx apps/code-agent/src/scripts/bulkDeleteForTTLRollout.ts --execute
 *
 * Idempotent. Safe to re-run.
 */

import { Firestore, Timestamp, type Query } from '@google-cloud/firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';

/* v8 ignore start -- module-init: standalone bulk-delete script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

const logger = createAppLogger({ name: 'bulk-delete-for-ttl-rollout' });

const RETENTION_24H_MS = 24 * 60 * 60 * 1000;
const RETENTION_7D_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? 'intexuraos-dev-pbuchman';
const dryRun = !process.argv.includes('--execute');

const fs = new Firestore({ projectId });

interface CollectionPlan {
  label: string;
  query: () => Query;
  isCollectionGroup: boolean;
}

async function deleteByQuery(plan: CollectionPlan): Promise<number> {
  logger.info({ label: plan.label }, 'scanning');
  let totalDeleted = 0;
  let more = true;
  while (more) {
    const snap = await plan.query().limit(BATCH_SIZE).get();
    if (snap.size === 0) {
      more = false;
      break;
    }

    if (dryRun) {
      const samplePath = snap.docs[0]?.ref.path ?? '?';
      logger.info({ label: plan.label, count: snap.size, sample: samplePath }, '[DRY-RUN] would delete');
      totalDeleted += snap.size;
      // In dry-run we cannot loop forever — break after first window.
      more = false;
      break;
    }

    const batch = fs.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    totalDeleted += snap.size;
    logger.info({ label: plan.label, deleted: snap.size, total: totalDeleted }, 'deleted batch');
    if (snap.size < BATCH_SIZE) more = false;
  }
  logger.info({ label: plan.label, dryRun, totalDeleted }, 'done');
  return totalDeleted;
}

async function main(): Promise<void> {
  const now = Date.now();
  const cutoff24h = Timestamp.fromMillis(now - RETENTION_24H_MS);
  const cutoff7d = Timestamp.fromMillis(now - RETENTION_7D_MS);

  logger.info(
    {
      mode: dryRun ? 'DRY-RUN' : 'EXECUTE',
      projectId,
      cutoff24h: cutoff24h.toDate().toISOString(),
      cutoff7d: cutoff7d.toDate().toISOString(),
    },
    'starting bulk-delete'
  );

  const plans: CollectionPlan[] = [
    {
      label: 'github-webhook-audit-events',
      query: () => fs.collection('github-webhook-audit-events').where('receivedAt', '<', cutoff24h),
      isCollectionGroup: false,
    },
    {
      label: 'github-pr-events',
      query: () => fs.collection('github-pr-events').where('processedAt', '<', cutoff24h),
      isCollectionGroup: false,
    },
    {
      label: 'github-event-log-entries',
      query: () => fs.collection('github-event-log-entries').where('authPassedAt', '<', cutoff24h),
      isCollectionGroup: false,
    },
    {
      label: '(group) logs',
      query: () => fs.collectionGroup('logs').where('timestamp', '<', cutoff7d),
      isCollectionGroup: true,
    },
    {
      label: '(group) log_lines',
      query: () => fs.collectionGroup('log_lines').where('timestamp', '<', cutoff7d),
      isCollectionGroup: true,
    },
  ];

  let grandTotal = 0;
  for (const plan of plans) {
    grandTotal += await deleteByQuery(plan);
  }

  // turn_metrics: timestamp is an ISO string, so we can't do a server-side
  // Timestamp comparison. Instead, find code_tasks.createdAt < now - 7d, then
  // delete each task's turn_metrics subcollection.
  logger.info({}, '[turn_metrics] scanning by parent code_tasks.createdAt');
  let turnMetricsDeleted = 0;
  const oldTasksSnap = await fs.collection('code_tasks').where('createdAt', '<', cutoff7d).get();
  logger.info({ eligibleParents: oldTasksSnap.size }, 'turn_metrics parent tasks found');
  for (const taskDoc of oldTasksSnap.docs) {
    const subSnap = await taskDoc.ref.collection('turn_metrics').get();
    if (subSnap.size === 0) continue;
    if (dryRun) {
      turnMetricsDeleted += subSnap.size;
      continue;
    }
    const batch = fs.batch();
    for (const sub of subSnap.docs) batch.delete(sub.ref);
    await batch.commit();
    turnMetricsDeleted += subSnap.size;
  }
  logger.info({ dryRun, turnMetricsDeleted }, '[turn_metrics] done');
  grandTotal += turnMetricsDeleted;

  logger.info({ dryRun, grandTotal }, 'bulk-delete complete');
  if (dryRun) logger.info({}, 'Run again with --execute to commit.');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'bulk-delete failed');
  process.exit(1);
});

/* v8 ignore stop @preserve */
