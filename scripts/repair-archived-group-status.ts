#!/usr/bin/env npx tsx
/**
 * One-time repair: fix group summaries where taskCount=0 but aggregateStatus!='archived'.
 *
 * Root cause: recomputeWithLabels called deriveAggregateStatusFromSummary on archived groups,
 * which had no 'archived' case and defaulted to 'done'. This overwrote ~160 summaries.
 *
 * Usage:
 *   npx tsx scripts/repair-archived-group-status.ts [--dry-run]
 *
 * Logic:
 * 1. Query task_group_summaries where taskCount == 0 AND aggregateStatus != 'archived'.
 * 2. Set aggregateStatus to 'archived' for each.
 * 3. Recompute user_group_counts deltas (decrement old status, increment archived).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT_ID = 'intexuraos-dev-pbuchman';
const SA_KEY_PATH = '/secrets/gcp-sa.json';

// ---------------------------------------------------------------------------
// Firebase initialization
// ---------------------------------------------------------------------------

if (getApps().length === 0) {
  if (existsSync(SA_KEY_PATH)) {
    const serviceAccount = JSON.parse(readFileSync(SA_KEY_PATH, 'utf-8')) as object;
    initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId: PROJECT_ID,
    });
    console.log(`Initialized Firebase with service account from ${SA_KEY_PATH}`);
  } else {
    const { applicationDefault } = await import('firebase-admin/app');
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
    console.log('Initialized Firebase with application default credentials');
  }
}

const db = getFirestore();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUMMARIES_COLLECTION = 'task_group_summaries';
const COUNTS_COLLECTION = 'user_group_counts';
const BATCH_SIZE = 400;

type CountField = 'active' | 'needsAction' | 'done' | 'failed' | 'archived';

function statusToCountField(status: string): CountField {
  switch (status) {
    case 'active': return 'active';
    case 'needs-action': return 'needsAction';
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'archived': return 'archived';
    default: return 'done';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(DRY_RUN ? '[DRY RUN] No writes will be made.' : '[LIVE] Writing to Firestore.');

  // Step 1: Find all summaries with taskCount=0 that are not archived
  console.log('Querying task_group_summaries where taskCount=0 and aggregateStatus != archived...');
  const snapshot = await db
    .collection(SUMMARIES_COLLECTION)
    .where('taskCount', '==', 0)
    .get();

  const toRepair: Array<{ docId: string; userId: string; oldStatus: string }> = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const status = String(data['aggregateStatus'] ?? 'done');
    if (status !== 'archived') {
      toRepair.push({
        docId: doc.id,
        userId: String(data['userId'] ?? ''),
        oldStatus: status,
      });
    }
  }

  console.log(`Found ${toRepair.length} summaries to repair (out of ${snapshot.size} with taskCount=0).`);

  if (toRepair.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  // Group status breakdown
  const statusBreakdown = new Map<string, number>();
  for (const { oldStatus } of toRepair) {
    statusBreakdown.set(oldStatus, (statusBreakdown.get(oldStatus) ?? 0) + 1);
  }
  for (const [status, count] of statusBreakdown) {
    console.log(`  ${status}: ${count}`);
  }

  if (DRY_RUN) {
    for (const { docId, oldStatus } of toRepair) {
      console.log(`  [DRY RUN] Would repair: ${docId} (${oldStatus} → archived)`);
    }
    console.log(`\nDry run complete. Would repair ${toRepair.length} summaries.`);
    return;
  }

  // Step 2: Fix summaries in batches
  const now = Timestamp.fromDate(new Date());
  let repairedCount = 0;

  for (let i = 0; i < toRepair.length; i += BATCH_SIZE) {
    const chunk = toRepair.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const { docId } of chunk) {
      const ref = db.collection(SUMMARIES_COLLECTION).doc(docId);
      batch.update(ref, { aggregateStatus: 'archived', updatedAt: now });
    }

    await batch.commit();
    repairedCount += chunk.length;
    console.log(`  Committed summary batch: ${repairedCount}/${toRepair.length}`);
  }

  // Step 3: Recompute user_group_counts deltas
  // Accumulate per-user: { [countField]: delta }
  const userDeltas = new Map<string, Map<CountField, number>>();
  for (const { userId, oldStatus } of toRepair) {
    if (!userDeltas.has(userId)) {
      userDeltas.set(userId, new Map());
    }
    const deltas = userDeltas.get(userId)!;
    const oldField = statusToCountField(oldStatus);
    deltas.set(oldField, (deltas.get(oldField) ?? 0) - 1);
    deltas.set('archived', (deltas.get('archived') ?? 0) + 1);
  }

  console.log(`\nUpdating user_group_counts for ${userDeltas.size} users...`);

  const userEntries = Array.from(userDeltas.entries());
  for (let i = 0; i < userEntries.length; i += BATCH_SIZE) {
    const chunk = userEntries.slice(i, i + BATCH_SIZE);

    // Fetch all user count docs in parallel to avoid N+1 sequential reads
    const refs = chunk.map(([userId]) => db.collection(COUNTS_COLLECTION).doc(userId));
    const docs = await Promise.all(refs.map((ref) => ref.get()));

    const batch = db.batch();
    for (let j = 0; j < chunk.length; j++) {
      const [userId, deltas] = chunk[j]!;
      const doc = docs[j]!;
      if (!doc.exists) {
        console.log(`  WARNING: No counts doc for user ${userId}, skipping`);
        continue;
      }
      const data = doc.data()!;
      const updates: Record<string, unknown> = { updatedAt: now };
      for (const [field, delta] of deltas) {
        const current = Number(data[field] ?? 0);
        updates[field] = Math.max(0, current + delta);
      }
      batch.update(refs[j]!, updates);
    }

    await batch.commit();
    console.log(`  Committed user_group_counts batch for ${chunk.length} users`);
  }

  console.log(`\nRepair complete. Fixed ${repairedCount} summaries across ${userDeltas.size} users.`);
}

main().catch((error: unknown) => {
  console.error('Repair failed:', error);
  process.exit(1);
});
