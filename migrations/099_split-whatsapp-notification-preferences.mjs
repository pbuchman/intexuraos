/**
 * Migration 099: Move notificationLevel from whatsapp_user_mappings into
 * whatsapp_notification_preferences (INT-1532).
 *
 * Contract: uses the `up(context)` signature — `context.firestore` is a live
 * Firestore Admin SDK instance provided by the migration runner (mem_112a93e6).
 *
 * Safety: READ-AND-COPY only. The source field (`notificationLevel`) is NOT
 * deleted from `whatsapp_user_mappings` — that is handled by a follow-up
 * migration after ≥7 days, once the new collection is confirmed in use.
 *
 * Pagination: walks `whatsapp_user_mappings` ordered by __name__ in batches of
 * 200 docs using cursor pagination via `startAfter(lastDoc)` to avoid loading
 * the entire collection into memory.
 */

import { Timestamp } from 'firebase-admin/firestore';

export const metadata = {
  id: '099',
  name: 'split-whatsapp-notification-preferences',
  description:
    'Move notificationLevel out of whatsapp_user_mappings into whatsapp_notification_preferences (INT-1532)',
  createdAt: '2026-04-30',
};

const BATCH_SIZE = 200;
const SOURCE_COLLECTION = 'whatsapp_user_mappings';
const TARGET_COLLECTION = 'whatsapp_notification_preferences';

export async function up(context) {
  const db = context.firestore;
  let lastDoc = null;
  let migrated = 0;

  while (true) {
    let query = db.collection(SOURCE_COLLECTION).orderBy('__name__').limit(BATCH_SIZE);
    if (lastDoc !== null) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();
    let batchWrites = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const level = data.notificationLevel;

      if (level !== 'all' && level !== 'important') {
        continue;
      }

      const targetRef = db.collection(TARGET_COLLECTION).doc(doc.id);
      batch.set(
        targetRef,
        {
          userId: doc.id,
          notificationLevel: level,
          schemaVersion: 1,
          schemaUpdatedAt: now,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      );
      batchWrites++;
    }

    if (batchWrites > 0) {
      await batch.commit();
      migrated += batchWrites;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.docs.length < BATCH_SIZE) break;
  }

  console.log({ migrated });
}
