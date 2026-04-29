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
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/bulkDeleteForTTLRollout.ts        # dry-run
 *   npx tsx apps/code-agent/src/scripts/bulkDeleteForTTLRollout.ts --execute
 *
 * Idempotent. Safe to re-run.
 */

import { Firestore, Timestamp, type Query } from '@google-cloud/firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { RETENTION_24H_MS, RETENTION_7D_MS } from '@intexuraos/infra-firestore';

/* v8 ignore start -- module-init: standalone bulk-delete script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

const logger = createAppLogger({ name: 'bulk-delete-for-ttl-rollout' });

const BATCH_SIZE = 500;

const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? 'intexuraos-dev-pbuchman';
const dryRun = !process.argv.includes('--execute');

const fs = new Firestore({ projectId });

interface CollectionPlan {
  label: string;
  query: () => Query;
}

async function deleteByQuery(plan: CollectionPlan): Promise<number> {
  logger.info({ label: plan.label }, 'scanning');

  // Dry-run: use a count() aggregation so the operator sees the true total
  // (the doc-fetch loop below would otherwise stop at the first 500-doc window).
  if (dryRun) {
    const agg = await plan.query().count().get();
    const count = agg.data().count;
    logger.info({ label: plan.label, count }, '[DRY-RUN] would delete');
    return count;
  }

  let total = 0;
  for (;;) {
    const snap = await plan.query().limit(BATCH_SIZE).get();
    if (snap.size === 0) return total;
    const batch = fs.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    total += snap.size;
    logger.info({ label: plan.label, deleted: snap.size, total }, 'deleted batch');
    if (snap.size < BATCH_SIZE) return total;
  }
}

async function deleteTurnMetrics(cutoff7d: Timestamp): Promise<number> {
  logger.info({}, '[turn_metrics] scanning by parent code_tasks.createdAt');
  let total = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = fs
      .collection('code_tasks')
      .where('createdAt', '<', cutoff7d)
      .orderBy('createdAt')
      .limit(BATCH_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const parents = await q.get();
    if (parents.size === 0) break;

    for (const taskDoc of parents.docs) {
      // Page subcollection in BATCH_SIZE chunks so we never exceed the
      // Firestore 500-op batch ceiling for tasks with many turn_metrics rows.
      let subCursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (;;) {
        let subQ = taskDoc.ref.collection('turn_metrics').orderBy('__name__').limit(BATCH_SIZE);
        if (subCursor) subQ = subQ.startAfter(subCursor);
        const subSnap = await subQ.get();
        if (subSnap.size === 0) break;
        if (!dryRun) {
          const batch = fs.batch();
          for (const sub of subSnap.docs) batch.delete(sub.ref);
          await batch.commit();
        }
        total += subSnap.size;
        if (subSnap.size < BATCH_SIZE) break;
        subCursor = subSnap.docs[subSnap.docs.length - 1];
      }
    }

    if (parents.size < BATCH_SIZE) break;
    cursor = parents.docs[parents.docs.length - 1];
  }

  logger.info({ dryRun, turnMetricsDeleted: total }, '[turn_metrics] done');
  return total;
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
    },
    {
      label: 'github-pr-events',
      query: () => fs.collection('github-pr-events').where('processedAt', '<', cutoff24h),
    },
    {
      label: 'github-event-log-entries',
      query: () => fs.collection('github-event-log-entries').where('authPassedAt', '<', cutoff24h),
    },
    {
      label: '(group) logs',
      query: () => fs.collectionGroup('logs').where('timestamp', '<', cutoff7d),
    },
    {
      label: '(group) log_lines',
      query: () => fs.collectionGroup('log_lines').where('timestamp', '<', cutoff7d),
    },
  ];

  let grandTotal = 0;
  for (const plan of plans) {
    grandTotal += await deleteByQuery(plan);
  }
  grandTotal += await deleteTurnMetrics(cutoff7d);

  logger.info({ dryRun, grandTotal }, 'bulk-delete complete');
  if (dryRun) logger.info({}, 'Run again with --execute to commit.');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'bulk-delete failed');
  process.exit(1);
});

/* v8 ignore stop @preserve */
