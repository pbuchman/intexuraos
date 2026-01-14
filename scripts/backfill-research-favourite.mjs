#!/usr/bin/env node
/**
 * Quick script to backfill favourite: false for researches without the field
 * For local testing with emulator
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { applicationDefault } from 'firebase-admin/app';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) {
  console.error('Set FIRESTORE_EMULATOR_HOST=localhost:8080');
  process.exit(1);
}

process.env.FIRESTORE_AUTH_EMULATOR_HOST = emulatorHost;

initializeApp({
  credential: applicationDefault(),
  projectId: 'demo-intexuraos',
});

const db = getFirestore();
const collection = db.collection('researches');

console.log('Fetching researches...');
const snapshot = await collection.get();

console.log(`Found ${snapshot.docs.length} researches`);

let missingCount = 0;
let updatedCount = 0;

for (const doc of snapshot.docs) {
  const data = doc.data();
  if (data.favourite === undefined) {
    missingCount++;
    await doc.ref.update({ favourite: false });
    updatedCount++;
    if (updatedCount % 10 === 0) {
      console.log(`Updated ${updatedCount}...`);
    }
  }
}

console.log(`\nBackfill complete!`);
console.log(`  Total researches: ${snapshot.docs.length}`);
console.log(`  Missing favourite: ${missingCount}`);
console.log(`  Updated: ${updatedCount}`);
