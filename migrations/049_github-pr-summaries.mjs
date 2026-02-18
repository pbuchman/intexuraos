/**
 * Migration 049: Backfill github-pr-summaries from existing events
 *
 * Creates one summary doc per unique PR from the last 30 days of events.
 * Going forward, summaries are upserted on every webhook event.
 */

export const metadata = {
  id: '049',
  name: 'github-pr-summaries',
  description:
    'Backfill github-pr-summaries collection from existing github-pr-events (last 30 days)',
  createdAt: '2026-02-18',
};

export async function up(context) {
  const db = context.firestore;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const snapshot = await db.collection('github-pr-events').where('createdAt', '>=', cutoff).get();

  console.log(`  Found ${snapshot.size} events in last 30 days to process`);

  if (snapshot.size === 0) {
    console.log('  Nothing to backfill.');
    return;
  }

  // Group events by PR key, collecting summary fields
  // Process in Firestore doc order (no guaranteed sort) — take latest fields per PR
  const summaryMap = new Map();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const repository = data.repository;
    const pullRequestNumber = data.pullRequestNumber;

    // Skip push/ping events (pullRequestNumber === 0)
    if (pullRequestNumber === 0) continue;

    const key = `${repository.replace('/', '__')}#${String(pullRequestNumber)}`;
    const createdAt = data.createdAt instanceof Date ? data.createdAt : data.createdAt.toDate();

    const existing = summaryMap.get(key);

    if (!existing) {
      summaryMap.set(key, {
        repository,
        pullRequestNumber,
        lastActivityAt: createdAt,
        firstSeenAt: createdAt,
        title: data.title ?? null,
        state: data.state ?? null,
        mergedAt: data.mergedAt ?? null,
      });
    } else {
      // Track earliest and latest timestamps
      if (createdAt > existing.lastActivityAt) {
        existing.lastActivityAt = createdAt;
      }
      if (createdAt < existing.firstSeenAt) {
        existing.firstSeenAt = createdAt;
      }
      // Prefer pull_request event data for title/state/mergedAt
      if (data.eventType === 'pull_request') {
        existing.title = data.title ?? existing.title;
        existing.state = data.state ?? existing.state;
        existing.mergedAt = data.mergedAt ?? existing.mergedAt;
      }
    }
  }

  console.log(`  Writing ${summaryMap.size} PR summaries`);

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;

  for (const [key, summary] of summaryMap) {
    const docRef = db.collection('github-pr-summaries').doc(key);
    batch.set(docRef, summary);
    count++;

    if (count % BATCH_SIZE === 0) {
      await batch.commit();
      console.log(`  Committed batch of ${BATCH_SIZE} (${count}/${summaryMap.size})`);
      batch = db.batch();
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit();
  }

  console.log(`  Backfill complete: ${count} PR summaries written`);
}

export async function down() {
  console.log('  Removing summaries requires manual deletion via Firebase console');
}
